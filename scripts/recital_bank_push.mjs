// BW6 発表会（段階1）の入金の束を、入口 POST /api/staff/recital/bank-rows に渡す（読む役が使う。決まりの紙 2-17）。
// 手順書：boom-events-hub/docs/bw6-bank-read.md
//
// 使い方:
//   node scripts/recital_bank_push.mjs <束.json> --mode dry            # 手元（http://localhost:3000 と data/bw6_dev.db）に試しで渡す
//   node scripts/recital_bank_push.mjs <束.json> --mode dry --prod     # 本番に試しで渡す（何も書かない。合わなかった試しだけ束の記録に1行）
//   node scripts/recital_bank_push.mjs <束.json> --mode commit --prod  # 本番に渡す（台帳に入れて、当てて、メールを出す）
//
// 作りは scripts/bf7_ws_match_transfers.mjs と同じ：10分だけのスタッフの入場券を DB に入れる → 入口を呼ぶ → finally で消す。
// 本番の DB とアプリにさわるのは --prod の時だけ（.env.production.local を読み、送り先は RECITAL_BASE_URL か https://bw5-app.vercel.app）。
// --prod が無い時は .env.local を読まない（本番の DB を指しているため）。入場券は手元の data/bw6_dev.db（dev サーバが見ている DB）に入れる。
// 出す物は数字だけ（入口が名義・摘要・世帯の名前・残高を返さない。K146）。
// 終わりの数：検算が合った → 0、合わない → 2、ほかのエラー → 1。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';

const USAGE = '使い方: node scripts/recital_bank_push.mjs <束.json> --mode dry|commit [--prod]';
const LOCAL_BASE = 'http://localhost:3000';
const PROD_BASE_DEFAULT = 'https://bw5-app.vercel.app';
const TICKET_MS = 10 * 60 * 1000;

/** 見てほしい入金の種類の言葉（決まりの紙 6-6 の表。src/app/staff/bw6/bank/ReviewCards.tsx の KIND_LABEL と同じ。first5 だけ計画の出力の見本のとおり短く） */
const KIND_LABEL = {
  unread: '読めない所がある',
  manual: '手で打った行',
  no_ref: '番号が無い',
  bad_ref: '番号が合わない',
  gone: '出演なし・まとめた世帯の番号',
  paid: 'もう払い済み',
  sum: '足すとぴったり',
  short: '金額が少ない',
  over: '金額が多い',
  name: 'お名前が合わない',
  first5: 'はじめの5件',
};
const MARKS = ['①', '②', '③', '④', '⑤'];

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// ---- 引数 ----
const args = process.argv.slice(2);
const prod = args.includes('--prod');
const modeAt = args.indexOf('--mode');
const mode = modeAt >= 0 ? args[modeAt + 1] : undefined;
const file = args.find((a, i) => !a.startsWith('--') && i !== modeAt + 1);
if (mode !== 'dry' && mode !== 'commit') fail(USAGE);
if (!file) fail(USAGE);

// ---- 束を読んで、形を確かめる（入口と同じ validateBatchShape。.ts は @/ の import をふくむので jiti で読む） ----
let validateBatchShape;
try {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url, { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } });
  ({ validateBatchShape } = await jiti.import('../src/lib/recitalBankBatch.ts'));
  if (typeof validateBatchShape !== 'function') throw new Error('validateBatchShape が無い');
} catch (e) {
  fail(`jiti で src/lib/recitalBankBatch.ts を読めませんでした（止まって知らせる）：${e instanceof Error ? e.message : e}`);
}

let raw;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  fail(`束の JSON を読めませんでした：${e instanceof Error ? e.message : e}`);
}
const shape = validateBatchShape(raw);
if (!shape.ok) fail(`束の形が合いません：${shape.error}`);
const batch = shape.batch;

// ---- 送り先と、入場券を入れる DB ----
let base;
let dbUrl;
let dbToken;
if (prod) {
  for (const line of readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  base = process.env.RECITAL_BASE_URL || PROD_BASE_DEFAULT;
  dbUrl = process.env.TURSO_DATABASE_URL;
  dbToken = process.env.TURSO_AUTH_TOKEN;
  if (!dbUrl) fail('.env.production.local に TURSO_DATABASE_URL がありません');
} else {
  const localDb = fileURLToPath(new URL('../data/bw6_dev.db', import.meta.url));
  // 無いファイルを libsql に開かせると空の DB ができるので、先に止める
  if (!existsSync(localDb)) fail('手元の data/bw6_dev.db がありません（計画の頭の「手元の画面の確かめ」で dev サーバを立ててから）');
  base = LOCAL_BASE;
  dbUrl = `file:${localDb}`;
  dbToken = undefined;
}

// ---- 入場券 → 入口 → 消す ----
const db = createClient({ url: dbUrl, authToken: dbToken });
const token = randomUUID();
let res;
let json;
try {
  await db.execute({ sql: 'INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)', args: [token, new Date(Date.now() + TICKET_MS).toISOString()] });
  try {
    res = await fetch(`${base}/api/staff/recital/bank-rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `staff_events_auth=${token}` },
      body: JSON.stringify({ mode, imported_by: 'Claude（読む役）', batch }),
    });
    json = await res.json().catch(() => ({}));
  } finally {
    await db.execute({ sql: 'DELETE FROM admin_sessions WHERE token = ?', args: [token] });
  }
} catch (e) {
  fail(`入口を呼べませんでした：${e instanceof Error ? e.message : e}`);
}
if (res.status === 401) fail('入口が 401 を返しました（入場券を入れた DB と、入口のサーバの DB がちがう。止まって知らせる）');
if (!res.ok) fail(`入口がエラーを返しました（${res.status}）：${json?.error ?? ''}`);

// ---- 数字だけを出す ----
const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;
const md = (ymd) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  return m ? `${Number(m[1])}月${Number(m[2])}日` : String(ymd ?? '');
};

console.log(`渡し方：${json.mode === 'commit' ? '本番（commit）' : '試し（dry）'}`);
if (json.check?.ok) console.log('検算：合った');
else console.log(`検算：合わない（${json.check?.near ?? ''}。最後に合った束：${json.check?.lastOkDate ? md(json.check.lastOkDate) : 'まだ無い'}）`);
console.log(`新しく入る行 ${json.inserted ?? 0} ／ もうある行 ${json.existing ?? 0} ／ 自動で当たる ${json.auto_matched ?? 0} ／ 印で止めた ${json.flagged ?? 0}`);
const review = Object.entries(json.review ?? {}).filter(([, n]) => Number(n) > 0);
console.log(`見てほしい入金：${review.length === 0 ? 'なし' : review.map(([k, n]) => `${KIND_LABEL[k] ?? k} ${n}`).join('、')}`);
console.log(`はいが要る束：${json.needs_first_ok ? 'はい' : 'いいえ'}`);
for (const r of json.first5_rows ?? []) {
  const conds = (r.conditions ?? []).map((c, i) => `${MARKS[i]}${c ? '○' : '×'}`).join('');
  console.log(`  ${r.pos} 番号 ${r.ref ?? 'なし'} ${yen(r.amount)} 条件 ${conds}`);
}
if ((json.join_mismatch ?? []).length > 0) {
  console.log(`つなぎ目が合わない台帳の行：${json.join_mismatch.map((j) => `${md(j.date)} ${yen(j.amount)}`).join('、')}`);
}
process.exit(json.check?.ok ? 0 : 2);
