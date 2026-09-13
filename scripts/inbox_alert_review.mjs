#!/usr/bin/env node
// 受信箱アラートの事前テスト(本番ドライラン)の結果を一覧する。
// 件名はGmailから取り直して画面に出すだけで、ファイルにもDBにも保存しない(DBは読むだけ)。
// 件数が多くて画面では追いきれない時は、Markdownに書き出す scripts/inbox_alert_report.mjs を使う。
//
// 使い方(本番DBの接続情報は bw5-app 本体の .env.production.local を絶対パスで読む):
//   node --env-file=$HOME/BOOM/BW5_2026/bw5-app/.env.production.local scripts/inbox_alert_review.mjs
import { createClient } from '@libsql/client';
import {
  ACCOUNTS,
  KIND,
  LABEL,
  PRICE_IN,
  PRICE_OUT,
  YEN_PER_USD,
  fetchSubjectFrom,
  localToken,
  senderLabel,
} from './lib/inbox_alert_view.mjs';

if (!process.env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL がありません。--env-file=<bw5-app の .env.production.local> を付けて実行してください');
  process.exit(2);
}

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function describeRow(auth, row) {
  const when = new Date(Number(row.received_ms) + 9 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ');
  if (!auth.token) return `${when} ${auth.reason}`;
  const got = await fetchSubjectFrom(auth.token, row.message_id);
  if (!got.ok) return `${when} ${got.reason}`;
  return `${when} ${got.subject} ／ ${senderLabel(got.from)}`;
}

const state = await db.execute('SELECT account, last_checked_ms, consecutive_errors, last_error FROM inbox_alert_state');
console.log('■ 進み具合（完了＝過去分の判定が終わった）');
for (const s of state.rows) {
  const done = Number(s.last_checked_ms) > 0 ? '完了' : '判定中';
  console.log(`  ${LABEL[s.account] ?? s.account}: ${done} / 連続エラー ${s.consecutive_errors}${s.last_error ? `（${s.last_error}）` : ''}`);
}

const rows = (await db.execute('SELECT * FROM inbox_alert_items WHERE dry_run = 1 ORDER BY account, received_ms')).rows;
const tally = {};
let inTokens = 0;
let outTokens = 0;
for (const r of rows) {
  const key = `${LABEL[r.account] ?? r.account} / ${r.read_mode} → ${r.tier}`;
  tally[key] = (tally[key] ?? 0) + 1;
  inTokens += Number(r.input_tokens);
  outTokens += Number(r.output_tokens);
}
console.log(`\n■ 件数（ドライラン ${rows.length}通）`);
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k}: ${v}`);

const aiRows = rows.filter((r) => r.read_mode === 'ai_light' || r.read_mode === 'ai_full');
const usd = (inTokens * PRICE_IN + outTokens * PRICE_OUT) / 1_000_000;
console.log(`\n■ AI費用（概算）: 判定${aiRows.length}通 / 入力${inTokens.toLocaleString()}・出力${outTokens.toLocaleString()}トークン ≒ $${usd.toFixed(2)}（約${Math.round(usd * YEN_PER_USD).toLocaleString()}円）`);
console.log(`  AI判定できず: ${rows.filter((r) => Number(r.ai_failed) === 1).length}通`);

const tokens = {};
for (const account of ACCOUNTS) tokens[account] = await localToken(account);

const sections = [
  ['すぐ鳴らす（now）', (r) => r.tier === 'now'],
  ['朝のまとめ（digest）', (r) => r.tier === 'digest'],
  ['見逃し候補: 人が書いた風なのに件数だけにしたメール', (r) => r.tier === 'count' && r.read_mode === 'ai_full'],
];
for (const [title, pick] of sections) {
  const list = rows.filter(pick);
  console.log(`\n■ ${title} ${list.length}通`);
  for (const r of list) {
    const failed = Number(r.ai_failed) === 1 ? '【AI判定できず】' : '';
    const auth = tokens[r.account] ?? { token: null, reason: '(不明なアカウント)' };
    console.log(`  [${LABEL[r.account] ?? r.account}]${KIND[r.kind] ?? ''}${failed} ${await describeRow(auth, r)}`);
  }
}
