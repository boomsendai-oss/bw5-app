// One-off: lstep_friends の blocked 列だけを Lstep 全件 CSV から修正する。
// 本番 Turso に直接接続 (.env.production.local の TURSO_* を使用)。
// member_lstep_links / boom_members 等、他テーブルには一切触れない。
//
// 使い方:
//   node scripts/sync_lstep_blocked.mjs <csv_path> [--apply]
//   --apply を付けない場合は dry-run (集計のみ、UPDATE しない)
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';

// --- .env.production.local を素朴にパース ---
function loadEnv(path) {
  const txt = readFileSync(path, 'utf-8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

// --- 軽量 CSV パーサ (src/lib/csvUtil.ts と同等) ---
function parseCSV(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cur.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows;
}

function rowsToDicts(rows, headerRowIndex = 0) {
  if (rows.length <= headerRowIndex) return [];
  const headers = rows[headerRowIndex];
  return rows.slice(headerRowIndex + 1).map((row) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (row[idx] ?? '').trim(); });
    return obj;
  });
}

function isBlocked(raw) {
  const v = (raw ?? '').trim();
  return ['1', 'ブロック', 'ブロック中', 'TRUE', 'true', 'yes', 'Yes'].includes(v);
}

async function main() {
  const csvPath = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!csvPath) {
    console.error('usage: node scripts/sync_lstep_blocked.mjs <csv_path> [--apply]');
    process.exit(1);
  }
  loadEnv('.env.production.local');
  if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL missing');

  // CP932 で読む
  const buf = readFileSync(csvPath);
  const lstepText = new TextDecoder('shift-jis').decode(buf);
  const rows = rowsToDicts(parseCSV(lstepText), 1).filter((r) => {
    const id = (r['ID'] ?? '').trim();
    return id && /^\d+$/.test(id);
  });
  if (rows.length === 0) throw new Error('CSV から有効な行を読めません');
  if (!('ユーザーブロック' in rows[0])) throw new Error('「ユーザーブロック」列が見つかりません');

  const csvBlocked = new Map();
  let csvBlockedCount = 0;
  for (const r of rows) {
    const lid = (r['ID'] ?? '').trim();
    const b = isBlocked(r['ユーザーブロック']) ? 1 : 0;
    csvBlocked.set(lid, b);
    if (b === 1) csvBlockedCount++;
  }
  console.log(`CSV rows=${rows.length} blocked=${csvBlockedCount} not_blocked=${rows.length - csvBlockedCount}`);

  const c = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const before = (await c.execute(
    `SELECT SUM(CASE WHEN blocked=0 THEN 1 ELSE 0 END) nb, SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) b, COUNT(*) t FROM lstep_friends`
  )).rows[0];
  console.log('lstep_friends BEFORE:', JSON.stringify(before));
  const linksBefore = (await c.execute(`SELECT COUNT(*) n FROM member_lstep_links`)).rows[0];
  console.log('member_lstep_links BEFORE:', JSON.stringify(linksBefore));

  const existing = (await c.execute(`SELECT lstep_id FROM lstep_friends`)).rows;
  const existingIds = new Set(existing.map((r) => String(r.lstep_id)));

  const stmts = [];
  let notInDb = 0;
  for (const [lid, blocked] of csvBlocked) {
    if (!existingIds.has(lid)) { notInDb++; continue; }
    stmts.push({
      sql: `UPDATE lstep_friends SET blocked = ?, updated_at = CURRENT_TIMESTAMP WHERE lstep_id = ?`,
      args: [blocked, lid],
    });
  }
  console.log(`will UPDATE ${stmts.length} rows; csv_ids_not_in_db=${notInDb}`);

  if (!apply) {
    console.log('DRY-RUN (no --apply). Nothing written.');
    return;
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await c.batch(stmts.slice(i, i + 50), 'write');
  }

  const after = (await c.execute(
    `SELECT SUM(CASE WHEN blocked=0 THEN 1 ELSE 0 END) nb, SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) b, COUNT(*) t FROM lstep_friends`
  )).rows[0];
  const linksAfter = (await c.execute(`SELECT COUNT(*) n FROM member_lstep_links`)).rows[0];
  console.log('lstep_friends AFTER:', JSON.stringify(after));
  console.log('member_lstep_links AFTER:', JSON.stringify(linksAfter));
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
