#!/usr/bin/env node
// 多ソース経費取込スクリプト (GMO/SBI/楽天・dry-run既定) — WS P: 経費見える化
//
// 使い方:
//   node scripts/import_expense_sources.mjs \
//     --gmo <csv...> --sbi-bank <csv...> --sbi-debit <csv...> --rakuten <txt...> \
//     [--reclassify] [--apply] [--prod]
//
//   --apply なし: dry-run (書込ゼロ・件数/金額レポートのみ)
//   --reclassify: 既存の confirmed=0 行に分類ルールを再適用 (queueに真の未知だけ残す)
//   --prod: .env.production.local を読んで本番Tursoへ (明示時のみ。既定はローカル file:./data/bw5.db)
//
// 書込規則:
//   - bank_transactions: INSERT ... 既存(txn_date, amount, description)一致はスキップ
//     (既存3〜4月GMO行と自然に重複排除。GMO2ファイルの4月重複も同様)
//   - 同一実行内の同キー衝突: 残高が異なる(=別取引。同日同額の振込手数料等)場合と
//     明細系ソース(楽天/SBIデビット: 残高なし・1行=1取引)は description に " #n" を付けて両方保存。
//     残高まで同一ならファイル重複とみなしスキップ。UNIQUE制約による実取引の取り落とし防止。
//   - expenses: source='bank_txn'・source_ref_id=bank_transactions.id。
//     重複チェックは source_ref_id 一致 or (expense_date, amount, description) 一致
//     (旧import-bankが source_ref_id にマスタidを入れていた歴史行対策)。
//   - SBIは許可リスト方式: master一致行のみDBへ。他は一切入れない(私費持ち込み禁止)。
import { readFileSync } from 'node:fs';
import { classify, parseGmoCsv, parseSbiBankCsv, parseSbiDebitCsv, parseRakutenText } from '../src/lib/expenseImport.ts';
import { makeClient } from './seed_recurring_expenses.mjs';

// --- 引数パース (複数値フラグ対応) ---
function parseArgs(argv) {
  const multi = { '--gmo': [], '--sbi-bank': [], '--sbi-debit': [], '--rakuten': [] };
  const flags = { apply: false, reclassify: false, prod: false };
  let cur = null;
  for (const a of argv.slice(2)) {
    if (a === '--apply') { flags.apply = true; cur = null; continue; }
    if (a === '--reclassify') { flags.reclassify = true; cur = null; continue; }
    if (a === '--prod') { flags.prod = true; cur = null; continue; }
    if (a in multi) { cur = a; continue; }
    if (a.startsWith('--')) throw new Error(`不明なオプション: ${a}`);
    if (!cur) throw new Error(`ファイルの前にソース指定が必要: ${a}`);
    multi[cur].push(a);
  }
  return { files: multi, flags };
}

// --- Shift-JIS 判定つき読込 (import-bank と同じ: UTF-8で読み � が10超なら shift-jis) ---
function readTextAuto(path) {
  const buf = readFileSync(path);
  let text = new TextDecoder('utf-8').decode(buf);
  if ((text.match(/�/g)?.length ?? 0) > 10) {
    text = new TextDecoder('shift-jis').decode(buf);
  }
  return text;
}

const SOURCES = [
  ['gmo', '--gmo', parseGmoCsv],
  ['sbi-bank', '--sbi-bank', parseSbiBankCsv],
  ['sbi-debit', '--sbi-debit', parseSbiDebitCsv],
  ['rakuten', '--rakuten', parseRakutenText],
];

// ============================================
// 統計
// ============================================
function newStats() {
  return {
    bySource: {}, // source -> { parsed, expense, ignore, queue, drop, skipped_existing, dup_suffixed }
    expenseByMonth: new Map(), // 'YYYY-MM' -> { total, byCategory: Map<cat, {total, count}> }
    ignoreByLabel: new Map(), // label -> { count, amount(出金のみ) }
    queueRows: [], // { date, description, amount }
    expenseInserted: 0,
    expenseDupSkipped: 0,
  };
}
function srcStat(stats, source) {
  stats.bySource[source] ??= { parsed: 0, expense: 0, ignore: 0, queue: 0, drop: 0, skipped_existing: 0, dup_suffixed: 0 };
  return stats.bySource[source];
}
function addExpenseStat(stats, date, category, amount) {
  const ym = date.slice(0, 7);
  const m = stats.expenseByMonth.get(ym) ?? { total: 0, byCategory: new Map() };
  m.total += amount;
  const c = m.byCategory.get(category) ?? { total: 0, count: 0 };
  c.total += amount;
  c.count += 1;
  m.byCategory.set(category, c);
  stats.expenseByMonth.set(ym, m);
}

// ============================================
// 書込 (apply=false なら SELECT のみで一切書かない)
// ============================================
function makeWriter(c, apply) {
  // 同一実行内の (txn_date|amount|description) 衝突検出。値=そのキーで見た残高の集合。
  const seen = new Map();

  async function bankRowExists(date, amount, description) {
    const r = await c.execute({
      sql: 'SELECT id FROM bank_transactions WHERE txn_date = ? AND amount = ? AND description = ?',
      args: [date, amount, description],
    });
    return r.rows.length > 0 ? Number(r.rows[0].id) : null;
  }

  /**
   * bank_transactions への保存 (dry-runでは採番シミュレーション)。
   * 返り値: { status: 'inserted'|'existing'|'dup_batch', txnId, description }
   */
  async function saveBankRow(row, amount, confirmed, expenseCategory, hasBalance) {
    let description = row.description;
    const origKey = `${row.date}|${amount}|${description}`;
    let key = origKey;
    const balKey = String(row.balance ?? '');
    if (seen.has(origKey)) {
      const balances = seen.get(origKey);
      // 残高まで同一 = 同一取引のファイル間重複 (GMOの3-4月/4-6月ファイルの4月部分など) → スキップ。
      // ※ " #n" 付与済みの行も元キーの残高集合に登録してあるため、重複ファイル側の同行もここで落ちる。
      if (hasBalance && balances.has(balKey)) {
        return { status: 'dup_batch', txnId: null, description };
      }
      // 別取引 (同日同額の手数料等 / 明細系ソースは残高なし=常に別取引) → " #n" で識別して両方保存
      let n = 2;
      while (seen.has(`${row.date}|${amount}|${description} #${n}`)) n++;
      description = `${description} #${n}`;
      key = `${row.date}|${amount}|${description}`;
    }
    (seen.get(origKey) ?? seen.set(origKey, new Set()).get(origKey)).add(balKey);
    if (key !== origKey) (seen.get(key) ?? seen.set(key, new Set()).get(key)).add(balKey);

    const existingId = await bankRowExists(row.date, amount, description);
    if (existingId !== null) return { status: 'existing', txnId: existingId, description };

    if (!apply) return { status: 'inserted', txnId: null, description };
    const r = await c.execute({
      sql: `INSERT INTO bank_transactions (txn_date, amount, description, counterparty, balance_after, expense_category, confirmed, imported_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [row.date, amount, description, row.memo ?? null, row.balance ?? null, expenseCategory, confirmed],
    });
    return { status: 'inserted', txnId: Number(r.lastInsertRowid), description };
  }

  /** expenses への登録 (重複チェック: source_ref_id or 三点一致)。返り値: 'inserted'|'dup' */
  async function saveExpense(txnId, date, category, subcategory, amount, description) {
    const dup = await c.execute({
      sql: `SELECT id FROM expenses WHERE source = 'bank_txn'
            AND (source_ref_id = ? OR (expense_date = ? AND amount = ? AND COALESCE(description, '') = COALESCE(?, '')))`,
      args: [txnId ?? -1, date, amount, description ?? ''],
    });
    if (dup.rows.length > 0) return 'dup';
    if (!apply) return 'inserted';
    await c.execute({
      sql: `INSERT INTO expenses (expense_date, category, subcategory, amount, description, source, source_ref_id)
            VALUES (?, ?, ?, ?, ?, 'bank_txn', ?)`,
      args: [date, category, subcategory ?? null, amount, description ?? null, txnId],
    });
    return 'inserted';
  }

  return { saveBankRow, saveExpense };
}

// ============================================
// ソース別処理
// 保存対象: GMO=全行 / SBI=master一致(expense)のみ / 楽天=expense+queue。drop は DB非投入。
// ============================================
async function processSource(source, files, parser, masters, writer, stats) {
  const st = srcStat(stats, source);
  const hasBalance = source === 'gmo' || source === 'sbi-bank';
  for (const path of files) {
    const rows = parser(readTextAuto(path));
    st.parsed += rows.length;
    for (const row of rows) {
      const r = classify(row, masters, source);
      st[r.action]++;
      if (r.action === 'drop') continue;
      if ((source === 'sbi-bank' || source === 'sbi-debit') && r.action !== 'expense') continue; // 許可リスト方式の保険
      const amount = row.deposit > 0 ? row.deposit : -row.withdraw;
      const confirmed = r.action === 'expense' || r.action === 'ignore' ? 1 : 0;
      const expenseCategory = r.action === 'expense' ? r.category : r.action === 'ignore' ? r.label : null;
      const saved = await writer.saveBankRow(row, amount, confirmed, expenseCategory, hasBalance);
      if (saved.status === 'dup_batch') { st[r.action]--; st.drop++; continue; } // 同一取引の重複ファイル行(残高まで同一)
      if (saved.description !== row.description) st.dup_suffixed++;
      if (saved.status === 'existing') { st.skipped_existing++; }

      if (r.action === 'expense') {
        const res = await writer.saveExpense(saved.txnId, row.date, r.category, r.subcategory ?? null, row.withdraw, saved.description);
        if (res === 'inserted') {
          stats.expenseInserted++;
          addExpenseStat(stats, row.date, r.category, row.withdraw);
        } else {
          stats.expenseDupSkipped++;
        }
      } else if (r.action === 'ignore') {
        if (saved.status !== 'existing') {
          const lab = stats.ignoreByLabel.get(r.label) ?? { count: 0, amount: 0 };
          lab.count++;
          lab.amount += row.withdraw;
          stats.ignoreByLabel.set(r.label, lab);
        }
      } else if (r.action === 'queue') {
        if (saved.status !== 'existing') {
          stats.queueRows.push({ date: row.date, description: saved.description, amount });
        }
      }
    }
  }
}

// ============================================
// --reclassify: 既存 confirmed=0 行へ分類ルール再適用 (queueに真の未知だけ残す)
// [楽天] 接頭辞行は楽天ルール・他はGMOルール。drop判定(私費)は行を消せないため 経費外(私費) ラベルで確定。
// ============================================
async function reclassify(c, masters, writer, stats, apply) {
  const rows = (await c.execute('SELECT id, txn_date, amount, description, counterparty, balance_after FROM bank_transactions WHERE confirmed = 0 ORDER BY id')).rows;
  const counts = { expense: 0, ignore: 0, queue: 0, private: 0 };
  for (const t of rows) {
    const amount = Number(t.amount);
    const source = String(t.description ?? '').startsWith('[楽天] ') ? 'rakuten' : 'gmo';
    const row = {
      date: String(t.txn_date),
      description: String(t.description ?? ''),
      memo: t.counterparty != null ? String(t.counterparty) : undefined,
      deposit: amount > 0 ? amount : 0,
      withdraw: amount < 0 ? -amount : 0,
      balance: t.balance_after != null ? Number(t.balance_after) : null,
    };
    const r = classify(row, masters, source);
    if (r.action === 'expense') {
      counts.expense++;
      const res = await writer.saveExpense(Number(t.id), row.date, r.category, r.subcategory ?? null, row.withdraw, row.description);
      if (res === 'inserted') {
        stats.expenseInserted++;
        addExpenseStat(stats, row.date, r.category, row.withdraw);
      } else {
        stats.expenseDupSkipped++;
      }
      if (apply) await c.execute({ sql: 'UPDATE bank_transactions SET confirmed = 1, expense_category = ? WHERE id = ?', args: [r.category, Number(t.id)] });
    } else if (r.action === 'ignore' || r.action === 'drop') {
      const label = r.action === 'drop' ? '経費外(私費)' : r.label;
      if (r.action === 'drop') counts.private++; else counts.ignore++;
      const lab = stats.ignoreByLabel.get(label) ?? { count: 0, amount: 0 };
      lab.count++;
      lab.amount += row.withdraw;
      stats.ignoreByLabel.set(label, lab);
      if (apply) await c.execute({ sql: 'UPDATE bank_transactions SET confirmed = 1, expense_category = ? WHERE id = ?', args: [label, Number(t.id)] });
    } else {
      counts.queue++;
      stats.queueRows.push({ date: row.date, description: row.description, amount });
    }
  }
  console.log(`\n=== reclassify (confirmed=0 ${rows.length}件) → expense化=${counts.expense} 経費外=${counts.ignore} 私費=${counts.private} queue残=${counts.queue} ===`);
}

// ============================================
// レポート
// ============================================
const yen = (n) => `¥${n.toLocaleString('ja-JP')}`;

function printReport(stats, apply) {
  console.log(`\n========== 取込レポート (${apply ? 'APPLY' : 'DRY-RUN・書込なし'}) ==========`);
  console.log('\n--- ソース別 ---');
  for (const [src, s] of Object.entries(stats.bySource)) {
    console.log(`  ${src.padEnd(9)} parsed=${s.parsed} expense=${s.expense} ignore=${s.ignore} queue=${s.queue} drop=${s.drop} 既存スキップ=${s.skipped_existing} 重複識別(#n)=${s.dup_suffixed}`);
  }
  console.log('\n--- expenses化 (月別・カテゴリ内訳) ---');
  const months = [...stats.expenseByMonth.keys()].sort();
  for (const ym of months) {
    const m = stats.expenseByMonth.get(ym);
    console.log(`  ${ym}: 合計 ${yen(m.total)}`);
    for (const [cat, v] of [...m.byCategory.entries()].sort((a, b) => b[1].total - a[1].total)) {
      console.log(`      ${cat.padEnd(6, '　')} ${yen(v.total)} (${v.count}件)`);
    }
  }
  console.log(`  expenses新規=${stats.expenseInserted}件 / 重複スキップ=${stats.expenseDupSkipped}件`);
  console.log('\n--- ignore内訳 (bank_transactionsには保存・confirmed=1・経費登録なし) ---');
  for (const [label, v] of [...stats.ignoreByLabel.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${label}: ${v.count}件${v.amount > 0 ? ` (出金計 ${yen(v.amount)})` : ''}`);
  }
  console.log(`\n--- 未確定キュー残 (confirmed=0): ${stats.queueRows.length}件 ---`);
  for (const q of stats.queueRows.slice(0, 15)) {
    console.log(`  ${q.date} ${yen(Math.abs(q.amount))} ${q.description}`);
  }
  if (stats.queueRows.length > 15) console.log(`  ... 他${stats.queueRows.length - 15}件`);
}

// ============================================
// main
// ============================================
async function main() {
  const { files, flags } = parseArgs(process.argv);
  const total = Object.values(files).reduce((s, a) => s + a.length, 0);
  if (total === 0 && !flags.reclassify) {
    console.error('usage: node scripts/import_expense_sources.mjs --gmo <csv...> --sbi-bank <csv...> --sbi-debit <csv...> --rakuten <txt...> [--reclassify] [--apply] [--prod]');
    process.exit(1);
  }
  const c = makeClient(process.argv);
  const masters = (await c.execute(
    "SELECT id, category, subcategory, match_pattern FROM recurring_expenses WHERE active = 1 AND match_pattern IS NOT NULL AND match_pattern != '' ORDER BY id"
  )).rows.map((r) => ({ id: Number(r.id), category: String(r.category), subcategory: r.subcategory != null ? String(r.subcategory) : null, match_pattern: String(r.match_pattern) }));
  if (masters.length === 0) throw new Error('recurring_expenses の active なマスタが0件です。先に seed_recurring_expenses.mjs --apply を実行してください。');
  console.log(`masters: ${masters.length}件 (id ${masters[0].id}..${masters[masters.length - 1].id})`);

  const stats = newStats();
  const writer = makeWriter(c, flags.apply);
  for (const [source, flag, parser] of SOURCES) {
    if (files[flag].length > 0) await processSource(source, files[flag], parser, masters, writer, stats);
  }
  if (flags.reclassify) await reclassify(c, masters, writer, stats, flags.apply);
  printReport(stats, flags.apply);
}

main().catch((e) => {
  console.error('IMPORT FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
