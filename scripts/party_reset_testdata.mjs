#!/usr/bin/env node
// パーティー申込のテストデータ削除(公開前の動作確認の後片付け用)。
//
// 使い方:
//   node scripts/party_reset_testdata.mjs xmas2026          … 件数を表示するだけ(何も消さない)
//   node scripts/party_reset_testdata.mjs xmas2026 --yes    … 削除する
//
// 消す順番: 決済記録 → 出演メンバー → 申込 → 収支台帳(このイベントの行)。設定(party_settings)は残す。
// BF6では「控えのテーブルだけ消して申込の状態を戻さない」ことで幻の集金済みが残った。
// ここでは申込そのものを消すので、状態だけが残ることはない。
// ⚠️ 公開後(本物の申込が入った後)には使わない。
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN(未設定ならローカル file:./data/bw5.db)
import { createClient } from '@libsql/client';

const eventKey = process.argv[2];
const doIt = process.argv.includes('--yes');
if (!eventKey || eventKey.startsWith('--')) {
  console.error('event_key を指定してください(例: xmas2026)');
  process.exit(1);
}

const c = createClient({ url: process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db', authToken: process.env.TURSO_AUTH_TOKEN });
const ids = "SELECT id FROM party_orders WHERE event_key = ?";

const counts = {
  party_payments: (await c.execute({ sql: `SELECT COUNT(*) n FROM party_payments WHERE order_id IN (${ids})`, args: [eventKey] })).rows[0].n,
  party_entry_members: (await c.execute({ sql: `SELECT COUNT(*) n FROM party_entry_members WHERE order_id IN (${ids})`, args: [eventKey] })).rows[0].n,
  party_orders: (await c.execute({ sql: 'SELECT COUNT(*) n FROM party_orders WHERE event_key = ?', args: [eventKey] })).rows[0].n,
  event_ledger: (await c.execute({ sql: 'SELECT COUNT(*) n FROM event_ledger WHERE event_key = ?', args: [eventKey] })).rows[0].n,
};
console.log(`event_key=${eventKey}`, counts);

if (!doIt) {
  console.log('確認だけしました。消すときは --yes を付けてください');
  process.exit(0);
}

await c.batch(
  [
    { sql: `DELETE FROM party_payments WHERE order_id IN (${ids})`, args: [eventKey] },
    { sql: `DELETE FROM party_entry_members WHERE order_id IN (${ids})`, args: [eventKey] },
    { sql: 'DELETE FROM party_orders WHERE event_key = ?', args: [eventKey] },
    { sql: 'DELETE FROM event_ledger WHERE event_key = ?', args: [eventKey] },
  ],
  'write'
);
console.log('削除しました');
