#!/usr/bin/env node
// 受信箱アラートの確認シートを、ブラウザでポチポチ確認するための小さな画面。
// このMacの中だけ(127.0.0.1)で動き、外には何も送らない。件名はブラウザに出すだけで、保存先もこのMacの中。
//
// 使い方:
//   node scripts/inbox_alert_check_ui.mjs [--file <確認シート.md>] [--port <番号>]
//   出たURLをブラウザで開き、1行ずつ「鳴らしてほしい / いらない / 保留」を選ぶ。
//   選んだ内容は0.5秒後に自動で ~/Desktop/受信箱アラート_チェック結果_<日付>.json に保存される(閉じても消えない)。
import http from 'node:http';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_FILE = join(homedir(), 'Desktop', '受信箱アラート_確認シート_2026-09-13.md');
const DEFAULT_PORT = 8787;
const MARKS = ['鳴らしてほしい', 'いらない', '保留'];

function usage() {
  console.error([
    '使い方:',
    '  node scripts/inbox_alert_check_ui.mjs [--file <確認シート.md>] [--port <番号>]',
    '',
    `  --file: 確認シートのMarkdown(既定 ${DEFAULT_FILE})`,
    `  --port: 待ち受けポート(既定 ${DEFAULT_PORT}・埋まっていたら1ずつ増やす)`,
  ].join('\n'));
  process.exit(2);
}

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
    console.error(`${path} はリポジトリの中です。件名と差出人が入るので、リポジトリの外(例: ~/Desktop)に置いてください`);
    process.exit(2);
  }
}

const args = process.argv.slice(2);
const fileOption = takeOption(args, '--file');
const portOption = takeOption(args, '--port');
if (args.length > 0) usage();
const port = portOption === undefined ? DEFAULT_PORT : Number(portOption);
if (!Number.isInteger(port) || port < 1024 || port > 65535) usage();

const sheetPath = resolve(fileOption ?? DEFAULT_FILE);
if (!existsSync(sheetPath)) {
  console.error(`確認シートが見つかりません（${sheetPath}）。--file で場所を指定してください`);
  process.exit(2);
}

/** 保存先は確認シートと同じ場所に「チェック結果」として置く */
const outPath = join(
  dirname(sheetPath),
  `${basename(sheetPath, '.md').replace('確認シート', 'チェック結果')}.json`,
);
assertOutsideRepo(outPath);

// ── 確認シートを読む(A=要確認 と B=AIが読まなかった だけ。C=機械的な通知は見ない) ──
const rows = [];
let section = null;
for (const line of readFileSync(sheetPath, 'utf8').split('\n')) {
  const heading = line.match(/^##\s*([A-C])\./);
  if (heading) {
    section = heading[1];
    continue;
  }
  if (section !== 'A' && section !== 'B') continue;
  const m = line.match(/^- \[[ xX]\] (\d{1,2}\/\d{1,2} \d{1,2}:\d{2}) ［([^］]*)］(.*)$/);
  if (!m) continue;
  const [, date, account, rest] = m;
  const sep = rest.indexOf(' — ');
  rows.push({
    section,
    date,
    account,
    sender: (sep >= 0 ? rest.slice(0, sep) : rest).trim(),
    subject: (sep >= 0 ? rest.slice(sep + 3) : '').trim(),
  });
}
if (rows.length === 0) {
  console.error(`確認シートから行を読み取れませんでした（${sheetPath}）。A・Bの「- [ ] 日付 ［アカウント］差出人 — 件名」の形か確かめてください`);
  process.exit(2);
}

/** 同じ行を見分けるための鍵(保存した内容を読み直す時に使う) */
const keyOf = (r) => [r.section, r.date, r.account, r.sender, r.subject].join('');

// ── 前回の続きから(保存済みがあれば選択を復元する) ──
let memo = '';
const marks = {};
if (existsSync(outPath)) {
  try {
    const saved = JSON.parse(readFileSync(outPath, 'utf8'));
    memo = typeof saved.memo === 'string' ? saved.memo : '';
    for (const r of saved.rows ?? []) {
      if (r && MARKS.includes(r.mark)) marks[keyOf(r)] = r.mark;
    }
  } catch {
    // 壊れていたら無かったことにする(上書きされるだけで、元の確認シートは触らない)
  }
}

function saveToDisk(nextMemo, nextMarks) {
  const payload = {
    savedAt: new Date().toISOString(),
    memo: nextMemo,
    rows: rows.map((r) => ({ ...r, mark: nextMarks[keyOf(r)] ?? '' })),
  };
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(outPath, 0o600);
  return payload.savedAt;
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** </script> でページを壊されないようにする(件名は外部の人が書ける文字列) */
const toJsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function page() {
  const data = rows.map((r, i) => ({ i, ...r, key: keyOf(r), mark: marks[keyOf(r)] ?? '' }));
  const counts = { A: data.filter((r) => r.section === 'A').length, B: data.filter((r) => r.section === 'B').length };
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>受信箱アラート 確認シート</title>
<style>
  /* 白背景・濃い文字で固定する(ダークモードでも文字が消えないよう、すべての要素に色を明示する) */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f2ef; color: #101040; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; font-size: 14px; }
  header { position: sticky; top: 0; z-index: 10; background: #101040; color: #ffffff; padding: 10px 16px; border-bottom: 3px solid #00a090; }
  header .title { font-weight: 700; font-size: 15px; color: #ffffff; }
  header .counts { margin-top: 4px; color: #e0d0c0; font-size: 13px; }
  header .saved { color: #7ef0dc; font-size: 13px; }
  main { padding: 12px 16px 40px; max-width: 1100px; }
  h2 { background: #e0d0c0; color: #101040; padding: 6px 10px; border-radius: 6px; font-size: 14px; margin: 18px 0 8px; }
  .row { background: #ffffff; color: #101040; border: 1px solid #ddd6cc; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
  .row.cursor { outline: 3px solid #00a090; outline-offset: 1px; }
  .row.done { background: #f7fbf9; }
  .meta { color: #5a5a72; font-size: 12px; min-width: 92px; }
  .account { background: #101040; color: #ffffff; border-radius: 4px; padding: 1px 6px; font-size: 12px; }
  .sender { color: #101040; font-weight: 600; min-width: 140px; }
  .subject { color: #22223b; flex: 1 1 320px; word-break: break-word; }
  .state { font-size: 12px; font-weight: 700; border-radius: 4px; padding: 2px 8px; background: #eeeae4; color: #5a5a72; white-space: nowrap; }
  .state.m1 { background: #b3261e; color: #ffffff; }
  .state.m2 { background: #d7d2c8; color: #3b3b46; }
  .state.m3 { background: #8a6d1f; color: #ffffff; }
  .btns { display: flex; gap: 4px; }
  button { font: inherit; cursor: pointer; border-radius: 6px; padding: 4px 10px; border: 1px solid #b8b0a4; background: #ffffff; color: #101040; }
  button:hover { border-color: #00a090; }
  button.on1 { background: #b3261e; color: #ffffff; border-color: #b3261e; font-weight: 700; }
  button.on2 { background: #4a4a58; color: #ffffff; border-color: #4a4a58; font-weight: 700; }
  button.on3 { background: #8a6d1f; color: #ffffff; border-color: #8a6d1f; font-weight: 700; }
  textarea { width: 100%; min-height: 110px; background: #ffffff; color: #101040; border: 1px solid #b8b0a4; border-radius: 8px; padding: 10px; font: inherit; }
  textarea::placeholder { color: #8a8a9a; }
  .help { background: #ffffff; color: #3b3b46; border: 1px solid #ddd6cc; border-radius: 8px; padding: 10px; margin: 14px 0; }
  code { background: #eeeae4; color: #101040; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<header>
  <div class="title">受信箱アラート 確認シート（クリックで選ぶ。自動保存されます）</div>
  <div class="counts">A 要確認 ${counts.A}件 ／ B AIが読まなかった ${counts.B}件 ／ 未選択 <span id="left">-</span>件　<span class="saved" id="saved">まだ保存していません</span></div>
</header>
<main>
  <div class="help">
    キーボード: <code>j</code> 次 / <code>k</code> 前 / <code>1</code> 鳴らしてほしい / <code>2</code> いらない / <code>3</code> 保留
  </div>
  <div id="list"></div>
  <h2>メモ（気づいたこと・ルールにしたいこと）</h2>
  <textarea id="memo" placeholder="例: この差出人はもう鳴らさなくていい／この件名は必ず鳴らしてほしい"></textarea>
  <div class="help">
    終わったら Claude に伝えてください。結果はこのMacの <code>${escapeHtml(outPath)}</code> に入っています。
  </div>
</main>
<script>
const DATA = ${toJsonForScript(data)};
const MARKS = ${toJsonForScript(MARKS)};
const marks = {};
for (const r of DATA) if (r.mark) marks[r.key] = r.mark;
let cursor = 0;
let timer = null;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

function render() {
  const list = document.getElementById('list');
  list.textContent = '';
  let current = null;
  for (const section of ['A', 'B']) {
    const inSection = DATA.filter((r) => r.section === section);
    if (inSection.length === 0) continue;
    const title = section === 'A' ? 'A. 要確認（人が書いた可能性が高い）' : 'B. AIが読まなかったメール';
    list.appendChild(el('h2', null, title + '　' + inSection.length + '件'));
    for (const r of inSection) {
      const mark = marks[r.key] || '';
      const row = el('div', 'row' + (mark ? ' done' : '') + (r.i === cursor ? ' cursor' : ''));
      row.id = 'row-' + r.i;
      if (r.i === cursor) current = row;
      row.appendChild(el('span', 'meta', r.date));
      row.appendChild(el('span', 'account', r.account));
      row.appendChild(el('span', 'sender', r.sender || '(差出人なし)'));
      row.appendChild(el('span', 'subject', r.subject || '(件名なし)'));
      const state = el('span', 'state' + (mark ? ' m' + (MARKS.indexOf(mark) + 1) : ''), mark || '未選択');
      row.appendChild(state);
      const btns = el('div', 'btns');
      MARKS.forEach((m, idx) => {
        const b = el('button', mark === m ? 'on' + (idx + 1) : null, (idx + 1) + '. ' + m);
        b.onclick = () => { setMark(r.i, m); };
        btns.appendChild(b);
      });
      row.appendChild(btns);
      row.onclick = () => { cursor = r.i; render(); };
      list.appendChild(row);
    }
  }
  const left = DATA.filter((r) => !marks[r.key]).length;
  document.getElementById('left').textContent = left;
  if (current) current.scrollIntoView({ block: 'nearest' });
}

function setMark(i, m) {
  const r = DATA[i];
  if (marks[r.key] === m) delete marks[r.key]; // 同じボタンをもう一度押したら未選択に戻す
  else marks[r.key] = m;
  cursor = i;
  render();
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(save, 500);
}

async function save() {
  try {
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memo: document.getElementById('memo').value, marks }),
    });
    const j = await res.json();
    const t = new Date(j.savedAt);
    const pad = (n) => String(n).padStart(2, '0');
    document.getElementById('saved').textContent = '保存しました ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
  } catch (e) {
    document.getElementById('saved').textContent = '保存できませんでした（画面は閉じないでください）';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'j') { cursor = Math.min(cursor + 1, DATA.length - 1); render(); }
  else if (e.key === 'k') { cursor = Math.max(cursor - 1, 0); render(); }
  else if (e.key === '1' || e.key === '2' || e.key === '3') setMark(cursor, MARKS[Number(e.key) - 1]);
  else return;
  e.preventDefault();
});

document.getElementById('memo').value = ${toJsonForScript(memo)};
document.getElementById('memo').addEventListener('input', scheduleSave);
render();
</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
    const html = page();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
    return;
  }
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 5_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        memo = typeof parsed.memo === 'string' ? parsed.memo : '';
        for (const k of Object.keys(marks)) delete marks[k];
        for (const [k, v] of Object.entries(parsed.marks ?? {})) if (MARKS.includes(v)) marks[k] = v;
        const savedAt = saveToDisk(memo, marks);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, savedAt }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

/** ポートが埋まっていたら1つずつずらして試す */
let tryPort = port;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tryPort < port + 20) {
    tryPort += 1;
    server.listen(tryPort, '127.0.0.1');
    return;
  }
  console.error(`サーバーを起動できませんでした: ${e.message}`);
  process.exit(1);
});
server.on('listening', () => {
  const counts = { A: rows.filter((r) => r.section === 'A').length, B: rows.filter((r) => r.section === 'B').length };
  console.log(`http://127.0.0.1:${tryPort}/`);
  console.log(`  確認する行: A ${counts.A}件 / B ${counts.B}件（合計 ${rows.length}件）`);
  console.log(`  保存先: ${outPath}`);
  console.log('  終わったら Ctrl+C で止めてください');
});
server.listen(tryPort, '127.0.0.1');
