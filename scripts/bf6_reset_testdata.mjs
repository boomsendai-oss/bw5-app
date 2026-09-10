/**
 * 当日データを本番前のまっさらな状態に戻す。
 *
 *   node scripts/bf6_reset_testdata.mjs            … 何が消えるか出すだけ(書き込みなし)
 *   node scripts/bf6_reset_testdata.mjs --apply    … 実際に消す
 *   node scripts/bf6_reset_testdata.mjs --apply --order 59  … テスト用の申込も一緒に消す
 *
 * 消すのは「当日の操作で溜まるもの」だけ。
 * 申込・入金・キャンセル待ち・一斉メールの履歴・設定には触らない。
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
const oi = process.argv.indexOf('--order');
const testOrder = oi >= 0 ? Number(process.argv[oi + 1]) : null;

// 当日の操作で溜まるものだけ。ここに申込・入金は入れない。
const DAY_TABLES = [
  ['bf_checkin', 'チェックイン'],
  ['bf_draw', 'くじ引きの枠(当日また作られる)'],
  ['bf_match', '試合結果'],
  ['bf_qualifier', '予選通過者'],
  ['bf_photo', '顔写真(切り抜き済み)'],
  ['bf_photo_raw', '顔写真(元画像)'],
  ['bf_screen_state', 'LED画面の状態'],
  ['bf_cash_collect', '当日現金の集金記録'],
  ['bf_stream_sessions', '配信の視聴セッション'],
  ['bf_crew_sessions', 'クルーのログイン(入り直しになる)'],
];

// 触らないもの(誤って消していないかの確認用に件数だけ出す)
const KEEP_TABLES = [
  ['bf_orders', '申込'],
  ['bf_order_items', '申込の明細'],
  ['bf_payments', '入金記録'],
  ['bf_waitlist', 'キャンセル待ち'],
  ['bf_broadcast', '一斉メールの履歴'],
  ['bf_broadcast_recipient', '一斉メールの宛先'],
  ['bf_settings', '設定'],
];

const count = async (t) => Number((await db.execute(`SELECT COUNT(*) c FROM ${t}`)).rows[0].c);

console.log(apply ? '=== 実行します ===' : '=== 下見(書き込みなし) ===\n');

console.log('■ 消すもの');
let total = 0;
for (const [t, label] of DAY_TABLES) {
  const c = await count(t);
  total += c;
  console.log(`  ${String(c).padStart(4)} 件  ${label}  (${t})`);
}

if (testOrder) {
  const o = await db.execute({ sql: 'SELECT id, buyer_name, amount_total, payment_status FROM bf_orders WHERE id = ?', args: [testOrder] });
  if (!o.rows.length) {
    console.log(`\n  ⚠️ 申込 ${testOrder} が見つかりません`);
  } else {
    const r = o.rows[0];
    console.log(`\n■ テスト用の申込も消す`);
    console.log(`     BF6-${String(r.id).padStart(3, '0')} ${r.buyer_name} ¥${r.amount_total} (${r.payment_status})`);
    console.log(`     + その明細・入金記録・視聴キー`);
  }
}

const orphanKeys = await db.execute('SELECT id, order_id FROM bf_stream_keys WHERE order_id = 0');
if (orphanKeys.rows.length) {
  console.log(`\n■ 手で作ったテスト用の視聴キー ${orphanKeys.rows.length} 本も消す`);
}

console.log('\n■ 触らないもの');
for (const [t, label] of KEEP_TABLES) {
  console.log(`  ${String(await count(t)).padStart(4)} 件  ${label}`);
}

if (!apply) {
  console.log('\n実行するには --apply を付けてください。');
  process.exit(0);
}

for (const [t] of DAY_TABLES) await db.execute(`DELETE FROM ${t}`);
await db.execute('DELETE FROM bf_stream_keys WHERE order_id = 0');
if (testOrder) {
  await db.execute({ sql: 'DELETE FROM bf_stream_keys WHERE order_id = ?', args: [testOrder] });
  await db.execute({ sql: 'DELETE FROM bf_payments WHERE order_id = ?', args: [testOrder] });
  await db.execute({ sql: 'DELETE FROM bf_order_items WHERE order_id = ?', args: [testOrder] });
  await db.execute({ sql: 'DELETE FROM bf_orders WHERE id = ?', args: [testOrder] });
}

console.log('\n=== 結果 ===');
for (const [t, label] of DAY_TABLES) console.log(`  ${String(await count(t)).padStart(4)} 件  ${label}`);
console.log(`  ${String(await count('bf_stream_keys')).padStart(4)} 件  視聴キー`);
console.log('\n■ 残したもの');
for (const [t, label] of KEEP_TABLES) console.log(`  ${String(await count(t)).padStart(4)} 件  ${label}`);
console.log(`\n消した合計: ${total} 件`);
