/**
 * 切り抜きをやり直させる(当日、仕上がりが気に入らない写真が出たとき用)。
 *
 *   node scripts/bf6_recut.mjs 19      枠ではなく「申込項目ID」を指定
 *   node scripts/bf6_recut.mjs all     元画像がある人を全員やり直し
 *
 * 待ち行列に戻すだけ。常駐している切り抜き係が数秒後に拾って差し替える。
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';

const envPath = new URL('../.env.production.local', import.meta.url);
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const arg = process.argv[2];
if (!arg) {
  console.error('使い方: node scripts/bf6_recut.mjs <申込項目ID|all>');
  process.exit(1);
}

if (arg === 'all') {
  const r = await db.execute('UPDATE bf_photo_raw SET cut_at = NULL, cut_model = NULL');
  console.log(`${r.rowsAffected}件を抜き直し待ちに戻しました`);
} else {
  const id = Number(arg);
  if (!Number.isInteger(id)) {
    console.error('申込項目IDは数字で指定してください');
    process.exit(1);
  }
  const who = await db.execute('SELECT dancer_name FROM bf_order_items WHERE id = ?', [id]);
  const r = await db.execute(
    'UPDATE bf_photo_raw SET cut_at = NULL, cut_model = NULL WHERE item_id = ?',
    [id],
  );
  if (r.rowsAffected === 0) {
    console.log(`item ${id} の元画像がありません(撮り直しが要ります)`);
  } else {
    console.log(`item ${id} (${who.rows[0]?.dancer_name ?? '?'}) を抜き直し待ちに戻しました`);
  }
}
