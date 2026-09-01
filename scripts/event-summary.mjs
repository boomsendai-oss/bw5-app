#!/usr/bin/env node
/**
 * イベントの現在の数字(エントリー・チケット・収支)を出す。
 *
 * 他のセッション(経理・司令塔など)がTAROに聞かずに現状を読めるようにするための入口。
 * 個人情報は一切出さない(件数と金額だけ)。
 *
 *   node scripts/event-summary.mjs bf6           人が読む形
 *   node scripts/event-summary.mjs bf6 --json    JSON(他セッションが機械的に読む用)
 *
 * 数字の出どころ:
 *   - エントリー/チケット/カード入金/当日現金 = bf_orders・bf_order_items(アプリの実データ)
 *   - 固定費とアプリ外の現金               = event_ledger(台帳。/staff/bf6/ledger で編集)
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRIPE_FEE_RATE = 0.036;

function loadEnv() {
  for (const f of ['.env.local', '.env.production.local']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const yen = (n) => `¥${n.toLocaleString()}`;

async function main() {
  const eventKey = process.argv[2] || 'bf6';
  const asJson = process.argv.includes('--json');
  if (eventKey !== 'bf6') {
    console.error(`未対応のイベントです: ${eventKey}(現在は bf6 のみ)`);
    process.exit(1);
  }

  loadEnv();
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

  const OK = "o.payment_status IN ('paid','cash_due')";

  const itemRows = await q(
    `SELECT i.item_type, SUM(i.qty) AS qty, SUM(i.qty*i.unit_amount) AS amt
       FROM bf_order_items i JOIN bf_orders o ON o.id=i.order_id
      WHERE ${OK} GROUP BY i.item_type`
  );
  const amt = new Map(itemRows.map((r) => [String(r.item_type), Number(r.amt ?? 0)]));
  const qty = new Map(itemRows.map((r) => [String(r.item_type), Number(r.qty ?? 0)]));

  const statusRows = await q(
    `SELECT payment_status, SUM(amount_total) AS amt FROM bf_orders
      WHERE payment_status IN ('paid','cash_due') GROUP BY payment_status`
  );
  const byStatus = new Map(statusRows.map((r) => [String(r.payment_status), Number(r.amt ?? 0)]));
  const paid = byStatus.get('paid') ?? 0;
  const cashDue = byStatus.get('cash_due') ?? 0;

  const entryRows = await q(
    `SELECT i.divisions FROM bf_order_items i JOIN bf_orders o ON o.id=i.order_id
      WHERE ${OK} AND i.item_type='entry'`
  );
  const byDivision = { beginner: 0, kids: 0, general: 0 };
  for (const e of entryRows) {
    for (const d of JSON.parse(String(e.divisions ?? '[]'))) {
      if (d in byDivision) byDivision[d] += 1;
    }
  }

  let capacity = { beginner: 16, kids: 32, general: 32 };
  const capRow = await q("SELECT value FROM bf_settings WHERE key='capacity'");
  if (capRow[0]) { try { capacity = { ...capacity, ...JSON.parse(String(capRow[0].value)) }; } catch { /* 既定値 */ } }

  const waitRow = await q("SELECT COUNT(*) AS n FROM bf_waitlist WHERE status IN ('waiting','offered')");
  const waitlist = Number(waitRow[0]?.n ?? 0);

  const ledger = (await q(
    'SELECT kind, category, label, amount, collected, note FROM event_ledger WHERE event_key=? ORDER BY kind DESC, sort_order, id',
    [eventKey]
  )).map((r) => ({
    kind: String(r.kind), category: String(r.category ?? ''), label: String(r.label),
    amount: Number(r.amount), collected: Number(r.collected) === 1, note: String(r.note ?? ''),
  }));

  const appRevenue = (amt.get('entry') ?? 0) + (amt.get('ticket_adult') ?? 0)
    + (amt.get('ticket_child') ?? 0) + (amt.get('stream') ?? 0);
  const incomes = ledger.filter((r) => r.kind === 'income');
  const costs = ledger.filter((r) => r.kind === 'cost');
  const offline = incomes.reduce((s, r) => s + r.amount, 0);
  const offlineCollected = incomes.filter((r) => r.collected).reduce((s, r) => s + r.amount, 0);
  const ledgerCost = costs.reduce((s, r) => s + r.amount, 0);
  const stripeFee = Math.round(paid * STRIPE_FEE_RATE);
  const costTotal = ledgerCost + stripeFee;
  const total = appRevenue + offline;

  const out = {
    event: eventKey,
    asOf: new Date().toISOString(),
    entrants: entryRows.length,
    divisions: Object.fromEntries(
      Object.keys(byDivision).map((k) => [k, { count: byDivision[k], capacity: capacity[k] }])
    ),
    waitlist,
    tickets: {
      adult: qty.get('ticket_adult') ?? 0,
      child: qty.get('ticket_child') ?? 0,
      stream: qty.get('stream') ?? 0,
    },
    revenue: { app: appRevenue, offline, total },
    collected: paid + offlineCollected,
    receivable: cashDue + (offline - offlineCollected),
    cost: { ledger: ledgerCost, stripeFee, total: costTotal },
    profit: total - costTotal,
    ledger,
  };

  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }

  const L = (k) => `${k}`.padEnd(22, '　'.length ? ' ' : ' ');
  console.log(`\n=== ${eventKey.toUpperCase()} 現況 (${new Date().toLocaleString('ja-JP')}) ===\n`);
  console.log(`  出場者          ${out.entrants}名`);
  for (const [k, v] of Object.entries(out.divisions)) {
    console.log(`    ${L(k)}${v.count}/${v.capacity}`);
  }
  console.log(`  キャンセル待ち  ${waitlist}名`);
  console.log(`  観覧チケット    大人${out.tickets.adult}枚 / 小学生${out.tickets.child}枚`);
  console.log(`  オンライン配信  ${out.tickets.stream}枚`);
  console.log('');
  console.log(`  売上(アプリ)    ${yen(out.revenue.app)}`);
  console.log(`  売上(アプリ外)  ${yen(out.revenue.offline)}`);
  console.log(`  売上 合計       ${yen(out.revenue.total)}`);
  console.log(`    回収済み      ${yen(out.collected)}`);
  console.log(`    未回収        ${yen(out.receivable)}`);
  console.log('');
  console.log(`  支出 合計       ${yen(out.cost.total)}  (台帳${yen(out.cost.ledger)} + 決済手数料${yen(out.cost.stripeFee)})`);
  console.log('');
  console.log(`  損益            ${out.profit >= 0 ? '+' : ''}${yen(out.profit)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
