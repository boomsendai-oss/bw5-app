#!/usr/bin/env node
// 受信箱アラートの事前テスト(本番ドライラン)の結果を一覧する。
// 件名はGmailから取り直して画面に出すだけで、ファイルにもDBにも保存しない。
//
// 使い方(bw5-app 直下):
//   node --env-file=.env.production.local scripts/inbox_alert_review.mjs
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (!process.env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL がありません。--env-file=.env.production.local を付けて実行してください');
  process.exit(2);
}

const LOCAL_CRED_DIR = { boom: '.gmail-mcp', nitroash: '.gmail-mcp-nitroash' };
const LABEL = { boom: 'BOOM', nitroash: 'NITRO ASH', taro: '個人' };
const KIND = {
  new_inquiry: '【新規】', reply: '【返信】', money_deadline: '【期限あり】',
  automation_failure: '【失敗】', money_later: '【お金】', other: '【要確認】',
};
// Opus 5 の料金(1Mトークンあたり・Anthropic公式料金表 2026-06-24時点)と換算レート
const PRICE_IN = 5;
const PRICE_OUT = 25;
const YEN_PER_USD = 150;

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function localToken(account) {
  const dir = LOCAL_CRED_DIR[account];
  if (!dir) return null;
  const keys = JSON.parse(readFileSync(join(homedir(), dir, 'gcp-oauth.keys.json'), 'utf8'));
  const c = keys.installed ?? keys.web;
  const cred = JSON.parse(readFileSync(join(homedir(), dir, 'credentials.json'), 'utf8'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: cred.refresh_token, grant_type: 'refresh_token' }),
  });
  return (await r.json()).access_token ?? null;
}

async function describeRow(token, row) {
  const when = new Date(Number(row.received_ms) + 9 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ');
  if (!token) return `${when} (件名はこのMacから読めません)`;
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${row.message_id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return `${when} (取得失敗 ${r.status})`;
  const m = await r.json();
  const h = Object.fromEntries((m.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  const from = (h.from ?? '').replace(/\s*<[^>]*>\s*/, '').replace(/"/g, '') || h.from || '';
  return `${when} ${h.subject ?? '(件名なし)'} ／ ${from}`;
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
console.log(`\n■ AI費用: 判定${aiRows.length}通 / 入力${inTokens.toLocaleString()}・出力${outTokens.toLocaleString()}トークン ≒ $${usd.toFixed(2)}（約${Math.round(usd * YEN_PER_USD).toLocaleString()}円）`);
console.log(`  AI判定できず: ${rows.filter((r) => Number(r.ai_failed) === 1).length}通`);

const tokens = {};
for (const account of Object.keys(LABEL)) tokens[account] = await localToken(account).catch(() => null);

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
    console.log(`  [${LABEL[r.account] ?? r.account}]${KIND[r.kind] ?? ''}${failed} ${await describeRow(tokens[r.account], r)}`);
  }
}
