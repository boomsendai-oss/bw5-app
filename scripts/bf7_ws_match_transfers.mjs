// HIRO ワークショップ(BF7)の銀行振込を、GMOあおぞらの入出金明細CSVで照合する。
//
// 使い方:
//   node scripts/bf7_ws_match_transfers.mjs [CSV...]           # 照合結果を見るだけ(何も変えない)
//   node scripts/bf7_ws_match_transfers.mjs --apply [CSV...]   # 合ったものを入金済みにし、確定メールを送る
//   CSV を省くと ~/Downloads と ~/Downloads/sidebar の一番新しい statement-201-*.csv を使う
//
// 「今日のCSV取り込んで」で GMO の明細を落としたあとに続けて回す想定。
// 自動で入金済みにするのは「振込名義に受付番号(WS001 など)があり、振込待ちで、金額がぴったり」のときだけ。
// 照合は本番の /api/staff/bf7/ws-transfers(src/lib/bf7WsTransferMatch.ts)が行う。
// 認証は、このスクリプトが本番DBに数分だけ有効なスタッフのセッションを作って使い、終わったら消す。
// 出力は受付番号・日付・金額だけ(名前は出さない)。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';

for (const line of readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const BASE = process.env.BF7_BASE_URL || 'https://boomersfight.vercel.app';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
let files = args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  const dirs = [join(homedir(), 'Downloads'), join(homedir(), 'Downloads', 'sidebar')];
  const found = dirs.flatMap((d) => {
    try {
      return readdirSync(d).filter((f) => /^statement-201-.*\.csv$/.test(f)).map((f) => join(d, f));
    } catch {
      return [];
    }
  });
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found[0]) {
    console.error('statement-201-*.csv が見つかりません。GMOあおぞらの入出金明細CSVを指定してください');
    process.exit(1);
  }
  files = [found[0]];
}

/** GMOの入出金明細CSV(Shift_JIS・列: 日付,摘要,入金金額,出金金額,残高,メモ)から入金の行だけ取り出す */
function readDeposits(path) {
  const text = new TextDecoder('shift_jis').decode(readFileSync(path));
  const rows = text.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const head = rows[0] ?? [];
  const iDate = head.indexOf('日付');
  const iDesc = head.indexOf('摘要');
  const iIn = head.indexOf('入金金額');
  if (iDate < 0 || iDesc < 0 || iIn < 0) throw new Error(`${path}: 列(日付・摘要・入金金額)が見つかりません`);
  return rows.slice(1).flatMap((r) => {
    const amount = Number(String(r[iIn] ?? '').replace(/[,円¥\s]/g, ''));
    return amount > 0 ? [{ date: r[iDate] ?? '', description: r[iDesc] ?? '', amount }] : [];
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') out.push(cur), (cur = '');
    else cur += c;
  }
  out.push(cur);
  return out;
}

// 同じ取引が複数のCSVに入っていても1回だけ送る
const seen = new Set();
const deposits = files.flatMap(readDeposits).filter((d) => {
  const k = `${d.date}|${d.description}|${d.amount}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const token = randomUUID();
await db.execute({ sql: 'INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)', args: [token, new Date(Date.now() + 10 * 60 * 1000).toISOString()] });

let json;
try {
  const res = await fetch(`${BASE}/api/staff/bf7/ws-transfers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `staff_events_auth=${token}` },
    body: JSON.stringify({ deposits, apply }),
  });
  json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`照合APIがエラーを返しました(${res.status}): ${json.error ?? ''}`);
} finally {
  await db.execute({ sql: 'DELETE FROM admin_sessions WHERE token = ?', args: [token] });
}

const ws = (id) => (id ? `WS${String(id).padStart(3, '0')}` : '(番号なし)');
const yen = (n) => `¥${Number(n).toLocaleString('ja-JP')}`;
const by = (k) => json.results.filter((r) => r.kind === k);

console.log(`明細: ${files.join(', ')}(入金 ${deposits.length} 行)`);
console.log(apply ? '■ 入金済みにした(確定メール送信)' : '■ 入金済みにできる(--apply で反映)');
for (const r of by('auto')) {
  const note = apply ? (r.applied ? (r.mailed ? '' : ' ⚠️確定メールを送れませんでした') : ' ⚠️更新できませんでした') : '';
  console.log(`  ${ws(r.orderId)} ${r.date} ${yen(r.amount)}${note}`);
}
if (by('auto').length === 0) console.log('  なし');
console.log('■ 人が確かめる');
for (const r of by('review')) console.log(`  ${ws(r.orderId)} ${r.date} ${yen(r.amount)} … ${r.reason}`);
if (by('review').length === 0) console.log('  なし');
if (by('already_paid').length) console.log(`■ 入金済み(前回までに処理): ${by('already_paid').map((r) => ws(r.orderId)).join(' ')}`);
process.exit(0);
