#!/usr/bin/env node
// 受信箱アラートの事前テスト(本番ドライラン)の結果を一覧する。
// 件名はGmailから取り直して画面に出すだけで、ファイルにもDBにも保存しない(DBは読むだけ)。
//
// 使い方(本番DBの接続情報は bw5-app 本体の .env.production.local を絶対パスで読む):
//   node --env-file=$HOME/BOOM/BW5_2026/bw5-app/.env.production.local scripts/inbox_alert_review.mjs
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (!process.env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL がありません。--env-file=<bw5-app の .env.production.local> を付けて実行してください');
  process.exit(2);
}

const LOCAL_CRED_DIR = { boom: '.gmail-mcp', nitroash: '.gmail-mcp-nitroash' };
const LABEL = { boom: 'BOOM', nitroash: 'NITRO ASH', taro: '個人' };
const KIND = {
  new_inquiry: '【新規】', reply: '【返信】', money_deadline: '【期限あり】',
  automation_failure: '【失敗】', money_later: '【お金】', other: '【要確認】',
};
// Opus 5 の料金(1Mトークンあたり・Anthropic公式料金表 2026-06-24時点)と換算レート。
// 記録したトークン数はキャッシュの読み書きも同じ単価で数えているので、金額は概算
const PRICE_IN = 5;
const PRICE_OUT = 25;
const YEN_PER_USD = 150;

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

/** このMacの既存の鍵でGmailのアクセストークンを取る。読めない時は理由も返す(鍵が無い/認証できない) */
async function localToken(account) {
  const dir = LOCAL_CRED_DIR[account];
  if (!dir) return { token: null, reason: '(このMacにこのアカウントの鍵がありません)' };
  try {
    const keys = JSON.parse(readFileSync(join(homedir(), dir, 'gcp-oauth.keys.json'), 'utf8'));
    const c = keys.installed ?? keys.web;
    const cred = JSON.parse(readFileSync(join(homedir(), dir, 'credentials.json'), 'utf8'));
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.client_id,
        client_secret: c.client_secret,
        refresh_token: cred.refresh_token,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await r.json();
    return json.access_token
      ? { token: json.access_token, reason: null }
      : { token: null, reason: `(このMacの鍵で認証できません: ${json.error ?? r.status})` };
  } catch (e) {
    return { token: null, reason: `(このMacの鍵で認証できません: ${e.message})` };
  }
}

/**
 * 差出人は表示名だけ出す。表示名が無い(またはアドレスそのもの)ならドメインだけ(お客さんのアドレスを画面に出さない)。
 * ドメインは山括弧の中の本当のアドレスから取る(表示名に書かれた偽のアドレスに惑わされない)
 */
function senderLabel(fromHeader) {
  const raw = (fromHeader ?? '').trim();
  const angle = raw.match(/<([^<>]*)>$/);
  const name = (angle ? raw.slice(0, angle.index) : raw.includes('@') ? '' : raw).replace(/"/g, '').trim();
  if (name && !name.includes('@')) return name;
  const address = angle ? angle[1] : raw;
  const domain = address.match(/@([^>\s,;"]+)/)?.[1];
  return domain ? `(${domain})` : '';
}

async function describeRow(auth, row) {
  const when = new Date(Number(row.received_ms) + 9 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ');
  if (!auth.token) return `${when} ${auth.reason}`;
  let r;
  try {
    r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${row.message_id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(15_000) },
    );
  } catch (e) {
    // 1件の通信エラーで一覧全体を止めない
    return `${when} (通信エラー: ${e.message})`;
  }
  if (!r.ok) return `${when} (取得失敗 ${r.status})`;
  const m = await r.json().catch(() => ({}));
  const h = Object.fromEntries((m.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  return `${when} ${h.subject ?? '(件名なし)'} ／ ${senderLabel(h.from)}`;
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
for (const account of Object.keys(LABEL)) tokens[account] = await localToken(account);

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
