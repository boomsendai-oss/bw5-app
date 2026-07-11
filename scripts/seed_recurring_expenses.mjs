#!/usr/bin/env node
// recurring_expenses シード刷新スクリプト (固定費マスタv1 / WS P: 経費見える化)
//
// 既存9行(鮮度切れ: Claude Max=Apple旧額¥21,400・HACOMONO¥37,000・過広`GOOGLE`パターン等)を
// active=0 に落とし(削除しない: expenses.source_ref_id の参照保全)、
// src/lib/expenseImport.ts の RECURRING_SEED 21行を配列順にINSERTする(id昇順=マッチ優先順)。
//
// 使い方:
//   node scripts/seed_recurring_expenses.mjs            # dry-run (差分表示のみ・書込なし)
//   node scripts/seed_recurring_expenses.mjs --apply    # ローカル/環境変数のDBへ書込
//   node scripts/seed_recurring_expenses.mjs --prod --apply  # .env.production.local を読んで本番Tursoへ
//
// 接続先 (house流儀: seed_faq.mjs 参照):
//   --prod 指定時のみ .env.production.local を素朴パースして TURSO_* を使用。
//   それ以外は環境変数 TURSO_DATABASE_URL、未設定なら file:./data/bw5.db (ローカル)。
//   ※誤って本番に書かないよう、.env.production.local の自動読込はしない(--prod 明示時のみ)。
//
// 冪等性: 現在の active 行がシード21行と完全一致(件数・並び・内容)なら何もしない。
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { RECURRING_SEED } from '../src/lib/expenseImport.ts';

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

export function makeClient(argv) {
  if (argv.includes('--prod')) {
    loadEnv('.env.production.local');
    if (!process.env.TURSO_DATABASE_URL) throw new Error('--prod なのに TURSO_DATABASE_URL がありません');
  }
  const url = process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db';
  console.log(`DB: ${url.startsWith('file:') ? url : url.replace(/\/\/.*@/, '//***@')}`);
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

/** 行の同一性キー (active行 vs シード行の比較用)。 */
const rowKey = (r) => [r.category, r.subcategory ?? '', Number(r.amount), r.match_pattern ?? ''].join('|');

async function main() {
  const apply = process.argv.includes('--apply');
  const c = makeClient(process.argv);

  const existing = (await c.execute('SELECT * FROM recurring_expenses ORDER BY id')).rows;
  console.log(`\n=== 既存 recurring_expenses (${existing.length}件) ===`);
  for (const r of existing) {
    console.log(`  #${r.id} [${r.active ? 'active' : 'inactive'}] ${r.category}/${r.subcategory ?? '-'} ¥${r.amount} pattern=${JSON.stringify(r.match_pattern)}`);
  }

  // 冪等チェック: active行がシードと完全一致(id昇順での並びも)なら no-op
  const activeRows = existing.filter((r) => Number(r.active) === 1);
  const alreadySeeded =
    activeRows.length === RECURRING_SEED.length &&
    activeRows.every((r, i) => rowKey(r) === rowKey(RECURRING_SEED[i]));
  if (alreadySeeded) {
    console.log('\n✅ active行はシード21行と完全一致。何もしません (冪等)。');
    return;
  }

  console.log(`\n=== 差分 ===`);
  console.log(`  active=0 に落とす: ${activeRows.length}件 (削除はしない)`);
  console.log(`  INSERT するシード: ${RECURRING_SEED.length}件 (配列順=id昇順)`);
  for (let i = 0; i < RECURRING_SEED.length; i++) {
    const s = RECURRING_SEED[i];
    console.log(`  +${String(i + 1).padStart(2)} ${s.category}/${s.subcategory} ¥${s.amount} pattern="${s.match_pattern}"`);
  }

  if (!apply) {
    console.log('\nDRY-RUN (--apply なし)。何も書き込んでいません。');
    return;
  }

  await c.execute('UPDATE recurring_expenses SET active = 0 WHERE active = 1');
  for (const s of RECURRING_SEED) {
    await c.execute({
      sql: `INSERT INTO recurring_expenses (category, subcategory, amount, budget_amount, description, match_pattern, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)`,
      args: [s.category, s.subcategory, s.amount, s.amount, s.description, s.match_pattern],
    });
  }

  // 検証: active行が21件・id昇順=シード順
  const after = (await c.execute('SELECT * FROM recurring_expenses WHERE active = 1 ORDER BY id')).rows;
  const ok = after.length === RECURRING_SEED.length && after.every((r, i) => rowKey(r) === rowKey(RECURRING_SEED[i]));
  console.log(`\nAPPLY完了: active=${after.length}件 id=${after[0]?.id}..${after[after.length - 1]?.id} 検証=${ok ? 'OK' : 'NG'}`);
  if (!ok) process.exit(1);
}

const isMain = process.argv[1] && process.argv[1].endsWith('seed_recurring_expenses.mjs');
if (isMain) {
  main().catch((e) => {
    console.error('SEED FAILED:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
