#!/usr/bin/env node
// BW6 発表会のテストデータ削除（試しの発表会 is_test=1 の後片付け用）。
//
// 使い方:
//   node scripts/recital_reset_testdata.mjs bw6-test          … 表ごとの件数を出すだけ（何も消さない）
//   node scripts/recital_reset_testdata.mjs bw6-test --yes    … 削除する
//   本番に使うとき: node --env-file=.env.production.local scripts/recital_reset_testdata.mjs bw6-test
//
// is_test=1 の発表会だけを消す。守りは文の中にもある（src/lib/recitalReset.ts）。
// 消す順・消す表は src/lib/recitalReset.ts が正本（スタッフ画面の resetTestEvent と同じ文）。
// 設定・料金の規則・作品・特別な料金の事前登録・イントラのページの鍵は残す。
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN（未設定ならローカル file:./data/bw5.db）
import { createClient } from '@libsql/client';
import { recitalResetStatements } from '../src/lib/recitalReset.ts';

const eventKey = process.argv[2];
const doIt = process.argv.includes('--yes');
if (!eventKey || eventKey.startsWith('--')) {
  console.error('event_key を指定してください（例: bw6-test）');
  process.exit(1);
}

const c = createClient({ url: process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db', authToken: process.env.TURSO_AUTH_TOKEN });

const ev = (await c.execute({ sql: 'SELECT is_test FROM recital_events WHERE event_key = ?', args: [eventKey] })).rows[0];
if (!ev || Number(ev.is_test) !== 1) {
  console.log(`event_key=${eventKey}`);
  console.log('is_test=1 の発表会ではありません。何も消しません');
  process.exit(0);
}

const stmts = recitalResetStatements(eventKey);
const counts = {};
for (const s of stmts) {
  counts[s.table] = Number((await c.execute({ sql: s.countSql, args: s.args })).rows[0].n);
}
console.log(`event_key=${eventKey}`, counts);

if (!doIt) {
  console.log('確認だけしました。消すときは --yes を付けてください');
  process.exit(0);
}

await c.batch(stmts.map((s) => ({ sql: s.deleteSql, args: s.args })), 'write');
console.log('削除しました');
