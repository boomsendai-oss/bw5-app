#!/usr/bin/env node
// Visaデビットの取消(返金)を経費から打ち消す (dry-run既定) — WS P
//
// 銀行明細は「利用」と「取消」が別行で来る。利用行は経費に計上されるが、取消行は入金なので
// `経費外(入金)` として無視されており、**返金が経費から引かれていなかった**。
// 実例: 2026-06-19 インスタベース ¥5,775 を当日中に取消 → 6月の経費が¥5,775過大。
//
// マスタの文字列照合では拾えない(明細は英字 INSTABASE、マスタのパターンは「インスタベ」で、
// あの経費はTAROが画面で手動分類したもの)。取消行は元の取引と **承認番号が同じ** なので、
// そこで突き合わせる。
//
// 元の利用行は消さない。「使って、取り消した」という事実を残すため、返金をマイナスの経費で足す。
//
// 使い方: node scripts/apply_debit_refunds.mjs [--prod] [--apply]
import { extractApprovalNo, isDebitRefund, planRefunds } from '../src/lib/expenseRefunds.ts';
import { makeClient } from './seed_recurring_expenses.mjs';

const yen = (n) => `¥${Number(n).toLocaleString()}`;
const MARK = '【返金】承認番号';

async function main() {
  const apply = process.argv.includes('--apply');
  const c = makeClient(process.argv);

  const txns = (await c.execute(
    `SELECT id, txn_date, amount, description FROM bank_transactions ORDER BY txn_date, id`
  )).rows;

  // 元の利用行 → その経費(承認番号でひく)
  const expenses = (await c.execute(
    `SELECT id, source_ref_id, expense_date, amount, category, subcategory, description
     FROM expenses WHERE source = 'bank_txn'`
  )).rows;
  const expenseByTxn = new Map(expenses.filter((e) => e.source_ref_id != null).map((e) => [Number(e.source_ref_id), e]));

  const charges = new Map();
  for (const t of txns) {
    if (Number(t.amount) >= 0) continue;                 // 利用は出金
    const no = extractApprovalNo(String(t.description ?? ''));
    if (!no) continue;
    const ex = expenseByTxn.get(Number(t.id));
    if (!ex) continue;                                    // 経費になっていない利用は打ち消す必要なし
    charges.set(no, {
      txnId: Number(t.id), approvalNo: no,
      category: String(ex.category), subcategory: ex.subcategory ? String(ex.subcategory) : null,
      amount: Number(ex.amount),
    });
  }

  const refunds = txns
    .filter((t) => isDebitRefund(String(t.description ?? ''), Number(t.amount)))
    .map((t) => ({ txnId: Number(t.id), date: String(t.txn_date), description: String(t.description ?? ''), amount: Number(t.amount) }));

  // 既に打ち消し済みの承認番号(冪等)
  const applied = new Set(
    expenses
      .map((e) => String(e.description ?? ''))
      .filter((d) => d.startsWith(MARK))
      .map((d) => (d.match(/承認番号(\d+)/) ?? [])[1])
      .filter(Boolean)
  );

  const { plans, unmatched } = planRefunds(refunds, charges, applied);

  console.log(`\n=== 取消(返金)行 ${refunds.length}件 / 元の経費と一致 ${plans.length}件 / 対象外 ${unmatched.length}件 ===`);
  const byMonth = new Map();
  for (const p of plans) {
    console.log(`  ${p.date} ${yen(p.amount).padStart(12)}  ${p.category}/${p.subcategory ?? '-'}`);
    const k = p.date.slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + p.amount);
  }
  if (byMonth.size) {
    console.log('\n--- 月別の経費への影響 ---');
    for (const [k, v] of [...byMonth.entries()].sort()) console.log(`  ${k}: ${yen(v)}`);
  }
  if (unmatched.length) {
    console.log(`\n--- 対象外(元の利用が経費になっていない = 打ち消す先が無い) ---`);
    for (const u of unmatched.slice(0, 12)) console.log(`  ${u.date} ${yen(u.amount).padStart(10)} ${u.description.slice(0, 52)}`);
    if (unmatched.length > 12) console.log(`  ... 他${unmatched.length - 12}件`);
  }

  if (!apply) { console.log('\n(dry-run: --apply で書込)'); return; }
  for (const p of plans) {
    await c.execute({
      sql: `INSERT INTO expenses (expense_date, category, subcategory, amount, description, source, source_ref_id)
            VALUES (?, ?, ?, ?, ?, 'bank_txn', ?)`,
      args: [p.date, p.category, p.subcategory, p.amount, p.description, p.refundTxnId],
    });
  }
  console.log(`\n✅ ${plans.length}件の返金を計上しました`);
}

main().catch((e) => { console.error(e); process.exit(1); });
