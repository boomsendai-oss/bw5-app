#!/usr/bin/env node
// 受信箱アラートの事前テスト(本番ドライラン)の結果を、差出人ごとに判断できる形のMarkdownに書き出す。
// DBは読むだけ。件名と差出人は書き出すファイルの中だけに入れ、画面には出さない。
// 書き出したファイルは Git に入れない・見終わったら消す(リポジトリの中には書けないようにしてある)。
//
// 使い方(本番DBの接続情報は bw5-app 本体の .env.production.local を絶対パスで読む):
//   node --env-file=$HOME/BOOM/BW5_2026/bw5-app/.env.production.local scripts/inbox_alert_report.mjs [--out <パス>]
//       既定の書き出し先は ~/Desktop/受信箱アラート_判定結果_<YYYY-MM-DD>.md
//   node scripts/inbox_alert_report.mjs --login-taro --expect <個人のメールアドレス>
//       個人アカウントの件名を取れるようにする(読み取り専用でログインし、鍵を ~/.gmail-alert-local/taro.json に0600で保存する)
import { createClient } from '@libsql/client';
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loopbackLogin } from './lib/google_oauth_loopback.mjs';
import {
  ACCOUNTS,
  ALERT_LOCAL_DIR,
  KIND,
  LABEL,
  PRICE_IN,
  PRICE_OUT,
  TARO_TOKEN_PATH,
  YEN_PER_USD,
  fetchSubjectFrom,
  localToken,
  mapLimit,
  readOauthClient,
  senderDomain,
  senderLabel,
  yenFor,
} from './lib/inbox_alert_view.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FETCH_CONCURRENCY = 8;
const SUBJECT_MAX = 80;
const DOMAIN_ROWS = 40;
/** 「費用を下げる候補」に出す最低件数(たまたま1〜2通読んだだけの差出人は出さない) */
const COST_MIN = 5;

function usage() {
  console.error([
    '使い方:',
    '  node --env-file=<bw5-app の .env.production.local> scripts/inbox_alert_report.mjs [--out <パス>]',
    '  node scripts/inbox_alert_report.mjs --login-taro --expect <個人のメールアドレス>',
    '',
    '  --out: 書き出し先(既定 ~/Desktop/受信箱アラート_判定結果_<日付>.md)。リポジトリの中には書けません',
  ].join('\n'));
  process.exit(2);
}

/** `--name 値` を取り出して args から除く。値が無ければ使い方を出して止める */
function takeOption(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) usage();
  args.splice(i, 2);
  return value;
}

/** 件名と差出人が入るファイルなので、公開リポジトリの中には書かせない */
function assertOutsideRepo(path) {
  const rel = relative(REPO_ROOT, resolve(path));
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    console.error(`${path} はリポジトリの中です。件名と差出人が入るファイルなので、リポジトリの外(例: ~/Desktop)に書き出してください`);
    process.exit(2);
  }
}

const jst = (ms) => new Date(ms + 9 * 3_600_000);
const jstStamp = (ms) => jst(ms).toISOString().slice(0, 16).replace('T', ' ');
const jstDay = (ms) => jst(ms).toISOString().slice(0, 10);
/** 表の中で改行や | が化けないようにする。件名は1行に収め、長ければ切る */
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, max = SUBJECT_MAX) => ([...s].length > max ? `${[...s].slice(0, max).join('')}…` : s);
const cell = (s) => clip(oneLine(s)).replace(/\|/g, '\\|');

const args = process.argv.slice(2);
const outOption = takeOption(args, '--out');
const expect = takeOption(args, '--expect');
const loginTaro = args.includes('--login-taro');
if (loginTaro) args.splice(args.indexOf('--login-taro'), 1);
if (args.length > 0) usage();

// ── 個人アカウントのログイン(件名を取れるようにするだけ。DBには触らない) ──
if (loginTaro) {
  if (!expect) usage();
  assertOutsideRepo(TARO_TOKEN_PATH);
  try {
    const client = readOauthClient();
    const { refreshToken } = await loopbackLogin({ client, expect });
    mkdirSync(ALERT_LOCAL_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(TARO_TOKEN_PATH, `${JSON.stringify({ refresh_token: refreshToken }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(TARO_TOKEN_PATH, 0o600); // 前からファイルがあった時のため
    console.log('保存しました');
  } catch (e) {
    console.error(`失敗: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!process.env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL がありません。--env-file=<bw5-app の .env.production.local> を付けて実行してください');
  process.exit(2);
}
const outPath = resolve(outOption ?? join(homedir(), 'Desktop', `受信箱アラート_判定結果_${jstDay(Date.now())}.md`));
assertOutsideRepo(outPath);

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const rows = (await db.execute('SELECT * FROM inbox_alert_items WHERE dry_run = 1 ORDER BY account, received_ms')).rows;
if (rows.length === 0) {
  console.error('ドライランの行がありません(dry_run = 1)。先に事前テストを動かしてください');
  process.exit(2);
}

const tokens = {};
for (const account of ACCOUNTS) tokens[account] = await localToken(account);

process.stderr.write(`件名を取り直します: ${rows.length}件\n`);
let done = 0;
const enriched = await mapLimit(rows, FETCH_CONCURRENCY, async (row) => {
  const auth = tokens[row.account] ?? { token: null, reason: '(取得失敗: 不明なアカウント)' };
  const base = {
    account: String(row.account),
    receivedMs: Number(row.received_ms),
    readMode: String(row.read_mode),
    tier: String(row.tier),
    kind: String(row.kind),
    aiFailed: Number(row.ai_failed) === 1,
    inTokens: Number(row.input_tokens),
    outTokens: Number(row.output_tokens),
    subject: null,
    from: '',
    failReason: null,
  };
  try {
    if (!auth.token) return { ...base, failReason: auth.reason };
    const got = await fetchSubjectFrom(auth.token, row.message_id);
    return got.ok ? { ...base, subject: got.subject, from: got.from } : { ...base, failReason: got.reason };
  } finally {
    done += 1;
    if (done % 100 === 0) process.stderr.write(`  ${done}/${rows.length}件\n`);
  }
});

const known = enriched.filter((r) => r.subject !== null);
const unknown = enriched.filter((r) => r.subject === null);
const inTokens = enriched.reduce((n, r) => n + r.inTokens, 0);
const outTokens = enriched.reduce((n, r) => n + r.outTokens, 0);
const aiRows = enriched.filter((r) => r.readMode === 'ai_light' || r.readMode === 'ai_full');
const usd = (inTokens * PRICE_IN + outTokens * PRICE_OUT) / 1_000_000;
const nowRows = enriched.filter((r) => r.tier === 'now');
const digestRows = enriched.filter((r) => r.tier === 'digest');
const countRows = enriched.filter((r) => r.tier === 'count');
const missRows = enriched.filter((r) => r.tier === 'count' && r.readMode === 'ai_full');
const periodMs = enriched.map((r) => r.receivedMs).filter((n) => n > 0);

/** 差出人ドメインごとにまとめる(件名が取れた行だけ。取れなかった行は別の節で数える) */
function groupByDomain(list) {
  const map = new Map();
  for (const r of list) {
    const domain = senderDomain(r.from);
    const g = map.get(domain) ?? { domain, total: 0, now: 0, digest: 0, count: 0, aiRead: 0, inTokens: 0, outTokens: 0, rows: [] };
    g.total += 1;
    if (r.tier === 'now' || r.tier === 'digest' || r.tier === 'count') g[r.tier] += 1;
    if (r.readMode === 'ai_light' || r.readMode === 'ai_full') g.aiRead += 1;
    g.inTokens += r.inTokens;
    g.outTokens += r.outTokens;
    g.rows.push(r);
    map.set(domain, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain));
}

const domains = groupByDomain(known);
const lines = [];
const put = (...ls) => lines.push(...ls);

// ── 1. 見出し ──
put(
  '# 受信箱アラート 判定結果',
  '',
  `- 作成: ${jstStamp(Date.now())}（JST）`,
  `- ドライランの行: ${rows.length}件（件名が取れた ${known.length}件 / 取れなかった ${unknown.length}件）`,
  `- 対象の期間: ${periodMs.length ? `${jstDay(Math.min(...periodMs))} 〜 ${jstDay(Math.max(...periodMs))}` : '(不明)'}`,
  '',
  '> ⚠️ このファイルには**件名と差出人**が入っています。Gitに入れず、見終わったら削除してください。',
  '',
);

// ── 2. まとめ ──
put('## まとめ', '', '| アカウント | すぐ鳴らす(now) | 朝のまとめ(digest) | 件数だけ(count) | 合計 |', '| --- | ---: | ---: | ---: | ---: |');
for (const account of ACCOUNTS) {
  const list = enriched.filter((r) => r.account === account);
  if (list.length === 0) continue;
  const n = (tier) => list.filter((r) => r.tier === tier).length;
  put(`| ${LABEL[account] ?? account} | ${n('now')} | ${n('digest')} | ${n('count')} | ${list.length} |`);
}
put(
  `| **合計** | **${nowRows.length}** | **${digestRows.length}** | **${countRows.length}** | **${enriched.length}** |`,
  '',
  `- AI費用（概算）: 判定${aiRows.length}通 / 入力${inTokens.toLocaleString()}・出力${outTokens.toLocaleString()}トークン ≒ $${usd.toFixed(2)}（約${Math.round(usd * YEN_PER_USD).toLocaleString()}円）`,
  `- AI判定できず: ${enriched.filter((r) => r.aiFailed).length}通`,
  '',
);
if (unknown.length > 0) {
  const reasons = new Map();
  for (const r of unknown) {
    const key = `${LABEL[r.account] ?? r.account}|${r.failReason ?? '(取得失敗)'}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  put('### 件名が取れなかった行', '', `この${unknown.length}件は件名・差出人を取れなかったので、以下の集計に入っていません。`, '');
  for (const [key, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    const [label, reason] = key.split('|');
    put(`- ${label}: ${n}件 ${reason}`);
  }
  put('', '個人アカウントは `node scripts/inbox_alert_report.mjs --login-taro --expect <アドレス>` でログインすると件名を取れるようになります。', '');
}

// ── 3. 差出人ごとの集計 ──
put(
  '## 差出人ごとの集計',
  '',
  '「この差出人はもう鳴らさなくていい」を決めるための表です（件名が取れた行だけ）。',
  '',
  '| ドメイン | 件数 | now | digest | count | AIが読んだ数 | 推定AI費用(円) |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
);
for (const g of domains.slice(0, DOMAIN_ROWS)) {
  put(`| ${cell(g.domain)} | ${g.total} | ${g.now} | ${g.digest} | ${g.count} | ${g.aiRead} | ${yenFor(g.inTokens, g.outTokens).toLocaleString()} |`);
}
const rest = domains.slice(DOMAIN_ROWS);
if (rest.length > 0) {
  const sum = (pick) => rest.reduce((n, g) => n + pick(g), 0);
  put(
    `| その他${rest.length}件のドメイン | ${sum((g) => g.total)} | ${sum((g) => g.now)} | ${sum((g) => g.digest)} | ${sum((g) => g.count)} | ${sum((g) => g.aiRead)} | ${yenFor(sum((g) => g.inTokens), sum((g) => g.outTokens)).toLocaleString()} |`,
  );
}
put('');

/** 1通を1行で出す(頭の `- [ ] ` は、鳴らさなくていいものにチェックを入れてもらうため) */
const itemLine = (r, box) =>
  `${box ? '- [ ] ' : '- '}${jstStamp(r.receivedMs)} ／ ${LABEL[r.account] ?? r.account} ／ ${KIND[r.kind] ?? r.kind}${r.aiFailed ? '【AI判定できず】' : ''} ／ ${cell(senderLabel(r.from) || r.failReason || '(差出人不明)')} ／ ${cell(r.subject ?? r.failReason ?? '(件名なし)')}`;

// ── 4〜5. now / digest ──
for (const [title, list] of [['すぐ鳴らす（now）', nowRows], ['朝のまとめ（digest）', digestRows]]) {
  put(`## ${title}`, '', `${list.length}件。鳴らさなくていいものにチェックを入れてください。`, '');
  for (const r of list) put(itemLine(r, true));
  put('');
}

// ── 6. 見逃し候補 ──
put(
  '## 見逃し候補（人が書いた風なのに件数だけ）',
  '',
  `${missRows.length}件。AIが本文まで読んだうえで「鳴らさない」と判断したものです。鳴らすべきものが混ざっていないか見てください。`,
  '',
);
const missDomains = groupByDomain(missRows.filter((r) => r.subject !== null));
for (const g of missDomains) {
  put(`- **${cell(g.domain)}** ${g.total}件`);
  for (const r of g.rows.slice(0, 3)) put(`    - ${cell(r.subject ?? '(件名なし)')}`);
}
if (missRows.length > 0) {
  put('', '<details><summary>全件</summary>', '');
  for (const r of missRows) put(itemLine(r, false));
  put('', '</details>', '');
} else {
  put('');
}

// ── 7. 費用を下げる候補 ──
const costDomains = groupByDomain(known.filter((r) => r.tier === 'count' && (r.readMode === 'ai_full' || r.readMode === 'ai_light')))
  .filter((g) => g.total >= COST_MIN)
  .sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain));
put(
  '## 費用を下げる候補',
  '',
  `AIが読んだのに結果は「件数だけ」だった差出人（${COST_MIN}件以上）。先に振り分ければ、その分のAI費用がまるごと減ります。`,
  '',
  '| ドメイン | 読んだ数 | 推定費用(円) |',
  '| --- | ---: | ---: |',
);
for (const g of costDomains) put(`| ${cell(g.domain)} | ${g.total} | ${yenFor(g.inTokens, g.outTokens).toLocaleString()} |`);
if (costDomains.length === 0) put('| (該当なし) | 0 | 0 |');
put('');

writeFileSync(outPath, lines.join('\n'), { mode: 0o600 });

// 画面には件名も差出人も出さない(パスと件数だけ)
console.log(`書き出しました: ${outPath}（${statSync(outPath).size.toLocaleString()}バイト）`);
console.log(`  ドライランの行: ${rows.length}件（件名が取れた ${known.length} / 取れなかった ${unknown.length}）`);
console.log(`  すぐ鳴らす(now): ${nowRows.length} / 朝のまとめ(digest): ${digestRows.length} / 件数だけ(count): ${countRows.length}`);
console.log(`  差出人ドメイン: ${domains.length} / 見逃し候補: ${missRows.length}件 / 費用を下げる候補: ${costDomains.length}ドメイン`);
console.log('  ※ 件名と差出人が入っています。Gitに入れず、見終わったら削除してください');
