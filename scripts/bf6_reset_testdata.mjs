// BF6 当日データのリセット(本番前のテストを消す)。
//
// ⚠️ 2026-09-23に手書きのリセットで事故になった。bf_cash_collect(集金の控え)を消しただけで
//    bf_orders.payment_status を戻さなかったため、**集金していない3件(¥18,500)が「集金済み」のまま**
//    残り、当日そのまま取りっぱぐれるところだった(9/25にTAROが気づいて発覚)。
//    集金はテーブルが2つに分かれている。必ず**控えを消す前に申込の状態を戻す**こと。
//
// 使い方:
//   node scripts/bf6_reset_testdata.mjs            … 何が消えるかだけ表示(実行しない)
//   node scripts/bf6_reset_testdata.mjs --yes      … 実行する
//
// 触らないもの: bf_orders / bf_order_items / bf_payments / bf_settings / 各種チケット。
// ただし「アプリの集金ボタンで払い済みにした申込」だけは未集金に戻す(上記の理由)。
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';

// 本番の接続情報は .env.production.local から読む(リポジトリには置かない)。
// ⚠️ worktreeから動かすと隣に無いので、本体のチェックアウト側も見る
const ENV_PATHS = [
  '.env.production.local',
  new URL('../.env.production.local', import.meta.url).pathname,
  `${process.env.HOME}/BOOM/BW5_2026/bw5-app/.env.production.local`,
];
function loadEnv() {
  const out = {};
  for (const path of ENV_PATHS) {
    try {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (line.trim().startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i < 1) continue;
        const k = line.slice(0, i).trim();
        if (out[k]) continue;
        out[k] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {
      /* 次の候補を見る */
    }
  }
  return out;
}
const env = { ...loadEnv(), ...process.env };
if (!env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL が見つかりません(.env.production.local を確認)');
  process.exit(1);
}
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

// 当日の記録。消してよいもの(申込・決済は入っていない)
const TABLES = [
  'bf_checkin',
  'bf_draw',
  'bf_match',
  'bf_photo',
  'bf_photo_raw',
  'bf_qualifier',
  'bf_gate_entry',
  'bf_cash_collect',
  'bf_walkin_sale',
  'bf_screen_state',
];

const apply = process.argv.includes('--yes');
const yen = (n) => `¥${Number(n || 0).toLocaleString()}`;

const counts = async () => {
  const out = {};
  for (const t of TABLES) {
    try {
      out[t] = Number((await db.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n);
    } catch {
      out[t] = 'なし';
    }
  }
  return out;
};

// 集金ボタンで払い済みにした申込(控えが残っているもの)。これが戻す対象
const collected = await db.execute(
  `SELECT o.id, o.buyer_name, o.amount_total
     FROM bf_orders o JOIN bf_cash_collect c ON c.order_id = o.id
    WHERE o.pay_method = 'onsite' AND o.payment_status = 'paid'
    ORDER BY o.id`
);

console.log('■ いまの当日データ');
console.table(await counts());
console.log('■ 未集金に戻す申込(アプリで集金済みにしたもの)');
if (collected.rows.length === 0) console.log('  なし');
else {
  for (const r of collected.rows) console.log(`  BF6-${String(r.id).padStart(3, '0')} ${r.buyer_name} ${yen(r.amount_total)}`);
}

if (!apply) {
  console.log('\n(表示しただけです。実行するには --yes を付けてください)');
  process.exit(0);
}

const now = new Date().toISOString();
// ⚠️ 順番が大事。控えを消す前に申込の状態を戻す
for (const r of collected.rows) {
  await db.execute({
    sql: "UPDATE bf_orders SET payment_status = 'cash_due', updated_at = ? WHERE id = ? AND pay_method = 'onsite' AND payment_status = 'paid'",
    args: [now, Number(r.id)],
  });
}
for (const t of TABLES) {
  try {
    await db.execute(`DELETE FROM ${t}`);
  } catch (e) {
    console.log('skip', t, e.message);
  }
}

console.log('\n■ リセット後');
console.table(await counts());
const due = await db.execute(
  "SELECT COUNT(*) n, COALESCE(SUM(amount_total),0) s FROM bf_orders WHERE pay_method = 'onsite' AND payment_status = 'cash_due'"
);
console.log(`当日集金の予定 = ${due.rows[0].n}件 / ${yen(due.rows[0].s)}`);
const keep = await db.execute(
  'SELECT (SELECT COUNT(*) FROM bf_orders) o, (SELECT COUNT(*) FROM bf_order_items) i, (SELECT COUNT(*) FROM bf_payments) p'
);
console.log(`申込 ${keep.rows[0].o} / 明細 ${keep.rows[0].i} / 決済 ${keep.rows[0].p}(ここは触っていない)`);
