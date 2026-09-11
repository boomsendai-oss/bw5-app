/**
 * 当日データを本番前のまっさらな状態に戻す。
 *
 *   node scripts/bf6_reset_testdata.mjs                 … 何が消えるか出すだけ(書き込みなし)
 *   node scripts/bf6_reset_testdata.mjs --apply         … 実際に消す
 *   node scripts/bf6_reset_testdata.mjs --apply --keep-logins   … クルーのログインは残す(操作中の人を追い出さない)
 *   node scripts/bf6_reset_testdata.mjs --apply --order 59      … テスト用の申込も一緒に消す
 *
 * 消すのは「当日の操作で溜まるもの」だけ。申込・入金・キャンセル待ち・一斉メールの履歴・設定には触らない。
 *
 * ⚠️ 当日現金の「受け取った」を押すと、申込そのものが支払い済みに変わる。
 *    控え(bf_cash_collect)だけ消すと支払い済みのまま残るので、控えがある申込は当日現金(未払い)に戻す。
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const apply = process.argv.includes('--apply');
const keepLogins = process.argv.includes('--keep-logins');
const oi = process.argv.indexOf('--order');
const testOrder = oi >= 0 ? Number(process.argv[oi + 1]) : null;

// 当日の操作で溜まるもの。ここに申込・入金は入れない。
const DAY_TABLES = [
  ['bf_checkin', 'チェックイン'],
  ['bf_draw', 'くじ引きの枠(受付画面を開くとまた作られる)'],
  ['bf_match', '試合結果'],
  ['bf_qualifier', '予選通過者'],
  ['bf_photo', '顔写真(切り抜き済み)'],
  ['bf_photo_raw', '顔写真(元画像)'],
  ['bf_screen_state', 'LED画面の状態(ロゴに戻る)'],
  ['bf_cash_collect', '当日現金の受け取りの控え'],
  ['bf_gate_entry', '入場受付(リストバンドを渡した数)'],
  ['bf_walkin_sale', '当日券の販売記録'],
  ['bf_stream_sessions', '配信の視聴セッション'],
  ...(keepLogins ? [] : [['bf_crew_sessions', 'クルーのログイン(入り直しになる)']]),
];

const KEEP_TABLES = [
  ['bf_orders', '申込'],
  ['bf_order_items', '申込の明細'],
  ['bf_payments', '入金記録'],
  ['bf_waitlist', 'キャンセル待ち'],
  ['bf_broadcast', '一斉メールの履歴'],
  ['bf_settings', '設定'],
];

const count = async (t) => Number((await db.execute(`SELECT COUNT(*) c FROM ${t}`)).rows[0].c);

console.log(apply ? '=== 実行します ===' : '=== 下見(書き込みなし) ===');
console.log('\n■ 消すもの');
let total = 0;
for (const [t, label] of DAY_TABLES) {
  const c = await count(t);
  total += c;
  console.log(`  ${String(c).padStart(4)} 件  ${label}`);
}
if (keepLogins) console.log('     (クルーのログインは残します)');

// 受け取りの控えがある当日現金の申込 = テストで支払い済みにしたもの
const revert = (await db.execute(
  `SELECT o.id, o.amount_total FROM bf_cash_collect c JOIN bf_orders o ON o.id = c.order_id
    WHERE o.pay_method = 'onsite' AND o.payment_status = 'paid'`
)).rows.map((r) => ({ id: Number(r.id), amount: Number(r.amount_total) }));
console.log(`\n■ 当日現金(未払い)に戻す申込: ${revert.length} 件${revert.length ? ' ' + revert.map((r) => `BF6-${String(r.id).padStart(3, '0')} ¥${r.amount.toLocaleString()}`).join(' / ') : ''}`);

if (testOrder) {
  const o = await db.execute({ sql: 'SELECT id, amount_total, payment_status FROM bf_orders WHERE id = ?', args: [testOrder] });
  console.log(o.rows.length ? `\n■ テスト用の申込も消す: BF6-${String(testOrder).padStart(3, '0')} ¥${o.rows[0].amount_total} (${o.rows[0].payment_status})` : `\n  ⚠️ 申込 ${testOrder} が見つかりません`);
}

const orphanKeys = Number((await db.execute('SELECT COUNT(*) c FROM bf_stream_keys WHERE order_id = 0')).rows[0].c);
if (orphanKeys) console.log(`\n■ 手で作ったテスト用の視聴キー ${orphanKeys} 本も消す`);

console.log('\n■ 触らないもの');
for (const [t, label] of KEEP_TABLES) console.log(`  ${String(await count(t)).padStart(4)} 件  ${label}`);

if (!apply) {
  console.log('\n実行するには --apply を付けてください。');
  process.exit(0);
}

const now = new Date().toISOString();
const stmts = revert.map((r) => ({
  sql: "UPDATE bf_orders SET payment_status = 'cash_due', updated_at = ? WHERE id = ? AND pay_method = 'onsite' AND payment_status = 'paid'",
  args: [now, r.id],
}));
for (const [t] of DAY_TABLES) stmts.push({ sql: `DELETE FROM ${t}`, args: [] });
stmts.push({ sql: 'DELETE FROM bf_stream_keys WHERE order_id = 0', args: [] });
if (testOrder) {
  for (const t of ['bf_stream_keys', 'bf_payments', 'bf_order_items']) stmts.push({ sql: `DELETE FROM ${t} WHERE order_id = ?`, args: [testOrder] });
  stmts.push({ sql: 'DELETE FROM bf_orders WHERE id = ?', args: [testOrder] });
}
// 全部まとめて1回で書く(途中で止まって半端に残らないように)
await db.batch(stmts, 'write');

console.log('\n=== 結果 ===');
for (const [t, label] of DAY_TABLES) console.log(`  ${String(await count(t)).padStart(4)} 件  ${label}`);
console.log(`  当日現金(未払い): ${(await db.execute("SELECT COUNT(*) c FROM bf_orders WHERE payment_status = 'cash_due'")).rows[0].c} 件`);
console.log('\n■ 残したもの');
for (const [t, label] of KEEP_TABLES) console.log(`  ${String(await count(t)).padStart(4)} 件  ${label}`);
console.log(`\n消した合計: ${total} 件 / 未払いに戻した申込: ${revert.length} 件`);
