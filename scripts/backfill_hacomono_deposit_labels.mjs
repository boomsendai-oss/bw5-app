#!/usr/bin/env node
// bank_transactions の既存入金行に hacomono売上の系統ラベルを後付けする (dry-run既定) — WS P
//
// 背景: 入金行はこれまで一律 '経費外(入金)' で保存されていた。2026-08-22の申し送りで
// GMO入金が3系統(カード月末締め/カード15日締め/オンライン口座振替)に分かれることが確定したため、
// 既存行にも同じ判定を当てて仕訳できる状態にする。
//
// 安全性: 触るのは bank_transactions.expense_category のみ。
//   - 入金行(amount > 0) 限定
//   - 既に '売上入金(' で始まるラベルが付いている行はスキップ(冪等)
//   - expenses テーブル・金額・PL集計には一切影響しない
//     (getMonthlyFinance は expenses しか読まず、入金は元々経費計上されていない)
//
// 使い方:
//   node scripts/backfill_hacomono_deposit_labels.mjs [--prod] [--apply]
import { classifyHacomonoDeposit, HACOMONO_DEPOSIT_LABELS } from '../src/lib/expenseImport.ts';
import { makeClient } from './seed_recurring_expenses.mjs';

const yen = (n) => `¥${Number(n).toLocaleString()}`;

async function main() {
  const apply = process.argv.includes('--apply');
  const c = makeClient(process.argv);

  const rows = (await c.execute(
    `SELECT id, txn_date, amount, description, counterparty, expense_category
       FROM bank_transactions WHERE amount > 0 ORDER BY txn_date, id`
  )).rows;

  const planned = [];
  let already = 0;
  for (const t of rows) {
    const stream = classifyHacomonoDeposit(`${t.description ?? ''} ${t.counterparty ?? ''}`, String(t.txn_date));
    if (!stream) continue;
    const label = HACOMONO_DEPOSIT_LABELS[stream];
    if (t.expense_category === label) { already++; continue; }
    planned.push({ id: Number(t.id), date: String(t.txn_date), amount: Number(t.amount), from: t.expense_category, label });
  }

  console.log(`\n=== 入金行 ${rows.length}件を判定 → hacomono由来 ${planned.length + already}件 (更新対象 ${planned.length} / 既に正しい ${already}) ===`);
  const byLabel = new Map();
  for (const p of planned) {
    console.log(`  #${String(p.id).padStart(4)} ${p.date} ${yen(p.amount).padStart(11)}  ${JSON.stringify(p.from)} → ${p.label}`);
    const v = byLabel.get(p.label) ?? { count: 0, amount: 0 };
    v.count++; v.amount += p.amount; byLabel.set(p.label, v);
  }
  console.log('\n--- 系統別サマリ ---');
  for (const [label, v] of [...byLabel.entries()].sort()) {
    console.log(`  ${label}: ${v.count}件 計${yen(v.amount)}`);
  }

  if (!apply) { console.log('\n(dry-run: --apply で書込)'); return; }
  for (const p of planned) {
    await c.execute({ sql: 'UPDATE bank_transactions SET expense_category = ? WHERE id = ?', args: [p.label, p.id] });
  }
  console.log(`\n✅ ${planned.length}件を更新しました`);
}

main().catch((e) => { console.error(e); process.exit(1); });
