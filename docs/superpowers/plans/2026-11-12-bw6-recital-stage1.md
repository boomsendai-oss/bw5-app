# BW6 進行システム 段階1（〜2026-12-15（火）12:00） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BW6 発表会（2027-04-11）の申込を 12/15（火）12:00 から受け、世帯ごとの金額を出し、カードと振込で払えて、入金が記録される（カードは Stripe の知らせで自動、振込は毎日のスクショを読む役が写した束で自動）ところまでを、bw5-app の中に作る。

**Architecture:** 新しい表 19 個（`recital_*`）を台帳SQLと `schema.ts` の両方に足し、計算はすべて DB にさわらない純関数（`recital.ts`・`recitalFee.ts`・`recitalRef.ts`・`recitalMatch.ts`・`recitalBankBatch.ts`・`recitalBankMatch.ts`）に置く。書き込みは `withWriteTx` の中だけで行い、お金の核（`recitalMoneyDb.ts` の `insertPaymentTx`）を、カード・振込・手で入れた入金の全部が通る。家庭の画面は `/bw6/*`（鍵つき URL のマイページ）、スタッフの画面は `/staff/bw6/*`、外からの入口は Stripe の受け口・束の入口・定期の声かけの3つだけ。

**Tech Stack:** Next.js 16（App Router・Server Actions）・TypeScript・Turso（libsql）・Vercel Hobby（関数は60秒まで）・vitest・Stripe Checkout（fetch で直接）・nodemailer（Gmail）・Cloudflare Workers（boom-cron の `JOBS`）。

**Spec:** 設計書 第5版（iCloud の `BOOM/成果物/BW6_進行システム設計/BW6_進行のしくみ_設計書_第5版.md`。作業用の写し `bw6-design/rev2/design-v5.md`・章ごと `bw6-design/rev2/ch/*.md`）と決まりの紙 `bw6-design/rev2/decisions-v5.md`。食いちがったら決まりの紙が勝つ。名前の正本は `bw6-plan/split.md` の③。

---

## Global Constraints

- 範囲は段階1だけ。段階2より後の物は作らない（必要に見えたら止まって知らせる。終わりの「段階2以降の計画へ回した物」）。
- **計画に書いていないことに当たったら、自分で決めずに、止まって知らせる。** とくに、列を足したい・値の言葉を変えたい・設計書の数字と試験が合わない、の3つ。
- 計画の文と試験が食いちがったら、試験（設計書の数字を入れた物）が正。直す前に止まって知らせる。
- 試験の本体が `/* 入力 → 期待 */` の短い書き方になっている所は、作る係がそのコメントの入力と期待をそのまま `expect` に書く。空の本体のまま出さない（落ちるのを見てから作る）。
- DB の試験は自分の `event_key`（`t-xxx`）の行だけを見る（試験のDBには台帳SQLが全部流れ、種の `bw6-test` と 12/13 からは `bw6`・`bw6-smoke` も入る）。
- 試験は1ファイルずつ回す：`npx vitest run <ファイル>`。全件（`npm test`）・`tsc` 全体・`next build` は回さない（M1 はメモリ 8GB）。dev サーバでの画面の確かめは M5 で、下の「手元の画面の確かめ」のとおりに行う。
- スキーマの変更は台帳SQL（`scripts/migrations/*.sql`）＋`node scripts/migrate.mjs`。本番は `SKIP_DB_INIT=1` で `addColumnIfMissing` も `initDb` も効かない。台帳SQLにはコメントを書かない。文面の中に「`;` で終わる行」を作らない。表のファイルは種のファイルより名前の順で先（`20261113_recital_stage1.sql` → `20261114_recital_seed_test.sql` → `20261213_*`）。
- 外部キー（`REFERENCES`）と値の CHECK は付けない（例外は `recital_payments` の「世帯か注文のどちらか1つ」だけ）。`created_at` は全部の表で `TEXT NOT NULL`、書く側が `nowUtcIso()` を入れる。
- 関数は60秒まで。長くなる所は件数の上限（束 `BANK_BATCH_MAX_ROWS = 400`、待ちのメールは1回20通、1つの束でその場で送るのは10通まで）で切り、`maxDuration = 60` を書く。
- bw5-app は公開リポジトリ。計画・コード・台帳SQL・試験・コミット文に、実名・電話・メール・口座番号・振込先の文・鍵・乱数を書かない（例は `example.com`・`example.invalid`・架空の名前・`090-1234-5678` の形だけ）。`bank_text`・`ref_skip`・鍵は本番の設定の画面か Vercel の環境変数だけに入れる。
- 変えた記録（`recital_changes`）・ログ・`console.*`・エラー文に、メール・電話・生年月日・インスタ・名義を残さない（R-18。`logChangeTx` が伏せる）。
- 家庭に渡すマイページの URL は Task 2 の `recitalMyUrl(token)`（`RECITAL_PUBLIC_ORIGIN = 'https://event.boom-sendai.com'`）だけで作る。`NEXT_PUBLIC_BASE_URL` と `location.origin` は使わない。
- 入力欄（input・select・textarea）は全部、文字色と下地色を両方書く（bw5-app は body が白文字）。家庭の画面は生成り色 `#faf6f1` の下地に紺 `#101040` の文字。オレンジ（BW5 の色）を家庭の画面に使わない。
- 確かめの窓（`confirm()`）は使わない。お金・設定・確定のボタンは2段階ボタンと名前の選択（`RECITAL_STAFF_NAMES`）。
- Next.js 16 の書き方は、作る前に `node_modules/next/dist/docs/` の該当ページを読む（`AGENTS.md`）。`searchParams`・`params` は Promise。
- git は自分が作った・直したファイルだけをパス指定で add する（`git add -A`・`git add .` は使わない。共有リポジトリを他のセッションも同時に触っている）。コミット文の最後に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 12/13（日）までに、本番の種と `JOBS`（声かけ・朝の「ア」）を出す。12/14（月）〜12/15（火）は bw5-app に push しない（共有の STATE.md に1行書いて、ほかのセッションにも頼む）。
- お金にさわるタスク（9・10 の送る所・21・22・23・27・28・20）の最後の見直しは Fable。

## Review Focus

1. **同じ入金の行を2人が同時に当てる**（TARO と KEIKO が別々の画面から「この世帯に当てる」）→ 1つだけ通り、入金は1行・メールは1通。試験は Task 28（`Promise.allSettled` の2本）。
2. **カードと振込の二重**（カードの画面を開いたまま振込が全額で当たる／振込で払い終わった世帯にカードの完了の知らせ）→ 開いている画面を切る・こえた分は返す分1番（`source_payment_id` はカードの入金）・完了メールは出ない。試験は Task 21・22・9。
3. **iPhone の全角数字・全角ハイフン**（電話「０９０－１２３４－５６７８」、金額「２６５００」「26,500円」、探す欄の「２７１４」、摘要の「振込　２７１４　ヤマダ」）→ 半角と同じ物として読む。試験は Task 2（`normalizePhone`）・7・13・16・23（`parseYenInput`）・25。
4. **銀行の名義のゆれ**（半角カナ、長音の `ｰ`・`-`、頭の番号のあとの区切り「ー」「‐」）→ 姓が合えば合う。試験は Task 26（`surnameMatches`）と Task 4（`readRefFromDesc`）。
5. **時刻ちょうどの鍵**（12/15 11:59:59.999 と 12:00:00、1/31 23:59:59.999 と 2/1 0:00、夜 21:00 ちょうど、`pay_open_at` が読めない形）→ 境目のとおりに開く・閉じる・送る、読めなければ開けない側。試験は Task 2（`payGate`・`entryPhase`）・8（`change_close_at`）・10（夜の待ち）。

---

## タスクの並び（全30タスク）

- 基（1〜5）：1 と 2〜5 は同時に始めてよい（2〜5 は純関数）。1 は 6 から後の全部の DB タスクの前提。
- 申（6〜11）：6 → 7・9・10 → 8（7 のコミットの後。同じ `recitalEntryDb.ts`）→ 11（6 の後。同じ `recitalDb.ts`。11 の種の後半は 12/13（日））。
- 家（12〜15）：12 は 2・6 の後。13 は 7 の後。14 は 8・10 の後。15 は 8・14 の後（12/8（火）に出すか決める。切っても 12〜14 は動く）。
- ス（16〜20）：16 は 2・6 の後／17 は 6 の後／18 は 3・6・11 の後／19 は 8・9・10 の後／20 は 8・9・5・18・21 の後（12/8 に出すか決める逃げ道）。ス の中は 16→17→18→19→20。
- 払（21〜24）：21 は 9・10・14 の後 → 22。23 は 9・10・14・19 の後。24 は 10・27・28 の後（`listReviewRows`・`bankStartDate` を使う）。
- 振（25〜30）：25・26 は 2・4 の後すぐ。27 は 9・10・25・26 の後。28 は 27・16・19 の後。29 は 28・16 の後。30 は 25・27 の後。
- 締切から逆に見た道：24 の `JOBS` は 12/13（日）までに出す → 27・28 は 12/11（金）までに終える。間に合わないと分かった時点で止まって知らせる（24 だけを先に出す道は無い）。通し試し1は 1〜11・21〜23・25〜29 ができた時、通し試し2は 12/8（火）。

## 手元の画面の確かめ（全部の「`npm run dev` で見る」の段に効く）

手元の `.env.local` は本番の DB を向いている（`TURSO_DATABASE_URL` が本番と同じ・`SKIP_DB_INIT=1`）。そのまま `npm run dev` を立てると、試しの申込や設定の変更が本番の行を書きかえる。だから画面の確かめは必ず手元のファイルDBで行う（M5 で。M1 では回さない）：

1. `TURSO_DATABASE_URL=file:./data/bw6_dev.db TURSO_AUTH_TOKEN= SKIP_DB_INIT=0 npm run dev`（シェルで渡した値が `.env.local` より勝つ）。1回 `/bw6` を開くと `initDb`（`schema.ts` に入れた `RECITAL_SCHEMA_STATEMENTS`）が表を作る。
2. 種は台帳SQLを1本だけ流す：
   `node --input-type=module -e "import {createClient} from '@libsql/client'; import {readFileSync} from 'node:fs'; const c=createClient({url:'file:./data/bw6_dev.db'}); for (const s of readFileSync('scripts/migrations/20261114_recital_seed_test.sql','utf8').split(/;\s*$/m).map(x=>x.trim()).filter(Boolean)) await c.execute(s); console.log('ok')"`
3. Task 30 の手元モード（`recital_bank_push.mjs` を `--prod` なしで）も、入場券を同じ `data/bw6_dev.db` に入れる。
4. 手元の `data/bw5.db` には `migrate.mjs` を流さない（`schema_migrations` が4件しか無く、古い台帳が約115本「未適用」に出て MIGRATE FAILED になる）。台帳の正しさは、台帳SQLを全部流す DB の試験で確かめる。

## 出す手順（本番の DB とコードを出す順）

1. Task 1 のコミットのあと、表を読むコードを push する前に：`node --env-file=.env.production.local scripts/migrate.mjs --dry-run` → 出るのが `20261113_recital_stage1.sql` の1本だけと見る（ほかが出たら止まって知らせる）→ `--dry-run` を外して流す → 表ができたことを読むだけで確かめる。表は今ある表にさわらないので、公開のページが無いうちに流してよい。
2. Task 6 の試しの種 `20261114_recital_seed_test.sql` は、表のあとに同じ形（`--dry-run` → 外す）で流す。表がまだ本番に無ければ流さずに止まって知らせる。
3. コードは main に push → Vercel が自動で出す。出たあと、本番で `/bw6` が「準備中です」のまま（本番の `bw6` はまだ無い）であることを見る。
4. 12/13（日）：本番の種 `20261213_recital_seed_bw6.sql`（`suspended`=1・`stripe_mode`=`live`）と `…_seed_smoke.sql` を同じ形で流す（Task 11）。`bank_text`・`ref_skip`・特別な料金の人は設定の画面から入れる（台帳SQLには書かない）。同じ日までに `JOBS` を出し直す（Task 24。`wrangler deploy`）。
5. 12/14（月）〜12/15（火）は push しない。12/15 12:00 は `entry_open_at` で自動に開く（「受付を開ける」を押してあるとき）。「払う」は `pay_ok_at` が入ってから（Task 18 の「支払いを開ける」）。
6. おかしい時：「受付を止める」→ コードは Vercel の画面で前の版へ戻す → 表にはさわらない → 入った申込と入金は消さない。支払いだけなら `pay_open_at` を先へ動かす。

---

## 基（base）土台：表と計算の部品 — Task 1〜5

並び：Task 1 と Task 2〜5 は同時に始めてよい（2〜5 は DB にさわらない純関数）。Task 1 は、ほかの全部の DB タスク（6 から後）の前提。
このまとまりの試験は全部 `src/lib/__tests__/` に置き、1ファイルずつ回す（全件は回さない。このMacは8GB）。

作る係への決まり（このまとまり全部）：**計画に書いていないことに当たったら、自分で決めずに、止まって知らせる。** とくに、列を足したい・値の言葉を変えたい・設計書の数字と試験が合わない、の3つ。

もと：設計書 03 3-2・3-4・3-9・3-20、05 5章頭・5-1〜5-4・5-8〜5-10、決まりの紙 D5 2-2・2-3・2-16・2-18、D4 2-10、K199・K204・K207・K218・K222〜K224・K228・K135〜K140、R-17・R-83・R-84。

---

### Task 1: 表（台帳SQL・`recitalSchema.ts`・`schema.ts` の1行）

**Files:**
- Create: `scripts/migrations/20261113_recital_stage1.sql`
- Create: `src/lib/db/recitalSchema.ts`
- Modify: `src/lib/db/schema.ts`（先頭の import に1行、`getSchemaStatements()` の返す配列の最後に `...RECITAL_SCHEMA_STATEMENTS,` を1行。ほかは変えない）
- Test: `src/lib/__tests__/recitalSchema.test.ts`

**Interfaces:**
- Consumes: `src/lib/db.ts` の `batch(statements, 'write')`・`execute(sql, args)`・`getAll(sql, args)`（今あるもの）
- Produces:
  - `export const RECITAL_SCHEMA_STATEMENTS: readonly string[]`（`src/lib/db/recitalSchema.ts`。台帳SQLを `migrate.mjs` と同じ分け方で割った文と一字一句同じ。末尾の `;` は持たない）
  - 19表（下の SQL）と索引の名前。ほかの全部の DB タスクは、この列の名前・初めの値・一意の決まりを前提にする。

決めたこと（ここだけで決める。後のタスクは変えない）：
- 外部キー（`REFERENCES`）は付けない（今のアプリの表と同じ。`ticket_order_id` は設計書どおり付けない）。
- 値の CHECK（`status IN (…)` など）は付けない。あとの段階で値が増えると、SQLite では表の作り直しになるため（設計書 3-8「作り直しにならない」）。CHECK は `recital_payments` の「世帯か注文のどちらか1つ」だけ。
- `created_at` は全部の表に `TEXT NOT NULL`（初めの値なし。書く側が `nowUtcIso()` を入れる。`CURRENT_TIMESTAMP` は形が UTC ISO とちがうので使わない）。
- 台帳SQLにはコメントを1行も書かない（行内コメント禁止の決まりに加え、試験で文をくらべるため）。

- [ ] **Step 1: 失敗する試験を書く**（`src/lib/__tests__/recitalSchema.test.ts`）

```ts
// 発表会の段階1の表（19表）。台帳SQLだけで作ったDBで、表・索引・一意・CHECK を確かめる。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';

const TEST_DB = './data/test_recital_schema.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
process.env.SKIP_DB_INIT = '1'; // schema.ts を流さず、台帳SQLだけで作る（台帳の付け忘れを見つけるため）

const LEDGER = 'scripts/migrations/20261113_recital_stage1.sql';
/** scripts/migrate.mjs の splitSql と同じ分け方（行末の ; で割る） */
const splitSql = (sql: string) => sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const TABLES = [
  'recital_bank_rows', 'recital_casts', 'recital_changes', 'recital_charges', 'recital_checkouts',
  'recital_events', 'recital_fee_presets', 'recital_fee_rules', 'recital_households', 'recital_imports',
  'recital_instructor_links', 'recital_mail_log', 'recital_payments', 'recital_people', 'recital_refunds',
  'recital_settings', 'recital_work_classes', 'recital_work_instructors', 'recital_works',
];
const INDEXES = [
  'idx_recital_bank_rows_state', 'idx_recital_casts_work', 'idx_recital_changes_household',
  'idx_recital_charges_household', 'idx_recital_fee_rules_event', 'idx_recital_households_email',
  'idx_recital_households_phone', 'idx_recital_mail_log_household', 'idx_recital_payments_bankrow',
  'idx_recital_payments_household', 'idx_recital_people_household', 'idx_recital_refunds_household',
  'idx_recital_work_classes_work', 'idx_recital_work_instructors_work',
  'ux_recital_bank_rows_key', 'ux_recital_casts_pw', 'ux_recital_checkouts_open', 'ux_recital_checkouts_pi',
  'ux_recital_checkouts_session', 'ux_recital_fee_presets_member', 'ux_recital_households_ref',
  'ux_recital_households_seq', 'ux_recital_households_submit', 'ux_recital_households_token',
  'ux_recital_instructor_links_token', 'ux_recital_mail_log_dedupe', 'ux_recital_payments_event',
  'ux_recital_payments_pi', 'ux_recital_payments_session', 'ux_recital_people_ext', 'ux_recital_people_seq',
  'ux_recital_works_code',
];
const NOW = '2026-11-13T00:00:00.000Z';

let core: typeof import('../db');
let ledgerSql: string;

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  ledgerSql = readFileSync(LEDGER, 'utf8');
  core = await import('../db');
  await core.batch(splitSql(ledgerSql), 'write');
});

describe('台帳SQL と recitalSchema.ts', () => {
  it('(a) 台帳SQLを割った文が RECITAL_SCHEMA_STATEMENTS と一字一句同じ（空白はそろえて比べる）', async () => {
    const { RECITAL_SCHEMA_STATEMENTS } = await import('../db/recitalSchema');
    expect(splitSql(ledgerSql).map(norm)).toEqual(RECITAL_SCHEMA_STATEMENTS.map(norm));
  });
  it('台帳SQLにコメントが無い', () => {
    expect(ledgerSql).not.toMatch(/--/);
  });
  it('schema.ts の getSchemaStatements() に全部入っている', async () => {
    const { RECITAL_SCHEMA_STATEMENTS } = await import('../db/recitalSchema');
    const { getSchemaStatements } = await import('../db/schema');
    const all = getSchemaStatements().map((s) => norm(typeof s === 'string' ? s : s.sql));
    for (const st of RECITAL_SCHEMA_STATEMENTS) expect(all).toContain(norm(st));
  });
  it('(b) 台帳SQLだけで19表と索引がそろう', async () => {
    const t = await core.getAll(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'recital%' ORDER BY name`);
    expect(t.map((r) => r.name)).toEqual(TABLES);
    const i = await core.getAll(`SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_recital%' OR name LIKE 'ux_recital%') ORDER BY name`);
    expect(i.map((r) => r.name)).toEqual([...INDEXES].sort());
  });
});

describe('(c) 部分一意', () => {
  it('開いている checkout は世帯に1つ。open でなければ何個でも', async () => {
    const ins = (hh: number, st: string) => core.execute(
      `INSERT INTO recital_checkouts (event_key, household_id, amount, status, created_at) VALUES ('t-schema', ?, 26500, ?, ?)`, [hh, st, NOW]);
    await ins(1, 'open');
    await expect(ins(1, 'open')).rejects.toThrow(/UNIQUE/i);
    await ins(1, 'expired'); await ins(1, 'expired'); await ins(2, 'open');
  });
  it('void でない同じ row_key は1つ。void は何個でも、void のあとは同じ鍵を入れられる', async () => {
    const ins = (st: string) => core.execute(
      `INSERT INTO recital_bank_rows (event_key, created_at, row_date, dir, amount, balance, kind, row_key, source, state)
       VALUES ('t-schema', ?, '2026-12-20', 'in', 26500, 100000, 'transfer', '2026-12-20|in|26500|100000', 'chat', ?)`, [NOW, st]);
    await ins('new');
    await expect(ins('matched')).rejects.toThrow(/UNIQUE/i);
    await core.execute(`UPDATE recital_bank_rows SET state='void' WHERE event_key='t-schema'`);
    await ins('void'); await ins('new');
  });
  it('stripe_event_id・stripe_session_id・stripe_pi_id の重複は弾き、NULL は何個でも入る', async () => {
    const ins = (ev: string | null, ss: string | null, pi: string | null) => core.execute(
      `INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, stripe_event_id, stripe_session_id, stripe_pi_id, created_at)
       VALUES ('t-schema', 1, 'card', 26500, '2026-12-20', 'stripe_webhook', ?, ?, ?, ?)`, [ev, ss, pi, NOW]);
    await ins('evt_1', 'cs_1', 'pi_1');
    await expect(ins('evt_1', 'cs_2', 'pi_2')).rejects.toThrow(/UNIQUE/i);
    await expect(ins('evt_2', 'cs_1', 'pi_2')).rejects.toThrow(/UNIQUE/i);
    await expect(ins('evt_2', 'cs_2', 'pi_1')).rejects.toThrow(/UNIQUE/i);
    await ins(null, null, null); await ins(null, null, null); await ins(null, null, null);
  });
  it('checkouts の stripe_session_id、mail_log の dedupe_key、people の ext_ref も同じ（NULL は何個でも）', async () => {
    const co = (ss: string | null) => core.execute(
      `INSERT INTO recital_checkouts (event_key, household_id, stripe_session_id, amount, status, created_at) VALUES ('t-schema', 9, ?, 1, 'closed', ?)`, [ss, NOW]);
    await co('cs_x'); await expect(co('cs_x')).rejects.toThrow(/UNIQUE/i); await co(null); await co(null);
    const ml = (k: string | null) => core.execute(
      `INSERT INTO recital_mail_log (event_key, household_id, mail_kind, dedupe_key, status, created_at) VALUES ('t-schema', 1, 'complete', ?, 'sent', ?)`, [k, NOW]);
    await ml('complete:1'); await expect(ml('complete:1')).rejects.toThrow(/UNIQUE/i); await ml(null); await ml(null);
    let seq = 0;
    const pp = (ev: string, ext: string | null) => core.execute(
      `INSERT INTO recital_people (event_key, seq, category, last_name, ext_ref, created_at) VALUES (?, ?, 'student', 'ヤマダ', ?, ?)`, [ev, ++seq, ext, NOW]);
    await pp('t-schema', 'M1'); await expect(pp('t-schema', 'M1')).rejects.toThrow(/UNIQUE/i);
    await pp('t-schema2', 'M1'); await pp('t-schema', null); await pp('t-schema', null);
  });
});

describe('(d) payments の CHECK（世帯か注文のどちらか1つ）', () => {
  const ins = (hh: number | null, to: number | null) => core.execute(
    `INSERT INTO recital_payments (event_key, household_id, ticket_order_id, method, amount, paid_on, source, created_at)
     VALUES ('t-schema-ck', ?, ?, 'cash', 1000, '2026-12-20', 'manual', ?)`, [hh, to, NOW]);
  it('両方 NULL は弾く', async () => { await expect(ins(null, null)).rejects.toThrow(/CHECK/i); });
  it('両方入っているのも弾く', async () => { await expect(ins(1, 1)).rejects.toThrow(/CHECK/i); });
  it('片方だけなら入る', async () => { await ins(1, null); await ins(null, 1); });
});
```

- [ ] **Step 2: 試験を回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalSchema.test.ts`
Expected: FAIL（`ENOENT … 20261113_recital_stage1.sql` か `Cannot find module '../db/recitalSchema'`）

- [ ] **Step 3: 台帳SQL `scripts/migrations/20261113_recital_stage1.sql` を書く**

列の名前・型・初めの値は下のとおり（設計書 03 3-4・3-9、決まりの紙 6-1、名前の正本③）。この文のまま書く。列を足す・名前を変えるなら止まって知らせる。

```sql
CREATE TABLE IF NOT EXISTS recital_events (
  event_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  show_date TEXT NOT NULL,
  rehearsal_date TEXT,
  venue TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  copied_from TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recital_settings (
  event_key TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_key, key)
);
CREATE TABLE IF NOT EXISTS recital_fee_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  payer_role TEXT NOT NULL,
  item_code TEXT NOT NULL,
  nth_from INTEGER NOT NULL,
  nth_to INTEGER,
  unit_amount INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  is_tentative INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_fee_rules_event ON recital_fee_rules (event_key, sort_order);
CREATE TABLE IF NOT EXISTS recital_works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  work_code TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  title_reading TEXT,
  title_final INTEGER,
  class_label TEXT,
  class_short TEXT,
  slot_label TEXT,
  target_label TEXT,
  genre TEXT,
  entry_mode TEXT NOT NULL DEFAULT 'form',
  fee_type TEXT NOT NULL DEFAULT 'counted',
  extra_fee INTEGER,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  merged_into INTEGER,
  public_note TEXT,
  staff_note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER,
  start_style TEXT,
  exit_style TEXT,
  song TEXT,
  costume TEXT,
  color1 TEXT,
  color2 TEXT,
  intro_text TEXT,
  props TEXT,
  mic INTEGER,
  smoke INTEGER,
  attack INTEGER,
  attack_sec INTEGER,
  video_sale_ok INTEGER,
  sns_post_ok INTEGER,
  line_group_url TEXT,
  lighting_plan_json TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_works_code ON recital_works (event_key, work_code);
CREATE TABLE IF NOT EXISTS recital_work_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  work_id INTEGER NOT NULL,
  lesson_master_id INTEGER,
  label TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_work_classes_work ON recital_work_classes (work_id);
CREATE TABLE IF NOT EXISTS recital_work_instructors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  work_id INTEGER NOT NULL,
  instructor_id INTEGER,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'choreo',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_work_instructors_work ON recital_work_instructors (work_id);
CREATE TABLE IF NOT EXISTS recital_households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ref_code TEXT NOT NULL,
  contact_last_name TEXT,
  contact_first_name TEXT,
  contact_last_kana TEXT,
  contact_first_kana TEXT,
  email TEXT,
  phone TEXT,
  edit_token TEXT NOT NULL,
  submit_key TEXT,
  source TEXT NOT NULL DEFAULT 'form',
  pay_method TEXT,
  bank_told_at TEXT,
  bank_told_date TEXT,
  bank_told_name TEXT,
  bank_told_amount INTEGER,
  bank_told_by TEXT,
  extend_until TEXT,
  pay_due_override TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  merged_into INTEGER,
  applied_at TEXT,
  opened_at TEXT,
  mail_opened_at TEXT,
  mail_bounced INTEGER NOT NULL DEFAULT 0,
  staff_note TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_households_seq ON recital_households (event_key, seq);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_households_ref ON recital_households (event_key, ref_code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_households_token ON recital_households (edit_token);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_households_submit ON recital_households (submit_key) WHERE submit_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recital_households_email ON recital_households (event_key, email);
CREATE INDEX IF NOT EXISTS idx_recital_households_phone ON recital_households (event_key, phone);
CREATE TABLE IF NOT EXISTS recital_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  household_id INTEGER,
  category TEXT NOT NULL,
  member_id INTEGER,
  match_status TEXT,
  instructor_link_id INTEGER,
  last_name TEXT NOT NULL,
  first_name TEXT,
  last_kana TEXT,
  first_kana TEXT,
  birthday TEXT,
  display_name TEXT,
  name_ok INTEGER NOT NULL DEFAULT 1,
  name_confirmed_at TEXT,
  photo_ok INTEGER NOT NULL DEFAULT 1,
  sns_ok INTEGER NOT NULL DEFAULT 1,
  insta_handle TEXT,
  insta_synced_at TEXT,
  tshirt_size TEXT,
  tshirt_color TEXT,
  tshirt_body TEXT,
  fee_class_override TEXT,
  staff_note TEXT,
  ext_ref TEXT,
  merged_into INTEGER,
  ending_group TEXT,
  room_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_people_seq ON recital_people (event_key, seq);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_people_ext ON recital_people (event_key, ext_ref) WHERE ext_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recital_people_household ON recital_people (household_id);
CREATE TABLE IF NOT EXISTS recital_casts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  person_id INTEGER NOT NULL,
  work_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  applied_at TEXT,
  decided_at TEXT,
  withdrawn_at TEXT,
  withdraw_reason TEXT,
  absent_photo INTEGER,
  sort_order INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_casts_pw ON recital_casts (person_id, work_id);
CREATE INDEX IF NOT EXISTS idx_recital_casts_work ON recital_casts (work_id, status);
CREATE TABLE IF NOT EXISTS recital_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER NOT NULL,
  person_id INTEGER,
  item_code TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_amount INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  void_reason TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_charges_household ON recital_charges (household_id, status);
CREATE TABLE IF NOT EXISTS recital_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER,
  ticket_order_id INTEGER,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  source TEXT NOT NULL,
  bank_transaction_id INTEGER,
  bank_date TEXT,
  bank_desc TEXT,
  stripe_event_id TEXT,
  stripe_session_id TEXT,
  stripe_pi_id TEXT,
  payer_name_raw TEXT,
  confirmed_by TEXT,
  memo TEXT,
  created_at TEXT NOT NULL,
  CHECK ((household_id IS NULL) <> (ticket_order_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_payments_event ON recital_payments (stripe_event_id) WHERE stripe_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_payments_session ON recital_payments (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_payments_pi ON recital_payments (stripe_pi_id) WHERE stripe_pi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recital_payments_household ON recital_payments (household_id);
CREATE INDEX IF NOT EXISTS idx_recital_payments_bankrow ON recital_payments (bank_transaction_id);
CREATE TABLE IF NOT EXISTS recital_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER,
  person_id INTEGER,
  work_id INTEGER,
  action TEXT NOT NULL,
  received_at TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  reason TEXT,
  is_exception INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_changes_household ON recital_changes (household_id);
CREATE TABLE IF NOT EXISTS recital_mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER,
  instructor_link_id INTEGER,
  ticket_order_id INTEGER,
  mail_kind TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_mail_log_dedupe ON recital_mail_log (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recital_mail_log_household ON recital_mail_log (household_id, mail_kind);
CREATE TABLE IF NOT EXISTS recital_instructor_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  link_kind TEXT NOT NULL,
  instructor_id INTEGER,
  display_name TEXT,
  reading TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  access_token TEXT NOT NULL,
  last_opened_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_instructor_links_token ON recital_instructor_links (access_token);
CREATE TABLE IF NOT EXISTS recital_fee_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  fee_class TEXT NOT NULL,
  memo TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_fee_presets_member ON recital_fee_presets (event_key, member_id);
CREATE TABLE IF NOT EXISTS recital_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason_no INTEGER NOT NULL,
  reason TEXT NOT NULL,
  waiting_reply INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo',
  payment_id INTEGER,
  source_payment_id INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_recital_refunds_household ON recital_refunds (household_id, status);
CREATE TABLE IF NOT EXISTS recital_checkouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER NOT NULL,
  stripe_session_id TEXT,
  stripe_pi_id TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_checkouts_session ON recital_checkouts (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_checkouts_pi ON recital_checkouts (stripe_pi_id) WHERE stripe_pi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_checkouts_open ON recital_checkouts (household_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS recital_bank_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  row_date TEXT NOT NULL,
  dir TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance INTEGER,
  kind TEXT NOT NULL,
  desc_raw TEXT,
  desc_norm TEXT,
  cut INTEGER NOT NULL DEFAULT 0,
  unread TEXT,
  ref_read TEXT,
  ref_ok INTEGER NOT NULL DEFAULT 0,
  row_key TEXT NOT NULL,
  source TEXT NOT NULL,
  import_id INTEGER,
  file_seen INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new',
  match_by TEXT,
  review_kind TEXT,
  check_flag TEXT,
  decided_by TEXT,
  decided_at TEXT,
  memo TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_bank_rows_key ON recital_bank_rows (event_key, row_key) WHERE state <> 'void';
CREATE INDEX IF NOT EXISTS idx_recital_bank_rows_state ON recital_bank_rows (event_key, state);
CREATE TABLE IF NOT EXISTS recital_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'statement',
  read_rows INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  existing INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT,
  imported_at TEXT,
  shot_on TEXT,
  range_from TEXT,
  range_to TEXT,
  images INTEGER,
  source TEXT,
  check_result TEXT
);
```

- [ ] **Step 4: `src/lib/db/recitalSchema.ts` に `export const RECITAL_SCHEMA_STATEMENTS: readonly string[]` を書く**

上の SQL の文を、書いた順に1文ずつ文字列（テンプレート文字列）にして並べる。末尾の `;` は入れない。ファイルの頭に1行「台帳 `scripts/migrations/20261113_recital_stage1.sql` と一字一句同じ。片方だけ直さない（recitalSchema.test.ts がくらべる）」。

- [ ] **Step 5: `src/lib/db/schema.ts` に2行足す**

`import { RECITAL_SCHEMA_STATEMENTS } from './recitalSchema';` と、`getSchemaStatements()` が返す配列の最後に `...RECITAL_SCHEMA_STATEMENTS,`（`InStatement` は文字列も受ける）。

- [ ] **Step 6: 試験を回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalSchema.test.ts`
Expected: PASS（11 tests。19表・索引32本＝51文）

- [ ] **Step 7: 本番の未適用を読むだけで見る（手元の `data/bw5.db` には流さない）**

手元の `data/bw5.db` は `schema_migrations` に4件しか記録が無く、`migrate.mjs` を流すと古い台帳が約115本「未適用」に出て、途中で MIGRATE FAILED になる。だから手元では流さない。台帳の正しさは Step 6 の試験（台帳SQLを全部流す DB の試験）で確かめ済み。
Run: `node --env-file=.env.production.local scripts/migrate.mjs --dry-run`
Expected: 未適用に出るのが `20261113_recital_stage1.sql` の1本だけ（ほかが出たら、止まって知らせる）。`--dry-run` を外して流すのは、このタスクではしない。いつ流すかは計画の頭の「出す手順」に従う。

- [ ] **Step 8: コミット**

```bash
git add scripts/migrations/20261113_recital_stage1.sql src/lib/db/recitalSchema.ts src/lib/db/schema.ts src/lib/__tests__/recitalSchema.test.ts
git commit -m "feat(bw6): 発表会の段階1の表（19表）と索引を台帳SQLとschema.tsに足す" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `recital.ts`（型・定数・設定の読み・受付と支払いの鍵・お金の式・見え方・人数・学年）

**Files:**
- Create: `src/lib/recital.ts`
- Test: `src/lib/__tests__/recital.test.ts`

**Interfaces:**
- Consumes: `nowUtcIso(now: Date): string`・`isIsoDate(s: string): boolean`（`src/lib/dateJst.ts`。今あるもの）
- Produces（名前と型は名前の正本③のまま。全部 `src/lib/recital.ts`）：
  - `RECITAL_EVENT = { live: 'bw6', test: 'bw6-test', smoke: 'bw6-smoke' } as const`
  - `type CastStatus`・`FeeClass`・`HouseholdView`・`EntryPhase`・`PayGate`・`MoneySummary`・`interface RecitalSettings`（③の全フィールド）・`type CountPerson`・`type PeopleCounts`
  - `RECITAL_SETTING_DEFAULTS`・`RECITAL_SETTING_KEYS_SHOWN`・`RECITAL_SETTING_KEYS_LOCKED`・`RECITAL_RATE`・`RECITAL_STAFF_NAMES`・`FIRST5_LIMIT`・`BANK_TOLD_WAIT_DAYS`・`MAIL_SEND_FROM`・`MAIL_SEND_UNTIL`
  - `parseRecitalSettings(rows: { key: string; value: string }[]): RecitalSettings`
  - `jstToMs(jst: string): number`／`deadlineMs(jst: string): number`
  - `entryPhase(s: RecitalSettings, nowMs: number, extendUntil?: string | null): EntryPhase`
  - `payGate(s: RecitalSettings, nowMs: number): PayGate`
  - `isCountedCast(work: { fee_type: string; status: string }, cast: { status: CastStatus }): boolean`
  - `moneySummary(x: { chargeAmounts: number[]; paymentAmounts: number[]; refundTodoAmounts: number[] }): MoneySummary`
  - `householdView(x: { hasIn: boolean; hasMaybe: boolean; paid: number; remaining: number }): HouseholdView`
  - `householdViewLabel(v: HouseholdView, remaining: number): string`
  - `payableAmount(m: MoneySummary, told: { amount: number } | null): number`
  - `payButtonState(x: { gate: PayGate; view: HouseholdView; m: MoneySummary; refundTodo: number }): 'hidden' | 'before' | 'preparing' | 'refund_hold' | 'show'`
  - `countPeople(people: CountPerson[], now: Date): PeopleCounts`
  - `schoolGrade(birthday: string, onDate: string): string`／`ageOn(birthday: string, onDate: string): number`
  - `normalizePhone(x: string): string`（`x.normalize('NFKC')` のあと数字だけ）・`normalizeEmail(x: string): string`（NFKC・前後の空白を取る・小文字）。iPhone の全角数字「０９０－１２３４－５６７８」もそろう。7（入れる形とくらべ方）・13（画面の確かめ）・16（探す欄）が使う
  - `RECITAL_PUBLIC_ORIGIN = 'https://event.boom-sendai.com'`・`recitalMyUrl(token: string, opts?: { fromMail?: boolean }): string`（`${RECITAL_PUBLIC_ORIGIN}/bw6/my?t=<token>`、`fromMail` なら `&from=mail` を足す）。家庭に渡すマイページの URL は全部これで作る（10 のメール・14 の画面・19 の「マイページのURLを写す」・21 のカードの戻り先）。今のアプリの家庭向けの URL（`partyEmail.ts` の `BASE_URL`・`mocchinEntry.ts` の `MOCCHIN_PUBLIC_ORIGIN`）と同じドメイン。`NEXT_PUBLIC_BASE_URL` は使わない（スタッフ・cron 向けの URL だけが使う）
  - `checkSettingValue(key: string, value: string): string | null`（null＝入れてよい。だめなら画面に出す文。表と試験は下の Step 1・Step 3。6 の `saveRecitalSetting` と 18 の設定の画面の両方がこれを使う。確かめを2か所に書かない）

決めた値（設計書の初めの値。3-4 の設定の表・④C11・④C13）：
- `RECITAL_SETTING_DEFAULTS`（鍵 → 文字の値）：`entry_open_at`='2026-12-15 12:00'・`entry_close_at`='2027-01-31 23:59'・`change_close_at`='2027-01-31 23:59'・`pay_open_at`='2026-12-15 12:00'・`pay_ok_at`=''・`pay_due`='2027-02-10'・`roster_fix_on`=''・`tshirt_order_on`=''・`min_self_apply_age`='18'・`tshirt_close_at`='2027-01-31 23:59'・`name_fix_close_at`=''・`max_works_per_person`='5'・**`suspended`='1'**・`fee_check_first`='26500,32500,35500,38500,41500'・`fee_check_family`='8000'・`goal_people`='150'・`breakeven_people`='77'・`cap_people`='175'・`tshirt_sizes`='130,140,150,S,M,L,XL,XXL,XXXL'・`tshirt_give_to`=''・`extra_costs_text`=''・`schedule_text`=''・`privacy_text`=''・`bank_text`=''・`ref_skip`=''・`pay_remind_stop_hours`='15'・`bank_ask_at`='19:00,20:30'・`bank_rest_from`='2026-12-30'・`bank_rest_to`='2027-01-03'・`bank_audit_on`='2027-02-12'・`bank_audit_done_at`=''・`bank_close_on`='2027-03-31'・`consent_items`=''・`line_url`=''・`mail_bcc_staff`='0'・`test_mail_to`=''・**`stripe_mode`='test'**。
  - `suspended` の初めの値を '1'、`stripe_mode` を 'test' にするのは、種の書き忘れで「受付が開く」「本番の鍵で動く」を起こさないため（試しの種は `suspended`=0・本番の種は `stripe_mode`=live を必ず書く）。文の初めの値（同意の文・使い道の知らせ・公式LINE）はここでは空。空のままでは受付を開けられない（6 の `setSuspended` が `consent_empty`・`privacy_empty`・`line_empty` で止める）。中身は 12/13 までに設定の画面から入れる（04 4-2 の下書き。`privacy_text` には SNS の1行を必ず入れる。D4 2-11）。
- `RECITAL_SETTING_KEYS_SHOWN`：`entry_open_at`・`entry_close_at`・`change_close_at`・`pay_open_at`・`pay_due`・`roster_fix_on`・`tshirt_order_on`・`min_self_apply_age`・`tshirt_close_at`・`name_fix_close_at`・`max_works_per_person`・`fee_check_first`・`fee_check_family`・`goal_people`・`breakeven_people`・`cap_people`・`tshirt_sizes`・`tshirt_give_to`・`extra_costs_text`・`schedule_text`・`privacy_text`・`bank_text`・`ref_skip`・`pay_remind_stop_hours`・`bank_ask_at`・`bank_rest_from`・`bank_rest_to`・`bank_audit_on`・`bank_close_on`・`consent_items`・`line_url`・`mail_bcc_staff`・`test_mail_to`。出さない物：`suspended`（ボタン）・`pay_ok_at`／`bank_audit_done_at`（LOCKED）・`stripe_mode`（種でだけ入れる。画面から本番を試しの鍵に変えられないようにする）・【1空】の鍵（`seat_*`・`tshirt_colors` など。R-19）。
- `RECITAL_RATE`：`submit: [30, 3600]`・`precheck: [60, 3600]`・`resendIp: [10, 3600]`・`resendEmail: [3, 3600]`。
- `RECITAL_STAFF_NAMES`：`['TARO', 'KEIKO', '作る人']`。
- 学年の言葉：`k = その日の年度 − 生まれの学年の年 − 6`（生まれの学年の年＝1/1〜4/1 生まれは前の年）。k≦−3 '未就学'／−2 '年少'／−1 '年中'／0 '年長'／1〜6 '小1'〜'小6'／7〜9 '中1'〜'中3'／10〜12 '高1'〜'高3'／13 以上 '大人'。年度は 4/1 から（4/1 はその年の年度）。

- [ ] **Step 1: 失敗する試験を書く**（`src/lib/__tests__/recital.test.ts`）

```ts
import { describe, it, expect } from 'vitest';
import {
  parseRecitalSettings, jstToMs, deadlineMs, entryPhase, payGate, isCountedCast, moneySummary,
  householdView, householdViewLabel, payableAmount, payButtonState, countPeople, schoolGrade, ageOn,
  recitalMyUrl, checkSettingValue, normalizePhone, normalizeEmail, RECITAL_SETTING_KEYS_SHOWN, RECITAL_SETTING_KEYS_LOCKED, type CountPerson, type MoneySummary,
} from '../recital';

const S = (over: Record<string, string> = {}) =>
  parseRecitalSettings(Object.entries({ suspended: '0', ...over }).map(([key, value]) => ({ key, value })));
const J = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms);
const M = (total: number, paid: number, todo = 0) =>
  moneySummary({ chargeAmounts: [total], paymentAmounts: paid ? [paid] : [], refundTodoAmounts: todo ? [todo] : [] });

describe('設定の読み', () => {
  it('空なら初めの値。止めている・試しの鍵・pay_ok_at は空', () => {
    const s = parseRecitalSettings([]);
    expect(s.suspended).toBe(true);
    expect(s.stripe_mode).toBe('test');
    expect(s.pay_ok_at).toBeNull();
    expect(s.fee_check_first).toEqual([26500, 32500, 35500, 38500, 41500]);
    expect(s.fee_check_family).toBe(8000);
    expect(s.max_works_per_person).toBe(5);
    expect(s.tshirt_sizes).toEqual(['130', '140', '150', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
    expect(s.bank_ask_at).toEqual(['19:00', '20:30']);
    expect(s.ref_skip).toEqual([]);
    expect(s.mail_bcc_staff).toBe(false);
  });
  it('suspended は "0" のときだけ開く。stripe_mode は "live" のときだけ本番', () => {
    expect(S({ suspended: '0' }).suspended).toBe(false);
    expect(S({ suspended: 'x' }).suspended).toBe(true);
    expect(S({ stripe_mode: 'live' }).stripe_mode).toBe('live');
    expect(S({ stripe_mode: 'LIVE' }).stripe_mode).toBe('test');
  });
  it('カンマの並び・数・空の日付', () => {
    const s = S({ ref_skip: ' 2008, 3009 ,', max_works_per_person: 'abc', pay_ok_at: '2026-12-14 20:00', roster_fix_on: '' });
    expect(s.ref_skip).toEqual(['2008', '3009']);
    expect(s.max_works_per_person).toBe(5);
    expect(s.pay_ok_at).toBe('2026-12-14 20:00');
    expect(s.roster_fix_on).toBeNull();
    expect(s.raw.ref_skip).toBe(' 2008, 3009 ,');
  });
  it('画面に出す鍵に、LOCKED・suspended・stripe_mode・【1空】の鍵が無い', () => {
    for (const k of [...RECITAL_SETTING_KEYS_LOCKED, 'suspended', 'stripe_mode', 'seat_total', 'tshirt_colors', 'pamphlet_due'])
      expect(RECITAL_SETTING_KEYS_SHOWN).not.toContain(k);
  });
});

describe('日時（JST の文字 → ミリ秒）', () => {
  it('jstToMs と deadlineMs', () => {
    expect(jstToMs('2026-12-15 12:00')).toBe(J(2026, 12, 15, 12));
    expect(jstToMs('2027-02-10')).toBe(J(2027, 2, 10));
    expect(deadlineMs('2027-01-31 23:59')).toBe(J(2027, 1, 31, 23, 59, 59, 999));
    expect(deadlineMs('2027-02-10')).toBe(J(2027, 2, 10, 23, 59, 59, 999));
    expect(Number.isNaN(jstToMs('2027/02/10'))).toBe(true);
  });
});

describe('受付の状態（5-4）', () => {
  it('上から：止めている／受付前／受付中／締切のあと', () => {
    expect(entryPhase(S({ suspended: '1' }), J(2027, 1, 10))).toBe('suspended');
    expect(entryPhase(S(), J(2026, 12, 15, 11, 59, 59, 999))).toBe('before');
    expect(entryPhase(S(), J(2026, 12, 15, 12))).toBe('open');
    expect(entryPhase(S(), J(2027, 1, 31, 23, 59))).toBe('open');
    expect(entryPhase(S(), J(2027, 1, 31, 23, 59, 59, 999))).toBe('open');
    expect(entryPhase(S(), J(2027, 2, 1, 0, 0))).toBe('closed');
  });
  it('世帯の延長が今より先なら受付中。止めている時は延長でも開かない', () => {
    expect(entryPhase(S(), J(2027, 2, 3), '2027-02-05 23:59')).toBe('open');
    expect(entryPhase(S(), J(2027, 2, 6), '2027-02-05 23:59')).toBe('closed');
    expect(entryPhase(S({ suspended: '1' }), J(2027, 2, 3), '2027-02-05 23:59')).toBe('suspended');
  });
  it('日時の設定が読めなければ開けない', () => {
    expect(entryPhase(S({ entry_open_at: '12/15' }), J(2027, 1, 10))).toBe('suspended');
  });
});

describe('支払いの鍵2つ（K224）', () => {
  it('pay_open_at の前は before（pay_ok_at があっても）', () => {
    expect(payGate(S({ pay_ok_at: '2026-12-14 20:00' }), J(2026, 12, 15, 11, 59))).toBe('before');
  });
  it('時刻を過ぎて pay_ok_at が空なら preparing', () => {
    expect(payGate(S(), J(2026, 12, 15, 12))).toBe('preparing');
  });
  it('両方そろえば open', () => {
    expect(payGate(S({ pay_ok_at: '2026-12-14 20:00' }), J(2026, 12, 15, 12))).toBe('open');
  });
  it('境目はミリ秒まで：11:59:59.999 は before、12:00:00.000 は open', () => {
    expect(payGate(S({ pay_ok_at: '2026-12-14 20:00' }), J(2026, 12, 15, 11, 59, 59, 999))).toBe('before');
    expect(payGate(S({ pay_ok_at: '2026-12-14 20:00' }), J(2026, 12, 15, 12, 0, 0, 0))).toBe('open');
  });
  it('pay_open_at が読めない形なら before（開けない）', () => {
    expect(payGate(S({ pay_open_at: '2026/12/15 12:00', pay_ok_at: '2026-12-14 20:00' }), J(2027, 1, 10))).toBe('before');
  });
});

describe('電話とメールのそろえ方', () => {
  it('全角・ハイフン・大文字・前後の空白をそろえる', () => {
    expect(normalizePhone('０９０－１２３４－５６７８')).toBe('09012345678');
    expect(normalizePhone('090-1234-5678')).toBe('09012345678');
    expect(normalizeEmail('  Ａ@Example.COM ')).toBe('a@example.com');
  });
});

describe('マイページの URL', () => {
  it('家庭向けのドメインで作る', () => {
    expect(recitalMyUrl('a'.repeat(48))).toBe('https://event.boom-sendai.com/bw6/my?t=' + 'a'.repeat(48));
    expect(recitalMyUrl('a'.repeat(48), { fromMail: true })).toBe('https://event.boom-sendai.com/bw6/my?t=' + 'a'.repeat(48) + '&from=mail');
  });
});

describe('checkSettingValue（6 の保存と 18 の画面の両方が使う）', () => {
  it.each([
    ['pay_ok_at', '2026-12-14 10:00', false],          // 鍵はボタンだけ（K224）
    ['bank_audit_done_at', '2027-02-12 21:00', false],
    ['suspended', '0', false],                         // 受付を開ける・止めるのボタンだけ
    ['stripe_mode', 'live', false],                    // 種だけで決める
    ['tshirt_colors', '白', false],                    // 段階1の画面に出さない鍵（R-19）
    ['entry_open_at', '2026-12-15 12:00', true],
    ['entry_open_at', '2026/12/15 12:00', false],
    ['entry_open_at', '2026-12-15', false],
    ['entry_close_at', '1/31', false],
    ['pay_due', '2027-02-10', true],
    ['pay_due', '2027-02-30', false],
    ['roster_fix_on', '', true],
    ['fee_check_first', '26500,32500,35500,38500,41500', true],
    ['fee_check_first', '26500,32500,35500,38500', false],
    ['fee_check_family', '8000', true],
    ['max_works_per_person', '5', true],
    ['max_works_per_person', '0', false],
    ['ref_skip', '', true],
    ['ref_skip', '2003', true],
    ['ref_skip', '1234,5724', true],
    ['ref_skip', '12a4', false],
    ['bank_ask_at', '19:00,20:30', true],
    ['bank_ask_at', '19時', false],
    ['test_mail_to', '', true],
    ['test_mail_to', 'not-mail', false],
    ['mail_bcc_staff', '1', true],
    ['mail_bcc_staff', '2', false],
  ])('%s = %s → 入れてよい %s', (k, v, ok) => expect(checkSettingValue(k, v) === null).toBe(ok));
});

describe('お金に数える出演（D4 2-3）', () => {
  it('counted・dropped でない・in のときだけ', () => {
    expect(isCountedCast({ fee_type: 'counted', status: 'open' }, { status: 'in' })).toBe(true);
    expect(isCountedCast({ fee_type: 'counted', status: 'dropped' }, { status: 'in' })).toBe(false);
    expect(isCountedCast({ fee_type: 'extra', status: 'open' }, { status: 'in' })).toBe(false);
    expect(isCountedCast({ fee_type: 'separate', status: 'open' }, { status: 'in' })).toBe(false);
    for (const st of ['maybe', 'out', 'passed'] as const)
      expect(isCountedCast({ fee_type: 'counted', status: 'fixed' }, { status: st })).toBe(false);
  });
});

describe('式4行（5章頭・K199）', () => {
  it('お支払いずみの分と返す分のちがい（5-7 の5行）', () => {
    const rows: [number[], number, number, number][] = [
      // 入金の行, 返す分 todo, 合計, → 払った額・お支払いずみの分 は下で確かめる
      [[35500], 0, 32500, 0],
      [[32500], 6000, 26500, 0],
      [[32500, -6000], 0, 26500, 0],
      [[32500], 0, 26500, 0],
      [[35500], 3000, 32500, 0],
    ];
    const want = [[35500, 3000], [26500, 0], [26500, 0], [32500, 6000], [32500, 0]];
    rows.forEach(([pays, todo, total], i) => {
      const m = moneySummary({ chargeAmounts: [total], paymentAmounts: pays, refundTodoAmounts: todo ? [todo] : [] });
      expect([m.paid, m.overpaid]).toEqual(want[i]);
      expect(m.remaining).toBe(0);
    });
  });
  it('adjust の下げる行で合計が0より小さくなれば合計は0（K228）', () => {
    expect(moneySummary({ chargeAmounts: [-5000], paymentAmounts: [], refundTodoAmounts: [] }))
      .toEqual({ total: 0, paid: 0, remaining: 0, overpaid: 0 });
  });
});

describe('世帯の見え方（5行の順・K218・K222）', () => {
  it.each([
    [{ hasIn: false, hasMaybe: false, paid: 8000, remaining: 0 }, 'none'],
    [{ hasIn: false, hasMaybe: true, paid: 0, remaining: 0 }, 'tentative'],
    [{ hasIn: false, hasMaybe: true, paid: 26500, remaining: 0 }, 'complete'],
    [{ hasIn: true, hasMaybe: false, paid: 0, remaining: 0 }, 'complete'],
    [{ hasIn: true, hasMaybe: true, paid: 26500, remaining: 6000 }, 'complete_extra'],
    [{ hasIn: true, hasMaybe: false, paid: 20000, remaining: 6500 }, 'complete_extra'],
    [{ hasIn: true, hasMaybe: false, paid: 0, remaining: 26500 }, 'tentative'],
  ] as const)('%o → %s', (x, v) => expect(householdView(x)).toBe(v));
  it('言葉4つ', () => {
    expect(householdViewLabel('none', 0)).toBe('出演なし');
    expect(householdViewLabel('tentative', 26500)).toBe('仮受付');
    expect(householdViewLabel('complete', 0)).toBe('申込完了');
    expect(householdViewLabel('complete_extra', 6000)).toBe('申込完了（追加分 6,000円のお支払い待ち）');
  });
});

describe('場面 A〜E（5-5）', () => {
  it.each([
    ['A 申し込む', 26500, 0, 26500, 0, '仮受付'],
    ['A 26,500 を払う', 26500, 26500, 0, 0, '申込完了'],
    ['B 1作品を足す', 32500, 26500, 6000, 0, '申込完了（追加分 6,000円のお支払い待ち）'],
    ['B 6,000 を払う', 32500, 32500, 0, 0, '申込完了'],
    ['C 1作品をやめる', 26500, 32500, 0, 6000, '申込完了'],
    ['C 別の1作品を足す', 32500, 32500, 0, 0, '申込完了'],
    ['D 2作品で申し込む', 32500, 0, 32500, 0, '仮受付'],
    ['D 1作品を足す', 35500, 0, 35500, 0, '仮受付'],
    ['D 1作品をやめる', 32500, 0, 32500, 0, '仮受付'],
    ['E 兄1・妹1で申し込む', 34500, 0, 34500, 0, '仮受付'],
    ['E 34,500 を1回で払う', 34500, 34500, 0, 0, '申込完了'],
    ['E 兄が1作品を足す', 37500, 34500, 3000, 0, '申込完了（追加分 3,000円のお支払い待ち）'],
    ['E 妹がやめる', 32500, 34500, 0, 2000, '申込完了'],
  ] as const)('%s', (_n, total, paid, remaining, overpaid, label) => {
    const m = M(total, paid);
    expect(m).toEqual({ total, paid, remaining, overpaid });
    const v = householdView({ hasIn: true, hasMaybe: false, paid: m.paid, remaining: m.remaining });
    expect(householdViewLabel(v, m.remaining)).toBe(label);
  });
});

describe('払う額と「払う」の出し方（K204・K207）', () => {
  it('振り込みましたの印が開いていて残り＞印の金額なら 残り−印の金額。そうでなければ残り', () => {
    expect(payableAmount(M(32500, 0), { amount: 26500 })).toBe(6000);
    expect(payableAmount(M(26500, 0), { amount: 26500 })).toBe(26500);
    expect(payableAmount(M(26500, 0), { amount: 30000 })).toBe(26500);
    expect(payableAmount(M(26500, 0), null)).toBe(26500);
  });
  const st = (gate: 'before' | 'preparing' | 'open', m: MoneySummary, todo = 0) =>
    payButtonState({ gate, view: householdView({ hasIn: true, hasMaybe: false, paid: m.paid, remaining: m.remaining }), m, refundTodo: todo });
  it('残り0は出さない。鍵が開くまでは before／preparing', () => {
    expect(st('open', M(26500, 26500))).toBe('hidden');
    expect(st('before', M(26500, 0))).toBe('before');
    expect(st('preparing', M(26500, 0))).toBe('preparing');
    expect(st('open', M(26500, 0))).toBe('show');
  });
  it('返す分≧残りの間は refund_hold（K207）', () => {
    expect(st('open', M(35500, 38500, 6000), 6000)).toBe('refund_hold'); // 残り 3,000・返す分 6,000
    expect(st('open', M(35500, 35500, 3000), 3000)).toBe('refund_hold'); // 残り 3,000・返す分 3,000
    expect(st('open', M(38500, 35500, 3000), 3000)).toBe('show');        // 残り 6,000・返す分 3,000
  });
  it('出演なしは出さない', () => {
    expect(payButtonState({ gate: 'open', view: 'none', m: M(3000, 0), refundTodo: 0 })).toBe('hidden');
  });
});

describe('人数（5-9 の例6行）', () => {
  const p = (countedIn: number, rem: number, over: Partial<CountPerson> = {}): CountPerson =>
    ({ category: 'student', feeClass: null, countedIn, maybeCount: 0, householdRemaining: rem, isTestEvent: false, ...over });
  const now = new Date('2026-12-20T03:00:00.000Z');
  it.each([
    ['1人1作品・仮受付', [p(1, 26500)], [1, 0, 1, 0]],
    ['その世帯が 26,500 を払った', [p(1, 0)], [1, 1, 0, 0]],
    ['兄1・妹1 で払ったあと兄が足した（追加 3,000 待ち）', [p(2, 3000), p(1, 3000)], [2, 0, 2, 0]],
    ['その 3,000 を払った', [p(2, 0), p(1, 0)], [2, 2, 0, 0]],
    ['払ったあと妹がやめた', [p(1, 0), p(0, 0)], [1, 1, 0, 0]],
    ['迷っているだけの世帯', [p(0, 0, { maybeCount: 1 })], [0, 0, 0, 1]],
  ] as const)('%s', (_n, people, [going, paid, unpaid, maybe]) => {
    const c = countPeople([...people], now);
    expect([c.going, c.paid, c.unpaid, c.maybe]).toEqual([going, paid, unpaid, maybe]);
    expect(c.countedAt).toBe('2026-12-20T03:00:00.000Z');
  });
  it('試し用は数えない・free と tshirt_only は別の行・イントラは出る人に入れない', () => {
    const c = countPeople([
      p(1, 0, { isTestEvent: true }), p(1, 0, { feeClass: 'free' }), p(1, 0, { feeClass: 'tshirt_only' }),
      p(1, 0, { category: 'instructor' }), p(1, 0, { category: 'non_member' }),
    ], now);
    expect([c.going, c.special]).toEqual([1, 2]);
  });
});

describe('学年と年齢（5-10）', () => {
  it.each([
    ['2019-04-02', '2027-04-11', '小2'], ['2019-04-01', '2027-04-11', '小3'], ['2019-04-02', '2026-12-15', '小1'],
    ['2012-04-02', '2027-04-11', '中3'], ['2021-05-01', '2027-04-11', '年長'], ['2022-05-01', '2027-04-11', '年中'],
    ['2009-06-01', '2027-04-11', '高3'], ['2000-01-01', '2027-04-11', '大人'], ['2025-01-01', '2027-04-11', '未就学'],
  ])('%s の %s は %s', (b, on, g) => expect(schoolGrade(b, on)).toBe(g));
  it('満年齢（誕生日の当日に1つ上がる）', () => {
    expect(ageOn('2009-04-12', '2027-04-11')).toBe(17);
    expect(ageOn('2009-04-11', '2027-04-11')).toBe(18);
    expect(ageOn('2008-12-16', '2026-12-15')).toBe(17);
  });
});
```

- [ ] **Step 2: 試験を回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recital.test.ts`
Expected: FAIL（`Cannot find module '../recital'`）

- [ ] **Step 3: `src/lib/recital.ts` を書く**

型・定数は Interfaces と上の「決めた値」のとおり。式と順番は上の試験が正本（ここに文で書いた所と試験が食いちがったら、試験に合わせて止まって知らせる）。決めること：
- `checkSettingValue`：順に見る：`RECITAL_SETTING_KEYS_LOCKED` と `suspended`・`stripe_mode` は「この欄からは直せません」／`RECITAL_SETTING_KEYS_SHOWN` に無い鍵は「この画面では直せない鍵です」／あとは鍵の形で見る。
  | 形 | 鍵 | 決まり |
  |---|---|---|
  | 日時 | `entry_open_at`・`entry_close_at`・`change_close_at`・`pay_open_at`・`tshirt_close_at`・`name_fix_close_at` | `YYYY-MM-DD HH:MM` で実在する日時（`name_fix_close_at` は空も可） |
  | 日付 | `pay_due`・`bank_rest_from`・`bank_rest_to`・`bank_audit_on`・`bank_close_on`（必須）／`roster_fix_on`・`tshirt_order_on`（空も可） | `isIsoDate` |
  | 整数 | `max_works_per_person` 1〜10・`min_self_apply_age` 0〜30・`goal_people`・`breakeven_people`・`cap_people` 1〜1000・`pay_remind_stop_hours` 1〜72・`fee_check_family` 0〜100000 | 半角の整数 |
  | 0か1 | `mail_bcc_staff` | `0`／`1` |
  | 並び | `fee_check_first` 整数5つ／`tshirt_sizes` 空でない語をカンマで／`ref_skip` 4けたの数字をカンマで（空も可）／`bank_ask_at` `HH:MM` をカンマで | 前後の空白は許す |
  | メール | `test_mail_to` | 空か、`@` を1つ含み空白が無い |
  | 文 | そのほか（`consent_items`・`privacy_text`・`extra_costs_text`・`schedule_text`・`line_url`・`bank_text`・`tshirt_give_to`） | 4000字まで |
  `RECITAL_SETTING_KEYS_SHOWN` に、上の表に無い鍵が入っていたら、文として扱わずに止まって知らせる。
- `parseRecitalSettings`：`RECITAL_SETTING_DEFAULTS` の上に行を重ねて `raw` にする。数は `parseInt`（数でなければ初めの値）、並びは `,` で割って `trim`・空を捨てる、`suspended`＝`raw.suspended !== '0'`、`mail_bcc_staff`＝`=== '1'`、`stripe_mode`＝`=== 'live' ? 'live' : 'test'`、`pay_ok_at`・`bank_audit_done_at`・`roster_fix_on`・`tshirt_order_on`・`name_fix_close_at` は空なら `null`。
- `jstToMs`：`/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/` に合えば `Date.UTC(…, 時−9, 分)`。合わなければ `NaN`。`deadlineMs`：時刻ありは `jstToMs + 60_000 − 1`、日付だけは `jstToMs + 86_400_000 − 1`。
- `entryPhase`：`suspended` → `'suspended'`。`entry_open_at`・`entry_close_at` のどちらかが `NaN` → `'suspended'`。`now < jstToMs(open)` → `'before'`。`now ≤ deadlineMs(close)` → `'open'`。`extendUntil` があり `now ≤ deadlineMs(extendUntil)` → `'open'`。ほかは `'closed'`。
- `payGate`：`pay_open_at` が `NaN` か `now < jstToMs(pay_open_at)` → `'before'`。`pay_ok_at` が `null` → `'preparing'`。ほかは `'open'`。
- `moneySummary`：`total = max(0, Σcharge)`・`paid = Σpayment − Σtodo`・`remaining = max(0, total − paid)`・`overpaid = max(0, paid − total)`。
- `householdView`：①`!hasIn && !hasMaybe` → none ②`paid ≤ 0 && !hasIn && hasMaybe` → tentative ③`remaining === 0` → complete ④`paid > 0 && remaining > 0` → complete_extra ⑤tentative。
- `householdViewLabel`：金額は `toLocaleString('ja-JP')`。
- `payButtonState`：`view === 'none'` か `m.remaining ≤ 0` → hidden → `gate` が before／preparing ならそれ → `refundTodo > 0 && refundTodo ≥ m.remaining` → refund_hold → show。
- `countPeople`：`isTestEvent` は飛ばす。`feeClass` が free／tshirt_only で `countedIn ≥ 1` → `special`。`category` が student／non_member で `countedIn ≥ 1`（free・tshirt_only を除く）→ `going`、そのうち `householdRemaining === 0` → `paid`、`> 0` → `unpaid`。`countedIn === 0 && maybeCount ≥ 1` → `maybe`。`countedAt = nowUtcIso(now)`。
- `schoolGrade`／`ageOn`：上の「学年の言葉」のとおり。生年月日が `YYYY-MM-DD` でなければ `''`／`NaN`。

- [ ] **Step 4: 試験を回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recital.test.ts`
Expected: PASS（全部）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recital.ts src/lib/__tests__/recital.test.ts
git commit -m "feat(bw6): 発表会の型・設定の読み・受付と支払いの鍵・お金の式・見え方・人数・学年" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `recitalFee.ts`（料金の規則→請求の行・1人目・行の比べ・検算）

**Files:**
- Create: `src/lib/recitalFee.ts`
- Test: `src/lib/__tests__/recitalFee.test.ts`

**Interfaces:**
- Consumes: `import type { FeeClass } from './recital'`（**`import type` で書く**。Task 2 と同時に作っても試験が動くように。試験の一部は `moneySummary`・`isCountedCast` を使うので、Task 2 が入ってから回す）
- Produces（`src/lib/recitalFee.ts`）：
  - `type FeeRule = { payer_role: 'first' | 'family'; item_code: 'base' | 'tshirt' | 'coop_ticket' | 'add_work'; nth_from: number; nth_to: number | null; unit_amount: number; qty: number; label: string; is_tentative: number; sort_order: number }`
  - `type FeePerson = { personId: number; seq: number; feeClass: FeeClass; counted: number; extraWorks: { workCode: string; label: string; fee: number }[] }`（`counted`＝その人のお金に数える出演の数〔`isCountedCast` が true の数〕。`extraWorks`＝`fee_type='extra'` で作品が `dropped` でなく出演が `in` の物。呼ぶ側が作る）
  - `type ChargeLine = { personId: number | null; itemCode: string; ref: string; label: string; qty: number; unitAmount: number; amount: number }`
  - `expectedCharges(rules: FeeRule[], people: FeePerson[], currentFirstPersonId: number | null): { lines: ChargeLine[]; firstPersonId: number | null; total: number }`
  - `pickFirstPerson(rules: FeeRule[], people: FeePerson[], currentFirstPersonId: number | null): number | null`
  - `diffCharges(active: (ChargeLine & { id: number })[], expected: ChargeLine[]): { add: ChargeLine[]; voidIds: number[] }`
  - `feeCheck(rules: FeeRule[], checkFirst: number[], checkFamily: number): { ok: boolean; first: number[]; family: number; tentative: boolean }`

行の作り方（05 5-1・5-3、03 3-4 の規則8行、R-17・R-84・K223）：
- 人ごと。役（`first`／`family`）の規則のうち `base`・`tshirt` は `nth_from ≤ n` なら1行（`ref`=''、`label`＝規則の `label`、`qty`・`unit_amount` は規則のまま、`amount = qty × unit_amount`）。`add_work` は `k = max(nth_from, 2)…min(nth_to ?? ∞, n)` の k ごとに1行（`ref = String(k)`、`label = \`${k}作品目\``）。
- `extraWorks` ごとに `extra_work` の行（`ref`＝W番号、`qty`=1、`unitAmount = amount = fee`）。n に数えない（n=0 でも作る）。
- `feeClass`：`no_coop`＝式のとおり／`tshirt_only`＝n≥1 のとき `family` の `tshirt` 規則の行1つだけ（`extra_work` も作らない）／`free`＝行を作らない（`extra_work` も作らない）。`tshirt_only`・`free` は1人目の候補にしない。
- 世帯の行 `coop_ticket`（`personId: null`・`ref` ''）は、1人目がいて、その人が `no_coop` でないときだけ、`first` の `coop_ticket` 規則から1行。
- 1人目（R-83）：候補＝n≥1 で `tshirt_only`・`free` でない人。候補を1人ずつ1人目に置いた世帯の合計が最小の人。同じ額なら `currentFirstPersonId` がその中にいればその人、いなければ `seq` の小さい人。候補0なら `null`。
- `diffCharges`：`active` の `itemCode === 'adjust'` は見ない。鍵＝`${personId ?? ''}|${itemCode}|${ref}`。同じ鍵で `amount` も同じ生きている行は残す（同じ鍵が2つあれば2つ目から void）。それ以外の生きている行は `voidIds`。残した行に当たらない期待の行は `add`。`label` のちがいは見ない。
- `feeCheck`：`first[i]` ＝1人・(i+1)作品の世帯の合計（i＜`checkFirst.length`）、`family` ＝1作品ずつ2人の世帯の合計 − 1人・1作品の合計。`tentative = rules.some(r => r.is_tentative === 1)`。`ok`＝並びが同じ・`family === checkFamily`・`!tentative`。

- [ ] **Step 1: 失敗する試験を書く**（`src/lib/__tests__/recitalFee.test.ts`）

```ts
import { describe, it, expect } from 'vitest';
import { expectedCharges, pickFirstPerson, diffCharges, feeCheck, type FeeRule, type FeePerson, type ChargeLine } from '../recitalFee';
import { moneySummary } from '../recital';
import type { FeeClass } from '../recital';

const R = (payer_role: 'first' | 'family', item_code: FeeRule['item_code'], nth_from: number, nth_to: number | null, unit_amount: number, qty: number, label: string, sort_order: number): FeeRule =>
  ({ payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative: 0, sort_order });
const RULES: FeeRule[] = [
  R('first', 'base', 1, 1, 16000, 1, '出演料（本体）', 1),
  R('first', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 2),
  R('first', 'coop_ticket', 1, 1, 2500, 3, '協力チケット3枚', 3),
  R('first', 'add_work', 2, 2, 6000, 1, '2作品目', 4),
  R('first', 'add_work', 3, null, 3000, 1, '3作品目から（1作品ごと）', 5),
  R('family', 'base', 1, 1, 5000, 1, 'ご家族の参加費', 6),
  R('family', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 7),
  R('family', 'add_work', 2, null, 3000, 1, '2作品目から（1作品ごと）', 8),
];
const P = (id: number, n: number, feeClass: FeeClass = null, extra: number[] = []): FeePerson =>
  ({ personId: id, seq: id, feeClass, counted: n, extraWorks: extra.map((fee, i) => ({ workCode: `W9${i}`, label: '別料金の作品', fee })) });
const total = (people: FeePerson[], cur: number | null = null) => expectedCharges(RULES, people, cur).total;
const key = (l: ChargeLine) => `${l.personId ?? ''}|${l.itemCode}|${l.ref}|${l.amount}`;
/** 生きている行に diff を当てた結果（試験用の小さな台帳） */
function applyDiff(active: (ChargeLine & { id: number })[], expected: ChargeLine[]) {
  const d = diffCharges(active, expected);
  let next = Math.max(0, ...active.map((a) => a.id)) + 1;
  return { d, active: [...active.filter((a) => !d.voidIds.includes(a.id)), ...d.add.map((l) => ({ ...l, id: next++ }))] };
}

describe('料金の例（05 5-1 の表の全行）', () => {
  it.each([
    ['1人・1作品', [P(1, 1)], 26500],
    ['1人・2作品', [P(1, 2)], 32500],
    ['1人・3作品', [P(1, 3)], 35500],
    ['1人・4作品', [P(1, 4)], 38500],
    ['1人・5作品', [P(1, 5)], 41500],
    ['1人・1作品＋迷っている1作品（迷っているは n に入らない）', [P(1, 1)], 26500],
    ['きょうだい2人・1作品ずつ', [P(1, 1), P(2, 1)], 34500],
    ['きょうだい3人・1作品ずつ', [P(1, 1), P(2, 1), P(3, 1)], 42500],
    ['きょうだい4人・1作品ずつ', [P(1, 1), P(2, 1), P(3, 1), P(4, 1)], 50500],
    ['兄2作品・妹1作品', [P(1, 2), P(2, 1)], 37500],
    ['兄3作品・妹1作品', [P(1, 3), P(2, 1)], 40500],
    ['兄2作品・妹2作品', [P(1, 2), P(2, 2)], 43500],
    ['兄3作品・妹2作品', [P(1, 3), P(2, 2)], 46500],
    ['兄5作品・妹5作品', [P(1, 5), P(2, 5)], 61500],
    ['きょうだい3人（1・2・3作品）', [P(1, 1), P(2, 2), P(3, 3)], 51500],
    ['きょうだい3人・2作品ずつ', [P(1, 2), P(2, 2), P(3, 2)], 54500],
    ['きょうだい3人・5作品ずつ', [P(1, 5), P(2, 5), P(3, 5)], 81500],
    ['協力チケットなし・1人1作品', [P(1, 1, 'no_coop')], 19000],
    ['協力チケットなし・1人2作品', [P(1, 2, 'no_coop')], 25000],
    ['協力チケットなし（印の人が1人目）・兄1・妹1', [P(1, 1, 'no_coop'), P(2, 1)], 27000],
    ['Tシャツ代だけ・1人', [P(1, 1, 'tshirt_only')], 3000],
    ['参加費なし（0円）・1人', [P(1, 1, 'free')], 0],
    ['参加費なしの親＋ふつうの子1作品', [P(1, 1, 'free'), P(2, 1)], 26500],
    ['Tシャツ代だけの親＋ふつうの子1作品', [P(1, 1, 'tshirt_only'), P(2, 1)], 29500],
    ['参加費なしの人とTシャツ代だけの人の世帯', [P(1, 1, 'free'), P(2, 1, 'tshirt_only')], 3000],
    ['1作品＋別料金の作品1つ', [P(1, 1, null, [4000])], 30500],
    ['別料金の作品だけ', [P(1, 0, null, [4000])], 4000],
    ['MOCCHIN だけ（separate は渡さない）', [P(1, 0)], 0],
  ] as const)('%s → %i', (_n, people, want) => expect(total([...people])).toBe(want));

  it('12/20 の例の行（本体・Tシャツ・協力チケット・2作品目）', () => {
    const r = expectedCharges(RULES, [P(1, 2)], null);
    expect(r.lines.map(key).sort()).toEqual(['1|add_work|2|6000', '1|base||16000', '1|tshirt||3000', '|coop_ticket||7500'].sort());
    expect(r.lines.find((l) => l.itemCode === 'add_work')?.label).toBe('2作品目');
  });
  it('参加費なしの人とTシャツ代だけの人の世帯には協力チケットの行が無く、1人目も無い', () => {
    const r = expectedCharges(RULES, [P(1, 1, 'free'), P(2, 1, 'tshirt_only')], null);
    expect(r.firstPersonId).toBeNull();
    expect(r.lines.some((l) => l.itemCode === 'coop_ticket')).toBe(false);
  });
});

describe('1人目（05 5-2・R-83）', () => {
  it('兄2・妹1 は妹が1人目（37,500 と 40,500 の安い方）', () => {
    expect(pickFirstPerson(RULES, [P(1, 2), P(2, 1)], null)).toBe(2);
  });
  it('同じ額なら今の1人目のまま。初めてなら P番号の小さい人', () => {
    expect(pickFirstPerson(RULES, [P(1, 3), P(2, 2)], 2)).toBe(2);
    expect(pickFirstPerson(RULES, [P(1, 3), P(2, 2)], 1)).toBe(1);
    expect(pickFirstPerson(RULES, [P(1, 3), P(2, 2)], null)).toBe(1);
    expect(total([P(1, 3), P(2, 2)], 2)).toBe(total([P(1, 3), P(2, 2)], 1));
  });
  it('今の1人目がいちばん安い人の中にいなければ入れかわる（足す例：兄2 → 兄2・妹1）', () => {
    expect(expectedCharges(RULES, [P(1, 2), P(2, 1)], 1).firstPersonId).toBe(2);
  });
});

describe('計算の部品の試し（05 5-1 の21場面）', () => {
  it('1 n が0の人だけの世帯：行なし', () => {
    expect(expectedCharges(RULES, [P(1, 0)], null)).toEqual({ lines: [], firstPersonId: null, total: 0 });
  });
  it('2 1人目がやめて2人目が残る：行ごとに void と足す（Tシャツと協力チケットは残る）', () => {
    const start = expectedCharges(RULES, [P(1, 1), P(2, 1)], null).lines.map((l, i) => ({ ...l, id: i + 1 }));
    const exp = expectedCharges(RULES, [P(1, 0), P(2, 1)], 1);
    const { d, active } = applyDiff(start, exp.lines);
    expect(exp.firstPersonId).toBe(2);
    expect(d.add.map(key)).toEqual(['2|base||16000']);
    expect(d.voidIds.map((id) => key(start.find((s) => s.id === id)!)).sort()).toEqual(['1|base||16000', '1|tshirt||3000', '2|base||5000'].sort());
    expect(active.reduce((a, l) => a + l.amount, 0)).toBe(26500);
  });
  it('3 家族のうち1人だけ n が0になる：37,500 → 26,500', () => {
    expect(total([P(1, 2), P(2, 1)])).toBe(37500);
    expect(total([P(1, 0), P(2, 1)])).toBe(26500);
  });
  it('4 払ったあとにやめた作品がある：お支払いずみの分が出る', () => {
    expect(moneySummary({ chargeAmounts: [total([P(1, 2)])], paymentAmounts: [35500], refundTodoAmounts: [] }))
      .toEqual({ total: 32500, paid: 35500, remaining: 0, overpaid: 3000 });
  });
  it('5 払ったあとに足した：残りは差額だけ', () => {
    expect(moneySummary({ chargeAmounts: [total([P(1, 2)])], paymentAmounts: [26500], refundTodoAmounts: [] }).remaining).toBe(6000);
  });
  it('6 お支払いずみの分がある世帯が足した：先に当たる', () => {
    expect(moneySummary({ chargeAmounts: [total([P(1, 3)])], paymentAmounts: [35500], refundTodoAmounts: [] }))
      .toEqual({ total: 35500, paid: 35500, remaining: 0, overpaid: 0 });
  });
  it('7 返す分（todo）がある世帯の残り', () => {
    expect(moneySummary({ chargeAmounts: [26500], paymentAmounts: [32500], refundTodoAmounts: [6000] }))
      .toEqual({ total: 26500, paid: 26500, remaining: 0, overpaid: 0 });
  });
  it('8・9 dropped の作品・まだ迷っている作品は n に入らない（呼ぶ側が isCountedCast で数えた n）', () => {
    expect(total([P(1, 1)])).toBe(26500);
  });
  it('10 特別な料金の印の人がいる（上の表の no_coop・tshirt_only・free の行）', () => {
    expect(total([P(1, 1, 'no_coop'), P(2, 1)])).toBe(27000);
  });
  it('11 同じ額のとき1人目が動かない（diff が空）', () => {
    const lines = expectedCharges(RULES, [P(1, 3), P(2, 2)], 2).lines.map((l, i) => ({ ...l, id: i + 1 }));
    expect(diffCharges(lines, expectedCharges(RULES, [P(1, 3), P(2, 2)], 2).lines)).toEqual({ add: [], voidIds: [] });
  });
  it('12 別料金と通常がまざる', () => { expect(total([P(1, 1, null, [4000]), P(2, 1)])).toBe(38500); });
  it('13 家族4人', () => { expect(total([P(1, 1), P(2, 1), P(3, 1), P(4, 1)])).toBe(50500); });
  it('14 払ったあとに種類を変えた（下がる・上がる）', () => {
    expect(moneySummary({ chargeAmounts: [total([P(1, 1, 'no_coop')])], paymentAmounts: [26500], refundTodoAmounts: [] }).overpaid).toBe(7500);
    expect(moneySummary({ chargeAmounts: [total([P(1, 1)])], paymentAmounts: [19000], refundTodoAmounts: [] }).remaining).toBe(7500);
  });
  it('15・16 同じ種類をもう一度選んだ／印のある人を会員と結んだ：何も変わらない', () => {
    const lines = expectedCharges(RULES, [P(1, 1, 'no_coop')], null).lines.map((l, i) => ({ ...l, id: i + 1 }));
    expect(diffCharges(lines, expectedCharges(RULES, [P(1, 1, 'no_coop')], 1).lines)).toEqual({ add: [], voidIds: [] });
  });
  it('17 きょうだいの世帯で種類を変えた（1人目が入れかわる）', () => {
    expect(expectedCharges(RULES, [P(1, 2), P(2, 1)], null).firstPersonId).toBe(2);
    const r = expectedCharges(RULES, [P(1, 2), P(2, 1, 'tshirt_only')], 2);
    expect([r.firstPersonId, r.total]).toEqual([1, 35500]);
  });
  it('18 種類を変えた人があとで作品を足す・全部やめる', () => {
    expect(total([P(1, 2, 'no_coop')])).toBe(25000);
    expect(total([P(1, 0, 'no_coop')])).toBe(0);
  });
  it('19 「ふつう」にもどした', () => { expect(total([P(1, 1)])).toBe(26500); });
  it('20 adjust の下げる行がある世帯が全部やめた：adjust は残り、合計は0', () => {
    const active = [{ personId: null, itemCode: 'adjust', ref: '', label: '手の調整', qty: 1, unitAmount: -5000, amount: -5000, id: 9 },
      ...expectedCharges(RULES, [P(1, 1)], null).lines.map((l, i) => ({ ...l, id: i + 1 }))];
    const { d, active: after } = applyDiff(active, expectedCharges(RULES, [P(1, 0)], 1).lines);
    expect(d.voidIds).not.toContain(9);
    expect(after.map((a) => a.id)).toEqual([9]);
    expect(moneySummary({ chargeAmounts: after.map((a) => a.amount), paymentAmounts: [], refundTodoAmounts: [] }).total).toBe(0);
  });
});

describe('請求の行の流れ（05 5-3 の例・12/20〜1/30）', () => {
  it('行ごとに足す・void して、合計と払った額が表のとおり', () => {
    let active: (ChargeLine & { id: number })[] = [];
    const pays: number[] = [];
    const step = (n: number) => { active = applyDiff(active, expectedCharges(RULES, [P(1, n)], 1).lines).active; };
    const m = () => moneySummary({ chargeAmounts: active.map((a) => a.amount), paymentAmounts: pays, refundTodoAmounts: [] });
    step(2); expect(m()).toEqual({ total: 32500, paid: 0, remaining: 32500, overpaid: 0 });          // 12/20
    pays.push(32500); expect(m().remaining).toBe(0);                                                 // 12/21
    step(3); expect(m()).toEqual({ total: 35500, paid: 32500, remaining: 3000, overpaid: 0 });       // 1/20
    expect(active.some((a) => a.itemCode === 'add_work' && a.ref === '3' && a.label === '3作品目')).toBe(true);
    pays.push(3000); expect(m().remaining).toBe(0);                                                  // 1/22
    step(2); expect(m()).toEqual({ total: 32500, paid: 35500, remaining: 0, overpaid: 3000 });       // 1/25
    step(3); expect(m()).toEqual({ total: 35500, paid: 35500, remaining: 0, overpaid: 0 });          // 1/30
  });
});

describe('検算（05 5-1）', () => {
  it('BW6 の規則は 26,500〜41,500 と 8,000 で合う', () => {
    expect(feeCheck(RULES, [26500, 32500, 35500, 38500, 41500], 8000))
      .toEqual({ ok: true, first: [26500, 32500, 35500, 38500, 41500], family: 8000, tentative: false });
  });
  it('規則が1つちがえば ng', () => {
    const bad = RULES.map((r) => (r.item_code === 'add_work' && r.nth_from === 2 && r.payer_role === 'first' ? { ...r, unit_amount: 5000 } : r));
    expect(feeCheck(bad, [26500, 32500, 35500, 38500, 41500], 8000).ok).toBe(false);
  });
  it('is_tentative の行があれば、額が合っても ng', () => {
    const t = RULES.map((r, i) => (i === 0 ? { ...r, is_tentative: 1 } : r));
    expect(feeCheck(t, [26500, 32500, 35500, 38500, 41500], 8000)).toMatchObject({ ok: false, tentative: true });
  });
});
```

- [ ] **Step 2: 試験を回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalFee.test.ts`
Expected: FAIL（`Cannot find module '../recitalFee'`。Task 2 がまだなら `'../recital'` も）

- [ ] **Step 3: `src/lib/recitalFee.ts` を書く**

上の「行の作り方」のとおり。1人目は候補ごとに行を作って合計をくらべる（候補は数人なので、全部ためしてよい）。規則の `item_code` にない物（後の段階の種類）が来たら無視せず throw する（規則の表に段階1の4種類以外が入ったら、止まって知らせる）。

- [ ] **Step 4: 試験を回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalFee.test.ts`
Expected: PASS（全部）。どれかの金額が設計書の表と合わないときは、表を直さず、止まって知らせる。

- [ ] **Step 5: コミット**

```bash
git add src/lib/recitalFee.ts src/lib/__tests__/recitalFee.test.ts
git commit -m "feat(bw6): 料金の規則から請求の行・1人目・行の比べ・検算を出す" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `recitalRef.ts`（整理番号：Damm・確かめる・出す・摘要から読む）

**Files:**
- Create: `src/lib/recitalRef.ts`
- Test: `src/lib/__tests__/recitalRef.test.ts`

**Interfaces:**
- Consumes: なし
- Produces（`src/lib/recitalRef.ts`）：
  - `RESERVED_REFS: readonly string[]`＝`['1007','1234','5724','9054','9990','4727','4823','4867','4872','9827']`
  - `dammDigit(digits: string): number`（`c=0` から左へ `c = T[c][digit]`。表は 03 3-2・D5 2-16 の `T` をそのまま）
  - `isValidRef(code: string): boolean`（`/^[1-9]\d{3}$/` かつ4けたを通した `c === 0`）
  - `pickRef(used: ReadonlySet<string>, skip: readonly string[], rand: () => number): string | null`（100〜999 に検査の数字を付けた900個から、`RESERVED_REFS`・`skip`・`used` を除いた並び〔小さい順〕の `Math.floor(rand() × 長さ)` 番目。空なら `null`）
  - `readRefFromDesc(descRaw: string): { ref: string | null; refOk: boolean; nameRaw: string; descNorm: string }`

摘要の読み方（D5 2-16・K140）：
1. `descNorm` ＝ `descRaw.normalize('NFKC')` から空白（`\s`）を全部取った物。
2. `descNorm` が「振込」で始まるときだけ、それを外して続ける。始まらなければ `ref: null`・`nameRaw: descNorm`。
3. 残りが `/^(\d{4})(?!\d)/` に合えば `ref` ＝その4つ。すぐあとの区切り1文字（`-‐‑‒–—―−ー・.,、。/` のどれか）は取る。その後ろが `nameRaw`。
4. 合わなければ（3けた・5けた以上・名前の後ろの数字）`ref: null`、`nameRaw` ＝「振込」を外した残り全部。
5. 後ろの口座番号などの数字は読まない（`nameRaw` に残るだけ）。`refOk = ref !== null && isValidRef(ref)`。
- `nameRaw` は NFKC と空白を取ったあとの文字（`payer_name_raw` にもこれを入れる。もとの摘要は `bank_desc` に残る）。
- 摘要の本当の形は、TARO の試しの振込（U41・U42。12/4 ごろ）で確かめる。形がちがったら、この関数と試験だけを直す（ほかのタスクは変えない）。ここでは上の形で作る。

- [ ] **Step 1: 失敗する試験を書く**（`src/lib/__tests__/recitalRef.test.ts`）

```ts
import { describe, it, expect } from 'vitest';
import { dammDigit, isValidRef, pickRef, readRefFromDesc, RESERVED_REFS } from '../recitalRef';

const ALL = Array.from({ length: 900 }, (_, i) => `${i + 100}${dammDigit(String(i + 100))}`);

describe('検査の数字（Damm）', () => {
  it.each([['100', '1007'], ['123', '1234'], ['572', '5724'], ['905', '9054'], ['999', '9990'], ['482', '4823']])(
    '%s → %s', (three, code) => { expect(`${three}${dammDigit(three)}`).toBe(code); expect(isValidRef(code)).toBe(true); });
  it('4827・8427・4287 は合わない。形のちがう物も合わない', () => {
    for (const c of ['4827', '8427', '4287', '0007', '100', '10070', '１００７', 'abcd']) expect(isValidRef(c)).toBe(false);
  });
  it('1けたの打ちまちがい 32,400通りを全部見つける', () => {
    let n = 0, miss = 0;
    for (const c of ALL) for (let p = 0; p < 4; p++) for (const d of '0123456789') {
      if (d === c[p]) continue; n++;
      if (isValidRef(c.slice(0, p) + d + c.slice(p + 1))) miss++;
    }
    expect([n, miss]).toEqual([32400, 0]);
  });
  it('となりどうしの入れかえ 2,430通りを全部見つける', () => {
    let n = 0, miss = 0;
    for (const c of ALL) for (let p = 0; p < 3; p++) {
      if (c[p] === c[p + 1]) continue; n++;
      if (isValidRef(c.slice(0, p) + c[p + 1] + c[p] + c.slice(p + 2))) miss++;
    }
    expect([n, miss]).toEqual([2430, 0]);
  });
});

describe('出す（pickRef）', () => {
  it('欠番10個はどれも検査に合う番号で、出さない', () => {
    expect(RESERVED_REFS).toHaveLength(10);
    for (const r of RESERVED_REFS) expect(isValidRef(r)).toBe(true);
  });
  it('使い切るまで出すと 890個（ref_skip の検査に合う分だけ減る）。欠番・skip・使用ずみを出さず、重ならない', () => {
    const skip = ['2008', '3009', '4827', 'abc'];
    const used = new Set<string>();
    let seed = 7;
    const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let r = pickRef(used, skip, rand); r !== null; r = pickRef(used, skip, rand)) {
      expect(isValidRef(r)).toBe(true);
      expect(RESERVED_REFS).not.toContain(r);
      expect(['2008', '3009']).not.toContain(r);
      expect(used.has(r)).toBe(false);
      used.add(r);
    }
    expect(used.size).toBe(888);
  });
  it('rand=0 は空いている中でいちばん小さい番号（1007 は欠番なので 1010）', () => {
    expect(pickRef(new Set(), [], () => 0)).toBe('1010');
    expect(pickRef(new Set(['1010']), [], () => 0)).toBe('1029');
  });
  it('使い切ったら null', () => {
    expect(pickRef(new Set(ALL), [], () => 0)).toBeNull();
  });
});

describe('摘要から読む（D5 2-16 の読む位置）', () => {
  it.each([
    ['振込 4827 ヤマダ ハナコ', '4827', false, 'ヤマダハナコ'],
    ['振込１００７－ヤマダハナコ', '1007', true, 'ヤマダハナコ'],
    ['振込　4823・ﾔﾏﾀﾞ ﾊﾅｺ', '4823', true, 'ヤマダハナコ'],
    ['振込 4823ヤマダハナコ 0123456', '4823', true, 'ヤマダハナコ0123456'],
    ['振込 482 ヤマダハナコ', null, false, '482ヤマダハナコ'],
    ['振込 48231 ヤマダハナコ', null, false, '48231ヤマダハナコ'],
    ['振込 ヤマダハナコ 4823', null, false, 'ヤマダハナコ4823'],
    ['2714 ヤマダハナコ', null, false, '2714ヤマダハナコ'],   // 頭に「振込」が無ければ番号を読まない（決まり。読む役は Task 30 で「振込」から写す）
    ['ヤマダハナコ 4823', null, false, 'ヤマダハナコ4823'],
  ] as const)('%s', (raw, ref, ok, name) => {
    const r = readRefFromDesc(raw);
    expect([r.ref, r.refOk, r.nameRaw]).toEqual([ref, ok, name]);
    expect(r.descNorm).not.toMatch(/\s/);
  });
});
```

- [ ] **Step 2: 試験を回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalRef.test.ts`
Expected: FAIL（`Cannot find module '../recitalRef'`）

- [ ] **Step 3: `src/lib/recitalRef.ts` を書く**

Interfaces と「摘要の読み方」のとおり。表 `T` は設計書のまま10行を写す（行と列を取りちがえない：`T[今の c][けたの数字]`）。ファイルの頭に1行「例の番号は 4827（検査に合わない）。これより外の番号・名前を例に作らない（D5 2-16）」。

- [ ] **Step 4: 試験を回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalRef.test.ts`
Expected: PASS（全部）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recitalRef.ts src/lib/__tests__/recitalRef.test.ts
git commit -m "feat(bw6): 整理番号（Damm）の検査・出し方・摘要からの読み方" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `recitalMatch.ts`（会員照合・特別な料金の事前登録の照らし合わせ・生年月日の形）

**Files:**
- Create: `src/lib/recitalMatch.ts`
- Test: `src/lib/__tests__/recitalMatch.test.ts`

**Interfaces:**
- Consumes: `normalizeKana(s: string): string`（**`@/lib/csvUtil` から**。同じ名前が `party.ts`・`referral.ts`・`linkSuggest.ts` にもあるので取りちがえない）／`import type { FeeClass } from './recital'`（`import type` で書く）
- Produces（`src/lib/recitalMatch.ts`）：
  - `type MemberLite = { id: number; fullName: string | null; fullNameKana: string | null; birthday: string | null; status: string | null }`。**`status` の値の約束**：`'active'`／`'withdrew'`（退会。`boom_members.status` のまま）／`'leave'`（休会。Task 6 の `loadMembersLite` が `boom_members.member_type = '休会'` のとき `'leave'` を入れる。会員を詰めるのは全部その関数）
  - `type MemberMatch = { status: 'auto' | 'pending' | 'unmatched'; memberId: number | null; candidateIds: number[]; warn: 'leave' | 'withdrawn' | null }`
  - `normalizeBirthday(s: string | null | undefined): string | null`（→ `'YYYY-MM-DD'`。実在しない日・読めない形は `null`）
  - `matchMember(p: { lastKana: string; firstKana: string; lastName: string; firstName: string; birthday: string | null }, members: MemberLite[]): MemberMatch`
  - `matchFeePreset(p: { lastKana: string; firstKana: string; lastName: string; firstName: string; birthday: string | null }, presets: { memberId: number; feeClass: Exclude<FeeClass, null> }[], members: MemberLite[]): { feeClass: Exclude<FeeClass, null>; memberId: number } | { suspect: true } | null`（③の型に `lastName`・`firstName` を足した。「漢字の名前だけ合う」を見るため。最後の「足した名前」に書いた）
  - `match_status` の `none`・`manual` はスタッフが決める値なので、この関数は返さない。

決めたこと（05 5-8・03 3-7・D4 2-10・直し8）：
- カナをそろえる：`normalizeKana(s.normalize('NFKC'))`（NFKC で半角カナ・全角英数をそろえ、`normalizeKana` でひらがな→カタカナ・空白と中点と長音を取る・ヅ→ズ・ヂ→ジ）。人は `lastKana + firstKana`、会員は `fullNameKana`。空になったら合わない扱い。
- 漢字の名前：`(s ?? '').normalize('NFKC').replace(/\s/g, '')`。人は `lastName + firstName`、会員は `fullName`。
- `matchMember`：①カナが同じ会員を集める ②そのうち生年月日（両方 `normalizeBirthday` 済み）も同じ人がちょうど1人 → `auto`（`memberId` と `candidateIds:[id]`）③両方合う人が2人以上 → `pending`（その人たち）④カナだけ合う人がいる（生年月日がちがう・会員の誕生日が空・人の誕生日が空）→ `pending`（カナの合った人たち）⑤カナはだれとも合わないが漢字の名前が合う人がいる → `pending`（その人たち）⑥ほか → `unmatched`（`[]`）。`warn` は `auto` のときだけ、会員の `status` が `'withdrew'` なら `'withdrawn'`、`'leave'` なら `'leave'`。
- `matchFeePreset`：事前登録の会員だけを相手に、①カナと生年月日の両方が合う登録の会員がちょうど1人 → `{ feeClass, memberId }` ②両方合うのが2人以上・カナだけ合う・漢字だけ合う、のどれか → `{ suspect: true }` ③ほか → `null`。登録の無い会員とだけ合っても `null`（勝手に安くしない）。
- `normalizeBirthday` が読む形：`YYYY-MM-DD`・`YYYY-M-D`・`YYYY/MM/DD`・`YYYY/M/D`・`YYYYMMDD`・`YYYY年M月D日`（全角数字も NFKC で読む）、後ろに時刻（` 00:00:00`・`T…`）が付いていても日付だけ読む。日の順が分からない形（`MM/DD/YYYY` など）は `null`。

- [ ] **Step 1: 本番の `boom_members.birthday` の形ごとの件数を数える（U12。読むだけ。値は出さない）**

Run（アプリのフォルダで）:
```bash
node --env-file=.env.production.local --input-type=module -e "import {createClient} from '@libsql/client'; const c=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN}); const r=await c.execute('SELECT birthday FROM boom_members'); const m={}; for (const x of r.rows){const s=x.birthday==null?'NULL':String(x.birthday).replace(/[0-9]/g,'9'); m[s]=(m[s]||0)+1} console.log(m)"
```
Expected: `{ '9999-99-99': …, NULL: … }` のような「形 → 件数」だけが出る（数字は全部 9 に置きかわるので、個人の値は出ない）。件数は記録に書いてよいが、値は書かない。
上の「読む形」に無い形が出たら、作る前に止まって、形と件数を知らせる（自分で読み方を決めない）。全部が「読む形」に入っていれば、そのまま Step 2 へ。

- [ ] **Step 2: 失敗する試験を書く**（`src/lib/__tests__/recitalMatch.test.ts`）

```ts
import { describe, it, expect } from 'vitest';
import { matchMember, matchFeePreset, normalizeBirthday, type MemberLite } from '../recitalMatch';

const m = (id: number, fullName: string, fullNameKana: string, birthday: string | null, status = 'active'): MemberLite =>
  ({ id, fullName, fullNameKana, birthday, status });
const P = (over: Partial<{ lastKana: string; firstKana: string; lastName: string; firstName: string; birthday: string | null }> = {}) =>
  ({ lastKana: 'ヤマダ', firstKana: 'ハナコ', lastName: '山田', firstName: '花子', birthday: '2015-04-03', ...over });

describe('生年月日の形', () => {
  it.each([
    ['2015-04-03', '2015-04-03'], ['2015-4-3', '2015-04-03'], ['2015/04/03', '2015-04-03'], ['2015/4/3', '2015-04-03'],
    ['20150403', '2015-04-03'], ['2015年4月3日', '2015-04-03'], ['２０１５－０４－０３', '2015-04-03'],
    ['2015-04-03 00:00:00', '2015-04-03'], ['2015-04-03T00:00:00.000Z', '2015-04-03'],
  ])('%s → %s', (s, want) => expect(normalizeBirthday(s)).toBe(want));
  it.each([[null], [''], ['2015-02-30'], ['04/03/2015'], ['不明']])('%s → null', (s) => expect(normalizeBirthday(s)).toBeNull());
});

describe('会員照合（05 5-8 の表）', () => {
  it('自動で合った：カナと生年月日が両方合う会員が1人だけ', () => {
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015/4/3'), m(2, '山田 太郎', 'ヤマダ タロウ', '2013-01-01')]))
      .toEqual({ status: 'auto', memberId: 1, candidateIds: [1], warn: null });
  });
  it('カナのゆれ（ひらがな・空白・半角・ヅ/ズ）はそろえて合わせる', () => {
    const mem = [m(1, '山田 花子', 'ヤマダ　ハナコ', '2015-04-03')];
    expect(matchMember(P({ lastKana: 'やまだ', firstKana: ' はなこ' }), mem).status).toBe('auto');
    expect(matchMember(P({ lastKana: 'ﾔﾏﾀﾞ', firstKana: 'ﾊﾅｺ' }), mem).status).toBe('auto');
    expect(matchMember(P({ firstKana: 'ミヅキ' }), [m(3, '山田 美月', 'ヤマダ ミズキ', '2015-04-03')]).status).toBe('auto');
  });
  it('確認待ち：生年月日がちがう／会員の誕生日が空／候補2人以上／漢字だけ合う', () => {
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-04')])).toMatchObject({ status: 'pending', memberId: null, candidateIds: [1] });
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', null)])).toMatchObject({ status: 'pending', candidateIds: [1] });
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-03'), m(2, '山田 華子', 'ヤマダ ハナコ', '2015-04-03')]))
      .toMatchObject({ status: 'pending', candidateIds: [1, 2] });
    expect(matchMember(P(), [m(5, '山田 花子', 'ヤマダ ハナ', '2015-04-03')])).toMatchObject({ status: 'pending', candidateIds: [5] });
  });
  it('合わない：どれも合わない', () => {
    expect(matchMember(P(), [m(1, '佐藤 一郎', 'サトウ イチロウ', '2015-04-03')]))
      .toEqual({ status: 'unmatched', memberId: null, candidateIds: [], warn: null });
  });
  it('退会・休会の人と自動で合ったら警告（止めない）', () => {
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-03', 'withdrew')]).warn).toBe('withdrawn');
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-03', 'leave')]).warn).toBe('leave');
  });
});

describe('特別な料金の事前登録（D4 2-10・直し8）', () => {
  const members = [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-03'), m(2, '佐藤 一郎', 'サトウ イチロウ', '2010-10-10')];
  it('カナと生年月日の両方が合う登録の会員が1人だけなら、その種類', () => {
    expect(matchFeePreset(P(), [{ memberId: 1, feeClass: 'no_coop' }], members)).toEqual({ feeClass: 'no_coop', memberId: 1 });
  });
  it('カナだけ合う・生年月日が空・漢字だけ合う・2人以上は suspect（印は入れない）', () => {
    expect(matchFeePreset(P({ birthday: '2015-04-04' }), [{ memberId: 1, feeClass: 'free' }], members)).toEqual({ suspect: true });
    expect(matchFeePreset(P({ birthday: null }), [{ memberId: 1, feeClass: 'free' }], members)).toEqual({ suspect: true });
    expect(matchFeePreset(P({ firstKana: 'ハナ' }), [{ memberId: 1, feeClass: 'free' }], members)).toEqual({ suspect: true });
    const twins = [...members, m(3, '山田 華子', 'ヤマダ ハナコ', '2015-04-03')];
    expect(matchFeePreset(P(), [{ memberId: 1, feeClass: 'free' }, { memberId: 3, feeClass: 'tshirt_only' }], twins)).toEqual({ suspect: true });
  });
  it('登録の無い会員とだけ合う・だれとも合わないなら null', () => {
    expect(matchFeePreset(P(), [{ memberId: 2, feeClass: 'free' }], members)).toBeNull();
    expect(matchFeePreset(P({ lastKana: 'スズキ', lastName: '鈴木' }), [{ memberId: 1, feeClass: 'free' }], members)).toBeNull();
  });
});
```

（Step 1 で「読む形」に入る別の形が出たときは、その形の行を `生年月日の形` の表に1行足してから進める。）

- [ ] **Step 3: 試験を回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalMatch.test.ts`
Expected: FAIL（`Cannot find module '../recitalMatch'`）

- [ ] **Step 4: `src/lib/recitalMatch.ts` を書く**

Interfaces と「決めたこと」のとおり。`normalizeBirthday` は形を読んだあと `Date.UTC` で作り直して年月日が同じかを見る（実在しない日を `null` に）。候補の `candidateIds` は会員の `id` の小さい順。

- [ ] **Step 5: 試験を回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalMatch.test.ts`
Expected: PASS（全部）

- [ ] **Step 6: コミット**

```bash
git add src/lib/recitalMatch.ts src/lib/__tests__/recitalMatch.test.ts
git commit -m "feat(bw6): 会員照合（カナ＋生年月日）と特別な料金の事前登録の照らし合わせ" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### このまとまりから Review Focus に出す候補（計画の頭の Review Focus へ）

1. 設定の日時の文字が形ちがい（`2026/12/15 12:00`・時刻なしの締切）→ 受付も「払う」も開かない側に倒れること。Task 2 の「日時の設定が読めなければ開けない」と `jstToMs` の `NaN` の試験で押さえた。
2. 種の書き忘れ（`suspended`・`stripe_mode` が無い発表会）→ 受付は止まったまま・試しの鍵。Task 2 の「空なら初めの値」の試験で押さえた。
3. 全角・半角・空白まじりの摘要や名前（`１００７－`・`ﾔﾏﾀﾞ`・`やまだ はなこ`）→ 同じ物として読む。Task 4・Task 5 の表で押さえた。
4. `adjust` の下げる行が残ったまま全部やめた世帯 → 合計0で「お支払いずみの分」が払った額より大きく出ない。Task 2 の K228 の試験と Task 3 の場面20で押さえた。
5. 同時に作った2つ目の「開いている支払い」・同じ Stripe の知らせ・同じ明細の行 → 表の部分一意で弾く。Task 1 の (c) で押さえた（書き込み側の扱いは 7・21・22・27 の試験）。

### 足した名前（名前の正本③に無かった物）

- 索引の名前（Task 1）：`idx_recital_bank_rows_state`・`idx_recital_casts_work`・`idx_recital_changes_household`・`idx_recital_charges_household`・`idx_recital_fee_rules_event`・`idx_recital_households_email`・`idx_recital_households_phone`・`idx_recital_mail_log_household`・`idx_recital_payments_bankrow`・`idx_recital_payments_household`・`idx_recital_people_household`・`idx_recital_refunds_household`・`idx_recital_work_classes_work`・`idx_recital_work_instructors_work`・`ux_recital_bank_rows_key`・`ux_recital_casts_pw`・`ux_recital_checkouts_open`・`ux_recital_checkouts_pi`・`ux_recital_checkouts_session`・`ux_recital_fee_presets_member`・`ux_recital_households_ref`・`ux_recital_households_seq`・`ux_recital_households_submit`・`ux_recital_households_token`・`ux_recital_instructor_links_token`・`ux_recital_mail_log_dedupe`・`ux_recital_payments_event`・`ux_recital_payments_pi`・`ux_recital_payments_session`・`ux_recital_people_ext`・`ux_recital_people_seq`・`ux_recital_works_code`
- `matchFeePreset` の引数 `p` に `lastName`・`firstName` を足した（③は `lastKana`・`firstKana`・`birthday` だけ。「漢字の名前だけ合う」を suspect にするため。Task 7 は `matchMember` と同じ `p` を渡す）
- `MemberLite.status` の値の約束 `'active' | 'withdrew' | 'leave'`（`'leave'` は Task 6 の `loadMembersLite` が `member_type = '休会'` から入れる）
- Task 2 に移した・足した名前：`RECITAL_PUBLIC_ORIGIN`・`recitalMyUrl`（家庭に渡すマイページの URL。10・14・19・21 が使う）、`checkSettingValue`（設定の値の確かめ。6 と 18 が使う）、`normalizePhone`・`normalizeEmail`（7・13・16 が使う）
- 試験のDBの置き場 `./data/test_recital_schema.db`（Task 1）
- 学年の言葉 `未就学`・`年少`・`年中`・`年長`・`小1`〜`小6`・`中1`〜`中3`・`高1`〜`高3`・`大人`（`schoolGrade` の返す値。設計書に形が無いので決めた）

---

## まとまり「申」：申込の書き込み・お金の核・メール・データ（タスク 6〜11）

このまとまりは、家・ス・払・振の全部が呼ぶ「書き込みの核」を作る。画面は作らない。
並び：**6 → 7・8・9・10 → 11（11 の種の後半は 12/13（日））**。ただし同じファイルをさわるので、**8 は 7 のコミットの後**（どちらも `recitalEntryDb.ts`）、**11 は 6 の後**（どちらも `recitalDb.ts`）。9 と 10 は 7 と並べて進めてよい。
7・8 は 9（`afterMoneyChanged`）と 10（`sendRecitalMail`）を呼ぶ。試験ではこの2つを `vi.mock` で差しかえる。9・10 のファイルがまだ無くて読み込みで落ちるときは、**中身を自分で作らずに止まって知らせる**。

正本：名前は `bw6-plan/split.md` の③、列は設計書 03 3-4・3-9、値の言葉は決まりの紙 6-1・6-3。数字の例は設計書 05 のまま試験に入れる。

### このまとまりで気をつける所（Review Focus の候補。各行の試験は持ち主のタスクに足してある）
1. メールアドレスの大文字・小文字、前後の空白だけがちがう2回目の申込 → 同じメールとして止まる（Task 7 `same email ignores case and spaces`）。
2. 別の発表会の作品の番号を送ってきた／直しで指定した → 受けない（Task 7 `rejects work of another event`、Task 8 `rejects work of another event`）。
3. 別の発表会の台帳行を指した入金 → 書かない（Task 9 `rejects bank row of another event`）。
4. 夜21:00ちょうどに当たった振込の確認メール → 待ちにせず送る（Task 10 `21:00 sends`）。
5. 変えた記録の前後の中に、入れ子でメール・生年月日が入っている（家族の配列など）→ 入れ子でも残さない（Task 6 `redacts nested values`）。

---

### Task 6: 読む物・設定・作品・変えた記録（`recitalDb.ts`）と試しの種

**Files:**
- Create: `src/lib/recitalDb.ts`
- Create: `src/lib/__tests__/recitalTestSeed.ts`（試験の下ごしらえ。`*.test.ts` ではないので単独では回らない）
- Create: `scripts/migrations/20261114_recital_seed_test.sql`
- Test: `src/lib/__tests__/recitalDb.test.ts`

**Interfaces:**
- Consumes: Task 1 の表（`recital_*` の19表）。Task 2 の `RecitalSettings`・`parseRecitalSettings`・`RECITAL_SETTING_DEFAULTS`・`RECITAL_SETTING_KEYS_LOCKED`・`checkSettingValue`・`moneySummary`・`householdView`・`HouseholdView`・`MoneySummary`。Task 3 の `feeCheck`・`FeeRule`。Task 5 の `MemberLite`。`@/lib/db` の `execute`・`getAll`・`getOne`・`batch`・`withWriteTx`、`@/lib/dateJst` の `nowUtcIso`。
- Produces（家・ス・払・振と 7〜11 が使う）:
  - `type RecitalEvent = { event_key: string; title: string; show_date: string; rehearsal_date: string; venue: string; is_test: number }`
  - `type HouseholdRow / PersonRow / CastRow / ChargeRow / PaymentRow / RefundRow / MailRow / ChangeRow / WorkRow` … 各表の列そのまま（snake_case）
  - `type WorkInput = { id?: number; kind: string; title: string; class_label: string; slot_label: string; target_label: string; genre: string; entry_mode: 'form'|'staff'|'none'; fee_type: 'counted'|'not_counted'|'extra'|'separate'; extra_fee: number|null; capacity: number|null; status: 'draft'|'open'|'fixed'|'dropped'; merged_into: number|null; public_note: string; staff_note: string; sort_order: number; classes: { lesson_master_id: number|null; label: string }[]; instructors: { instructor_id: number|null; display_name: string; role: 'choreo'|'perform'|'assist'; sort_order: number }[] }`（足した名前）
  - `type HouseholdDetail = { household; people; casts; charges; payments; refunds; mails; changes; money: MoneySummary; view: HouseholdView; refundTodo: number }`
  - `getRecitalEvent(eventKey): Promise<RecitalEvent|null>`
  - `getRecitalSettings(eventKey): Promise<RecitalSettings>`（行が無い鍵は初めの値）
  - `saveRecitalSetting(eventKey, key, value, staffName): Promise<void>`。投げる `Error.message`：`'recital_setting:locked'`（`pay_ok_at`・`bank_audit_done_at`）／`'recital_setting:unknown'`（`RECITAL_SETTING_DEFAULTS` に無い鍵）／`'recital_setting:bad_value'`（形ちがい）
  - `setPayOk(eventKey, staffName): Promise<void>`
  - `setSuspended(eventKey, on, staffName): Promise<{ ok: boolean; reason?: 'fee_check'|'tentative'|'consent_empty'|'privacy_empty'|'line_empty' }>`
  - `listFeeRules(eventKey): Promise<(FeeRule & { id: number })[]>`（`recital_fee_rules` を `sort_order, id` の順。7・12・13・18 が使う。ほかのファイルに同じ関数を作らない）
  - `loadMembersLite(): Promise<MemberLite[]>`（足した名前。`boom_members` の `id, full_name, full_name_kana, birthday, status, member_type` を読み、`member_type`='休会' なら `status`='leave'、`status`='withdrew' はそのまま。会員を `MemberLite` に詰めるのは 7・13・16・18・20 の全部がこれを使う。自分で詰めない）
  - `listWorks(eventKey): Promise<WorkRow[]>`・`saveWork(eventKey, w: WorkInput, staffName): Promise<{ id: number; workCode: string }>`・`listWorkCounts(eventKey): Promise<Map<number, { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean }>>`
  - `loadHouseholdDetail(householdId): Promise<HouseholdDetail|null>`
  - `logChangeTx(tx, c): Promise<void>`（split.md ③の型）
  - 試験の決まり：DB の試験は、自分の `event_key`（`t-xxx`）の行だけを見る。試験のDBには台帳SQLが全部流れるので、種の `bw6-test`（と 12/13 からは `bw6`・`bw6-smoke`）の行も入っている。「`is_test=0` の発表会を全部回す」関数の試験は、数の期待に種の行を含めるか、`event_key` でしぼって数える。
  - 試験の下ごしらえ（足した名前）：`setupRecitalTestDb(name: string): Promise<void>`・`seedRecitalTestEvent(eventKey: string, opts?: { isTest?: 0|1; settings?: Record<string,string> }): Promise<{ workIds: Record<string, number> }>`・`seedHousehold(eventKey: string, opts: { total: number; cast: 'in'|'maybe'|'out'; payMethod?: string|null }): Promise<number>`

- [ ] **Step 1: 試験の下ごしらえ `recitalTestSeed.ts` を書く**

  中身は3つ。どれも `../db` を**関数の中で** `await import` する（環境変数を先に入れるため）。
  - `setupRecitalTestDb(name)`：`process.env.TURSO_DATABASE_URL = 'file:./data/test_recital_<name>.db'`、`delete process.env.TURSO_AUTH_TOKEN`・`delete process.env.SKIP_DB_INIT`、そのファイルと `-shm`・`-wal` を消す → `initDb()` → `scripts/migrations/*.sql` を名前順に全部流す（`bf7EntryDb.test.ts` 1〜25行と同じ。`--` で始まる行を除き `;` で割る。失敗は飛ばす）。
  - `seedRecitalTestEvent(eventKey, opts)`：`recital_events` に1行（`is_test` は既定 1、`title` は `'試し'`、`show_date` `'2027-04-11'`、`rehearsal_date` `'2027-04-10'`、`venue` `'若林区文化センター'`）。設定の行：`entry_open_at`=`'2026-11-01 00:00'`・`pay_open_at`=`'2026-11-01 00:00'`・`pay_ok_at`=`'2026-11-01 00:00'`・`suspended`=`'0'`・`stripe_mode`=`'test'`・`test_mail_to`=`'test@example.com'`・`mail_bcc_staff`=`'0'`・`bank_text`=`'TEST-BANK-TEXT'`・`consent_items`=`'同意の文（試し）'`、そのあと `opts.settings` で上書き。料金の規則8行（03 3-4 の表そのまま：first base 1〜1 16000×1／first tshirt 1〜1 3000×1／first coop_ticket 1〜1 2500×3／first add_work 2〜2 6000×1／first add_work 3〜NULL 3000×1／family base 1〜1 5000×1／family tshirt 1〜1 3000×1／family add_work 2〜NULL 3000×1、`is_tentative` 0）。作品12本（`work_code` と中身）：`W01`〜`W07`＝`counted`・`form`・`open`／`W08`＝`not_counted`・`form`・`open`／`W09`＝`counted`・`form`・`draft`／`W10`＝`counted`・`staff`・`open`／`W11`＝`extra`・`extra_fee` 3000・`form`・`open`／`W12`＝`separate`・`none`・`open`。題は `'作品A'` のような仮の名前。返り値は `work_code`→`id`。
  - `seedHousehold(eventKey, opts)`：世帯1つ（`seq`・`ref_code` は発表会の中の最大+1。`ref_code` は `String(1000+seq)`。`edit_token` は48けた hex、`email` は `'h<seq>@example.com'`）、人1人、`W01` への出演1つ（`opts.cast`）、`opts.total>0` なら `item_code='base'` で額 `opts.total` の請求1行。返り値は世帯の id。

- [ ] **Step 2: 落ちる試験 `recitalDb.test.ts` を書く**

```ts
// 頭：await setupRecitalTestDb('db'); のあと const db = await import('../recitalDb');
describe('getRecitalSettings', () => {
  it('行が無い発表会は初めの値（03 3-4）', async () => {
    const s = await db.getRecitalSettings('t-db-empty');
    expect(s.entry_open_at).toBe('2026-12-15 12:00');
    expect(s.entry_close_at).toBe('2027-01-31 23:59');
    expect(s.change_close_at).toBe('2027-01-31 23:59');
    expect(s.pay_open_at).toBe('2026-12-15 12:00');
    expect(s.pay_ok_at).toBeNull();
    expect(s.pay_due).toBe('2027-02-10');
    expect(s.max_works_per_person).toBe(5);
    expect(s.min_self_apply_age).toBe(18);
    expect(s.fee_check_first).toEqual([26500, 32500, 35500, 38500, 41500]);
    expect(s.fee_check_family).toBe(8000);
    expect([s.goal_people, s.breakeven_people, s.cap_people]).toEqual([150, 77, 175]);
    expect(s.tshirt_sizes).toEqual(['130','140','150','S','M','L','XL','XXL','XXXL']);
    expect(s.bank_ask_at).toEqual(['19:00', '20:30']);
    expect([s.bank_rest_from, s.bank_rest_to]).toEqual(['2026-12-30', '2027-01-03']);
    expect(s.pay_remind_stop_hours).toBe(15);
    expect(s.bank_close_on).toBe('2027-03-31');
    expect(s.mail_bcc_staff).toBe(false);
    expect(s.bank_text).toBe('');
    expect(s.ref_skip).toEqual([]);
  });
  it('種 bw6-test は試しの鍵・受付中・支払いを開けてある', async () => {
    const s = await db.getRecitalSettings('bw6-test');
    expect(s.stripe_mode).toBe('test');
    expect(s.suspended).toBe(false);
    expect(s.pay_ok_at).not.toBeNull();
    expect((await db.getRecitalEvent('bw6-test'))?.is_test).toBe(1);
  });
});
describe('saveRecitalSetting', () => {
  it('pay_ok_at と bank_audit_done_at は欄から直せない', async () => {
    await seedRecitalTestEvent('t-db-set');
    await expect(db.saveRecitalSetting('t-db-set', 'pay_ok_at', '2026-12-15 12:00', 'TARO')).rejects.toThrow('recital_setting:locked');
    await expect(db.saveRecitalSetting('t-db-set', 'bank_audit_done_at', '2027-02-12 20:00', 'TARO')).rejects.toThrow('recital_setting:locked');
  });
  it('知らない鍵・形ちがいは拒む／ふつうの鍵は保存して直した人が残る', async () => {
    await expect(db.saveRecitalSetting('t-db-set', 'fee_lock', '1', 'TARO')).rejects.toThrow('recital_setting:unknown');
    await expect(db.saveRecitalSetting('t-db-set', 'entry_close_at', '1/31', 'TARO')).rejects.toThrow('recital_setting:bad_value');
    await db.saveRecitalSetting('t-db-set', 'ref_skip', '2003', 'TARO');
    expect((await db.getRecitalSettings('t-db-set')).ref_skip).toEqual(['2003']);
  });
  it('setPayOk は pay_ok_at を入れて pay_opened を残す（2回目は変えない）', async () => {
    // 下ごしらえが入れた pay_ok_at を消してから（core は '../db'）
    await core.execute("DELETE FROM recital_settings WHERE event_key='t-db-set' AND key='pay_ok_at'");
    await db.setPayOk('t-db-set', 'TARO');
    const first = (await db.getRecitalSettings('t-db-set')).pay_ok_at;
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await db.setPayOk('t-db-set', 'TARO');
    expect((await db.getRecitalSettings('t-db-set')).pay_ok_at).toBe(first);
    const n = await core.getOne("SELECT COUNT(*) n FROM recital_changes WHERE event_key='t-db-set' AND action='pay_opened'");
    expect(Number(n.n)).toBe(1);
  });
});
describe('setSuspended', () => {
  // 下ごしらえの種は privacy_text・line_url を入れないので、ここで入れる
  const ready = { suspended: '1', privacy_text: '使い道の知らせ（試し）', line_url: 'https://example.invalid/line' };
  it('仮の金額の行があれば開けない → tentative', async () => {
    await seedRecitalTestEvent('t-db-sus1', { settings: ready });
    await core.execute("UPDATE recital_fee_rules SET is_tentative=1 WHERE event_key='t-db-sus1' AND item_code='tshirt' AND payer_role='first'");
    expect(await db.setSuspended('t-db-sus1', false, 'TARO')).toEqual({ ok: false, reason: 'tentative' });
  });
  it('検算が合わなければ開けない → fee_check', async () => {
    await seedRecitalTestEvent('t-db-sus2', { settings: { ...ready, fee_check_first: '26500,32500,35500,38500,41000' } });
    expect(await db.setSuspended('t-db-sus2', false, 'TARO')).toEqual({ ok: false, reason: 'fee_check' });
  });
  it.each([
    ['consent_items', 'consent_empty'], ['privacy_text', 'privacy_empty'], ['line_url', 'line_empty'],
  ])('%s が空なら開けない → %s', async (key, reason) => {
    const ev = 't-db-sus-' + key;
    await seedRecitalTestEvent(ev, { settings: { ...ready, [key]: ' ' } });
    expect(await db.setSuspended(ev, false, 'TARO')).toEqual({ ok: false, reason });
  });
  it('そろえば suspended=0 と entry_opened、止めると 1 と entry_suspended', async () => {
    await seedRecitalTestEvent('t-db-sus3', { settings: ready });
    expect(await db.setSuspended('t-db-sus3', false, 'TARO')).toEqual({ ok: true });
    expect((await db.getRecitalSettings('t-db-sus3')).suspended).toBe(false);
    expect(await db.setSuspended('t-db-sus3', true, 'TARO')).toEqual({ ok: true });
    expect((await db.getRecitalSettings('t-db-sus3')).suspended).toBe(true);
    const acts = (await core.getAll("SELECT action FROM recital_changes WHERE event_key='t-db-sus3' ORDER BY id")).map((r) => r.action);
    expect(acts).toEqual(['entry_opened', 'entry_suspended']);
  });
});
describe('loadMembersLite', () => {
  it('休会は leave・退会は withdrew', async () => {
    await core.execute("INSERT INTO boom_members (hacomono_member_id, full_name, full_name_kana, birthday, status, member_type) VALUES ('t-lite-1','テスト キュウ','テスト キュウ','2014-01-01','active','休会')");
    const m = (await db.loadMembersLite()).find((x) => x.fullName === 'テスト キュウ');
    expect(m?.status).toBe('leave');
  });
});
describe('saveWork', () => {
  it('W番号は登録順・取りやめても詰めない・直しても変わらない', async () => {
    await seedRecitalTestEvent('t-db-work'); // W01〜W12 がある
    const a = await db.saveWork('t-db-work', workInput({ title: '新しい作品' }), 'TARO');
    expect(a.workCode).toBe('W13');
    await db.saveWork('t-db-work', workInput({ id: a.id, status: 'dropped' }), 'TARO');
    const b = await db.saveWork('t-db-work', workInput({ title: 'もう1つ' }), 'TARO');
    expect(b.workCode).toBe('W14');
    const again = await db.saveWork('t-db-work', workInput({ id: b.id, title: '名前を直した' }), 'TARO');
    expect(again.workCode).toBe('W14');
  });
});
describe('logChangeTx', () => {
  it('メール・電話・生年月日・インスタ・名義の値は残さない', async () => {
    await core.withWriteTx((tx) => db.logChangeTx(tx, {
      eventKey: 't-db-log', action: 'contact_edit', actor: 'TARO', reason: 'LINEで聞いた',
      before: { email: 'old@example.com', phone: '09011112222', last_name: 'テスト' },
      after: { email: 'new@example.com', phone: '09033334444', birthday: '2015-04-02', insta_handle: 'abc_1', bank_told_name: '4827 ヤマダ ハナコ', name: '4827 ヤマダ ハナコ', bank_told_amount: 26500 },
    }));
    const r = await core.getOne("SELECT before_json, after_json FROM recital_changes WHERE event_key='t-db-log'");
    const all = String(r.before_json) + String(r.after_json);
    for (const v of ['example.com', '0901111', '0903333', '2015-04-02', 'abc_1', 'ヤマダ ハナコ']) expect(all).not.toContain(v);
    expect(all).toContain('テスト');   // 名前（姓・名）は残してよい
    expect(all).toContain('26500');    // 「振り込みました」の金額は値のまま
  });
  it('redacts nested values', async () => {
    await core.withWriteTx((tx) => db.logChangeTx(tx, { eventKey: 't-db-log2', action: 'apply', actor: 'family', after: { people: [{ birthday: '2014-05-06', email: 'k@example.com' }] } }));
    const r = await core.getOne("SELECT after_json FROM recital_changes WHERE event_key='t-db-log2'");
    expect(String(r.after_json)).not.toContain('2014-05-06');
    expect(String(r.after_json)).not.toContain('k@example.com');
  });
});
describe('loadHouseholdDetail', () => {
  it('お金の式4行と見え方を出す（請求 26,500・入金なし → 仮受付）', async () => {
    await seedRecitalTestEvent('t-db-hh');
    const id = await seedHousehold('t-db-hh', { total: 26500, cast: 'in' });
    const d = await db.loadHouseholdDetail(id);
    expect(d?.money).toEqual({ total: 26500, paid: 0, remaining: 26500, overpaid: 0 });
    expect(d?.view).toBe('tentative');
    expect(await db.loadHouseholdDetail(999999)).toBeNull();
  });
});
```
  `workInput(over)` は試験の中の小さな関数（`WorkInput` の既定の値＋上書き）。

- [ ] **Step 3: 落ちることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalDb.test.ts`
  Expected: FAIL（`Cannot find module '../recitalDb'`）

- [ ] **Step 4: 試しの種 `20261114_recital_seed_test.sql` を書く**

  `bw6-test` の発表会1行（`is_test`=1。題・日付・会場は上の下ごしらえと同じ形）、設定（`suspended`='0'・`stripe_mode`='test'・`pay_ok_at`・`entry_open_at`・`pay_open_at` は `'2026-11-13 00:00'`・`mail_bcc_staff`='0'）、料金の規則8行、作品5本（仮の題。`W01`〜`W03` は `counted`・`form`・`open`、`W04` は `draft`、`W05` は `extra`・`extra_fee` 3000）。決まり：`INSERT OR IGNORE` か `INSERT … SELECT … WHERE NOT EXISTS`（2回流しても増えない）。`created_at` は `strftime('%Y-%m-%dT%H:%M:%fZ','now')`。**行の中にコメントを書かない**（コメントは文の前の独立した行）。**文字の値の中に `;` を書かない**（試験と `migrate.mjs` は `;` で割る）。鍵・乱数・`bank_text`・`ref_skip`・`test_mail_to`・実名を書かない。

- [ ] **Step 5: `src/lib/recitalDb.ts` の関数を作る（Produces の型どおり）**

  決めてあること：
  - `getRecitalSettings`：`SELECT key, value FROM recital_settings WHERE event_key=?` → `parseRecitalSettings`。
  - `listFeeRules`：`recital_fee_rules` を `event_key` でしぼり `sort_order, id` の順。`setSuspended` の検算もこれを使う。
  - `saveRecitalSetting`：LOCKED → `'recital_setting:locked'`。鍵が `RECITAL_SETTING_DEFAULTS` に無い → `'recital_setting:unknown'`。そのあと Task 2 の `checkSettingValue(key, value)` が null でなければ `'recital_setting:bad_value'`（形の決まりはそちらの表だけ。ここに写さない）。`suspended`・`stripe_mode` もここでは `bad_value` になる。書けるのは内部の書き込み（`setSuspended`・`setPayOk`・種の SQL）だけ。保存は `ON CONFLICT(event_key, key) DO UPDATE`、`updated_at`=`nowUtcIso()`・`updated_by`=staffName。変えた記録は書かない（設定の行の `updated_by` が記録）。
  - `setPayOk`：JST の今を `'YYYY-MM-DD HH:MM'` で入れる。もう入っていれば何もしない。`logChangeTx` の `action`=`pay_opened`。LOCKED の守りを通らない内部の書き込みはここだけ。
  - `setSuspended(on=false)`：`feeCheck(rules, s.fee_check_first, s.fee_check_family)` の `tentative` → `'tentative'`、`ok` でない → `'fee_check'`、`consent_items` が空白だけ → `'consent_empty'`、`privacy_text` が空白だけ → `'privacy_empty'`、`line_url` が空白だけ → `'line_empty'`（この順。使い道の知らせと公式LINEの道が無いまま受付を開けないため。03 3-4・D4 2-11）。通れば `'0'`＋`entry_opened`。`on=true` はいつでも `'1'`＋`entry_suspended`。
  - `saveWork`：新しい作品は `withWriteTx` の中で、その発表会の `work_code` の数字の最大＋1（`dropped` も数える）を2けた以上で `W13` の形に。直すときは `work_code` を変えない。`recital_work_classes`・`recital_work_instructors`（どちらも `event_key` を入れる）は、その作品の行を消して入れ直す（この2つのつなぎの表だけ。ほかの表の行は消さない）。
  - `listWorkCounts`：`in`・`maybe` は「人 `active`・世帯 `active`」の出演の数。`paid`／`unpaid` は `in` の出演のうち世帯の残りが 0／>0 の数（残りは世帯ごとに `moneySummary`）。`snsNg` は `in` の人に `sns_ok`=0 がいるか。
  - `loadHouseholdDetail`：`money` は「生きている請求の行の額・入金の行の額全部・返す分 `todo` の額」で `moneySummary`。`view` は `householdView({ hasIn, hasMaybe, paid, remaining })`。`hasIn`／`hasMaybe` は「人 `active` で、作品が `dropped` でない出演」の `in`／`maybe` があるか。`refundTodo` は `todo` の合計。`mails`・`changes` は新しい順。
  - `logChangeTx`：`before`/`after` を JSON にする前に、鍵の名前が `email`・`phone`・`birthday`・`insta_handle`・`instaHandle`・`bank_told_name`・`bankToldName`・`payer_name_raw`・`payerNameRaw`・`desc_raw`・`desc_norm`・`bank_desc`・`name` の値を、入れ子（オブジェクト・配列）までたどって、値があれば `'(伏せた)'`、空なら `null` に置きかえる。名義を渡す側は `name` か `bank_told_name` の鍵で渡す。`actor` が空なら throw。`created_at`=`nowUtcIso()`。

- [ ] **Step 6: 通ることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalDb.test.ts`
  Expected: PASS（全部）

- [ ] **Step 7: 種を確かめる（手元の `data/bw5.db` には流さない）**

  種が割れずに入ることは Step 6 の試験（台帳SQLを全部流す）で分かる（`種 bw6-test は…` の試験）。手元の画面用のDB `data/bw6_dev.db` には、計画の頭の「手元の画面の確かめ」の1行で入れる。
  本番へは、Task 1 の表の台帳が本番に入ったあとに、Task 1 と同じ形（`node --env-file=.env.production.local scripts/migrate.mjs --dry-run` → `--dry-run` を外す）で流す。表がまだ本番に無いときは流さずに止まって知らせる。

- [ ] **Step 8: コミット**

```bash
git add src/lib/recitalDb.ts src/lib/__tests__/recitalDb.test.ts src/lib/__tests__/recitalTestSeed.ts scripts/migrations/20261114_recital_seed_test.sql
git commit -m "feat(bw6): 発表会の設定・作品・世帯の読み書きと変えた記録、試しの種

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 「送る」`submitEntry` と `precheckEntry`（`recitalEntryDb.ts`）

**Files:**
- Create: `src/lib/recitalEntryDb.ts`
- Test: `src/lib/__tests__/recitalEntryDb.test.ts`

**Interfaces:**
- Consumes: Task 6 の `getRecitalEvent`・`getRecitalSettings`・`listFeeRules`・`loadMembersLite`・`logChangeTx`。Task 2 の `entryPhase`・`isCountedCast`・`householdView`・`ageOn`・`jstToMs`・`normalizePhone`・`normalizeEmail`。Task 3 の `expectedCharges`・`FeeRule`・`FeePerson`。Task 4 の `pickRef`・`isValidRef`・`RESERVED_REFS`。Task 5 の `matchMember`・`matchFeePreset`・`MemberLite`。Task 10 の `sendRecitalMail`（試験では mock）。`@/lib/csvUtil` の `normalizeKana`（同じ名前の別物を使わない）。`@/lib/dateJst` の `nowUtcIso`・`todayJst`・`isIsoDate`。`node:crypto` の `randomBytes`。
- Produces（Task 13 が呼ぶ）:
  - `precheckEntry(eventKey, { email, phone, people }): Promise<{ sameEmail: boolean; samePhone: boolean; samePersonIdx: number[] }>`。**書かない・送らない**。URL のメールを送るのは 13 の `precheckEntryAction` だけ（そこで `bw6:resend-to:` の回数も数える。2か所で送ると2通になる）。空の電話（`''`）は「同じ」と返さない。
  - 電話とメールのそろえ方は Task 2 の `normalizePhone`・`normalizeEmail`（純関数。13 の画面の確かめも同じ物を使うので、DB のファイルには置かない）。電話は数字だけの形で DB に入れ、同じ電話のくらべもこの形で行う。
  - `buildEntryFeePeople(eventKey, people: { lastName: string; firstName: string; lastKana: string; firstKana: string; birthday: string | null; works: { workId: number; status: 'in' | 'maybe' }[] }[]): Promise<{ rules: FeeRule[]; feePeople: FeePerson[]; presetClasses: (FeeClass | null)[] }>`（書かない。規則・作品・事前登録の照らし合わせ〔`loadMembersLite`＋`matchFeePreset`〕から `FeePerson` を作る。`personId` は並びの番号（1から）。`submitEntry` と 13 の `quoteEntry` の両方がこれを呼ぶ。同じ計算を2か所に書かない）
  - `submitEntry(s: EntrySubmission, now?: Date): Promise<SubmitResult>`（型は split.md ③）。`s.submitKey` は `randomBytes(16).toString('hex')`（32けた hex）で 13 がページを出す時に作る。形がちがえば `invalid`。
  - 失敗の文（`message`）：`suspended`＝「ただいま受付を止めています。再開までお待ちください」／`before`＝「◯月◯日（◯）◯時から受け付けます」（`entry_open_at` から）／`closed`＝「受付は終わりました。ご相談は公式LINEへ」／`same_email`＝「このメールアドレスに、ご案内を送りました。メールをご確認ください。」／`same_phone`＝「ご家族のお申し込みが、すでにあります。マイページをご確認ください。」／`same_person`＝「同じお名前・同じ生年月日のお申し込みが、もうあります。ご家族が申し込んでいないか、確かめてください。」／`busy`＝「ただいま混み合っています。もう一度『送る』を押してください。二重にはなりません。」／`invalid`＝「入力を確かめてください。」＋`fieldErrors`（鍵は `contact.email` のように `contact.<欄>`、人は `people.<番号>.<欄>`）

- [ ] **Step 1: 落ちる試験 `recitalEntryDb.test.ts` を書く（送る）**

```ts
// 頭：const sendRecitalMail = vi.fn(async () => ({ status: 'sent', logId: 1 }));
// vi.mock('@/lib/recitalMail', () => ({ sendRecitalMail: (...a) => sendRecitalMail(...a) })); と '@/lib/recitalMail.ts' も同じ
// vi.mock('@/lib/recitalMoneyDb', () => ({ afterMoneyChanged: vi.fn(async () => {}) })); と '.ts' も
// await setupRecitalTestDb('entry'); const { workIds: W } = await seedRecitalTestEvent('t-entry');
const NOW = new Date('2026-12-20T03:00:00Z');
let n = 0;
const key = () => (++n).toString(16).padStart(32, '0');
const kid = (over = {}) => ({ tempId: 'p1', lastName: 'テスト', firstName: 'イチ', lastKana: 'テスト', firstKana: 'イチ', birthday: '2015-04-02', isContact: false, category: 'student' as const, tshirtSize: null, instaHandle: null, works: [{ workId: W.W01, status: 'in' as const }], ...over });
const sub = (over = {}) => ({ eventKey: 't-entry', submitKey: key(), contact: { lastName: 'テスト', firstName: 'ハハ', lastKana: 'テスト', firstKana: 'ハハ', email: `m${n}@example.com`, phone: `0901000${String(n).padStart(4, '0')}` }, people: [kid()], confirmNotFamily: false, confirmSamePerson: true, consentAccepted: true, ...over });

it('1人2作品で送ると、仮受付 32,500・請求の行4つ・整理番号が検査に合う', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W01, status: 'in' }, { workId: W.W02, status: 'in' }] })] }), NOW);
  expect(r.ok && r.total).toBe(32500);
  expect(r.ok && r.view).toBe('tentative');
  expect(r.ok && isValidRef(r.refCode)).toBe(true);
  expect(r.ok && r.token).toMatch(/^[0-9a-f]{48}$/);
  const lines = await core.getAll("SELECT item_code, ref, amount FROM recital_charges WHERE household_id=? AND status='active' ORDER BY id", [r.ok && r.householdId]);
  expect(lines.map((l) => [l.item_code, l.ref, Number(l.amount)])).toEqual([['base', '', 16000], ['tshirt', '', 3000], ['coop_ticket', '', 7500], ['add_work', '2', 6000]]);
  expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'receipt', householdId: r.ok && r.householdId }));
});
it('同じ submit_key の2回目は1回目の結果（世帯は1つ・メールは1回）', async () => {
  const s = sub();
  const a = await entry.submitEntry(s, NOW); const b = await entry.submitEntry(s, NOW);
  expect(b.ok && b.replay).toBe(true);
  expect(b.ok && b.householdId).toBe(a.ok && a.householdId);
  expect(b.ok && b.refCode).toBe(a.ok && a.refCode);
  const c = await core.getOne('SELECT COUNT(*) n FROM recital_households WHERE submit_key=?', [s.submitKey]);
  expect(Number(c.n)).toBe(1);
  expect(sendRecitalMail.mock.calls.filter((x) => x[0].householdId === (a.ok && a.householdId))).toHaveLength(1);
});
it('同じメールでは作らず、もとの世帯へURLのメール', async () => {
  const a = await entry.submitEntry(sub({ contact: { ...sub().contact, email: 'same@example.com' } }), NOW);
  const b = await entry.submitEntry(sub({ contact: { ...sub().contact, email: 'same@example.com' } }), NOW);
  expect(b).toMatchObject({ ok: false, code: 'same_email' });
  expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resend_url', householdId: a.ok && a.householdId }));
});
it('same email ignores case and spaces', async () => {
  await entry.submitEntry(sub({ contact: { ...sub().contact, email: 'Case@Example.com' } }), NOW);
  const b = await entry.submitEntry(sub({ contact: { ...sub().contact, email: '  case@example.COM ' } }), NOW);
  expect(b).toMatchObject({ ok: false, code: 'same_email' });
});
it('同じメールを同時に2件送っても世帯は1つ', async () => {
  const email = 'race@example.com';
  const rs = await Promise.all([1, 2].map(() => entry.submitEntry(sub({ contact: { ...sub().contact, email } }), NOW)));
  // busy で返った方は同じ submit_key でもう1回送る
  const c = await core.getOne("SELECT COUNT(*) n FROM recital_households WHERE event_key='t-entry' AND lower(email)=?", [email]);
  expect(Number(c.n)).toBe(1);
  expect(rs.filter((r) => r.ok)).toHaveLength(1);
});
it('合計0円で「出る」がある → 申込完了・メールは complete 1通', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W08, status: 'in' }] })] }), NOW);
  expect(r.ok && [r.total, r.view]).toEqual([0, 'complete']);
  expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'complete', householdId: r.ok && r.householdId, dedupeKey: `complete:${r.ok && r.householdId}` }));
});
it('迷っているだけ → 仮受付 0円・控えは receipt', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ works: [{ workId: W.W01, status: 'maybe' }] })] }), NOW);
  expect(r.ok && [r.total, r.view]).toEqual([0, 'tentative']);
});
it('6作品目は弾く（出る＋迷っている）', async () => {
  const works = ['W01','W02','W03','W04','W05'].map((c) => ({ workId: W[c], status: 'in' as const })).concat([{ workId: W.W06, status: 'maybe' }]);
  const r = await entry.submitEntry(sub({ people: [kid({ works })] }), NOW);
  expect(r).toMatchObject({ ok: false, code: 'invalid' });
  expect(!r.ok && r.fieldErrors?.['people.0.works']).toBeTruthy();
});
it('準備中・スタッフだけの作品・別の発表会の作品は選べない', async () => {
  for (const id of [W.W09, W.W10]) expect(await entry.submitEntry(sub({ people: [kid({ works: [{ workId: id, status: 'in' }] })] }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
});
it('rejects work of another event', async () => {
  const other = (await seedRecitalTestEvent('t-entry-other')).workIds.W01;
  expect(await entry.submitEntry(sub({ people: [kid({ works: [{ workId: other, status: 'in' }] })] }), NOW)).toMatchObject({ ok: false, code: 'invalid' });
});
it('18歳未満は「連絡する人と同じ」を選べない（年齢は申込の日）', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ isContact: true, birthday: '2009-04-02' })] }), NOW);
  expect(!r.ok && r.fieldErrors?.['people.0.isContact']).toBeTruthy();
  expect((await entry.submitEntry(sub({ people: [kid({ isContact: true, birthday: '2008-12-20' })] }), NOW)).ok).toBe(true);
});
it('同じ電話は「家族ではない」なしで止まる／同じカナ＋生年月日は「それでも進む」なしで止まる', async () => {
  const a = sub(); await entry.submitEntry(a, NOW);
  expect(await entry.submitEntry(sub({ contact: { ...sub().contact, phone: a.contact.phone } }), NOW)).toMatchObject({ ok: false, code: 'same_phone' });
  expect((await entry.submitEntry(sub({ contact: { ...sub().contact, phone: a.contact.phone }, confirmNotFamily: true }), NOW)).ok).toBe(true);
  const p = kid({ lastKana: 'オナジ', firstKana: 'ヒト', birthday: '2016-06-06' });
  await entry.submitEntry(sub({ people: [p] }), NOW);
  expect(await entry.submitEntry(sub({ people: [p], confirmSamePerson: false }), NOW)).toMatchObject({ ok: false, code: 'same_person' });
});
it('受付の状態：止めている／受付前／締切のあと', async () => { /* t-entry-st の suspended='1' → 'suspended'、suspended='0'＋entry_open_at が未来 → 'before'、now を 2027-01-31T15:00:00Z（JST 2/1 0:00）→ 'closed' */ });
it('事前登録の会員とカナ＋生年月日が両方合う1人だけ → 特別な料金の印が入り、その料金で請求', async () => {
  // boom_members に1行（hacomono_member_id 't-1'、full_name 'テスト ムリョウ'、full_name_kana 'テスト ムリョウ'、birthday '2014-07-07'）
  // recital_fee_presets に (event_key 't-entry', member_id, fee_class 'free')
  const r = await entry.submitEntry(sub({ people: [kid({ lastKana: 'テスト', firstKana: 'ムリョウ', birthday: '2014-07-07' })] }), NOW);
  expect(r.ok && r.total).toBe(0);
  const p = await core.getOne('SELECT fee_class_override FROM recital_people WHERE household_id=?', [r.ok && r.householdId]);
  expect(p.fee_class_override).toBe('free');
});
it('番号が検査に合い、欠番と ref_skip を出さない（30件）', async () => {
  const skip = '200' + dammDigit('200');
  await core.execute("INSERT INTO recital_settings (event_key, key, value, created_at) VALUES ('t-entry','ref_skip',?,?) ON CONFLICT(event_key,key) DO UPDATE SET value=excluded.value", [skip, new Date().toISOString()]);
  const codes = [];
  for (let i = 0; i < 30; i++) { const r = await entry.submitEntry(sub(), NOW); if (r.ok) codes.push(r.refCode); }
  expect(codes).toHaveLength(30);
  for (const c of codes) { expect(isValidRef(c)).toBe(true); expect(RESERVED_REFS).not.toContain(c); expect(c).not.toBe(skip); }
});
it('同時20件で番号と seq が重ならない', async () => {
  const subs = Array.from({ length: 20 }, () => sub());
  let rs = await Promise.all(subs.map((s) => entry.submitEntry(s, NOW)));
  for (let i = 0; i < 20; i++) while (!rs[i].ok && rs[i].code === 'busy') rs[i] = await entry.submitEntry(subs[i], NOW);
  const ok = rs.filter((r) => r.ok);
  expect(ok).toHaveLength(20);
  expect(new Set(ok.map((r) => r.ok && r.refCode)).size).toBe(20);
  const seqs = await core.getAll('SELECT seq FROM recital_households WHERE submit_key IN (' + subs.map(() => '?').join(',') + ')', subs.map((s) => s.submitKey));
  expect(new Set(seqs.map((x) => Number(x.seq))).size).toBe(20);
}, 120_000);
it('照合は書き込みのあと：会員と合わない人は unmatched', async () => {
  const r = await entry.submitEntry(sub({ people: [kid({ lastKana: 'ダレモ', firstKana: 'イナイ' })] }), NOW);
  const p = await core.getOne('SELECT match_status FROM recital_people WHERE household_id=?', [r.ok && r.householdId]);
  expect(p.match_status).toBe('unmatched');
});
it('precheckEntry は同じメール・電話・人を返し、何も送らない', async () => {
  const a = sub({ people: [kid({ lastKana: 'マエ', firstKana: 'カクニン', birthday: '2013-03-03' })] }); await entry.submitEntry(a, NOW);
  sendRecitalMail.mockClear();
  const r = await entry.precheckEntry('t-entry', { email: a.contact.email.toUpperCase(), phone: a.contact.phone, people: [{ lastKana: 'マエ', firstKana: 'カクニン', birthday: '2013-03-03' }] });
  expect(r).toEqual({ sameEmail: true, samePhone: true, samePersonIdx: [0] });
  expect(sendRecitalMail).not.toHaveBeenCalled();
  expect((await entry.precheckEntry('t-entry', { email: 'x@example.com', phone: '', people: [] })).samePhone).toBe(false);
});
it('全角の電話でも通り、半角ハイフンの電話と同じ電話になる', async () => {
  await entry.submitEntry(sub({ contact: { ...sub().contact, phone: '090-1234-5678' } }), NOW);
  expect(await entry.submitEntry(sub({ contact: { ...sub().contact, phone: '０９０－１２３４－５６７８' } }), NOW)).toMatchObject({ ok: false, code: 'same_phone' });
});
it('buildEntryFeePeople は送る時と同じ額（1人2作品 → 32,500）', async () => {
  const b = await entry.buildEntryFeePeople('t-entry', [{ lastName: 'テスト', firstName: 'イチ', lastKana: 'テスト', firstKana: 'イチ', birthday: '2015-04-02', works: [{ workId: W.W01, status: 'in' }, { workId: W.W02, status: 'in' }] }]);
  expect(expectedCharges(b.rules, b.feePeople, null).reduce((x, l) => x + l.amount, 0)).toBe(32500);
  expect(b.presetClasses).toEqual([null]);
});
```

- [ ] **Step 2: 落ちることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalEntryDb.test.ts`
  Expected: FAIL（`Cannot find module '../recitalEntryDb'`）

- [ ] **Step 3: `precheckEntry` と `submitEntry` を作る**

  `submitEntry` の順（03 3-4・05 5-2・04 4-2「送る」のあと）：
  1. 書き込みの前：`getRecitalEvent`（無ければ `invalid`）→ `getRecitalSettings` → `entryPhase(s, now.getTime())` が `open` でなければその code。
  2. 中身を調べる（どれか欠ければ `invalid`＋`fieldErrors`）：名前・カナ（カタカナ・長音・空白だけ）・メール（`normalizeEmail` のあと `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`）・電話（`normalizePhone` のあと10〜11けた。全角の数字・ハイフンも通す）・生年月日（`isIsoDate`・未来でない）・人は1〜10人・1人に「出る」か「迷っている」が1つ以上で `max_works_per_person` 以下・同じ作品を2回選ばない・作品はこの発表会の `entry_mode`=`form` かつ `status`=`open`・`isContact` の人は `ageOn(birthday, todayJst(now)) >= min_self_apply_age`・`tshirtSize` は `tshirt_sizes` の中か null（一覧が空なら null だけ）・インスタは前後の空白を取り、空なら null・`consentAccepted`。
  3. `confirmNotFamily` が false で同じ電話（`normalizePhone` の形でくらべる）の `active` 世帯がある → `same_phone`（その世帯へ `resend_url` を送る）。`confirmSamePerson` が false で同じ「`normalizeKana`(セイ＋メイ)＋生年月日」の `active` の人がいる → `same_person`。
  4. 金額の材料：`buildEntryFeePeople(eventKey, people)`（事前登録の照らし合わせ〔`recital_fee_presets` と `loadMembersLite()` で人ごとに `matchFeePreset`。`{feeClass}` のときだけ印に使う〕と `FeePerson` 作り。13 の `quoteEntry` と同じ関数）。
  5. `withWriteTx` の中（往復は「読む2回＋世帯1回＋人1回（`tx.batch`）＋出演・請求・記録1回（`tx.batch`）」まで）：
     - (あ) 同じ `submit_key` の世帯があれば何も書かず、その世帯の今の値で `replay: true`。
     - (い) `email = ?`（`normalizeEmail` の値。入れる時も同じ形なので一致でくらべる）の `active` 世帯があれば何も書かず `same_email`（URL のメールは書き込みの外で）。
     - (う) `seq` ＝発表会の最大＋1（ぶつかって一意の決まりに当たったら throw → `busy`。やり直しの輪は作らない）。`ref_code` ＝ この書き込みの中で読んだ使用ずみの番号の集まりと `s.ref_skip` を渡して `pickRef(used, skip, Math.random)`。null なら throw（番号切れ。止まって知らせる類いの事故なので `busy` で返し、ログに残す）。INSERT が `ref_code` の一意に当たったら、その番号を集まりに足して選び直す（3回まで）。
     - (え) 世帯：`edit_token`＝`randomBytes(24).toString('hex')`、`source`=`form`、`status`=`active`、`email` は `normalizeEmail` の値、`phone` は `normalizePhone` の値、`applied_at`・`created_at`。人：`seq` は最大＋1、`match_status`=`pending`（照合の前の仮）、`display_name`＝`姓 + ' ' + 名`、`name_ok`/`photo_ok`/`sns_ok`=1、`fee_class_override` は 4 の結果、`status`=`active`。出演：`source`=`form`、`in` は `decided_at` も入れる。請求：`expectedCharges(rules, feePeople, null)` の行を `due_on`=`pay_due`・`status`=`active` で。`FeePerson.counted` は `isCountedCast` の数、`extraWorks` は `extra` の作品で `in` の物（`{ workCode, label: title, fee: extra_fee }`）。変えた記録：`action`=`apply`・`actor`=`family`・`after`＝人数・出演の数・合計だけ。
  6. 書き込みのあと：`loadMembersLite()` で人ごとに `matchMember` → `member_id`（`auto` のときだけ）と `match_status` を UPDATE。失敗しても申込は成り立つ（`pending` のまま残る）。
  7. メール（書き込みの外。失敗しても `ok: true`）：見え方が `complete`（合計0円で「出る」あり）なら `{ kind: 'complete', householdId, dedupeKey: 'complete:<id>' }`、それ以外は `{ kind: 'receipt', householdId }`。`replay` のときは送らない。
  8. `SQLITE_BUSY`・`database is locked`・`seq` の一意エラーは `busy` に変える。そのほかの例外は投げ直す。
  - `precheckEntry`：書かない・送らない。`sameEmail` は (い) と同じくらべ方、`samePhone` は 3 と同じ（空の電話は false）、`samePersonIdx` は 3 の人のくらべ方。
  - 計画に書いていない入力（たとえば `category` が2つ以外、人が11人以上の家族の扱い）に当たったら、自分で決めずに止まって知らせる。

- [ ] **Step 4: 通ることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalEntryDb.test.ts`
  Expected: PASS。同時20件の試験が2分をこえる・`busy` がいつまでも続くときは、直さずに止まって知らせる（手元の SQLite と Turso では待ち方がちがう）。

- [ ] **Step 5: コミット**

```bash
git add src/lib/recitalEntryDb.ts src/lib/__tests__/recitalEntryDb.test.ts
git commit -m "feat(bw6): 申込の「送る」（1回の書き込みで世帯・人・出演・請求・整理番号）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 代わりに直す・マイページの変更・請求の作り直し（`recitalEntryDb.ts`）

**7 のコミットの後に始める（同じファイル）。**

**Files:**
- Modify: `src/lib/recitalEntryDb.ts`
- Test: `src/lib/__tests__/recitalEntryDb.test.ts`（同じファイルに `describe` を足す）

**Interfaces:**
- Consumes: Task 7 の `submitEntry`（試験で世帯を作る）。Task 6 の `loadHouseholdDetail`・`getRecitalSettings`・`logChangeTx`。Task 2 の `entryPhase`・`deadlineMs`・`moneySummary`。Task 3 の `expectedCharges`・`diffCharges`。Task 9 の `afterMoneyChanged`・Task 10 の `sendRecitalMail`（どちらも試験では mock）。
- Produces（Task 14・15・19・20 が呼ぶ）:
  - `type HouseholdEdit`・`type EditCtx`（split.md ③のまま）
  - `applyHouseholdEdits(householdId, edits, ctx)`（返り値は split.md ③）。失敗の文：`closed`＝「お申し込みと変更の受付は、1月31日（日）で終わりました。中身を変えたいときは、公式LINEでお知らせください。」／`max_works`＝「1人5作品までです。」（数は設定から）／`paid_no_maybe`＝「お支払いのあとは、『まだ迷っている』に戻せません。」／`last_work`＝「出演を全部やめるときは、公式LINEでお知らせください。」／`invalid`＝「入力を確かめてください。」
  - `recomputeChargesTx(tx, householdId, actor): Promise<{ totalBefore; totalAfter; firstPersonId }>`（合計が変わったら、この中で `total_changed` を記録する。20 もこれを呼ぶ）
  - `changeHouseholdEmail(householdId, email, staffName): Promise<{ token }>`。投げる `Error.message`：`'recital_entry:bad_email'`／`'recital_entry:same_email'`
  - `regenerateToken(householdId, staffName): Promise<{ token }>`
  - `EditCtx` に `dryRun?: boolean` を足す（足した名前）。`dryRun` のときは同じ確かめと同じ作り直しの計算を `withWriteTx` の中で通し、最後に印の例外を投げて巻き戻す。返り値は `{ ok: true; totalBefore; totalAfter; remainingBefore; remainingAfter }`（`remaining*`＝`max(0, 合計 − m.paid)`）。メールも `afterMoneyChanged` も呼ばない。15 の `previewHouseholdEdits` はこれを呼ぶだけ（確かめと計算を2か所に書かない）。
  - `updateInstaHandle` はこのタスクでは作らない（14 が作る。split.md ②）。
  - 呼ぶ側との約束（**呼ぶ側は送らない・呼ばない**）：
    - `applyHouseholdEdits` は、書き込みのあと（`staff_note`・`name_ok`・`photo_ok`・`sns_ok`・`pay_due_override` だけを直した時を除いて）変更の控え `{ kind: 'change' }` を1通送り、合計が変わった時は `afterMoneyChanged(householdId, 'total')` を呼ぶ。15 の `applyFamilyWorkEdits` と 19 の `editHouseholdAction` は、メールも `afterMoneyChanged` も呼ばない。
    - `changeHouseholdEmail` は、新しいアドレスへ `resend_url` を送る。19 の `changeEmailAction` は送らない。
    - 20 のように自分で `recomputeChargesTx` を呼ぶ側は、自分で `afterMoneyChanged` を呼ぶ。

- [ ] **Step 1: 落ちる試験を足す**

```ts
// 試験の中の小さな関数：
//   apply(ws: string[], maybe: string[] = [])        … submitEntry で1人の世帯を作り householdId を返す
//   pay(id, amount)                                   … INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, created_at) VALUES ('t-entry', ?, 'cash', ?, '2026-12-21', 'manual', ?)（9 に頼らない）
//   set(id, personId, code, status, by = 'family')    … applyHouseholdEdits(id, [{ type:'cast_set', personId, workId: W[code], status }], { actor: by === 'family' ? 'family' : 'TARO', by, reason: by === 'staff' ? 'LINEで聞いた' : null, now: NOW })
//   money(id)                                         … (await loadHouseholdDetail(id)).money と .view
//   active(id)                                        … 生きている請求の行 [id, item_code, person_id, ref, amount]
describe('請求の行の流れの例（05 5-3。行ごとに足す／void だけ）', () => {
  it('12/20〜1/30 の6行', async () => {
    const id = await apply(['W01', 'W02']);
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 0, remaining: 32500, overpaid: 0 }, view: 'tentative' });
    const base0 = (await active(id)).map((r) => r[0]);
    await pay(id, 32500);
    expect((await money(id)).view).toBe('complete');
    await set(id, P, 'W03', 'in');                       // 3作品目 3,000 を足す
    expect(await money(id)).toEqual({ m: { total: 35500, paid: 32500, remaining: 3000, overpaid: 0 }, view: 'complete_extra' });
    expect((await active(id)).filter((r) => !base0.includes(r[0])).map((r) => [r[1], r[3], r[4]])).toEqual([['add_work', '3', 3000]]);
    await pay(id, 3000);
    await set(id, P, 'W02', 'out');                      // 3作品目の行だけ void
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 35500, remaining: 0, overpaid: 3000 }, view: 'complete' });
    expect((await active(id)).map((r) => r[0])).toEqual(base0); // はじめの4行は同じ id のまま
    await set(id, P, 'W04', 'in');                       // 「お支払いずみの分」に当たる
    expect((await money(id)).m).toEqual({ total: 35500, paid: 35500, remaining: 0, overpaid: 0 });
  });
});
// applyKids(kids: { in: string[]; maybe?: string[] }[]) … submitEntry で兄・妹などの世帯を作り { id, pids }（pids は人の seq の順）を返す
// amc … vi.mocked((await import('@/lib/recitalMoneyDb')).afterMoneyChanged)
describe('足す例（払ったあと。05 5-5）', () => {
  it.each([
    [['W01'], 'W02', 26500, 32500, 6000],
    [['W01', 'W02'], 'W03', 32500, 35500, 3000],
  ] as const)('1人の世帯 %j で %s を足す → 差額が残り', async (ws, add, before, after, diff) => {
    const id = await apply([...ws]); await pay(id, before);
    await set(id, P, add, 'in');
    expect((await money(id)).m).toEqual({ total: after, paid: before, remaining: diff, overpaid: 0 });
  });
  it('兄1→兄1・妹1：26,500→34,500 差額 8,000', async () => {
    const { id, pids } = await applyKids([{ in: ['W01'] }, { in: [], maybe: ['W02'] }]);
    expect((await money(id)).m.total).toBe(26500); await pay(id, 26500);
    await set(id, pids[1], 'W02', 'in');
    expect((await money(id)).m).toEqual({ total: 34500, paid: 26500, remaining: 8000, overpaid: 0 });
  });
  it('兄2→兄2・妹1：32,500→37,500 差額 5,000（1人目が妹に入れかわる）', async () => {
    const { id, pids } = await applyKids([{ in: ['W01', 'W02'] }, { in: [], maybe: ['W03'] }]);
    await pay(id, 32500);
    await set(id, pids[1], 'W03', 'in');
    expect((await money(id)).m).toEqual({ total: 37500, paid: 32500, remaining: 5000, overpaid: 0 });
  });
  it('兄1・妹1→兄2・妹1：34,500→37,500 差額 3,000', async () => {
    const { id, pids } = await applyKids([{ in: ['W01'] }, { in: ['W02'] }]);
    await pay(id, 34500);
    await set(id, pids[0], 'W03', 'in');
    expect((await money(id)).m).toEqual({ total: 37500, paid: 34500, remaining: 3000, overpaid: 0 });
  });
  it('兄3・妹1→兄3・妹2：40,500→46,500 差額 6,000', async () => {
    const { id, pids } = await applyKids([{ in: ['W01', 'W02', 'W03'] }, { in: ['W04'] }]);
    await pay(id, 40500);
    await set(id, pids[1], 'W05', 'in');
    expect((await money(id)).m).toEqual({ total: 46500, paid: 40500, remaining: 6000, overpaid: 0 });
  });
});
describe('へらす例（1人の世帯）', () => {
  it('35,500→32,500（お支払いずみ 3,000）→35,500（当たる）→38,500（残り 3,000）', async () => {
    const id = await apply(['W01', 'W02', 'W03']); await pay(id, 35500);
    await set(id, P, 'W03', 'out');
    expect((await money(id)).m).toEqual({ total: 32500, paid: 35500, remaining: 0, overpaid: 3000 });
    await set(id, P, 'W04', 'in');
    expect((await money(id)).m).toEqual({ total: 35500, paid: 35500, remaining: 0, overpaid: 0 });
    await set(id, P, 'W05', 'in');
    expect((await money(id)).m).toEqual({ total: 38500, paid: 35500, remaining: 3000, overpaid: 0 });
  });
});
describe('場面 A〜E（05 5-5。Task 2 の it.each の13行を操作の並びにした物）', () => {
  it('A：申し込む → 26,500 を払う', async () => {
    const id = await apply(['W01']);
    expect(await money(id)).toEqual({ m: { total: 26500, paid: 0, remaining: 26500, overpaid: 0 }, view: 'tentative' });
    await pay(id, 26500);
    expect(await money(id)).toEqual({ m: { total: 26500, paid: 26500, remaining: 0, overpaid: 0 }, view: 'complete' });
  });
  it('B：1作品を足す → 6,000 を払う', async () => {
    const id = await apply(['W01']); await pay(id, 26500);
    await set(id, P, 'W02', 'in');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 26500, remaining: 6000, overpaid: 0 }, view: 'complete_extra' });
    await pay(id, 6000);
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 32500, remaining: 0, overpaid: 0 }, view: 'complete' });
  });
  it('C：1作品をやめる → 別の1作品を足す', async () => {
    const id = await apply(['W01', 'W02']); await pay(id, 32500);
    await set(id, P, 'W02', 'out');
    expect(await money(id)).toEqual({ m: { total: 26500, paid: 32500, remaining: 0, overpaid: 6000 }, view: 'complete' });
    await set(id, P, 'W03', 'in');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 32500, remaining: 0, overpaid: 0 }, view: 'complete' });
  });
  it('D：払う前の足す・やめるで入金の行は増えない', async () => {
    const id = await apply(['W01', 'W02']);
    expect((await money(id)).m.total).toBe(32500);
    await set(id, P, 'W03', 'in');
    expect(await money(id)).toEqual({ m: { total: 35500, paid: 0, remaining: 35500, overpaid: 0 }, view: 'tentative' });
    await set(id, P, 'W03', 'out');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 0, remaining: 32500, overpaid: 0 }, view: 'tentative' });
    expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [id])).n)).toBe(0);
  });
  it('E：兄1・妹1 34,500 → 払う → 兄が足す 37,500（妹が1人目・兄の base が 16,000→5,000）→ 妹をスタッフがやめる 32,500・お支払いずみ 2,000', async () => {
    const { id, pids } = await applyKids([{ in: ['W01'] }, { in: ['W02'] }]);
    await pay(id, 34500);
    const keep = (await active(id)).filter((r) => r[1] === 'coop_ticket' || (r[1] === 'tshirt' && r[2] === pids[0])).map((r) => r[0]);
    await set(id, pids[0], 'W03', 'in');
    expect(await money(id)).toEqual({ m: { total: 37500, paid: 34500, remaining: 3000, overpaid: 0 }, view: 'complete_extra' });
    expect((await active(id)).filter((r) => r[1] === 'base' && r[2] === pids[0]).map((r) => r[4])).toEqual([5000]);
    await set(id, pids[1], 'W02', 'out', 'staff');
    expect(await money(id)).toEqual({ m: { total: 32500, paid: 34500, remaining: 0, overpaid: 2000 }, view: 'complete' });
    for (const k of keep) expect((await active(id)).map((r) => r[0])).toContain(k); // 兄の tshirt と世帯の coop_ticket の行は同じ id のまま
  });
});
describe('決まり', () => {
  it('払ったあとは in→maybe を拒む（家庭もスタッフも）', async () => {
    const id = await apply(['W01', 'W02']); await pay(id, 32500);
    expect(await set(id, P, 'W02', 'maybe')).toMatchObject({ ok: false, code: 'paid_no_maybe' });
    expect(await set(id, P, 'W02', 'maybe', 'staff')).toMatchObject({ ok: false, code: 'paid_no_maybe' });
  });
  it('払ったあと、その人の最後の「出る」はボタンでなく LINE（迷っているが残っていても）', async () => {
    const id = await apply(['W01'], ['W02']); await pay(id, 26500);
    expect(await set(id, P, 'W01', 'out')).toMatchObject({ ok: false, code: 'last_work', message: '出演を全部やめるときは、公式LINEでお知らせください。' });
    expect((await set(id, P, 'W01', 'out', 'staff')).ok).toBe(true);
  });
  it('家庭は5作品で止まる／スタッフは通る', async () => {
    const id = await apply(['W01', 'W02', 'W03', 'W04', 'W05']);
    expect(await set(id, P, 'W06', 'in')).toMatchObject({ ok: false, code: 'max_works', message: '1人5作品までです。' });
    expect((await set(id, P, 'W06', 'in', 'staff')).ok).toBe(true);
  });
  it('adjust の行は作り直しで残る', async () => {
    const id = await apply(['W01']);
    await core.execute("INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, status, created_at) VALUES ('t-entry', ?, NULL, 'adjust', '', '手の調整', 1, -1000, -1000, 'active', ?)", [id, new Date().toISOString()]);
    await set(id, P, 'W02', 'in');
    expect((await active(id)).some((r) => r[1] === 'adjust' && r[4] === -1000)).toBe(true);
    expect((await money(id)).m.total).toBe(31500);
  });
  it('change_close_at の境目：1/31 23:59:59.999 は家庭も通る、2/1 0:00 は家庭 closed・スタッフは理由つきで通る／理由なしは invalid', async () => {
    const id = await apply(['W01']);
    const ed = (code: string) => [{ type: 'cast_set' as const, personId: P, workId: W[code], status: 'in' as const }];
    expect((await entry.applyHouseholdEdits(id, ed('W02'), { actor: 'family', by: 'family', now: new Date('2027-01-31T23:59:59.999+09:00') })).ok).toBe(true);
    const late = new Date('2027-02-01T00:00:00+09:00');
    expect(await entry.applyHouseholdEdits(id, ed('W03'), { actor: 'family', by: 'family', now: late })).toMatchObject({ ok: false, code: 'closed' });
    expect((await entry.applyHouseholdEdits(id, ed('W03'), { actor: 'TARO', by: 'staff', reason: 'LINEで聞いた', now: late })).ok).toBe(true);
    expect(await entry.applyHouseholdEdits(id, ed('W04'), { actor: 'TARO', by: 'staff', reason: '', now: late })).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('rejects work of another event', async () => {
    const id = await apply(['W01']);
    const other = (await seedRecitalTestEvent('t-entry-other8')).workIds.W02;
    expect(await entry.applyHouseholdEdits(id, [{ type: 'cast_set', personId: P, workId: other, status: 'in' }], { actor: 'TARO', by: 'staff', reason: 'x', now: NOW })).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('合計が変わったら afterMoneyChanged(id,"total") と change のメール1通。変わらない直し（電話）は afterMoneyChanged を呼ばない', async () => {
    const id = await apply(['W01']); amc.mockClear(); sendRecitalMail.mockClear();
    await set(id, P, 'W02', 'in');
    expect(amc).toHaveBeenCalledWith(id, 'total');
    expect(sendRecitalMail.mock.calls.filter((c) => c[0].kind === 'change' && c[0].householdId === id)).toHaveLength(1);
    amc.mockClear();
    await entry.applyHouseholdEdits(id, [{ type: 'contact', fields: { phone: '09099998888' } }], { actor: 'TARO', by: 'staff', reason: 'LINEで聞いた', now: NOW });
    expect(amc).not.toHaveBeenCalled();
  });
  it('dryRun は書かず、本番と同じ合計を返す', async () => {
    const id = await apply(['W01']); await pay(id, 26500); sendRecitalMail.mockClear();
    const ed = [{ type: 'cast_set' as const, personId: P, workId: W.W02, status: 'in' as const }];
    expect(await entry.applyHouseholdEdits(id, ed, { actor: 'family', by: 'family', now: NOW, dryRun: true }))
      .toEqual({ ok: true, totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000 });
    expect((await money(id)).m.total).toBe(26500);
    expect(sendRecitalMail).not.toHaveBeenCalled();
  });
  it('total_changed の記録に前と後の合計', async () => {
    const id = await apply(['W01']); await set(id, P, 'W02', 'in');
    const c = await core.getOne("SELECT before_json, after_json FROM recital_changes WHERE household_id=? AND action='total_changed' ORDER BY id DESC", [id]);
    expect([JSON.parse(c.before_json).total, JSON.parse(c.after_json).total]).toEqual([26500, 32500]);
  });
  it('メールを直すと古い鍵が使えない・新しいアドレスへ resend_url', async () => {
    const id = await apply(['W01']);
    const old = (await core.getOne('SELECT edit_token t FROM recital_households WHERE id=?', [id])).t;
    const { token } = await entry.changeHouseholdEmail(id, 'new-addr@example.com', 'TARO');
    expect(token).not.toBe(old);
    expect(await core.getOne('SELECT id FROM recital_households WHERE edit_token=?', [old])).toBeNull();
    expect(sendRecitalMail).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resend_url', householdId: id }));
    const ch = await core.getAll("SELECT action, after_json FROM recital_changes WHERE household_id=? AND action IN ('email_edit','token_regenerated')", [id]);
    expect(ch.map((c) => c.action).sort()).toEqual(['email_edit', 'token_regenerated']);
    expect(JSON.stringify(ch)).not.toContain('new-addr@example.com');
  });
  it('ほかの世帯と同じメールには直せない・形ちがいも直せない', async () => {
    const a = await apply(['W01']); const b = await apply(['W01']);
    const bMail = (await core.getOne('SELECT email FROM recital_households WHERE id=?', [b])).email;
    await expect(entry.changeHouseholdEmail(a, bMail, 'TARO')).rejects.toThrow('recital_entry:same_email');
    await expect(entry.changeHouseholdEmail(a, 'not-mail', 'TARO')).rejects.toThrow('recital_entry:bad_email');
  });
  it('regenerateToken で古い鍵が使えない', async () => {
    const id = await apply(['W01']);
    const old = (await core.getOne('SELECT edit_token t FROM recital_households WHERE id=?', [id])).t;
    const { token } = await entry.regenerateToken(id, 'TARO');
    expect(token).toMatch(/^[0-9a-f]{48}$/); expect(token).not.toBe(old);
    expect(await core.getOne('SELECT id FROM recital_households WHERE edit_token=?', [old])).toBeNull();
  });
});
```
  「妹を足す」は人を足す操作で段階1の `HouseholdEdit` に無い。試験では `applyKids` で妹を「迷っている」で入れておき、`in` にして同じ数字を確かめる。`apply` は世帯 id を返し、その1人の人の id を変数 `P` に入れる。

- [ ] **Step 2: 落ちることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalEntryDb.test.ts`
  Expected: 足した `describe` が FAIL（`entry.applyHouseholdEdits is not a function`）、7 の試験は PASS のまま。

- [ ] **Step 3: 関数を作る**

  - `applyHouseholdEdits`：
    - 世帯が無い・`merged` → `invalid`。`ctx.by`=`staff` で `reason` が空 → `invalid`。
    - 家庭（`by`=`family`）は `cast_set` だけ（`person`・`contact` は `invalid`）。`entryPhase(s, now, household.extend_until)` が `open` で、しかも今 ≤ `deadlineMs(change_close_at)` のときだけ。ちがえば `closed`。
    - `cast_set`：作品はこの発表会で `dropped` でない物。家庭は `entry_mode`=`form` かつ `status`=`open` の作品だけ足せる。家庭は「出る＋迷っている」が `max_works_per_person` をこえたら `max_works`（スタッフは通す）。払った額 > 0 で `in`→`maybe` は `paid_no_maybe`（家庭もスタッフも）。家庭で、払った額 > 0、`in`→`out`、その人の最後の `in`（`maybe` は数えない）なら `last_work`。出演の行が無ければ足す（`source` は家庭 `mypage`／スタッフ `staff`）、あれば同じ行の `status` を変える（`out` は `withdrawn_at`、`in` は `decided_at`）。記録の `action`：新しい行か `out`→`in`/`maybe` は `cast_add`、`maybe`→`in` と `in`→`maybe` は `cast_decide`、`→out` は `cast_out`。`received_at`＝`ctx.receivedAt`。
    - `person`：`name_ok`/`photo_ok`/`sns_ok` は `flags_edit`、`insta_handle` は `insta_edit`、ほかは `person_edit`。`contact`：`contact_edit`。前後の値は Task 6 の伏せ方に任せる（生の値を渡してよい）。
    - 全部を1つの `withWriteTx` で書き、最後に同じ書き込みの中で `recomputeChargesTx`。
    - 書き込みのあと：合計が変わっていれば `afterMoneyChanged(householdId, 'total')`。メールは `{ kind: 'change', householdId }` を1通。ただし直したのが `staff_note`・`name_ok`・`photo_ok`・`sns_ok`・`pay_due_override` だけのときは送らない。
    - `ctx.dryRun`：上の確かめと `recomputeChargesTx` を同じ `withWriteTx` の中で通し、`totalAfter` と払った額を読んだら印の例外（`'recital_entry:dry_run'`）を投げて巻き戻し、外で捕まえて返す。メール・`afterMoneyChanged`・変えた記録は残らない。
  - `recomputeChargesTx`：規則・人（`active`）・出演＋作品・生きている請求の行を読む。今の1人目は「`item_code`=`base` で、`unit_amount` が `first` の `base` の規則の額と同じ行」の人（無ければ null）。`expectedCharges(rules, people, currentFirst)` → `diffCharges(active, lines)`。`voidIds` は `status='void'`・`void_reason='recompute'`・`voided_at`、`add` は `due_on`=`pay_due` で足す。合計は生きている行（`adjust` も）の和を0未満なら0にした数。変わったら `logChangeTx` の `total_changed`（`before:{ total }`・`after:{ total }`）。
  - `changeHouseholdEmail`：形がちがえば `'recital_entry:bad_email'`、同じ発表会のほかの `active` 世帯が同じメールなら `'recital_entry:same_email'`。メールと `edit_token` を1回の書き込みで変え、`email_edit`（`after:{ field: 'email' }`）と `token_regenerated` を記録。書き込みのあと、新しいアドレスへ `{ kind: 'resend_url', householdId }`。
  - `regenerateToken`：新しい `edit_token`＋`token_regenerated`。メールは送らない（スタッフが URL を写す）。
  - 人を足す・全部やめる・世帯をまとめる操作は段階1のこの関数に入れない。必要に見えたら止まって知らせる。

- [ ] **Step 4: 通ることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalEntryDb.test.ts`
  Expected: PASS（7 と 8 の全部）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recitalEntryDb.ts src/lib/__tests__/recitalEntryDb.test.ts
git commit -m "feat(bw6): 代わりに直す・マイページの変更と、請求の行を行ごとに直す作り直し

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: お金の核（`recitalMoneyDb.ts`）

**Files:**
- Create: `src/lib/recitalMoneyDb.ts`
- Test: `src/lib/__tests__/recitalMoneyDb.test.ts`

**Interfaces:**
- Consumes: Task 6 の `logChangeTx`・`seedHousehold`・`seedRecitalTestEvent`。Task 2 の `moneySummary`・`householdView`・`MoneySummary`・`HouseholdView`。`@/lib/db` の `withWriteTx`・`getOne`・`getAll`。
- Produces（Task 19・20・22・23・27・28 が使う）:
  - `type HouseholdMoney`・`type PaymentInput`（split.md ③のまま）
  - `readHouseholdMoneyTx(tx, id)`・`readHouseholdMoney(id): Promise<HouseholdMoney>`
  - `insertPaymentTx(tx, p, actor): Promise<{ paymentId; before; after; refundId }>`。投げる `Error.message`：`'recital_money:bad_input'`（形ちがい・世帯が無い・台帳行が別の発表会）／`'recital_money:live_exists'`（同じ台帳行×同じ世帯の生きているプラスがもうある）／`'recital_money:row_over'`（1台帳行の合計が行の額をこえる）／`'recital_money:negative'`（払った額が0未満になる）
  - `createRefundTx(tx, r): Promise<number>`。投げる：`'recital_money:bad_input'`／`'recital_money:over_overpaid'`（6番で「お支払いずみの分」をこえる。K217）
  - `cancelRefund(refundId, reason, staffName): Promise<void>`
  - `recordManualPayment(householdId, { method: 'cash'|'adjust', amount, paidOn, memo }, staffName): Promise<{ paymentId; after }>`。`cash` は1以上、`adjust` は0でない整数（マイナスは打ちまちがいの打ち消し。メモ必須）。**書き込みのあと `afterMoneyChanged(householdId, 'payment')` を中で呼ぶ。メールは送らない。呼ぶ側（19）は `sendPaidMail(householdId, paymentId, method)` だけを呼び、`afterMoneyChanged` は呼ばない。**
  - `cancelRefund` も書き込みのあと `afterMoneyChanged(householdId, 'payment')` を中で呼ぶ（呼ぶ側は呼ばない）。
  - `PaymentInput.source` の語は `manual`／`stripe_webhook`／`stripe_recheck`／`bank_auto`／`bank_staff`（`stripe_recheck` はここで入れておく。21 は使うだけ）
  - 「振り込みました」の印を閉じた時の記録の形（**28 の取り消しはこれだけを読む**）：`action`=`payment_recorded`、`after`＝`{ paymentId, method, amount, source, bankRowId, refundId }`、`before`＝`{ told: { at, date, amount, by } | null }`。名義は記録に残さない（R-18）。別の `bank_told` の記録は書かない。
  - `afterMoneyChanged(householdId, cause: 'total'|'payment'): Promise<void>`（中身は空で作る。21 がカードの作り直し、23 がご案内の出し直しを足す）
  - `refundForDecrease(x: { totalBefore: number; paid: number; totalAfter: number }): number`（足した名前。純関数。返す額＝max(0, min(前の合計, 払った額) − あとの合計)。20 と後の計画の「出演とりやめ」が使う）

- [ ] **Step 1: 落ちる試験 `recitalMoneyDb.test.ts` を書く**

```ts
// 頭：await setupRecitalTestDb('money'); await seedRecitalTestEvent('t-money'); const money = await import('../recitalMoneyDb');
// pay(hid, amount, method='bank', extra={}) … core.withWriteTx((tx) => money.insertPaymentTx(tx, { householdId: hid, method, amount, paidOn: '2026-12-21', source: 'bank_staff', ...extra }, 'TARO'))
// bankRow(amount, eventKey='t-money') … recital_bank_rows に state='matched'・dir='in'・kind='transfer'・source='chat' の1行を足して id を返す
describe('返す額の例（05 5-7 の12行）', () => {
  it.each([
    ['合同で1つへる（1人3作品・全部払った）', 35500, 35500, 32500, 3000],
    ['合同で1つへる（1人2作品・全部払った）', 32500, 32500, 26500, 6000],
    ['1人1作品のその作品がなくなる', 26500, 26500, 0, 26500],
    ['兄1・妹1で妹の作品がなくなり妹が出ない', 34500, 34500, 26500, 8000],
    ['兄2・妹1で同上', 37500, 37500, 32500, 5000],
    ['お支払いずみ 3,000 の世帯で、もう1つがスクールの都合でなくなる', 32500, 35500, 26500, 6000],
    ['1作品払って1つ足した（差額まだ）世帯で、足した作品がなくなる', 32500, 26500, 26500, 0],
    ['まだ払っていない2作品の世帯で1つがなくなる', 32500, 0, 26500, 0],
    ['別々に払った家族（1作品ずつ）をまとめる', 53000, 53000, 34500, 18500],
    ['同じ子の二重の申込を両方払った', 53000, 53000, 26500, 26500],
    ['払った1人1作品の1人目を「協力チケットなし」に直した', 26500, 26500, 19000, 7500],
  ])('%s', (_, totalBefore, paid, totalAfter, want) => {
    expect(money.refundForDecrease({ totalBefore, paid, totalAfter })).toBe(want);
  });
  it('26,500 の世帯が 32,500 を振り込んだ（人が当てた）→ 返す分 6,000（1番・もとの入金つき）', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const r = await pay(hid, 32500);
    const ref = await core.getOne('SELECT amount, reason_no, source_payment_id, status FROM recital_refunds WHERE id=?', [r.refundId]);
    expect([Number(ref.amount), Number(ref.reason_no), Number(ref.source_payment_id), ref.status]).toEqual([6000, 1, r.paymentId, 'todo']);
    expect(r.after).toEqual({ total: 26500, paid: 26500, remaining: 0, overpaid: 0 });
  });
});
describe('お支払いずみの分と返す分のちがい（05 5-7 の5行）', () => {
  // setTotal(hid, n) … 生きている請求の行を void にして額 n の base を1行足す（Task 10 の試験と同じ小さな関数）
  it('(1) 35,500 払ったあと家庭の都合で1作品へらした → 払った 35,500・合計 32,500・お支払いずみ 3,000', async () => {
    const hid = await seedHousehold('t-money', { total: 35500, cast: 'in' });
    await pay(hid, 35500, 'cash'); await setTotal(hid, 32500);
    expect((await money.readHouseholdMoney(hid)).m).toEqual({ total: 32500, paid: 35500, remaining: 0, overpaid: 3000 });
  });
  it('(2) 26,500 の世帯が 32,500 振り込んだ（当てたあと）→ 返す分 6,000・払った 26,500・お支払いずみ 0', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await pay(hid, 32500);
    const r = await money.readHouseholdMoney(hid);
    expect([r.m.paid, r.m.overpaid, r.refundTodo]).toEqual([26500, 0, 6000]);
  });
  it('(3) その世帯に 6,000 を返したあと → 入金 26,500・返す分 0・払った 26,500', async () => {
    // 「返金を記録」は後の計画。ここでは refunds を status='done' にし、入金に -6,000 の行を SQL で入れて同じ数字を確かめる
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const p = await pay(hid, 32500);
    await core.execute("UPDATE recital_refunds SET status='done' WHERE id=?", [p.refundId]);
    await core.execute("INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, created_at) VALUES ('t-money', ?, 'bank', -6000, '2026-12-28', 'manual', ?)", [hid, new Date().toISOString()]);
    const r = await money.readHouseholdMoney(hid);
    expect([r.m.paid, r.m.overpaid, r.refundTodo]).toEqual([26500, 0, 0]);
  });
  it('(4) 返す前に cancelRefund → 入金 32,500・払った 32,500・合計 26,500・お支払いずみ 6,000（K187）', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const p = await pay(hid, 32500);
    await money.cancelRefund(p.refundId!, 'そのまま預かる（家庭と話した）', 'TARO');
    expect((await money.readHouseholdMoney(hid)).m).toEqual({ total: 26500, paid: 32500, remaining: 0, overpaid: 6000 });
  });
  it('(5) 35,500 払った世帯で1作品がスクールの都合でなくなった → 4番の返す分 3,000・払った 32,500・お支払いずみ 0', async () => {
    const hid = await seedHousehold('t-money', { total: 35500, cast: 'in' });
    await pay(hid, 35500, 'cash'); await setTotal(hid, 32500);
    await core.withWriteTx((tx) => money.createRefundTx(tx, { householdId: hid, amount: 3000, reasonNo: 4, reason: 'スクールの都合で作品がなくなった', createdBy: 'TARO' }));
    const r = await money.readHouseholdMoney(hid);
    expect([r.m.paid, r.m.overpaid, r.refundTodo]).toEqual([32500, 0, 3000]);
  });
});
describe('守り', () => {
  it('同じ台帳行×同じ世帯の生きているプラスは1つ', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const row = await bankRow(26500);
    await pay(hid, 13000, 'bank', { bankRowId: row });
    await expect(pay(hid, 13500, 'bank', { bankRowId: row })).rejects.toThrow('recital_money:live_exists');
  });
  it('1台帳行の合計は行の額まで（2つの世帯に分ける 26,500＋26,500 は通り、もう1円は通らない）', async () => {
    const a = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const b = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const c = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const row = await bankRow(53000);
    await pay(a, 26500, 'bank', { bankRowId: row });
    await pay(b, 26500, 'bank', { bankRowId: row });
    await expect(pay(c, 1, 'bank', { bankRowId: row })).rejects.toThrow('recital_money:row_over');
  });
  it('rejects bank row of another event', async () => {
    await seedRecitalTestEvent('t-money-other');
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await expect(pay(hid, 26500, 'bank', { bankRowId: await bankRow(26500, 't-money-other') })).rejects.toThrow('recital_money:bad_input');
  });
  it('払った額が0未満になる書き込みは通さず、行も増えない', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await expect(pay(hid, -1000, 'cash')).rejects.toThrow('recital_money:negative');
    expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [hid])).n)).toBe(0);
  });
  it('出演なしの世帯に当てても返す分を作らない（K207）', async () => {
    const hid = await seedHousehold('t-money', { total: 0, cast: 'out' });
    expect((await pay(hid, 26500)).refundId).toBeNull();
  });
  it('振込で当たったら「振り込みました」の5列を閉じ、記録に前の日と金額（名義は残さない）', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await core.execute("UPDATE recital_households SET bank_told_at='2026-12-21T01:00:00.000Z', bank_told_date='2026-12-21', bank_told_name='4827 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [hid]);
    const r = await pay(hid, 26500, 'bank');
    const h = await core.getOne('SELECT bank_told_at, bank_told_date, bank_told_name, bank_told_amount, bank_told_by FROM recital_households WHERE id=?', [hid]);
    expect(Object.values(h).every((v) => v === null)).toBe(true);
    const c = await core.getOne("SELECT before_json, after_json FROM recital_changes WHERE household_id=? AND action='payment_recorded' ORDER BY id DESC", [hid]);
    expect(JSON.parse(c.before_json).told).toEqual({ at: '2026-12-21T01:00:00.000Z', date: '2026-12-21', amount: 26500, by: 'family' });
    expect(JSON.parse(c.after_json).paymentId).toBe(r.paymentId);
    expect(String(c.before_json)).not.toContain('ヤマダ');
  });
  it('カードでは印を閉じない', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await core.execute("UPDATE recital_households SET bank_told_at='2026-12-21T01:00:00.000Z', bank_told_date='2026-12-21', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [hid]);
    await pay(hid, 26500, 'card', { source: 'stripe_webhook' });
    expect((await core.getOne('SELECT bank_told_amount a FROM recital_households WHERE id=?', [hid])).a).toBe(26500);
  });
  it('カードと振込の両方で払われたら、返す分はカードの入金に結び「（カードの方を Stripe で返す）」（2-25）', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const card = await pay(hid, 26500, 'card', { source: 'stripe_webhook' });
    const bank = await pay(hid, 26500, 'bank', { bankRowId: await bankRow(26500) });
    const ref = await core.getOne('SELECT amount, source_payment_id, reason FROM recital_refunds WHERE id=?', [bank.refundId]);
    expect([Number(ref.amount), Number(ref.source_payment_id)]).toEqual([26500, card.paymentId]);
    expect(ref.reason).toContain('（カードの方を Stripe で返す）');
  });
  it('stripe_recheck で記録したあとに手で現金を記録 → 返す分の理由に「（二重の記録かもしれません）」', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await pay(hid, 26500, 'card', { source: 'stripe_recheck' });
    const r = await money.recordManualPayment(hid, { method: 'cash', amount: 26500, paidOn: '2026-12-21', memo: '' }, 'TARO');
    const ref = await core.getOne("SELECT reason FROM recital_refunds WHERE household_id=? AND status='todo'", [hid]);
    expect(ref.reason).toContain('（二重の記録かもしれません）');
    expect(r.after.overpaid).toBe(0);
  });
  it('recordManualPayment：調整はメモ必須・振込とカードは選べない・現金は記録して after を返す', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await expect(money.recordManualPayment(hid, { method: 'adjust', amount: 440, paidOn: '2026-12-21', memo: '' }, 'TARO')).rejects.toThrow('recital_money:bad_input');
    await expect(money.recordManualPayment(hid, { method: 'bank' as never, amount: 26500, paidOn: '2026-12-21', memo: 'x' }, 'TARO')).rejects.toThrow('recital_money:bad_input');
    await expect(money.recordManualPayment(hid, { method: 'cash', amount: -100, paidOn: '2026-12-21', memo: '' }, 'TARO')).rejects.toThrow('recital_money:bad_input');
    expect((await money.recordManualPayment(hid, { method: 'cash', amount: 26500, paidOn: '2026-12-21', memo: '' }, 'TARO')).after.remaining).toBe(0);
  });
  it('打ちまちがいの打ち消し：現金 26,500 → 調整 −26,500（メモ『打ちまちがい』）で払った額 0', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await money.recordManualPayment(hid, { method: 'cash', amount: 26500, paidOn: '2026-12-21', memo: '' }, 'TARO');
    const r = await money.recordManualPayment(hid, { method: 'adjust', amount: -26500, paidOn: '2026-12-21', memo: '打ちまちがい' }, 'TARO');
    expect(r.after).toEqual({ total: 26500, paid: 0, remaining: 26500, overpaid: 0 });
    await expect(money.recordManualPayment(hid, { method: 'adjust', amount: -1, paidOn: '2026-12-21', memo: '打ちまちがい' }, 'TARO')).rejects.toThrow('recital_money:negative');
  });
  it('recordManualPayment と cancelRefund は書き込みのあと afterMoneyChanged(id,"payment") を呼ぶ', async () => {
    // afterMoneyChanged は同じファイルなので vi.spyOn(money, 'afterMoneyChanged') では捕まらない。中で呼ぶ所を内部の関数 notifyMoneyChanged にして、試験はその spy で見る
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const spy = vi.spyOn(money.__internal, 'notifyMoneyChanged');
    await money.recordManualPayment(hid, { method: 'cash', amount: 1000, paidOn: '2026-12-21', memo: '' }, 'TARO');
    expect(spy).toHaveBeenCalledWith(hid, 'payment');
  });
  it('6番の返す分は「お支払いずみの分」まで（K217）', async () => {
    const hid = await seedHousehold('t-money', { total: 35500, cast: 'in' });
    await pay(hid, 35500, 'cash'); await setTotal(hid, 32500);   // 払った 35,500・合計 32,500・お支払いずみ 3,000
    await expect(core.withWriteTx((tx) => money.createRefundTx(tx, { householdId: hid, amount: 3001, reasonNo: 6, reason: '例外として返す', createdBy: 'TARO' }))).rejects.toThrow('recital_money:over_overpaid');
    expect(await core.withWriteTx((tx) => money.createRefundTx(tx, { householdId: hid, amount: 3000, reasonNo: 6, reason: '例外として返す', createdBy: 'TARO' }))).toBeGreaterThan(0);
  });
  it('cancelRefund は理由必須・todo の行だけ', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const p = await pay(hid, 32500);
    await expect(money.cancelRefund(p.refundId!, '', 'TARO')).rejects.toThrow('recital_money:bad_input');
    await money.cancelRefund(p.refundId!, 'そのまま預かる', 'TARO');
    await expect(money.cancelRefund(p.refundId!, 'もう1回', 'TARO')).rejects.toThrow('recital_money:bad_input');
  });
  it('readHouseholdMoney は見え方・返す分・印・払い方を返す', async () => {
    const hid = await seedHousehold('t-money', { total: 32500, cast: 'in', payMethod: 'bank' });
    await core.execute("UPDATE recital_households SET bank_told_at='2026-12-21T01:00:00.000Z', bank_told_date='2026-12-21', bank_told_name='4827 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [hid]);
    expect(await money.readHouseholdMoney(hid)).toMatchObject({
      m: { total: 32500, paid: 0, remaining: 32500, overpaid: 0 }, view: 'tentative', refundTodo: 0,
      told: { date: '2026-12-21', amount: 26500, by: 'family' }, payMethod: 'bank',
    });
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalMoneyDb.test.ts`
  Expected: FAIL（`Cannot find module '../recitalMoneyDb'`）

- [ ] **Step 3: 関数を作る**

  - `readHouseholdMoneyTx`：生きている請求の行の額・入金の行の額全部・返す分 `todo` の額 → `moneySummary`。`view` は Task 6 の `loadHouseholdDetail` と同じ決め方（`hasIn`・`hasMaybe`）。`refundTodo` は `todo` の合計。`told` は `bank_told_at` があれば `{ at, date, name, amount, by }`、無ければ null。`payMethod` は `pay_method`。
  - `insertPaymentTx` の順（05 5-6・5-7、K199・K200・K202・K207）：
    1. 形：`amount` は0でない整数、`method`・`source` は値の言葉の中、`paidOn` は `YYYY-MM-DD`、世帯がある。ちがえば `bad_input`。`event_key` は世帯の物を使う。
    2. `before` ＝ `readHouseholdMoneyTx`。
    3. `bankRowId` があるとき：その行がこの発表会の物でなければ `bad_input`。「その行×この世帯」の入金の和 > 0 で、今の額がプラスなら `live_exists`。「その行」の入金の和＋今の額 > 行の `amount` なら `row_over`。
    4. 入れたあとの払った額（入金の和＋今の額−返す分 `todo`）が0未満なら `negative`。
    5. 入金の行を INSERT（`bank_transaction_id`・`bank_date`・`bank_desc`・`payer_name_raw`・`stripe_*`・`confirmed_by`・`memo`・`created_at`）。
    6. 返す分1番：今の額がプラス、`method` が `adjust` でない、`before.view` が `none` でない、今の額 > `before.remaining` のとき、`createRefundTx({ amount: 今の額 − before.remaining, reasonNo: 1, reason: '入金を記録して残りをこえた', sourcePaymentId, createdBy: 'system' })`。`sourcePaymentId` はふつう今の入金。ただし同じ世帯に生きている `card` の入金と `bank` の入金が両方ある時は、どちらの順で来ても `card` の入金にし、理由の後ろに「（カードの方を Stripe で返す）」を付ける（2-25）。同じ世帯に `source`=`manual` の入金と `stripe_webhook` か `stripe_recheck` の入金が両方あれば、理由の後ろに「（二重の記録かもしれません）」。
    7. 振込（`method`=`bank`）でプラスのときだけ、「振り込みました」の5列を NULL にする。
    8. `logChangeTx`：`action`=`payment_recorded`、`after`＝`{ paymentId, method, amount, source, bankRowId, refundId }`、`before`＝`{ told: { at, date, amount, by } | null }`（名義は入れない。28 の取り消しがここから at・date・amount・by を戻す。名義は戻らない）。
    9. `after` を読み直して返す。
  - `createRefundTx`：`amount` は正の整数、`reasonNo` は 1・2・3・4・6、`reason` は空でない。6番は `readHouseholdMoneyTx` の `m.overpaid` 以下（こえたら `over_overpaid`）。`status`=`todo`。記録 `refund_created`（6番は `isException: true`）。
  - `cancelRefund`：理由が空・`todo` でない → `bad_input`。`cancelled` にして `refund_cancelled`（理由つき）。書き込みのあと `afterMoneyChanged(householdId, 'payment')`（同じファイルの中からは `__internal.notifyMoneyChanged` を通して呼ぶ。試験が spy で見るため。`export const __internal = { notifyMoneyChanged: (id, cause) => afterMoneyChanged(id, cause) }`）。
  - `recordManualPayment`：`method` は `cash`・`adjust` だけ。`adjust` はメモ必須。`cash` はプラスだけ、`adjust` は0でない整数。`withWriteTx` で `insertPaymentTx`（`source`=`manual`・`confirmedBy`=staffName）。書き込みのあと `afterMoneyChanged(householdId, 'payment')`。
  - `afterMoneyChanged`：何もしないで返す（中身は 21・23）。書き込みの中から呼ばない、とコメントを1行。
  - カードの異議・返金を記録・返す分を作るボタンは後の計画。ここに入れたくなったら止まって知らせる。

- [ ] **Step 4: 通ることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalMoneyDb.test.ts`
  Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recitalMoneyDb.ts src/lib/__tests__/recitalMoneyDb.test.ts
git commit -m "feat(bw6): お金の核（入金の行の守り・返す分・手で入金を記録）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 最後の見直しは Fable**（お金にさわるため）。見直しの指摘は、作る係が自分で直さず、指摘の中身を知らせてから直す。

---

### Task 10: メール（`recitalEmail.ts`＋`recitalMail.ts`＋`email.ts` の `sendEmailNoBcc`）

**Files:**
- Modify: `src/lib/email.ts`（`sendEmailNoBcc` を足すだけ。`sendEmail` は変えない）
- Create: `src/lib/recitalEmail.ts`（純）
- Create: `src/lib/recitalMail.ts`（DB と送る）
- Test: `src/lib/__tests__/recitalEmail.test.ts`・`src/lib/__tests__/recitalMail.test.ts`

**Interfaces:**
- Consumes: Task 6 の `loadHouseholdDetail`・`getRecitalSettings`・`getRecitalEvent`。Task 9 の `readHouseholdMoney`（試験は本物の DB）。Task 2 の `payGate`・`payableAmount`・`recitalMyUrl`・`MAIL_SEND_FROM`・`MAIL_SEND_UNTIL`・`MoneySummary`。`@/lib/email` の `isMailConfigured`・`sendEmail`・`sendEmailNoBcc`。`@/lib/dateJst` の `weekdayJst`・`todayJst`・`nowUtcIso`。
- Produces（7・8・19・22・23・24・27・28 が呼ぶ）:
  - `sendEmailNoBcc({ to, subject, text?, html? }): Promise<void>`（`src/lib/email.ts`。鍵が無ければ `Error('mail_not_configured')` を投げる。黙って return しない）
  - `type MailKind`・`type MailVia`（split.md ③）
  - `type RecitalMailData`（足した名前。下の Step 3）
  - `buildRecitalMail(kind, d: RecitalMailData): { subject: string; text: string }`
  - `sendRecitalMail({ kind, householdId, dedupeKey?, via?, deferAtNight?, forceWait? }, now?)`・`sendPaidMail(householdId, paymentId, via, { sendRemaining?, now?, forceWait? })`（`forceWait` は足した名前。true なら時刻にかかわらず `waiting` で記録して送らない。27 が1つの束で11通目から使う）・`flushWaitingMails(eventKey, now?, limit = 20)`・`cancelWaitingMailsTx(tx, paymentId)`・`maybeResendBankGuide(householdId)`（型は split.md ③。`flushWaitingMails` の `limit` は足した引数）
  - `RECITAL_MAIL_DAILY_WARN: number`（`recitalEmail.ts`。足した名前）・`countRecitalMailsToday(now?: Date): Promise<{ count: number; warn: boolean }>`（`recitalMail.ts`。足した名前。`recital_mail_log` の今日〔JST〕の `sent`＋`failed` の数。19 の世帯の画面と 29 の取り込みの画面が「今日の送信 N通（上限に近いです）」を出す。最初の画面〔16〕には出さない。03・7-7）
  - 呼ぶ側との約束：**振込で当たった確認（`complete`／`extra_complete`／`remaining`）の `dedupe_key` は `bank_paid:<入金id>`**、カード・現金の `complete` は `complete:<世帯id>`、ご案内は `bank_guide:<世帯id>:<金額>:<通し番号>`、ほかは NULL。読みまちがいを直したあとの当て直しでメールを出さない決まり（K202）は、当てる側（28）が `sendPaidMail` を呼ばないことで守る。

- [ ] **Step 1: 落ちる試験 `recitalEmail.test.ts`（純）を書く**

```ts
// 見本の data は試験の中で1つ作る：refCode '4827'、contactName 'ヤマダ ハナコ'、eventLine 'BW6（2027年4月11日（日）・若林区文化センター）'、
// chargeLines 本体 16,000／Tシャツ 3,000／協力チケット3枚 7,500／2作品目 6,000、m { total: 32500, paid: 0, remaining: 32500, overpaid: 0 }、
// payDue '2月10日（水）'、payDueLong '2027年2月10日（水）'、payNotice 'open'、guide.bankText 'TEST-BANK-TEXT'、guide.nameLine '4827 ヤマダ ハナコ'
it('件名9つが決まりの紙 6-3 と 04 4-2 のまま', () => {
  const s = (k, over = {}) => buildRecitalMail(k, { ...D, ...over }).subject;
  expect(s('receipt')).toBe('【BOOM】BW6 お申し込みを受け付けました（仮受付）（整理番号 4827）');
  expect(s('resend_url')).toBe('【BOOM】BW6 マイページのご案内');
  expect(s('change', { change: CH })).toBe('【BOOM】BW6 お申し込みの中身が変わりました（整理番号 4827）');
  expect(s('bank_guide')).toBe('【BOOM】BW6 お振込みのご案内（整理番号 4827）');
  expect(s('complete', { via: 'card' })).toBe('【BOOM】BW6 お申し込みが完了しました（整理番号 4827）');
  expect(s('complete', { via: 'bank' })).toBe('【BOOM】BW6 ご入金を確認しました（お申し込み完了・整理番号 4827）');
  expect(s('extra_complete', { via: 'card' })).toBe('【BOOM】BW6 追加分のお支払いを受け付けました（整理番号 4827）');
  expect(s('extra_complete', { via: 'bank' })).toBe('【BOOM】BW6 ご入金を確認しました（追加分・整理番号 4827）');
  expect(s('remaining', { via: 'bank', m: { total: 32500, paid: 26500, remaining: 6000, overpaid: 0 } })).toBe('【BOOM】BW6 ご入金を確認しました（あと 6,000円です）');
});
it('合計0円で「出る」がある控えは、申込完了の件名で「お支払いはありません」・「■ お支払い」を出さない', () => {
  const z = buildRecitalMail('complete', { ...D, zeroComplete: true, chargeLines: [], m: { total: 0, paid: 0, remaining: 0, overpaid: 0 } });
  expect(z.subject).toBe('【BOOM】BW6 お申し込みが完了しました（整理番号 4827）'); // via が無い0円の完了はカード・現金と同じ件名
  expect(z.text).toContain('お支払いはありません');
  expect(z.text).not.toContain('■ お支払い');
});
it('振込先を書くのは bank_guide だけ（控え・変更の控え・完了には出ない）', () => {
  for (const k of ['receipt', 'change', 'complete', 'extra_complete', 'remaining', 'resend_url'] as const) expect(buildRecitalMail(k, { ...D, change: CH, via: 'bank' }).text).not.toContain('TEST-BANK-TEXT');
  const g = buildRecitalMail('bank_guide', D).text;
  expect(g).toContain('TEST-BANK-TEXT'); expect(g).toContain('4827 ヤマダ ハナコ'); expect(g).toContain('お振込み金額　32,500円（ちょうどの金額でお願いします）');
  expect(g).toContain('作品を足したときは、新しい金額のメールをお送りします。前のメールの金額は、古くなります。');
  expect(g).not.toContain('［コピーする］');
});
it('控えの金額と内わけは請求の行から（直書きしない）', () => {
  const t = buildRecitalMail('receipt', D).text;
  expect(t).toContain('■ 金額　32,500円'); expect(t).toContain('2作品目'); expect(t).toContain('6,000円');
});
it('払うがまだ開いていない控え：pay_open_at より前は「お支払いは、12月15日（火）から、マイページでできます。」、過ぎて pay_ok_at が空は「お支払いは、準備ができしだい、マイページでできます。」', () => {
  expect(buildRecitalMail('receipt', { ...D, payNotice: 'before', payOpenLabel: '12月15日（火）' }).text).toContain('お支払いは、12月15日（火）から、マイページでできます。');
  expect(buildRecitalMail('receipt', { ...D, payNotice: 'preparing' }).text).toContain('お支払いは、準備ができしだい、マイページでできます。');
  const open = buildRecitalMail('receipt', D).text;
  expect(open).not.toContain('準備ができしだい'); expect(open).not.toContain('12月15日（火）から');
});
it('迷っている作品だけの控えは「0円（迷っている作品は、金額に入っていません）」', () => {
  const t = buildRecitalMail('receipt', { ...D, hasMaybe: true, chargeLines: [], m: { total: 0, paid: 0, remaining: 0, overpaid: 0 },
    people: [{ name: 'ヤマダ タロウ', inWorks: [], maybeWorks: ['作品C（W03）'] }] }).text;
  expect(t).toContain('■ 金額　0円（迷っている作品は、金額に入っていません）');
  expect(t).toContain('作品C（W03）');
});
it('年末年始の1行は restLine があるときだけ', () => {
  const g = (restLine: string | null) => buildRecitalMail('bank_guide', { ...D, guide: { ...D.guide!, restLine } }).text;
  expect(g('年末年始（12月30日〜1月3日）の確認は、1月4日からです。')).toContain('年末年始（12月30日〜1月3日）の確認は、1月4日からです。');
  expect(g(null)).not.toContain('年末年始');
});
it('どのメールも終わりに「このメールに心当たりがないときは、そのままにしてください。」', () => {
  const P = { amount: 32500, dateLabel: '12月21日' };
  for (const k of ['receipt', 'change', 'complete', 'extra_complete', 'remaining', 'resend_url', 'bank_guide'] as const)
    expect(buildRecitalMail(k, { ...D, change: CH, via: 'bank', paid: P, paidTotal: 32500 }).text.trimEnd().endsWith('このメールに心当たりがないときは、そのままにしてください。')).toBe(true);
});
it('振込の完了は1行目「12月21日のお振込み 32,500円を確認しました。」、払い方「銀行振込」', () => {
  const t = buildRecitalMail('complete', { ...D, via: 'bank', paid: { amount: 32500, dateLabel: '12月21日' }, paidTotal: 32500, m: { total: 32500, paid: 32500, remaining: 0, overpaid: 0 } }).text;
  const body = t.split('\n').filter((l) => l.trim() && !l.endsWith('様') && !l.startsWith('こんにちは'));
  expect(body[0]).toBe('12月21日のお振込み 32,500円を確認しました。');
  expect(t).toContain('銀行振込'); expect(t).not.toContain('カード');
});
it('sendEmailNoBcc は鍵が無いと投げる', async () => {
  delete process.env.GMAIL_APP_PASSWORD; vi.resetModules();
  const { sendEmailNoBcc } = await import('../email');
  await expect(sendEmailNoBcc({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow('mail_not_configured');
});
```

- [ ] **Step 2: 落ちる試験 `recitalMail.test.ts`（DB）を書く**

```ts
// 頭：const sendEmailNoBcc = vi.fn(async () => {}); const sendEmail = vi.fn(async () => {}); let configured = true;
// vi.mock('@/lib/email', () => ({ isMailConfigured: () => configured, sendEmailNoBcc: (...a) => sendEmailNoBcc(...a), sendEmail: (...a) => sendEmail(...a) })); '.ts' も同じ
// await setupRecitalTestDb('mail'); await seedRecitalTestEvent('t-mail');
const at = (jst: string) => new Date(jst.replace(' ', 'T') + ':00+09:00');
it('鍵が無ければ送らず failed を記録', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  configured = false; sendEmailNoBcc.mockClear();
  const r = await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:00'));
  configured = true;
  expect(r.status).toBe('failed');
  expect(sendEmailNoBcc).not.toHaveBeenCalled();
});
it('is_test=1 は test_mail_to へ。空なら送らず failed', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  await mail.sendRecitalMail({ kind: 'receipt', householdId: hid }, at('2026-12-20 10:00'));
  expect(sendEmailNoBcc.mock.calls.at(-1)[0].to).toBe('test@example.com');
  await core.execute("UPDATE recital_settings SET value='' WHERE event_key='t-mail' AND key='test_mail_to'");
  const calls = sendEmailNoBcc.mock.calls.length;
  expect((await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:01'))).status).toBe('failed');
  expect(sendEmailNoBcc.mock.calls.length).toBe(calls);
  await core.execute("UPDATE recital_settings SET value='test@example.com' WHERE event_key='t-mail' AND key='test_mail_to'");
});
it('mail_bcc_staff=1 のときだけ写しつきの sendEmail', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  const setBcc = (v: string) => core.execute("UPDATE recital_settings SET value=? WHERE event_key='t-mail' AND key='mail_bcc_staff'", [v]);
  sendEmail.mockClear(); sendEmailNoBcc.mockClear();
  await setBcc('1');
  await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:00'));
  expect([sendEmail.mock.calls.length, sendEmailNoBcc.mock.calls.length]).toEqual([1, 0]);
  await setBcc('0');
  await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:01'));
  expect([sendEmail.mock.calls.length, sendEmailNoBcc.mock.calls.length]).toEqual([1, 1]);
});
it('dedupe で2回目を送らない', async () => {
  const hid = await seedHousehold('t-mail', { total: 0, cast: 'in' });
  const a = await mail.sendRecitalMail({ kind: 'complete', householdId: hid, dedupeKey: `complete:${hid}` }, at('2026-12-20 10:00'));
  const b = await mail.sendRecitalMail({ kind: 'complete', householdId: hid, dedupeKey: `complete:${hid}` }, at('2026-12-20 10:05'));
  expect([a.status, b.status]).toEqual(['sent', 'duplicate']);
  expect(sendEmailNoBcc.mock.calls.filter((c) => c[0].subject.includes('完了'))).toHaveLength(1);
});
it.each([['2026-12-20 21:00', 'sent'], ['2026-12-20 21:01', 'waiting'], ['2026-12-21 07:59', 'waiting'], ['2026-12-21 08:00', 'sent']])('夜の待ち：%s は %s', async (t, want) => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  expect((await mail.sendRecitalMail({ kind: 'receipt', householdId: hid, deferAtNight: true }, at(t))).status).toBe(want);
});
it('flushWaitingMails は 8:00〜21:00 だけ待ちを出し、取りやめは出さない', async () => {
  await seedRecitalTestEvent('t-mail-flush');   // ほかの試験の待ちが混ざらないように別の発表会
  const h1 = await seedHousehold('t-mail-flush', { total: 26500, cast: 'in' });
  const h2 = await seedHousehold('t-mail-flush', { total: 26500, cast: 'in' });
  const p1 = await bankPay(h1, 26500); const p2 = await bankPay(h2, 26500);
  expect((await mail.sendPaidMail(h1, p1, 'bank', { now: at('2026-12-20 22:00') })).status).toBe('waiting');
  expect((await mail.sendPaidMail(h2, p2, 'bank', { now: at('2026-12-20 22:00') })).status).toBe('waiting');
  await core.withWriteTx((tx) => mail.cancelWaitingMailsTx(tx, p2));
  expect((await mail.flushWaitingMails('t-mail-flush', at('2026-12-21 07:30'))).sent).toBe(0);
  expect((await mail.flushWaitingMails('t-mail-flush', at('2026-12-21 08:00'))).sent).toBe(1);
  expect((await core.getOne('SELECT status s FROM recital_mail_log WHERE dedupe_key=?', [`bank_paid:${p2}`])).s).toBe('cancelled');
  expect((await core.getOne('SELECT status s FROM recital_mail_log WHERE dedupe_key=?', [`bank_paid:${p1}`])).s).toBe('sent');
});
describe('sendPaidMail', () => {
  // cardPay(hid, amount) / bankPay(hid, amount) … Task 9 の insertPaymentTx で入金を入れて paymentId を返す（bank は台帳行つき）
  it('カードで残り0 → complete（カードの件名）', async () => {
    const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
    const pid = await cardPay(hid, 26500);
    expect((await mail.sendPaidMail(hid, pid, 'card', { now: at('2026-12-20 10:00') })).kind).toBe('complete');
    expect(sendEmailNoBcc.mock.calls.at(-1)[0].subject).toBe(`【BOOM】BW6 お申し込みが完了しました（整理番号 ${await ref(hid)}）`);
  });
  it('足したあとまた0 → extra_complete', async () => {
    const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
    await mail.sendPaidMail(hid, await cardPay(hid, 26500), 'card', { now: at('2026-12-20 10:00') });
    await setTotal(hid, 32500);
    expect((await mail.sendPaidMail(hid, await cardPay(hid, 6000), 'card', { now: at('2026-12-22 10:00') })).kind).toBe('extra_complete');
  });
  it('振込で 21:30 に当たる → waiting・鍵は bank_paid:<入金id>', async () => {
    const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
    const pid = await bankPay(hid, 26500);
    expect((await mail.sendPaidMail(hid, pid, 'bank', { now: at('2026-12-20 21:30') })).status).toBe('waiting');
    expect((await core.getOne('SELECT dedupe_key k FROM recital_mail_log WHERE household_id=? ORDER BY id DESC', [hid])).k).toBe(`bank_paid:${pid}`);
  });
  it('全額が返す分（もう払い済みだった）→ 出さない', async () => {
    const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
    await cardPay(hid, 26500);
    const pid = await bankPay(hid, 26500);   // 返す分1番 26,500 ができる
    expect(await mail.sendPaidMail(hid, pid, 'bank', { now: at('2026-12-20 10:00') })).toEqual({ status: 'none' });
  });
  it('一部の入金で sendRemaining → remaining（あと 6,000円）、なし → 出さない', async () => {
    const hid = await seedHousehold('t-mail', { total: 32500, cast: 'in' });
    const p1 = await bankPay(hid, 26500);
    expect((await mail.sendPaidMail(hid, p1, 'bank', { now: at('2026-12-20 10:00') })).status).toBe('none');
    const hid2 = await seedHousehold('t-mail', { total: 32500, cast: 'in' });
    const p2 = await bankPay(hid2, 26500);
    expect((await mail.sendPaidMail(hid2, p2, 'bank', { sendRemaining: true, now: at('2026-12-20 10:00') })).kind).toBe('remaining');
    expect(sendEmailNoBcc.mock.calls.at(-1)[0].subject).toBe('【BOOM】BW6 ご入金を確認しました（あと 6,000円です）');
  });
  it('出演なしの世帯（view none）に 26,500 を当てても、どのメールも出さない（場面10・44）', async () => {
    const hid = await seedHousehold('t-mail', { total: 0, cast: 'out' });
    const pid = await bankPay(hid, 26500);
    expect(await mail.sendPaidMail(hid, pid, 'bank', { now: at('2026-12-20 10:00') })).toEqual({ status: 'none' });
    expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_mail_log WHERE household_id=?', [hid])).n)).toBe(0);
  });
});
it('マイページの URL は家庭向けのドメイン', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  await mail.sendRecitalMail({ kind: 'receipt', householdId: hid }, at('2026-12-20 10:00'));
  expect(sendEmailNoBcc.mock.calls.at(-1)[0].text).toMatch(/https:\/\/event\.boom-sendai\.com\/bw6\/my\?t=[0-9a-f]{48}&from=mail/);
  expect(sendEmailNoBcc.mock.calls.at(-1)[0].text).not.toContain('vercel.app');
});
it('countRecitalMailsToday：今日（JST）の sent＋failed を数え、しきい値以上で warn', async () => {
  const t = at('2026-12-20 12:00');
  const c0 = (await mail.countRecitalMailsToday(t)).count;
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  configured = false;   // 送らずに failed を記録させる
  for (let i = c0; i < RECITAL_MAIL_DAILY_WARN; i++) await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, t);
  configured = true;
  await mail.sendRecitalMail({ kind: 'receipt', householdId: hid, deferAtNight: true }, at('2026-12-20 22:00')); // waiting は数えない
  const c = await mail.countRecitalMailsToday(at('2026-12-20 23:00'));
  expect(c.count).toBe(RECITAL_MAIL_DAILY_WARN);
  expect(c.count).toBeGreaterThanOrEqual(RECITAL_MAIL_DAILY_WARN);
  expect(c.warn).toBe(true);
  expect((await mail.countRecitalMailsToday(at('2026-12-21 08:00'))).warn).toBe(false);
});
it('flushWaitingMails は1回に20通まで', async () => {
  await seedRecitalTestEvent('t-mail-cap');
  for (let i = 0; i < 25; i++) {
    const hid = await seedHousehold('t-mail-cap', { total: 26500, cast: 'in' });
    await mail.sendRecitalMail({ kind: 'receipt', householdId: hid, deferAtNight: true }, at('2026-12-20 22:00'));
  }
  expect((await mail.flushWaitingMails('t-mail-cap', at('2026-12-21 08:00'))).sent).toBe(20);
  expect((await mail.flushWaitingMails('t-mail-cap', at('2026-12-21 08:05'))).sent).toBe(5);
});
it('ご案内は同じ金額を続けて出さず、元の金額に戻れば出す（26,500→26,500→32,500→26,500 で3通）', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in', payMethod: 'bank' });
  await mail.maybeResendBankGuide(hid); await mail.maybeResendBankGuide(hid);
  await setTotal(hid, 32500); await mail.maybeResendBankGuide(hid);
  await setTotal(hid, 26500); await mail.maybeResendBankGuide(hid);
  const keys = (await core.getAll("SELECT dedupe_key FROM recital_mail_log WHERE household_id=? AND mail_kind='bank_guide' ORDER BY id", [hid])).map((r) => r.dedupe_key);
  expect(keys).toEqual([`bank_guide:${hid}:26500:1`, `bank_guide:${hid}:32500:2`, `bank_guide:${hid}:26500:3`]);
});
it('ご案内：振込でない世帯・残り0・bank_text が空・返す分≧残り のときは出さない', async () => {
  const n = async (hid: number) => Number((await core.getOne("SELECT COUNT(*) n FROM recital_mail_log WHERE household_id=? AND mail_kind='bank_guide'", [hid])).n);
  const card = await seedHousehold('t-mail', { total: 26500, cast: 'in', payMethod: 'card' });
  await mail.maybeResendBankGuide(card); expect(await n(card)).toBe(0);
  const done = await seedHousehold('t-mail', { total: 26500, cast: 'in', payMethod: 'bank' });
  await cardPay(done, 26500); await mail.maybeResendBankGuide(done); expect(await n(done)).toBe(0);
  const big = await seedHousehold('t-mail', { total: 32500, cast: 'in', payMethod: 'bank' });
  await cardPay(big, 26500);   // 残り 6,000
  await core.execute("INSERT INTO recital_refunds (event_key, household_id, amount, reason_no, reason, status, created_at, created_by) VALUES ('t-mail', ?, 6000, 4, 'テスト', 'todo', ?, 'TARO')", [big, new Date().toISOString()]);
  await mail.maybeResendBankGuide(big); expect(await n(big)).toBe(0);
  const nob = await seedHousehold('t-mail', { total: 26500, cast: 'in', payMethod: 'bank' });
  await core.execute("UPDATE recital_settings SET value='' WHERE event_key='t-mail' AND key='bank_text'");
  await mail.maybeResendBankGuide(nob); expect(await n(nob)).toBe(0);
  await core.execute("UPDATE recital_settings SET value='TEST-BANK-TEXT' WHERE event_key='t-mail' AND key='bank_text'");
});
it('error に宛先を書かない', async () => {
  const hid = await seedHousehold('t-mail', { total: 26500, cast: 'in' });
  sendEmailNoBcc.mockRejectedValueOnce(Object.assign(new Error('x@example.com rejected'), { code: 'EENVELOPE' }));
  const r = await mail.sendRecitalMail({ kind: 'resend_url', householdId: hid }, at('2026-12-20 10:00'));
  expect(r.status).toBe('failed');
  const e = String((await core.getOne('SELECT error FROM recital_mail_log WHERE id=?', [r.logId])).error);
  expect(e).not.toContain('@'); expect(e).toContain('EENVELOPE');
});
```
  `setTotal(hid, n)` は試験の中の小さな関数（生きている請求の行を void にして額 n の `base` を1行足す）。

- [ ] **Step 3: 落ちることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalEmail.test.ts` と `npx vitest run src/lib/__tests__/recitalMail.test.ts`（1つずつ）
  Expected: どちらも FAIL（`Cannot find module`）

- [ ] **Step 4: `sendEmailNoBcc` と `buildRecitalMail` を作る**

  `RecitalMailData`（`recitalEmail.ts` から export）：
```ts
export type RecitalMailData = {
  contactName: string; refCode: string; myUrl: string; eventLine: string;
  people: { name: string; inWorks: string[]; maybeWorks: string[] }[];   // 作品は「作品の名前（W03）」の形
  chargeLines: { label: string; amount: number }[];                     // 生きている請求の行
  m: MoneySummary; hasMaybe: boolean; zeroComplete: boolean;
  payDue: string; payDueLong: string;                                   // '2月10日（水）'／'2027年2月10日（水）'。pay_due_override があればその日
  payNotice: 'open' | 'before' | 'preparing'; payOpenLabel: string;     // payGate の結果と '12月15日（火）'
  changeCloseLabel: string; mypageItems: string;                        // '1月31日（日）23:59'／マイページに今出ている物だけ（K221）
  nextContact: string;                                                  // '2月ごろ'（下の決め方）
  via?: MailVia;
  paid?: { amount: number; dateLabel: string };                         // その入金（振込は bank_date）
  paidTotal?: number;                                                   // 完了の「■ お支払い」の額（調整の入金を除いた和）
  addedWorks?: { name: string; works: string[] }[];
  change?: { lines: string[]; totalBefore: number; totalAfter: number; kind: 'unpaid' | 'paid_add' | 'paid_drop' | 'fee_refund' | 'no_money'; afterFeb1: boolean; refundAmount: number; merged?: { intoRefCode: string } };
  guide?: { amount: number; bankText: string; nameLine: string; restLine: string | null };
};
```
  本文は次の見本のまま（◯ の所に data を差し込む。金額は `toLocaleString('ja-JP')`＋`円`）：受付の控え・変更の控え・URL の送り直し＝設計書 04 4-2「自動メール」の見本と下の表（`survey-ch04-05.md` 2-5 に写しあり）。お振込みのご案内・申込完了（カード・現金／振込）・追加分・あと◯円＝決まりの紙 2-24 と 07 7-8（`survey-ch06-11.md` 6-3 に写しあり）。決まり：頭は「（名前）様」「こんにちは、BOOMダンススクールです。」、終わりは「こまったときは、公式LINEでお知らせください。」「BOOMダンススクール」と、いちばん終わりに「このメールに心当たりがないときは、そのままにしてください。」。ご案内のメールは画面の文の「このページの『振り込みました』」「このページから、カードでも」を「マイページの」に置きかえ、［コピーする］と銀行ごとの早見は入れず、最後に「作品を足したときは、…古くなります。」を1行足す。払い方の表示は `card`＝カード・`bank`＝銀行振込・`cash`＝現金（`adjust` は「現金」と同じ形の件名で、払い方の行を書かない）。`change.kind` ごとの「■ 金額」の下の行は 04 4-2 の表の5行のまま（`afterFeb1` のときは「当てられます」の文を出さない、`no_money` は金額の■を出さない）。`resend_url` には `contactName` 以下の頭を付けない（見本どおり2行＋最後の1行）。`change.merged` があるときは、「■ 変わったこと」の頭に「ご家族のお申し込みが2つに分かれていました。1つにまとめて、金額を直しました。」と「これからは、整理番号 {intoRefCode} のマイページをお使いください。」の2行を出す（20 の世帯をまとめる時の控え。合わせて試験を1つ：`change: { ...CH, merged: { intoRefCode: '5724' } }` の本文に '5724' と「1つにまとめて」がある）。`RECITAL_MAIL_DAILY_WARN` は、作る前に U5（Gmail の1日の送信上限。今のアプリの送り口のアカウントの種類で決まる）を調べて、その8割の数を置く（調べて分からなければ 400 にして、止まって知らせる）。

  `sendEmailNoBcc`：`sendEmail` と同じ送り方で `bcc` を付けない。鍵が無ければ `throw new Error('mail_not_configured')`。

- [ ] **Step 5: `recitalMail.ts` の関数を作る**

  - `sendRecitalMail`：
    1. 世帯・発表会・設定を読む。宛先は世帯の `email`。`is_test`=1 なら `test_mail_to`（空なら送らず `failed`「test_mail_to が空」）。宛先が無ければ `failed`。
    2. `dedupeKey` があれば、その鍵の行がもうあるとき `{ status: 'duplicate', logId }`。無ければ `recital_mail_log` に `status`=`waiting`・`sent_at` NULL で先に1行入れる（一意に当たったら `duplicate`）。
    3. `forceWait` なら `waiting` のまま返す。`deferAtNight` で、JST の時刻が `MAIL_SEND_FROM`(08:00) より前か `MAIL_SEND_UNTIL`(21:00) より後（分でくらべる。21:00 ちょうどは送る）なら、`waiting` のまま返す。
    4. `isMailConfigured()` が false → `failed`「メールの鍵が無い」。
    5. data を作って `buildRecitalMail` → `mail_bcc_staff` が false なら `sendEmailNoBcc`、true なら `sendEmail`。送れたら `sent`・`sent_at`。投げられたら `failed`、`error` は「送信に失敗」＋例外の `code`（あれば）だけ（宛先・氏名を書かない）。
    - data の作り方：`loadHouseholdDetail` と設定から。`myUrl` は Task 2 の `recitalMyUrl(token, { fromMail })`（`receipt` と0円の `complete` は `fromMail: true`。`NEXT_PUBLIC_BASE_URL` は使わない）。世帯が `merged` の時は `change.merged` に `{ intoRefCode: まとめ先の整理番号 }` を入れる。`payNotice` は `payGate(s, now)`。`mypageItems` は段階1は「お支払い、インスタ」（作品を足す・やめるを出すと決めたら 15 が直す）。`nextContact` は `roster_fix_on` があればその月の「◯月ごろ」、空なら「2月ごろ」（計画で仮に決めた。12/8 に TARO が見る）。`change` は、この世帯の前の控え（`receipt`・`change`・`complete`・`extra_complete` の記録）の `created_at` より後の変えた記録から作る（`cast_add`＝「（名前）『（作品）』を足しました」、`cast_out`＝「…をやめました」、`cast_decide`＝「…を『出る』にしました」、`person_edit`／`insta_edit`／`contact_edit`＝「お名前を直しました」／「インスタの欄を直しました」／「連絡先を直しました」。前後の合計は `total_changed` から）。`paid` は `dedupeKey` が `bank_paid:<id>` ならその入金、ほかは世帯のいちばん新しい `adjust` でないプラスの入金。`guide.amount` は `payableAmount(m, told)`、`restLine` は今日（JST）が `bank_rest_to` 以前なら決まりの紙の1行（日付は設定から）、過ぎたら null。
  - `sendPaidMail(householdId, paymentId, via, opts)`：返り値は `{ status: 'none' }` か `{ kind, status, logId }`。世帯の見え方が `none`（出演なし）なら、どのメールも出さない（返すか戻すかは TARO か KEIKO が決め、家庭へは人が公式LINEで伝える。場面10・44）。今の残りが0のとき、その入金から作った返す分の額が入金の額と同じ（＝もう払い済みだった。K188）なら出さない。そうでなければ、この世帯に `complete` の記録（`cancelled` 以外）があれば `extra_complete`、無ければ `complete`。残りが >0 なら `opts.sendRemaining` のときだけ `remaining`。鍵は `via`=`bank` なら `bank_paid:<paymentId>`＋`deferAtNight: true`、ほかは `complete` のときだけ `complete:<householdId>`（`extra_complete` は NULL）。
  - `flushWaitingMails`：JST の時刻が 08:00〜21:00 の外なら `{ sent: 0, failed: 0 }`。中なら、その発表会の `waiting` の行を古い順に `limit`（20）通まで（関数は60秒まで。残りは次の回）、行の `mail_kind` と `dedupe_key`（`bank_paid:<id>` なら入金を読み直す）で作り直して送り、同じ行を `sent`／`failed` にする。
  - `cancelWaitingMailsTx(tx, paymentId)`：`dedupe_key`=`'bank_paid:'+paymentId` で `waiting` の行を `cancelled`。
  - `countRecitalMailsToday(now)`：`created_at` が JST の今日（`todayJst(now)` の 0:00〜24:00 を UTC に直した範囲）の行のうち `status` が `sent`・`failed` の数。`warn`＝`count >= RECITAL_MAIL_DAILY_WARN`。
  - `maybeResendBankGuide(householdId)`：`pay_method`=`bank`、`bank_text` が空でない、返す分 `todo` < 残り、`payableAmount(m, told)` > 0 のときだけ。いちばん新しいご案内の記録（`cancelled` 以外）の鍵の金額と今の金額が同じなら出さない。出すときの鍵は `bank_guide:<id>:<金額>:<その世帯のご案内の記録の数＋1>`。
  - 段階2のメール（`pay_guide` など）は作らない。必要に見えたら止まって知らせる。

- [ ] **Step 6: 通ることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalEmail.test.ts` → PASS
  Run: `npx vitest run src/lib/__tests__/recitalMail.test.ts` → PASS

- [ ] **Step 7: コミット**

```bash
git add src/lib/email.ts src/lib/recitalEmail.ts src/lib/recitalMail.ts src/lib/__tests__/recitalEmail.test.ts src/lib/__tests__/recitalMail.test.ts
git commit -m "feat(bw6): 発表会のメール7種（写しなしの送り口・夜の待ち・同じ知らせを2回出さない）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: 最後の見直しは Fable**（お金の知らせの文と、送る・送らないの決まり）。文は 12/8（火）に TARO が見る（split.md ④C-9）。

---

### Task 11: テストデータを消す道具と、本番の種（後半は 12/13（日））

**6 のコミットの後に始める（同じファイル）。**

**Files:**
- Create: `src/lib/recitalReset.ts`（足した名前。import を1つも持たない純ファイル。スクリプトが `.ts` のまま読むため）
- Modify: `src/lib/recitalDb.ts`（`resetTestEvent` を足す）
- Create: `scripts/recital_reset_testdata.mjs`
- Test: `src/lib/__tests__/recitalDb.test.ts`（`describe` を足す）
- 12/13 に Create: `scripts/migrations/20261213_recital_seed_bw6.sql`・`scripts/migrations/20261213_recital_seed_smoke.sql`

**Interfaces:**
- Consumes: Task 6 の下ごしらえ（`seedRecitalTestEvent`・`seedHousehold`）。
- Produces（Task 18 の「テストデータを消す」ボタンが呼ぶ）:
  - `recitalResetStatements(eventKey: string): { table: string; countSql: string; deleteSql: string; args: [string, string] }[]`（`src/lib/recitalReset.ts`）
  - `resetTestEvent(eventKey, { dryRun }): Promise<Record<string, number>>`（`src/lib/recitalDb.ts`。`is_test`=0・無い発表会は全部0で、何も消さない）

- [ ] **Step 1: 落ちる試験を足す**

```ts
describe('resetTestEvent', () => {
  it('is_test=0 の発表会を渡すと何も消さない（全部0）', async () => {
    await seedRecitalTestEvent('t-reset-live', { isTest: 0 });
    const hid = await seedHousehold('t-reset-live', { total: 26500, cast: 'in' });
    const r = await db.resetTestEvent('t-reset-live', { dryRun: false });
    expect(Object.values(r).every((n) => n === 0)).toBe(true);
    expect(await core.getOne('SELECT id FROM recital_households WHERE id=?', [hid])).not.toBeNull();
  });
  it('is_test=1 は入金〜変えた記録まで消し、設定・規則・作品・事前登録は残す／dryRun は数えるだけ', async () => {
    await seedRecitalTestEvent('t-reset-test');
    const hid = await seedHousehold('t-reset-test', { total: 26500, cast: 'in' });
    await core.execute("INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, created_at) VALUES ('t-reset-test', ?, 'cash', 26500, '2026-12-21', 'manual', ?)", [hid, new Date().toISOString()]);
    const dry = await db.resetTestEvent('t-reset-test', { dryRun: true });
    expect(dry.recital_payments).toBe(1); expect(dry.recital_households).toBe(1);
    expect(await core.getOne('SELECT id FROM recital_households WHERE id=?', [hid])).not.toBeNull();
    await db.resetTestEvent('t-reset-test', { dryRun: false });
    for (const t of ['recital_payments', 'recital_charges', 'recital_casts', 'recital_people', 'recital_households']) expect(Number((await core.getOne(`SELECT COUNT(*) n FROM ${t} WHERE event_key='t-reset-test'`)).n)).toBe(0);
    for (const t of ['recital_settings', 'recital_fee_rules', 'recital_works']) expect(Number((await core.getOne(`SELECT COUNT(*) n FROM ${t} WHERE event_key='t-reset-test'`)).n)).toBeGreaterThan(0);
  });
  it('消す順は 入金→返す分→開いている支払い→請求→出演→人→世帯→台帳→束→メール記録→変えた記録', () => {
    expect(recitalResetStatements('x').map((s) => s.table)).toEqual(['recital_payments', 'recital_refunds', 'recital_checkouts', 'recital_charges', 'recital_casts', 'recital_people', 'recital_households', 'recital_bank_rows', 'recital_imports', 'recital_mail_log', 'recital_changes']);
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalDb.test.ts`
  Expected: 足した `describe` が FAIL、6 の試験は PASS のまま。

- [ ] **Step 3: 作る**

  - `recitalResetStatements`：表ごとに `countSql`＝`SELECT COUNT(*) AS n FROM <表> WHERE event_key = ? AND EXISTS (SELECT 1 FROM recital_events WHERE event_key = ? AND is_test = 1)`、`deleteSql` は同じ条件の `DELETE`。`args` は `[eventKey, eventKey]`。`is_test` の守りを文の中に入れる（呼ぶ側が確かめ忘れても消えない）。返す分と開いている支払いは split.md の8手順に無いが、世帯に付く行なので入金のすぐ後に足した（設定・規則・作品・事前登録・イントラのページの鍵は残す）。
  - `resetTestEvent`：表ごとに数え、`dryRun` でなければ `batch(deleteの文, 'write')`。返り値は表の名前→消す前の数。
  - `scripts/recital_reset_testdata.mjs <event_key> [--yes]`：`party_reset_testdata.mjs` と同じ作り（`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`、無ければ `file:./data/bw5.db`）。`import { recitalResetStatements } from '../src/lib/recitalReset.ts'`。数を出し、`--yes` が無ければ「確認だけしました。消すときは --yes を付けてください」で終わる。`is_test`=0 の発表会は「is_test=1 の発表会ではありません。何も消しません」と出して終わる。本番に使うときは `node --env-file=.env.production.local scripts/recital_reset_testdata.mjs bw6-test`（dotenv は package.json の依存に無いので使わない。Node の組み込みの読み方）。

- [ ] **Step 4: 通ることを確かめる**

  Run: `npx vitest run src/lib/__tests__/recitalDb.test.ts` → PASS
  Run: `TURSO_DATABASE_URL=file:./data/bw6_dev.db TURSO_AUTH_TOKEN= node scripts/recital_reset_testdata.mjs bw6-test` → 表ごとの数と「確認だけしました…」（手元の画面用のDB。計画の頭の「手元の画面の確かめ」で作った物。何も消さない）
  Run: `TURSO_DATABASE_URL=file:./data/bw6_dev.db TURSO_AUTH_TOKEN= node scripts/recital_reset_testdata.mjs bw6` → 「is_test=1 の発表会ではありません。何も消しません」か、全部0

- [ ] **Step 5: コミット**

```bash
git add src/lib/recitalReset.ts src/lib/recitalDb.ts src/lib/__tests__/recitalDb.test.ts scripts/recital_reset_testdata.mjs
git commit -m "feat(bw6): 試しの発表会だけを消すテストデータの片づけ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6（12/13（日）。文と料金が固まってから）: 本番の種を書く**

  `20261213_recital_seed_bw6.sql`：`bw6` の発表会1行（`is_test`=0）、設定は `suspended`='1'・`stripe_mode`='live'・`mail_bcc_staff`='0' だけ（`pay_ok_at`・`bank_text`・`ref_skip`・`test_mail_to` の行は作らない＝画面から入れる。`consent_items`・`privacy_text`〔SNS の1行入り〕・`line_url` も画面から入れる。空のままだと Task 6 の `setSuspended` が受付を開けない）、料金の規則8行（03 3-4 の表）。作品は種に入れない（12/1 から画面で入れる）。
  `20261213_recital_seed_smoke.sql`：`bw6-smoke`（`is_test`=1・`stripe_mode`='live'・`suspended`='0'・`pay_ok_at` 入り）。料金の規則の額は **TARO が決めた額**（split.md ④A-2）。額の返事がまだなら、このファイルは作らずに止まって知らせる。
  2本とも：`INSERT OR IGNORE` か `WHERE NOT EXISTS`、行の中にコメントを書かない、文字の値に `;` を書かない、鍵・乱数・`bank_text`・`ref_skip`・名前を書かない。

- [ ] **Step 7: 種を確かめて流す**

  Run: `npx vitest run src/lib/__tests__/recitalDb.test.ts`（試験のDBは台帳SQLを全部流すので、文が割れずに入ることもここで分かる）→ PASS
  手元の `data/bw5.db` には流さない（Task 1 Step 7 のわけ）。
  本番：`node --env-file=.env.production.local scripts/migrate.mjs --dry-run` → 2本だけが出ることを見てから、`--dry-run` を外す。12/14（月）からは push しない（split.md ④C-22）。

- [ ] **Step 8: コミット**

```bash
git add scripts/migrations/20261213_recital_seed_bw6.sql scripts/migrations/20261213_recital_seed_smoke.sql
git commit -m "feat(bw6): 本番と少額の試しの発表会の種

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 足した名前（split.md ③に無く、このまとまりで作った物）
- `WorkInput`（型。`src/lib/recitalDb.ts`。`saveWork` の引数。split.md ③は名前だけで中身が無かった）
- `RecitalMailData`（型。`src/lib/recitalEmail.ts`。`buildRecitalMail` の引数。split.md ③は名前だけで中身が無かった）
- `refundForDecrease(x: { totalBefore; paid; totalAfter }): number`（`src/lib/recitalMoneyDb.ts`。返す額の式。20 と後の計画が使う）
- `recitalResetStatements(eventKey)`（新しいファイル `src/lib/recitalReset.ts`。スクリプトが `@/` の別名と拡張子なしの import を読めないため、消す文だけを import なしのファイルに分けた）
- 試験の下ごしらえ `src/lib/__tests__/recitalTestSeed.ts`：`setupRecitalTestDb`・`seedRecitalTestEvent`・`seedHousehold`（DB の試験の全部が使う）
- 投げる `Error.message` の決まった値：`recital_setting:locked|unknown|bad_value`、`recital_entry:bad_email|same_email`、`recital_money:bad_input|live_exists|row_over|negative|over_overpaid`、`sendEmailNoBcc` の `mail_not_configured`
- `submitKey` の形：`randomBytes(16).toString('hex')`（32けた hex。13 が作る）

---

## 家（family）家庭の画面 — タスク 12〜15

並び：12 は 2・6 の後。13 は 7 の後。14 は 8・10 の後。15 は 8・14 の後（15 は 12/8（火）の通し試しで出すか決める。切っても 12〜14 は動く）。

このまとまり全部に効く決まり（各タスクの中では繰り返さない）：

- 公開のページ・Server Action の頭に「⚠️ 公開…(認証なし)。理由: …」を書く（`src/app/xmas/actions.ts` の頭の形）。マイページは `edit_token` 完全一致の1世帯だけ。申込があるかどうかを外から知る道を作らない。
- サーバの部品からクライアントの部品へ渡す props は、画面に要る値だけにする。`HouseholdDetail` を丸ごと渡さない（電話・メール・`staff_note`・`mails`・`changes` が HTML に乗るため）。`console.log` に URL・鍵・名前・電話・メールを出さない。
- 外へ出るリンク（公式LINE・MOCCHIN の申込など）は `target="_blank" rel="noreferrer noopener"`。マイページは metadata に `referrer: 'no-referrer'` も付ける。
- 入力欄は文字色と下地色を両方書く（`RECITAL_INPUT_CLS`。13 で作る）。画面を作ったタスクは、M5 で `npm run dev` を開き、全部の欄に実際に打って文字が見えるかを目で確かめてからコミットする。
- 金額は `yenJa`（`26,500円`）、日付は `jpDate`（`2月10日（水）`）・`slashDate`（`1/31（日）`）で出す（12 で作る）。曜日を文に直書きしない。
- DB の試験の頭は `src/lib/__tests__/bf7EntryDb.test.ts` 1〜25行と同じ形（DB のファイル名だけ `./data/test_recital_<名前>.db` に変える。`GMAIL_APP_PASSWORD` も `delete` して、メールは「失敗」で記録される状態で回す）。試験の発表会は自分の `event_key`（`t-<名前>`）を使い、種の `bw6-test` を使わない。
- 試験は1ファイルずつ回す。全件（`npm test`）は回さない。
- 計画に書いていないことに当たったら、自分で決めずに、止まって知らせる（とくに、7・8・10・16 の担当が作った関数の形が、ここに書いた形とちがう時）。

---

### Task 12: 入口の色と公開の3ページ＋試し用の鍵

**Files:**
- Create: `src/lib/recitalPreview.ts`
- Create: `src/lib/recitalPublic.ts`（純。表示の言葉・料金の早見の数・短い5行・表示用の受付の状態）
- Create: `src/app/bw6/layout.tsx`
- Create: `src/app/bw6/context.ts`（公開ページの共通の読み込み。Server Action ではないふつうのモジュール）
- Create: `src/app/bw6/page.tsx`
- Create: `src/app/bw6/guide/page.tsx`、`src/app/bw6/guide/PrintButton.tsx`
- Create: `src/app/bw6/fee/page.tsx`
- Create: `src/components/recital/FiveLines.tsx`、`src/components/recital/FeeTable.tsx`
- Test: `src/lib/__tests__/recitalPreview.test.ts`、`src/lib/__tests__/recitalPublic.test.ts`

**Interfaces:**
- Consumes:
  - 2：`RECITAL_EVENT`、`RecitalSettings`、`parseRecitalSettings(rows)`、`EntryPhase`、`entryPhase(s, nowMs, extendUntil?)`、`jstToMs(jst)`
  - 3：`FeeRule`、`FeePerson`、`expectedCharges(rules, people, currentFirstPersonId)`
  - 6：`RecitalEvent`、`getRecitalEvent(eventKey)`、`getRecitalSettings(eventKey)`
- Produces:
  - `src/lib/recitalPreview.ts`：`recitalPreviewKey(eventKey: string): string`（32けたの16進）、`isRecitalPreview(eventKey: string, v: string | null | undefined): boolean`、`resolvePreviewEvent(ev: string | null | undefined, pv: string | null | undefined, evIsTest: boolean): { eventKey: string; preview: boolean }`
  - `src/lib/recitalPublic.ts`：`yenJa(n: number): string`、`jpDate(ymdOrJst: string): string`、`slashDate(ymdOrJst: string): string`、`slashDateTime(jst: string): string`、`jpOpenLabel(jst: string): string`、`fiveLines(s: RecitalSettings): string[]`、`type FeeTableData = { first: number[]; familyFirst: number; familyAdd: number; examples: { label: string; total: number }[] }`、`feeTableFromRules(rules: FeeRule[], maxWorks: number): FeeTableData`、`publicPhase(real: EntryPhase, preview: boolean, nowMs: number, s: RecitalSettings): EntryPhase`、`FAMILY_ADD_LINE: string`、`RECITAL_MSG: { rate: string; busy: string }`
  - `src/app/bw6/context.ts`：`type RecitalPublicContext = { event: RecitalEvent | null; eventKey: string; settings: RecitalSettings; preview: boolean; pv: string | null; realPhase: EntryPhase; phase: EntryPhase; qs: string; nowMs: number }`、`getRecitalPublicContext(sp: { ev?: string; pv?: string }): Promise<RecitalPublicContext>`、`checkPublicEventKey(eventKey: string, pv: string | null): Promise<boolean>`
  - `src/components/recital/FiveLines.tsx`：`FiveLines({ lines }: { lines: string[] })`
  - `src/components/recital/FeeTable.tsx`：`FeeTable({ table, payDue, extraCostsText }: { table: FeeTableData; payDue: string; extraCostsText: string })`

- [ ] **Step 0: Next.js 16 の書き方を読む**

`node_modules/next/dist/docs/` の app router の layout・metadata（`robots`・`referrer`）・`searchParams`（Promise で来る）の所を読む（`AGENTS.md` の決まり）。読んだ版とこの計画の書き方がちがえば、止まって知らせる。

- [ ] **Step 1: 試し用の鍵の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalPreview.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recitalPreviewKey, isRecitalPreview, resolvePreviewEvent } from '../recitalPreview';

beforeEach(() => { process.env.RECITAL_PREVIEW_SECRET = 'test-secret-1'; });

describe('試し用の鍵', () => {
  it('32けたの16進で、同じ発表会なら同じ', () => {
    expect(recitalPreviewKey('bw6-test')).toMatch(/^[0-9a-f]{32}$/);
    expect(recitalPreviewKey('bw6-test')).toBe(recitalPreviewKey('bw6-test'));
  });
  it('合う鍵は通る', () => {
    expect(isRecitalPreview('bw6-test', recitalPreviewKey('bw6-test'))).toBe(true);
  });
  it('ちがう鍵・空・null は通らない', () => {
    expect(isRecitalPreview('bw6-test', '0'.repeat(32))).toBe(false);
    expect(isRecitalPreview('bw6-test', '')).toBe(false);
    expect(isRecitalPreview('bw6-test', null)).toBe(false);
  });
  it('別の発表会の鍵は通らない', () => {
    expect(isRecitalPreview('bw6-test', recitalPreviewKey('bw6-smoke'))).toBe(false);
    expect(isRecitalPreview('bw6', recitalPreviewKey('bw6-test'))).toBe(false);
  });
  it('秘密が変わると、前の鍵は通らない', () => {
    const old = recitalPreviewKey('bw6-test');
    process.env.RECITAL_PREVIEW_SECRET = 'test-secret-2';
    expect(isRecitalPreview('bw6-test', old)).toBe(false);
  });
});

describe('resolvePreviewEvent（?ev= と pv= の受け方）', () => {
  const k = (e: string) => recitalPreviewKey(e);
  it('ev なし（または bw6）は本番。本番の鍵が合えば「見るだけの試し」', () => {
    expect(resolvePreviewEvent(null, null, false)).toEqual({ eventKey: 'bw6', preview: false });
    expect(resolvePreviewEvent(undefined, k('bw6'), false)).toEqual({ eventKey: 'bw6', preview: true });
    expect(resolvePreviewEvent('bw6', k('bw6'), false)).toEqual({ eventKey: 'bw6', preview: true });
  });
  it('is_test=1 の発表会で、その発表会の鍵が合う時だけ切り替える', () => {
    expect(resolvePreviewEvent('bw6-test', k('bw6-test'), true)).toEqual({ eventKey: 'bw6-test', preview: true });
  });
  it('鍵がちがう・別の発表会の鍵・is_test=0 の発表会は、本番にもどす', () => {
    expect(resolvePreviewEvent('bw6-test', 'bad', true)).toEqual({ eventKey: 'bw6', preview: false });
    expect(resolvePreviewEvent('bw6-test', k('bw6-smoke'), true)).toEqual({ eventKey: 'bw6', preview: false });
    expect(resolvePreviewEvent('t-real', k('t-real'), false)).toEqual({ eventKey: 'bw6', preview: false });
  });
});
```

- [ ] **Step 2: 落ちるのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPreview.test.ts`
Expected: FAIL（`Cannot find module '../recitalPreview'`）

- [ ] **Step 3: `src/lib/recitalPreview.ts` を作る**

`src/lib/partyPreview.ts` と同じ作り（`createHmac`・`timingSafeEqual`、長さがちがえば false）。秘密の元は呼ぶたびに `process.env.RECITAL_PREVIEW_SECRET || process.env.PARTY_TICKET_SECRET || process.env.TURSO_AUTH_TOKEN || process.env.ADMIN_PASSWORD || 'local-dev'` を読み、HMAC の名前は `'recital-preview'`、中身は `` `preview:${eventKey}` ``、16進の先頭32けた。`resolvePreviewEvent` は「`ev` が空か `RECITAL_EVENT.live` → 本番（`preview` は本番の鍵が合うか）」「それ以外 → `evIsTest && isRecitalPreview(ev, pv)` の時だけ `{ eventKey: ev, preview: true }`、ほかは `{ eventKey: 'bw6', preview: false }`」。頭に「表示だけ。申込のサーバ処理は本物の受付の状態で判定する（R-40）」と書く。

- [ ] **Step 4: 通るのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPreview.test.ts`
Expected: PASS（8件）

- [ ] **Step 5: 表示の言葉と料金の早見の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalPublic.test.ts
import { describe, it, expect } from 'vitest';
import { parseRecitalSettings } from '../recital';
import type { FeeRule } from '../recitalFee';
import { yenJa, jpDate, slashDate, slashDateTime, jpOpenLabel, fiveLines, feeTableFromRules, publicPhase, RECITAL_MSG } from '../recitalPublic';

const r = (payer_role: 'first' | 'family', item_code: FeeRule['item_code'], nth_from: number, nth_to: number | null, unit_amount: number, qty: number, label: string, sort_order: number): FeeRule =>
  ({ payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative: 0, sort_order });
// 03 3-4 の「初めに入れる行」8行そのまま
const RULES: FeeRule[] = [
  r('first', 'base', 1, 1, 16000, 1, '出演料（本体）', 1),
  r('first', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 2),
  r('first', 'coop_ticket', 1, 1, 2500, 3, '協力チケット3枚', 3),
  r('first', 'add_work', 2, 2, 6000, 1, '2作品目', 4),
  r('first', 'add_work', 3, null, 3000, 1, '3作品目から（1作品ごと）', 5),
  r('family', 'base', 1, 1, 5000, 1, 'ご家族の参加費', 6),
  r('family', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 7),
  r('family', 'add_work', 2, null, 3000, 1, '2作品目から（1作品ごと）', 8),
];

describe('表示の言葉', () => {
  it('金額と日付（曜日は日付から出す）', () => {
    expect(yenJa(26500)).toBe('26,500円');
    expect(yenJa(0)).toBe('0円');
    expect(jpDate('2027-02-10')).toBe('2月10日（水）');
    expect(jpDate('2027-01-31 23:59')).toBe('1月31日（日）');
    expect(slashDate('2027-01-31 23:59')).toBe('1/31（日）');
    expect(slashDateTime('2027-01-31 23:59')).toBe('1/31（日）23:59');
    expect(jpOpenLabel('2026-12-15 12:00')).toBe('12月15日（火）12時');
    expect(jpOpenLabel('2026-12-15 12:30')).toBe('12月15日（火）12時30分');
  });
  it('連打よけと混んだ時の文（R-33）', () => {
    expect(RECITAL_MSG.rate).toBe('少し時間をおいて、もう一度お試しください。');
    expect(RECITAL_MSG.busy).toBe('ただいま混み合っています。もう一度『送る』を押してください。二重にはなりません。');
  });
});

describe('短い5行（R-35）', () => {
  it('初めの設定なら設計書の文のまま', () => {
    expect(fiveLines(parseRecitalSettings([]))).toEqual([
      'お申し込みのときは、お支払いはありません。送ると「仮受付」になります。',
      'お支払いは、お申し込みのすぐあとから 2月10日（水）まで、いつでもできます。カードか銀行振込です。お支払いいただいた時点で「申込完了」です。',
      '1/31（日）までは、マイページで作品を足したり、やめたりできます。「まだ迷っている」でも申し込めます。迷っている作品がある方は、決まってからお支払いください。',
      'お支払いのあとに作品を足したときは、足した分だけを、同じ「払う」からお支払いください。',
      'お支払いのあとは、お返しできません。スクールの都合で作品がなくなったときは、その分をお返しします。',
    ]);
  });
  it('日付は設定から差し込む', () => {
    const s = parseRecitalSettings([{ key: 'pay_due', value: '2027-02-12' }, { key: 'change_close_at', value: '2027-01-30 23:59' }]);
    expect(fiveLines(s)[1]).toContain('2月12日（金）まで');
    expect(fiveLines(s)[2].startsWith('1/30（土）までは')).toBe(true);
  });
});

describe('料金の早見（数は規則から。04 4-2）', () => {
  it('1人目の1〜5作品・家族2人目・家族の例', () => {
    expect(feeTableFromRules(RULES, 5)).toEqual({
      first: [26500, 32500, 35500, 38500, 41500],
      familyFirst: 8000,
      familyAdd: 3000,
      examples: [
        { label: '2人が1作品ずつ', total: 34500 },
        { label: '兄2作品・妹1作品', total: 37500 },
        { label: '3人が1作品ずつ', total: 42500 },
        { label: '4人が1作品ずつ', total: 50500 },
      ],
    });
  });
  it('1人目の表の長さは max_works_per_person', () => {
    expect(feeTableFromRules(RULES, 3).first).toEqual([26500, 32500, 35500]);
  });
});

describe('表示用の受付の状態', () => {
  const s = parseRecitalSettings([]); // entry_open_at 2026-12-15 12:00
  const before = Date.parse('2026-12-10T12:00:00+09:00');
  const after = Date.parse('2026-12-15T12:00:00+09:00');
  it('止めていても、開ける時刻の前なら「受付前」と出す（表示だけ）', () => {
    expect(publicPhase('suspended', false, before, s)).toBe('before');
    expect(publicPhase('suspended', false, after, s)).toBe('suspended');
  });
  it('試し用の鍵が合えば「受付中」の画面を出す', () => {
    expect(publicPhase('before', true, before, s)).toBe('open');
  });
  it('ほかはそのまま', () => {
    expect(publicPhase('closed', false, after, s)).toBe('closed');
    expect(publicPhase('open', false, after, s)).toBe('open');
  });
});
```

- [ ] **Step 6: 落ちるのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPublic.test.ts`
Expected: FAIL（`Cannot find module '../recitalPublic'`）。`parseRecitalSettings([])` の値が 03 3-4 の初めの値（`entry_open_at`=`2026-12-15 12:00`・`change_close_at`=`2027-01-31 23:59`・`pay_due`=`2027-02-10`）でなければ、2 の担当とずれているので止まって知らせる。

- [ ] **Step 7: `src/lib/recitalPublic.ts` を作る**

- 曜日は `weekdayJst`（`@/lib/dateJst`）か `Date.UTC` で出す（暗算しない）。`jpDate`・`slashDate` は先頭10文字の日付を見る。
- `fiveLines`：上の5つの文（04 4-2「短い5行」）。2行目の日付は `jpDate(s.pay_due)`、3行目は `slashDate(s.change_close_at)`。
- `feeTableFromRules`：`expectedCharges` に作り物の人を渡して合計を読むだけ（式を書き写さない）。人は `{ personId: i+1, seq: i+1, feeClass: null, counted: n, extraWorks: [] }`。`first[n-1]` は1人で n 作品、`familyFirst` は「2人が1作品ずつ − first[0]」、`familyAdd` は「[2,1] − [1,1]」、`examples` は [1,1]・[2,1]・[1,1,1]・[1,1,1,1] の順と上の言葉。
- `publicPhase`：`preview` なら `'open'`。`real==='suspended'` で `nowMs < jstToMs(s.entry_open_at)` なら `'before'`。ほかは `real`。（本番は 12/15 より前ずっと `suspended=1` なので、その間に開いた家庭に「止めています」と出さないため。こちらで決めた。表示だけで、送る判定は 7 が本物の状態で行う）
- `FAMILY_ADD_LINE = 'ご家族を足したいときは、12月22日（火）から、マイページでできます。お急ぎのときは、公式LINEへ。'`（R-38。段階1は「家族を足す」が無いので、いつも出す）
- `RECITAL_MSG`：上の試験の文。

- [ ] **Step 8: 通るのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPublic.test.ts`
Expected: PASS（9件）

- [ ] **Step 9: `src/app/bw6/context.ts` を作る**

- 料金の規則は Task 6 の `listFeeRules(eventKey)`（`src/lib/recitalDb.ts`）を使う。
- `getRecitalPublicContext(sp)`：`sp.ev` があれば `getRecitalEvent(sp.ev)` の `is_test===1` を見て `resolvePreviewEvent(sp.ev, sp.pv, isTest)`。決まった `eventKey` で `getRecitalEvent`・`getRecitalSettings`。`realPhase = entryPhase(settings, nowMs)`、`phase = publicPhase(realPhase, preview, nowMs, settings)`。`qs` は試しの時だけ（本番の鍵＝`?pv=…`、試しの発表会＝`?ev=…&pv=…`）。ページの中のリンクは全部 `qs` を付ける。
- `checkPublicEventKey(eventKey, pv)`：`eventKey===RECITAL_EVENT.live` なら true。それ以外は `getRecitalEvent(eventKey)?.is_test===1 && isRecitalPreview(eventKey, pv)`。13・14 の Server Action が、画面から来た `eventKey` を信じないために使う。

- [ ] **Step 10: `src/app/bw6/layout.tsx` を作る**

`src/app/xmas/layout.tsx` の型。`metadata = { title: 'BOOM 発表会 BW6', robots: { index: false, follow: false } }`。`<style>{'html, body { background: #faf6f1 !important; color: #101040 !important; }'}</style>`（sand-50 と navy-700。アプリ全体の白文字・オレンジ下地を決め直す）。中身は `max-w-xl mx-auto px-4 py-6`。印刷の時は背景を白にする（`@media print { html, body { background: #fff !important; } }` を同じ style に足す）。`export const viewport = { themeColor: '#faf6f1' };` も書く（ルートの `layout.tsx` の themeColor は BW5 のオレンジ `#f27a1a` なので、iPhone の上下のバーがオレンジになるのを止める。Next 16 の viewport の書き方は Step 0 で読んだ文書に合わせる）。

- [ ] **Step 11: `FiveLines.tsx` と `FeeTable.tsx` を作る**

- `FiveLines`：番号つきの5行（`<ol>`）。見出しは「お金のこと（大事な5つ）」。
- `FeeTable`（表だけ。04 4-2「料金の早見に書くこと」）：1人目の表（1作品〜n作品・金額）／「家族の2人目からは、1作品 {yenJa(familyFirst)}、2作品目から +{yenJa(familyAdd)}。1人 {n} 作品まで。」／家族の例の表／「ご家族の中で、いちばんお得になる組み合わせで計算しています。」／「協力チケットは、1家族に3枚です。ご家族やお友だちに渡せる入場券です。」／お支払いの文3つ（4-2 の文。日付は `jpDate(payDue)`）／「カードでお支払いのときの手数料は、スクールが持ちます。」（手数料の分け方 D5 2-6。この1文はこちらで決めた仮の文。12/8 に TARO が見る）／「このほかにかかるもの」＝`extraCostsText`（空なら見出しごと出さない）。「金額を試す」は作らない（段階2）。

- [ ] **Step 12: `/bw6`（`src/app/bw6/page.tsx`）を作る**

頭に公開のわけ（公開情報だけ。申込の中身は出さない）。`searchParams` から `getRecitalPublicContext`。`event` が null なら「準備中です」だけ。中身：発表会の名前・日時（`jpDate(show_date)`、前日リハ `jpDate(rehearsal_date)`）・会場・締切（`jpDate(entry_close_at)` と時刻）・ボタン3つ（「ご案内を読む」`/bw6/guide`／「料金を見る」`/bw6/fee`／「申し込む」`/bw6/entry`、どれも `+qs`）・`FiveLines`。`phase` が `'before'` なら「申し込む」の代わりに「{jpOpenLabel(entry_open_at)}から受け付けます」、`'suspended'` は「ただいま受付を止めています。再開までお待ちください」、`'closed'` は「受付は終わりました。ご相談は公式LINEへ」（公式LINE は `line_url`）。`preview` の時は上に「試し用の表示です」の帯。

- [ ] **Step 13: `/bw6/guide` を作る（印刷できる）**

7-9 の表の11行を、この順で、文のまま出す（問いかけの見出し・チェックの列挙・あおる言い方は使わない。7-6）。「お金の決まり」の行は `FiveLines`、「このほかにかかるもの」は `extra_costs_text`。料金は `FeeTable` を同じページに入れる。日付は設定から（「12月11日（金）より後にご入会の方も、お申し込みいただけます。」は 7-9 の文のまま）。`PrintButton.tsx`（`'use client'`、`window.print()` を呼ぶボタン1つ「印刷する」、`print:hidden`）。ボタン・帯は印刷に出さない。

- [ ] **Step 14: `/bw6/fee` を作る（表だけ）**

`listFeeRules(eventKey)` → `feeTableFromRules(rules, settings.max_works_per_person)` → `FeeTable`。規則が0行なら「準備中です」。

- [ ] **Step 15: 画面を目で確かめる（M5）**

計画の頭の「手元の画面の確かめ」のとおり、手元のファイルDB `data/bw6_dev.db` に種を入れて `npm run dev`（本番DBにつながないこと）。鍵は、dev サーバと同じ環境変数で jiti を使って出す（素の `node -e` は拡張子なしの import と `@/` を読めず、`.env.local` も読まない）：
`node --env-file=.env.local -e "const {createJiti}=require('jiti');const j=createJiti(process.cwd()+'/',{alias:{'@':process.cwd()+'/src'}});j.import('./src/lib/recitalPreview.ts').then(m=>console.log(m.recitalPreviewKey('bw6-test')))"`
（18 ができたあとは、設定の画面の「試し用のURLを写す」で同じ URL が取れる。）見る所：iPhone の上のバーが生成り色（オレンジでない）／`/bw6`・`/bw6/guide`・`/bw6/fee` が生成り色の下地に紺の文字で読める／`/bw6/fee` の数が 26,500・32,500・35,500・38,500・41,500・8,000・+3,000・34,500・37,500・42,500・50,500／`/bw6?ev=bw6-test&pv=<鍵>` で試しの帯が出て、リンクに `ev`・`pv` が付く／鍵を1文字変えると本番 `bw6` の表示にもどる／`/bw6/guide` を印刷プレビューにするとボタンが消える／ページのソースに `noindex` がある。

- [ ] **Step 16: コミット**

```bash
git add src/lib/recitalPreview.ts src/lib/recitalPublic.ts \
  src/lib/__tests__/recitalPreview.test.ts src/lib/__tests__/recitalPublic.test.ts \
  src/app/bw6/layout.tsx src/app/bw6/context.ts src/app/bw6/page.tsx \
  src/app/bw6/guide/page.tsx src/app/bw6/guide/PrintButton.tsx src/app/bw6/fee/page.tsx \
  src/components/recital/FiveLines.tsx src/components/recital/FeeTable.tsx
git commit -m "feat(bw6): 公開の3ページと試し用の鍵

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: 申込フォーム `/bw6/entry`

**Files:**
- Create: `src/lib/recitalEntryForm.ts`（純。下書きの形・カナ・画面ごとの確かめ・送る形への詰め替え・画面7の文）
- Create: `src/lib/recitalFamilyDb.ts`（`listPublicWorks`・`quoteEntry`・`resendMyPageUrl`。家庭の画面が読む物を置くファイル。`listFeeRules` は 6 の `recitalDb.ts` の物を使う）
- Create: `src/components/recital/inputCls.ts`、`src/components/recital/WorkCard.tsx`
- Create: `src/app/bw6/entry/page.tsx`、`src/app/bw6/entry/EntryForm.tsx`、`src/app/bw6/entry/actions.ts`
- Create: `src/lib/__tests__/recitalFamilySeed.ts`（試験の種。`.test.ts` ではないので単独では回らない。14・15 も使う）
- Test: `src/lib/__tests__/recitalEntryForm.test.ts`、`src/lib/__tests__/recitalEntryPublicDb.test.ts`

**Interfaces:**
- Consumes:
  - 2：`ageOn(birthday, onDate)`、`HouseholdView`、`PayGate`、`payGate(s, nowMs)`、`isCountedCast(work, cast)`、`RECITAL_RATE`、`normalizePhone`・`normalizeEmail`
  - 3：`ChargeLine`、`expectedCharges`
  - 6：`getRecitalSettings`、`listWorks`
  - 7：`EntrySubmission`、`EntryPersonInput`、`SubmitResult`、`precheckEntry(eventKey, { email, phone, people })`（書かない・送らない）、`submitEntry(s, now?)`、`buildEntryFeePeople(eventKey, people)`（金額の材料。`quoteEntry` はこれを呼ぶだけ）
  - 10：`sendRecitalMail({ kind: 'resend_url', householdId })`
  - 6：`listFeeRules`（`recitalDb.ts`）。12：`getRecitalPublicContext`、`checkPublicEventKey`、`yenJa`・`jpDate`・`slashDateTime`・`jpOpenLabel`、`FAMILY_ADD_LINE`、`RECITAL_MSG`
  - 既存：`checkRateLimit(key, max, windowSec)`（`@/lib/eventAuth`）、`todayJst()`（`@/lib/dateJst`）
- Produces:
  - `src/lib/recitalEntryForm.ts`：
    ```ts
    export type DraftPerson = { tempId: string; sameAsContact: boolean; lastName: string; firstName: string; lastKana: string; firstKana: string; birthday: string; instaHandle: string; tshirtSize: string | null; works: Record<number, 'in' | 'maybe'> };
    export type EntryDraft = { contact: { lastName: string; firstName: string; lastKana: string; firstKana: string; email: string; phone: string }; people: DraftPerson[] };
    export function toKatakana(s: string): string;
    export function entryStepErrors(step: 1 | 2 | 3, draft: EntryDraft, personIdx: number, ctx: { todayYmd: string; minSelfApplyAge: number; maxWorks: number }): Record<string, string>;
    export function workCountNotice(p: DraftPerson): string | null;
    export function draftToSubmission(d: EntryDraft, x: { eventKey: string; submitKey: string; confirmNotFamily: boolean; confirmSamePerson: boolean; consentAccepted: boolean; tshirtOn: boolean }): EntrySubmission;
    export function doneScreen(x: { view: HouseholdView; total: number; gate: PayGate; payOpenAt: string; payDue: string; hasMaybe: boolean }): { lines: string[]; button: 'マイページでお支払いへ進む' | 'マイページを見る' };
    ```
  - `src/lib/recitalFamilyDb.ts`：
    ```ts
    export type PublicWork = { id: number; workCode: string; title: string; classLabel: string; slotLabel: string; targetLabel: string; publicNote: string; feeType: string; extraFee: number | null; status: 'open' | 'draft'; instructors: string[] };
    export async function listPublicWorks(eventKey: string): Promise<PublicWork[]>;
    export type QuotePerson = { lastName: string; firstName: string; lastKana: string; firstKana: string; birthday: string | null; works: { workId: number; status: 'in' | 'maybe' }[] };   // 漢字の名前も渡す（5 の matchFeePreset が漢字だけ合う人を suspect にするため）
    export async function quoteEntry(eventKey: string, people: QuotePerson[]): Promise<{ lines: ChargeLine[]; total: number; totalIfAllIn: number }>;
    export async function resendMyPageUrl(eventKey: string, by: { email: string } | { phone: string }): Promise<{ sent: number }>;
    ```
  - `src/components/recital/inputCls.ts`：`RECITAL_INPUT_CLS: string`
  - `src/lib/__tests__/recitalFamilySeed.ts`：`seedFamilyEvent(core, ev): Promise<{ w: Record<string, number> }>`、`entryFor(ev, submitKey, people, contact?): EntrySubmission`
  - `src/app/bw6/entry/actions.ts`：`type EntryActionResult = SubmitResult | { ok: false; code: 'rate'; message: string }`、`precheckEntryAction(eventKey, pv, x)`、`quoteEntryAction(eventKey, pv, people)`、`submitEntryAction(s: EntrySubmission, pv: string | null): Promise<EntryActionResult>`

- [ ] **Step 1: フォームの純関数の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalEntryForm.test.ts
import { describe, it, expect } from 'vitest';
import { toKatakana, entryStepErrors, workCountNotice, draftToSubmission, doneScreen, type EntryDraft, type DraftPerson } from '../recitalEntryForm';

const person = (over: Partial<DraftPerson> = {}): DraftPerson => ({
  tempId: 'p1', sameAsContact: false, lastName: '山田', firstName: '花子', lastKana: 'ヤマダ', firstKana: 'ハナコ',
  birthday: '2015-05-01', instaHandle: '', tshirtSize: null, works: { 1: 'in' }, ...over,
});
const draft = (people: DraftPerson[] = [person()]): EntryDraft => ({
  contact: { lastName: '山田', firstName: '太郎', lastKana: 'ヤマダ', firstKana: 'タロウ', email: 'a@example.com', phone: '090-1234-5678' },
  people,
});
const ctx = { todayYmd: '2026-12-20', minSelfApplyAge: 18, maxWorks: 5 };

describe('カナ', () => {
  it('ひらがなはカタカナに直す', () => expect(toKatakana('やまだ はなこ')).toBe('ヤマダ ハナコ'));
});

describe('画面1 連絡する人', () => {
  it('そろっていれば空', () => expect(entryStepErrors(1, draft(), 0, ctx)).toEqual({}));
  it('メールの形・電話のけた・カタカナ以外は止める', () => {
    const d = draft(); d.contact.email = 'a@'; d.contact.phone = '0901'; d.contact.firstKana = 'たろう1';
    expect(Object.keys(entryStepErrors(1, d, 0, ctx)).sort()).toEqual(['email', 'firstKana', 'phone']);
  });
  it('iPhone の全角の電話・メールでも通る', () => {
    const d = draft(); d.contact.phone = '０９０－１２３４－５６７８'; d.contact.email = ' Ａ@Example.com ';
    expect(entryStepErrors(1, d, 0, ctx)).toEqual({});
  });
});

describe('画面2 出る人（18歳より下は「連絡する人と同じ」で進めない）', () => {
  const msg = '18歳より下の方が出るときは、前の画面に、保護者の方のことを書いてください';
  it('16歳で「連絡する人と同じ」は止める', () => {
    expect(entryStepErrors(2, draft([person({ sameAsContact: true, birthday: '2010-05-01' })]), 0, ctx).sameAsContact).toBe(msg);
  });
  it('申込の日にちょうど18歳なら進める', () => {
    expect(entryStepErrors(2, draft([person({ sameAsContact: true, birthday: '2008-12-20' })]), 0, ctx)).toEqual({});
  });
  it('生年月日が無いと止める。インスタは空でよい', () => {
    expect(Object.keys(entryStepErrors(2, draft([person({ birthday: '' })]), 0, ctx))).toEqual(['birthday']);
  });
});

describe('画面3 作品', () => {
  it('出る・迷っているが0なら止める', () => {
    expect(entryStepErrors(3, draft([person({ works: {} })]), 0, ctx).works).toBe('作品を1つ以上えらんでください（迷っているだけでも送れます）');
  });
  it('迷っているだけでも進める', () => {
    expect(entryStepErrors(3, draft([person({ works: { 1: 'maybe' } })]), 0, ctx)).toEqual({});
  });
  it('出る＋迷っているが6つは止める', () => {
    const works = { 1: 'in', 2: 'in', 3: 'in', 4: 'maybe', 5: 'maybe', 6: 'maybe' } as const;
    expect(entryStepErrors(3, draft([person({ works })]), 0, ctx).works).toBeTruthy();
  });
  it('「出る」が3つ以上で1行（止めない）', () => {
    expect(workCountNotice(person({ works: { 1: 'in', 2: 'in', 3: 'in' } }))).toBe('3作品以上に出るときは、担当イントラに相談してからにしてください');
    expect(workCountNotice(person({ works: { 1: 'in', 2: 'in', 3: 'maybe' } }))).toBeNull();
  });
});

describe('送る形への詰め替え', () => {
  it('「連絡する人と同じ」は名前を写し、空のインスタは null、Tシャツ欄が無ければ null', () => {
    const s = draftToSubmission(draft([person({ sameAsContact: true, birthday: '1990-01-01', tshirtSize: 'M', works: { 3: 'in', 4: 'maybe' } })]),
      { eventKey: 't-x', submitKey: 'k'.repeat(32), confirmNotFamily: false, confirmSamePerson: false, consentAccepted: true, tshirtOn: false });
    expect(s.people[0]).toMatchObject({ lastName: '山田', firstName: '太郎', lastKana: 'ヤマダ', firstKana: 'タロウ', isContact: true, category: 'student', instaHandle: null, tshirtSize: null });
    expect(s.people[0].works).toEqual([{ workId: 3, status: 'in' }, { workId: 4, status: 'maybe' }]);
    expect(s.contact.phone).toBe('090-1234-5678');
  });
});

describe('画面7（04 4-2 の世帯ごとのちがい）', () => {
  const base = { payOpenAt: '2026-12-15 12:00', payDue: '2027-02-10', hasMaybe: false };
  it('払うが開いている仮受付', () => {
    expect(doneScreen({ ...base, view: 'tentative', total: 26500, gate: 'open' })).toEqual({
      lines: ['お申し込みを受け付けました。いまは『仮受付』です。お支払いが済むと、『申込完了』になります。', 'お支払いは、2月10日（水）までです。今すぐでも、あとからでも大丈夫です。'],
      button: 'マイページでお支払いへ進む',
    });
  });
  it('迷っている作品もあれば1行足す', () => {
    expect(doneScreen({ ...base, view: 'tentative', total: 26500, gate: 'open', hasMaybe: true }).lines[2]).toBe('迷っている作品がある方は、決まってからお支払いください。お支払いのあとは、お返しできません。');
  });
  it('払うがまだ開いていない／時刻を過ぎて準備中', () => {
    expect(doneScreen({ ...base, view: 'tentative', total: 26500, gate: 'before' })).toEqual({
      lines: ['お申し込みを受け付けました。いまは『仮受付』です。お支払いが済むと、『申込完了』になります。', 'お支払いは、12月15日（火）から、マイページでできます。'],
      button: 'マイページを見る',
    });
    expect(doneScreen({ ...base, view: 'tentative', total: 26500, gate: 'preparing' }).lines[1]).toBe('お支払いは、準備ができしだい、マイページでできます。');
  });
  it('迷っている作品だけ（0円）', () => {
    expect(doneScreen({ ...base, view: 'tentative', total: 0, gate: 'open', hasMaybe: true })).toEqual({
      lines: ['いまは『仮受付』です。迷っている作品を、1月31日（日）までに決めてください。出る作品が決まったら、マイページからお支払いいただけます。'],
      button: 'マイページを見る',
    });
  });
  it('合計0円で「出る」がある', () => {
    expect(doneScreen({ ...base, view: 'complete', total: 0, gate: 'open' })).toEqual({ lines: ['お申し込みが完了しました。お支払いはありません。'], button: 'マイページを見る' });
  });
});
```

（画面7 の「迷っている作品だけ」の「1月31日（日）」は、`doneScreen` に `changeClose` を足さず、4-2 の文の日付をそのまま使う。設定で日付が動いた時に直す所が1つ増えるが、締切の延長はしない決まり。）

- [ ] **Step 2: 落ちるのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalEntryForm.test.ts`
Expected: FAIL（`Cannot find module '../recitalEntryForm'`）

- [ ] **Step 3: `src/lib/recitalEntryForm.ts` を作る**

- `toKatakana`：ひらがな（U+3041〜U+3096）を +0x60。ほかはそのまま。
- `entryStepErrors`：画面1＝姓名・セイメイ（カタカナと長音と空白だけ）・メール（`normalizeEmail` のあと `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`）・電話（`normalizePhone` のあと10〜11けた）。画面2（`personIdx` の人）＝姓名・セイメイ・生年月日必須、`sameAsContact && ageOn(birthday, todayYmd) < minSelfApplyAge` なら `sameAsContact` に上の文。画面3＝出る＋迷っているが0なら `works` に上の文、`maxWorks` をこえたら `works` に「1人 {maxWorks} 作品までです。」。
- `draftToSubmission`：`category` はいつも `'student'`（フォームでは会員かを聞かない。会員かは 7 の照合で決まる）。カナは `toKatakana` を通す。`tshirtOn` が false なら `tshirtSize: null`。`works` は `workId` の昇順。
- `doneScreen`：上の試験の文。判定は「`view==='complete' && total===0` → 0円完了」→「`total===0 && hasMaybe` → 迷っているだけ」→ `gate` が `'open'` かどうか。

- [ ] **Step 4: 通るのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalEntryForm.test.ts`
Expected: PASS（16件）

- [ ] **Step 5: 試験の種と DB の試験を書く（落ちる）**

`src/lib/__tests__/recitalFamilySeed.ts`：
- `seedFamilyEvent(core, ev)`：`recital_events` に `(ev, '試し', '2027-04-11', '2027-04-10', '試しの会場', is_test=1)`、`recital_settings` に `entry_open_at='2026-01-01 00:00'`・`pay_open_at='2026-01-01 00:00'`・`pay_ok_at='2026-01-01 00:00'`・`suspended='0'`、`recital_fee_rules` に 03 3-4 の8行（`recitalPublic.test.ts` の `RULES` と同じ数）、`recital_works` に W01〜W06（`entry_mode='form'`・`status='open'`・`fee_type='counted'`・`kind='class'`・`title='W01の作品'`…）、W07（`form`・`draft`）、W08（`staff`・`open`）。W01 に `recital_work_instructors` の行（`display_name='イントラA'`）。返り値 `w` は `{ W01: id, … }`。表に NOT NULL の列がほかにあれば、それも入れる（1 の表の作りに合わせる）。
- `entryFor(ev, submitKey, people, contact?)`：連絡する人は `ヤマダ タロウ`・`a@example.com`・`09012345678`（`contact` で上書き）、同意は true、確かめの2つは false。`people` は `{ firstName, firstKana, birthday, works }` だけ受けて、姓は `山田`／`ヤマダ`。

```ts
// src/lib/__tests__/recitalEntryPublicDb.test.ts（頭は bf7EntryDb.test.ts 1〜25行の形。DB は ./data/test_recital_entrypub.db）
const EV = 't-entrypub';
const NOW = new Date('2026-12-20T12:00:00+09:00');
let w: Record<string, number>;
beforeAll(async () => { /* 型どおり initDb と台帳SQL */ ({ w } = await seed.seedFamilyEvent(core, EV)); });

describe('listPublicWorks', () => {
  it('フォームで受ける open と draft だけ。staff は出さない。担当イントラの名前が付く', async () => {
    const list = await fam.listPublicWorks(EV);
    expect(list.map((x) => x.workCode)).toEqual(['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);
    expect(list.find((x) => x.workCode === 'W07')!.status).toBe('draft');
    expect(list[0].instructors).toEqual(['イントラA']);
  });
});

describe('quoteEntry（画面3・5 の金額）は「送る」と同じ額', () => {
  it('1人3作品＝35,500', async () => {
    const q = await fam.quoteEntry(EV, [{ lastName: '山田', firstName: '花子', lastKana: 'ヤマダ', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: w.W01, status: 'in' }, { workId: w.W02, status: 'in' }, { workId: w.W03, status: 'in' }] }]);
    expect(q.total).toBe(35500);
    const r = await entry.submitEntry(seed.entryFor(EV, 'q'.repeat(32), [{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: w.W01, status: 'in' }, { workId: w.W02, status: 'in' }, { workId: w.W03, status: 'in' }] }]), NOW);
    expect(r.ok && r.total).toBe(35500);
  });
  it('兄2作品・妹1作品＝37,500（1人目は自動で妹）', async () => {
    const q = await fam.quoteEntry(EV, [
      { lastName: '山田', firstName: '一郎', lastKana: 'ヤマダ', firstKana: 'イチロウ', birthday: '2012-04-10', works: [{ workId: w.W01, status: 'in' }, { workId: w.W02, status: 'in' }] },
      { lastName: '山田', firstName: 'さくら', lastKana: 'ヤマダ', firstKana: 'サクラ', birthday: '2016-06-01', works: [{ workId: w.W03, status: 'in' }] },
    ]);
    expect(q.total).toBe(37500);
  });
  it('迷っている作品は合計に入らず、totalIfAllIn に入る', async () => {
    const q = await fam.quoteEntry(EV, [{ lastName: '山田', firstName: '花子', lastKana: 'ヤマダ', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: w.W01, status: 'in' }, { workId: w.W02, status: 'maybe' }] }]);
    expect(q.total).toBe(26500);
    expect(q.totalIfAllIn).toBe(32500);
  });
  it('事前登録の会員とカナ＋生年月日が合う人は、その料金（free なら0円）。「送る」と同じ額', async () => {
    const m = await core.execute(`INSERT INTO boom_members (hacomono_member_id, full_name, full_name_kana, birthday, status) VALUES ('t-free-1', '試し 一郎', 'タメシ イチロウ', '2014-03-03', 'active')`);
    await core.execute(`INSERT INTO recital_fee_presets (event_key, member_id, fee_class, created_by, created_at) VALUES (?, ?, 'free', 'テスト', ?)`, [EV, Number(m.lastInsertRowid), new Date().toISOString()]);
    const people = [{ lastName: '試し', firstName: '一郎', lastKana: 'タメシ', firstKana: 'イチロウ', birthday: '2014-03-03', works: [{ workId: w.W04, status: 'in' as const }] }];
    const q = await fam.quoteEntry(EV, people);
    expect(q.total).toBe(0);
    const r = await entry.submitEntry({ ...seed.entryFor(EV, 'f'.repeat(32), []), contact: { lastName: '試し', firstName: '一郎', lastKana: 'タメシ', firstKana: 'イチロウ', email: 'free@example.com', phone: '09000000001' },
      people: [{ tempId: 'p1', lastName: '試し', firstName: '一郎', lastKana: 'タメシ', firstKana: 'イチロウ', birthday: '2014-03-03', isContact: false, category: 'student', tshirtSize: null, instaHandle: null, works: [{ workId: w.W04, status: 'in' }] }] }, NOW);
    expect(r.ok && r.total).toBe(0);
  });
});

describe('resendMyPageUrl（申込があるかは返り値でしか分からない。画面には出さない）', () => {
  it('知らないメールは0件で、メールの記録も作らない', async () => {
    expect(await fam.resendMyPageUrl(EV, { email: 'none@example.com' })).toEqual({ sent: 0 });
  });
  it('大文字・前後の空白をそろえて、生きている世帯へ1通（resend_url）', async () => {
    const before = await core.getAll(`SELECT id FROM recital_mail_log WHERE mail_kind='resend_url'`);
    expect(await fam.resendMyPageUrl(EV, { email: '  A@Example.com ' })).toEqual({ sent: 1 });
    const after = await core.getAll(`SELECT id FROM recital_mail_log WHERE mail_kind='resend_url'`);
    expect(after.length - before.length).toBe(1);
  });
  it('電話は数字だけにしてくらべる', async () => {
    expect((await fam.resendMyPageUrl(EV, { phone: '090-1234-5678' })).sent).toBe(1);
  });
});
```

（`a@example.com` の世帯は、上の「1人3作品」で作った物。`entryFor` の電話 `09012345678`。）

- [ ] **Step 6: 落ちるのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalEntryPublicDb.test.ts`
Expected: FAIL（`fam.listPublicWorks is not a function`）

- [ ] **Step 7: `recitalFamilyDb.ts` に3つを足す**

- `listPublicWorks(eventKey)`：`entry_mode='form' AND status IN ('open','draft')`、`sort_order, id` の順。`instructors` は `recital_work_instructors.display_name` を `sort_order` の順。
- `quoteEntry(eventKey, people)`：書かない。7 の `buildEntryFeePeople(eventKey, people)` → `expectedCharges(rules, feePeople, null)`（`submitEntry` と同じ関数。計算を2か所に書かない）。`personId` は `people` の並びの番号（1から）。`totalIfAllIn` は全部の `maybe` を `in` にした合計。`status` が `open` でない作品は数えない。
- `resendMyPageUrl(eventKey, by)`：`status='active'` の世帯を、メールは `lower(trim(email))`、電話は数字だけにしてくらべる。当たった世帯ごとに `sendRecitalMail({ kind: 'resend_url', householdId })`。返すのは送った数だけ（宛先も世帯の番号も返さない）。

- [ ] **Step 8: 通るのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalEntryPublicDb.test.ts`
Expected: PASS（8件）

- [ ] **Step 9: `inputCls.ts` と `WorkCard.tsx` を作る**

- `RECITAL_INPUT_CLS = 'w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-base text-navy-900 placeholder:text-[#7a7a86]'`（文字は16pxでスマホの拡大を防ぐ）。select・textarea も同じ。
- `WorkCard`（`'use client'`）：props `{ work: PublicWork; value: 'in' | 'maybe' | 'out'; onChange: (v: 'in' | 'maybe' | 'out') => void; disabled: boolean }`。作品の名前・クラス・`slotLabel`・担当イントラ・**対象（太字）**・`publicNote`（あれば1行）・別料金なら横に「別料金 {yenJa(extraFee)}」。選ぶのは「出る」「まだ迷っている」「出ない」の3つ（初めは「出ない」）。`status==='draft'` は「準備中（決まったら、マイページから足せます）」と出して選べない。

- [ ] **Step 10: `src/app/bw6/entry/actions.ts` を作る**

頭に公開のわけ：「⚠️ 公開Server Actions(認証なし)。理由: BW6 の出演申込は公開フォームから受けるため。申込を列挙する道は作らない。同じメール・同じ電話の時も相手の中身は返さない。金額はサーバで計算し直す。eventKey は checkPublicEventKey で確かめる（試しの発表会は鍵が合う時だけ）。」 IP は `x-forwarded-for` の先頭（`src/app/xmas/actions.ts` の `ip()` の形）。

- `precheckEntryAction(eventKey: string, pv: string | null, x: { email: string; phone: string; people: { lastKana: string; firstKana: string; birthday: string }[] }): Promise<{ ok: true; sameEmail: boolean; samePhone: boolean; samePersonIdx: number[] } | { ok: false; code: 'rate' | 'invalid'; message: string }>`：`checkPublicEventKey` → `checkRateLimit('bw6:precheck:'+ip, ...RECITAL_RATE.precheck)` → `precheckEntry`。`sameEmail` なら `resendMyPageUrl(eventKey, { email })`、`samePhone` なら `resendMyPageUrl(eventKey, { phone })`。どちらも先に `checkRateLimit('bw6:resend-to:'+<メールか電話の sha256 先頭16けた>, ...RECITAL_RATE.resendEmail)` を見て、超えていたら送らない（表示は変えない）。rate のキーに生のメール・電話を入れない。画面1 からは `phone: ''`・`people: []` で呼び、`sameEmail` だけを見る。7 の `precheckEntry` が空の電話を「同じ」と返すなら、止まって知らせる。
- `quoteEntryAction(eventKey, pv, people: QuotePerson[])`：`checkPublicEventKey` → `quoteEntry`。連打よけは付けない（R-33：金額の計算には付けない）。`EntryForm` は人ごとに `lastName`・`firstName`（「連絡する人と同じ」なら連絡する人の名前）も渡す。
- `submitEntryAction(s: EntrySubmission, pv: string | null): Promise<EntryActionResult>`：`checkPublicEventKey(s.eventKey, pv)` が false なら `{ ok: false, code: 'invalid', message: 'このページからは送れません。' }` → `checkRateLimit('bw6:submit:'+ip, ...RECITAL_RATE.submit)` が false なら `{ ok: false, code: 'rate', message: RECITAL_MSG.rate }` → `submitEntry(s)` の結果をそのまま返す。受付の状態・同じメール・控えのメール・照合は 7 の中（ここで重ねてやらない）。本番 `bw6` の試し用の鍵で開いた画面から送ると、7 が受付前として断る（R-40）。それでよい。

- [ ] **Step 11: `src/app/bw6/entry/page.tsx` を作る**

頭に公開のわけ。`getRecitalPublicContext(searchParams)`。`phase` が `'open'` 以外は1文だけ：`before`＝「{jpOpenLabel(entry_open_at)}から受け付けます」／`closed`＝「受付は終わりました。ご相談は公式LINEへ」／`suspended`＝「ただいま受付を止めています。再開までお待ちください」。`'open'` なら `submitKey = randomBytes(16).toString('hex')`（`node:crypto`。ページを出すたびにサーバで作る）・`listPublicWorks(eventKey)`・`todayYmd = todayJst()` を作って `EntryForm` へ。渡す設定は `tshirt_sizes`・`max_works_per_person`・`min_self_apply_age`・`entry_close_at`・`change_close_at`・`pay_due`・`pay_open_at`・`privacy_text`・`consent_items`・`extra_costs_text`・`line_url` と、`payGate(settings, nowMs)` だけ。

- [ ] **Step 12: `src/app/bw6/entry/EntryForm.tsx` を作る（画面0〜7）**

`'use client'`。04 4-2 の表の文のまま。決めておく所：
- 上にいつも「{slashDateTime(entry_close_at)} までに、『送る』を押してください。」（決まり15）と「いま n／m」（画面1〜7。`tshirt_sizes` が空なら画面4を飛ばし m=6）。
- 下書きは `localStorage` の `bw6-entry-draft:<eventKey>`（読み書きは try/catch。読めなくても動く）。`submitKey` は下書きに入れない。送れたら消す。
- 画面0：文3つ・「くわしくは、こちら」（`FiveLines` を開く）・小さく「途中でやめても、続きから入れられます」「金額は、送る前に画面に出ます」・「はじめる」・「もう申し込んだ方はこちら（お支払い・作品を足す・やめる）」→ `/bw6/resend`＋qs・「出演のご案内」「料金の早見」。かかる時間は書かない。
- 画面1：「つぎへ」で `entryStepErrors(1)` → `precheckEntryAction(phone '', people [])`。`sameEmail` なら「もうお申し込みがあります。マイページのURLをメールで送りました。」と `FAMILY_ADD_LINE` を出して止め、下に「別のメールアドレスで申し込む」（メール欄を空にして戻る）。カナ欄は blur で `toKatakana`。
- 画面2：「連絡する人と同じ」ボタン、名前の欄の「パンフレットとエンドロールに載ります」、生年月日は年・月・日の select、インスタ欄（任意。4-2 の欄の文2つ）。SNS に使ってよいかの問いは作らない。
- 画面3：上の文3つ、しぼる欄（曜日＝月〜日のボタンで `slotLabel` に「◯曜」を含むか／会場＝文字欄で `slotLabel` に含むか／担当イントラ＝`instructors` の名前の select）、`WorkCard` の一覧、MOCCHIN の1行「MOCCHINナンバーのお申し込みは、別のページです」＋`/mocchin` へのリンク、`workCountNotice`、下に世帯の今の合計（大きく）とこの人の内わけ（`quoteEntryAction` を選ぶたびに 400ms 待って呼び、最後の答えを出す）。「もう1人、家族を足す」で画面2・3をくり返し、2人目から「ご家族の中で、いちばんお得になる組み合わせで計算しています。」。選べる数が `max_works_per_person` に達したら、ほかのカードの「出る」「まだ迷っている」を押せなくする。
- 画面4：人ごとにサイズ（`tshirt_sizes` と「あとで決める」）、「色は、デザインが決まったらお知らせします」。
- 画面5：`quoteEntryAction` の答えで合計（大きく）・人ごとの内わけ・4-2 の文（①・家族・協力チケット・`extra_costs_text`・迷っている作品がある時の2文。「出ると決めると {yenJa(totalIfAllIn)} になります」）。
- 画面6：中身（メールは大きく）・直すボタン・`privacy_text`・`consent_items`（6つ）・チェック2つ（「お支払いのあとはお返しできないことを、確かめました」「ほかの5つを読みました」。2つとも付くまで「送る」を押せない）。「送る」の前に `precheckEntryAction`（電話と人も渡す）：`samePhone` は「ご家族のお申し込みが、すでにあります。マイページをご確認ください。」と「家族ではない」（選ぶと `confirmNotFamily=true`）、`samePersonIdx` があれば「同じお名前・同じ生年月日のお申し込みが、もうあります。ご家族が申し込んでいないか、確かめてください。」と「それでも進む」（`confirmSamePerson=true`）。相手の名前は出さない。ボタンの上の文は、合計0円で「出る」がある時「送ると、お申し込みが完了します。お支払いはありません。」、ほかは「送ると『仮受付』になります。このあと、マイページからお支払いいただけます。」。
- 「送る」：押したらすぐ押せなくする → `submitEntryAction(draftToSubmission(...), pv)`。`ok:false` の `code` ごと：`busy`・`rate` はその `message` を出して押せる状態にもどす（同じ `submitKey` のまま。二重にならない）／`same_phone`・`same_person` は画面6 の知らせにもどす／`same_email` は画面1 の止めと同じ文／`invalid` は `fieldErrors` をその欄に／`before`・`closed`・`suspended` はその `message`。
- 画面7：`doneScreen` の文とボタン（行き先は `/bw6/my?t=<token>`）、整理番号（4けた）と今の金額、次にやること①「控えのメールが届いたか、確かめてください。」だけ（②LINE で自分に送る・③Tシャツは段階1では出さない。K221）、「控えが届いていないとき」→ 公式LINE（`line_url`）、`FAMILY_ADD_LINE`。
- 入力欄は全部 `RECITAL_INPUT_CLS`。

- [ ] **Step 13: 画面を目で確かめる（M5）**

`npm run dev` → `/bw6/entry?ev=bw6-test&pv=<鍵>`。確かめる：全部の欄に打って文字が見える（白い下地に紺の文字）／ひらがなのカナが blur でカタカナになる／16歳の生年月日で「連絡する人と同じ」が止まる／6つ目の作品が押せない／準備中の作品が選べない／`staff` の作品が出ない／Tシャツのサイズを空にした種なら画面4 が出ず「／6」になる／画面5 の合計が `/bw6/fee` と同じ数／「送る」を素早く2回押しても世帯は1つ（スタッフの画面が無いうちは `select count(*) from recital_households where event_key='bw6-test'` で見る）／同じメールで2回目を始めると画面1 で止まる／同じ電話で別メールなら画面6 で「家族ではない」を選ぶと進む／途中で閉じて開き直すと下書きが戻る／送ったあと下書きが消える／`/bw6/entry`（鍵なし）は本番の状態の1文だけ。

- [ ] **Step 14: コミット**

```bash
git add src/lib/recitalEntryForm.ts src/lib/recitalFamilyDb.ts \
  src/lib/__tests__/recitalEntryForm.test.ts src/lib/__tests__/recitalEntryPublicDb.test.ts src/lib/__tests__/recitalFamilySeed.ts \
  src/components/recital/inputCls.ts src/components/recital/WorkCard.tsx \
  src/app/bw6/entry/page.tsx src/app/bw6/entry/EntryForm.tsx src/app/bw6/entry/actions.ts
git commit -m "feat(bw6): 申込フォーム（画面0〜7・送る前の確かめ・下書き）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: マイページ（見る・インスタ）と URL の送り直し

**Files:**
- Create: `src/lib/recitalMyPage.ts`（純。いちばん上の文・つぎにやること・払うの置き場の文・締切のあとの文）
- Modify: `src/lib/recitalEntryDb.ts`（`updateInstaHandle` を足す）
- Modify: `src/lib/recitalFamilyDb.ts`（`markMyPageOpened` を足す）
- Create（16 がまだの時だけ）: `src/lib/recitalGuard.ts` の `isTokenShape`・`requireHouseholdByToken`
- Create: `src/components/recital/MoneyBox.tsx`
- Create: `src/app/bw6/my/page.tsx`、`src/app/bw6/my/actions.ts`、`src/app/bw6/my/InstaEditor.tsx`
- Create: `src/app/bw6/resend/page.tsx`、`src/app/bw6/resend/actions.ts`、`src/app/bw6/resend/ResendForm.tsx`
- Test: `src/lib/__tests__/recitalMyPage.test.ts`、`src/lib/__tests__/recitalMyPageDb.test.ts`

**Interfaces:**
- Consumes:
  - 2：`HouseholdView`、`MoneySummary`、`householdViewLabel(v, remaining)`、`payGate`、`payButtonState({ gate, view, m, refundTodo })`、`entryPhase(s, nowMs, extendUntil)`
  - 6：`HouseholdDetail`、`loadHouseholdDetail(householdId)`、`listWorks(eventKey)`、`getRecitalSettings`、`logChangeTx(tx, {...})`
  - 8：（このタスクでは呼ばない。15 が呼ぶ）
  - 10：`sendRecitalMail`（`resendMyPageUrl` の中で）
  - 12：`FiveLines`、`fiveLines`、`yenJa`・`jpDate`・`slashDate`、`FAMILY_ADD_LINE`、`RECITAL_MSG`、`getRecitalPublicContext`、`checkPublicEventKey`
  - 13：`resendMyPageUrl(eventKey, by)`、`RECITAL_INPUT_CLS`、`seedFamilyEvent`・`entryFor`（試験）、7 の `submitEntry`（試験）
  - 16：`isTokenShape(t)`、`requireHouseholdByToken(t)`。**14 を 16 より先に始めた時は、この2つだけを 14 が `src/lib/recitalGuard.ts` に作る**（形は split ③のとおり。`isTokenShape` は `/^[0-9a-f]{48}$/`、`requireHouseholdByToken` は形が合わなければ DB を引かずに null、合えば `edit_token = ?` の完全一致で世帯の id を引いて `loadHouseholdDetail`）。16 は `requireRecitalStaff` を足すだけになる。
- Produces:
  - `src/lib/recitalMyPage.ts`：
    ```ts
    export type MyTopInput = { view: HouseholdView; m: MoneySummary; hasIn: boolean; hasMaybe: boolean; payDue: string; todayYmd: string; changeClose: string; afterChangeClose: boolean; payMethod: string | null };
    export function myTopLines(x: MyTopInput): string[];
    export function closedNotice(x: { afterChangeClose: boolean; remaining: number; payDue: string; changeClose: string }): string[];
    export function nextTodos(x: { payState: 'hidden' | 'before' | 'preparing' | 'refund_hold' | 'show'; remaining: number; payDue: string; hasMaybe: boolean; canEditWorks: boolean; changeClose: string }): string[];
    export function payAreaText(state: 'hidden' | 'before' | 'preparing' | 'refund_hold' | 'show', payOpenAt: string): string | null;
    ```
  - `src/lib/recitalEntryDb.ts`：`updateInstaHandle(token: string, personId: number, handle: string | null): Promise<{ ok: boolean }>`（split ③の形。**作るのはこのタスクだけ**。8 は作らない。決まり：100字まで・受付を止めている間は `ok:false`・締切のあとも変えられる・変更の控えは送らない〔インスタの欄だけの直しで家庭にメールを出さない〕・変えた記録は `insta_edit` で前後の値を渡さない）
  - `src/lib/recitalFamilyDb.ts`：`markMyPageOpened(householdId: number, fromMail: boolean, now?: Date): Promise<void>`
  - `src/components/recital/MoneyBox.tsx`：`MoneyBox(props: { refCode: string; viewLabel: string; lines: string[]; money: MoneySummary; breakdown: { who: string; items: { label: string; amount: number }[] }[]; lastPaid: { method: string; paidOn: string } | null; manyPeople: boolean; hasMaybe: boolean; payText: string | null; children?: React.ReactNode })`（`children` は 21 が「払う」を入れる口）
  - `src/app/bw6/my/actions.ts`：`updateInstaAction(token: string, personId: number, handle: string): Promise<{ ok: boolean }>`（21・23・15 がこのファイルに足す）
  - `src/app/bw6/resend/actions.ts`：`resendUrlAction(eventKey: string, pv: string | null, email: string): Promise<{ message: string }>`

- [ ] **Step 1: マイページの文の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalMyPage.test.ts
import { describe, it, expect } from 'vitest';
import { myTopLines, closedNotice, nextTodos, payAreaText, type MyTopInput } from '../recitalMyPage';

const m = (total: number, paid: number) => ({ total, paid, remaining: Math.max(0, total - paid), overpaid: Math.max(0, paid - total) });
const base: Omit<MyTopInput, 'view' | 'm'> = { hasIn: true, hasMaybe: false, payDue: '2027-02-10', todayYmd: '2026-12-20', changeClose: '2027-01-31 23:59', afterChangeClose: false, payMethod: null };
const DUE = 'お支払いは、2月10日（水）までです。今すぐでも、あとからでも大丈夫です。';
const MAYBE = '迷っている作品がある方は、決まってからお支払いください。お支払いのあとは、お返しできません。';

describe('いちばん上の文（04 4-2 マイページ）', () => {
  it('仮受付', () => {
    expect(myTopLines({ ...base, view: 'tentative', m: m(26500, 0) })).toEqual([DUE, 'いまは『仮受付』です。お支払いが済むと、『申込完了』になります。']);
    expect(myTopLines({ ...base, view: 'tentative', m: m(26500, 0), hasMaybe: true })[2]).toBe(MAYBE);
  });
  it('仮受付（迷っている作品だけ・0円）', () => {
    expect(myTopLines({ ...base, view: 'tentative', m: m(0, 0), hasIn: false, hasMaybe: true })).toEqual([
      'いまは『仮受付』です。', '迷っている作品を、1月31日（日）までに決めてください。', '出る作品が決まったら、ここからお支払いいただけます。',
    ]);
  });
  it('申込完了（追加分の待ち）＝場面B', () => {
    expect(myTopLines({ ...base, view: 'complete_extra', m: m(32500, 26500) })).toEqual([
      '追加分のお支払いは 6,000円です。2月10日（水）までにお支払いください。今のお申し込みは、そのままです。',
    ]);
  });
  it('申込完了。合計0円で「出る」がある時は「お支払いはありません」', () => {
    expect(myTopLines({ ...base, view: 'complete', m: m(26500, 26500) })).toEqual(['お申し込みが完了しました']);
    expect(myTopLines({ ...base, view: 'complete', m: m(0, 0) })).toEqual(['お申し込みが完了しました', 'お支払いはありません']);
  });
  it('払ったあとにへらした（へらす例 35,500→32,500）。2/1 からは文が変わる', () => {
    expect(myTopLines({ ...base, view: 'complete', m: m(32500, 35500) })).toEqual([
      'お申し込みが完了しました',
      'お支払いずみ 35,500円／今のお申し込み 32,500円。差の 3,000円は、1/31（日）までに作品を足すと、その分に当てられます。お返しはできません。',
    ]);
    expect(myTopLines({ ...base, view: 'complete', m: m(32500, 35500), afterChangeClose: true })[1]).toBe(
      'お支払いずみ 35,500円／今のお申し込み 32,500円。差の 3,000円は、スタッフが作品を足したときは、その分に当てます。お返しはできません。');
  });
  it('払ったあとに「出る」が無く迷っているだけ（K222）は「お支払いはありません」を出さず、お支払いずみの分の文', () => {
    const lines = myTopLines({ ...base, view: 'complete', m: m(0, 26500), hasIn: false, hasMaybe: true });
    expect(lines).not.toContain('お支払いはありません');
    expect(lines[1]).toContain('差の 26,500円は');
  });
  it('出演なし（払っていない／払っていた）', () => {
    expect(myTopLines({ ...base, view: 'none', m: m(0, 0), hasIn: false })).toEqual(['お支払いはありません。出たいお気持ちがあるときは、公式LINEでお知らせください。']);
    expect(myTopLines({ ...base, view: 'none', m: m(0, 26500), hasIn: false })[0]).toContain('お支払いずみ 26,500円／今のお申し込み 0円。');
  });
  it('期限を過ぎて残りがある（2/11 から）。振込の世帯は確認の日数の文を足す', () => {
    const late = { ...base, view: 'tentative' as const, m: m(26500, 0), todayYmd: '2027-02-11' };
    expect(myTopLines(late)[0]).toBe('お支払いの期限が過ぎました。お申し込みは、まだ完了していません。下の『払う』から、今もお支払いいただけます。');
    expect(myTopLines(late)).not.toContain(DUE);
    expect(myTopLines({ ...late, payMethod: 'bank' })[1]).toBe('お振込みずみのときは、ご入金の確認に、ふだん1〜2日、土日や祝日をはさむと数日かかることがあります。確認できましたら、メールでお知らせします。');
  });
});

describe('締切のあとの文（H19）', () => {
  it('残りがあれば期限を続ける', () => {
    expect(closedNotice({ afterChangeClose: true, remaining: 6000, payDue: '2027-02-10', changeClose: '2027-01-31 23:59' })).toEqual([
      'お申し込みと変更の受付は、1月31日（日）で終わりました。中身を変えたいときは、公式LINEでお知らせください。', 'お支払いは、2月10日（水）までです。',
    ]);
    expect(closedNotice({ afterChangeClose: false, remaining: 6000, payDue: '2027-02-10', changeClose: '2027-01-31 23:59' })).toEqual([]);
  });
});

describe('つぎにやること（K221：その時マイページでできる物だけ）', () => {
  it('払えて残りがある／迷っている作品があり、作品を変えられる時だけ', () => {
    expect(nextTodos({ payState: 'show', remaining: 26500, payDue: '2027-02-10', hasMaybe: true, canEditWorks: true, changeClose: '2027-01-31 23:59' }))
      .toEqual(['お支払い（2月10日（水）まで）', '迷っている作品を決める（1月31日（日）まで）']);
    expect(nextTodos({ payState: 'preparing', remaining: 26500, payDue: '2027-02-10', hasMaybe: true, canEditWorks: false, changeClose: '2027-01-31 23:59' })).toEqual([]);
  });
});

describe('払うの置き場の文（K224・K207）', () => {
  it('開く前／準備中／お預かり／出さない', () => {
    expect(payAreaText('before', '2026-12-22 12:00')).toBe('お支払いは 12月22日（火）から');
    expect(payAreaText('preparing', '2026-12-15 12:00')).toBe('お支払いは、準備中です');
    expect(payAreaText('refund_hold', '2026-12-15 12:00')).toBe('お預かりしている分があります。スクールからご連絡します');
    expect(payAreaText('hidden', '2026-12-15 12:00')).toBeNull();
    expect(payAreaText('show', '2026-12-15 12:00')).toBeNull();
  });
});
```

- [ ] **Step 2: 落ちるのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalMyPage.test.ts`
Expected: FAIL（`Cannot find module '../recitalMyPage'`）

- [ ] **Step 3: `src/lib/recitalMyPage.ts` を作る**

文は上の試験と 04 4-2 のまま。見る順は「出演なし」→ `view` ごと（R-46）。期限は `payDue`（呼ぶ側が `pay_due_override ?? pay_due` を渡す）。期限切れは `todayYmd > payDue.slice(0,10) && m.remaining > 0` で、その時は `DUE` の行を出さず期限切れの文に置きかえる。お支払いずみの分の文は `m.overpaid > 0` の時だけ（「出演なし」で払っていた世帯は、上の「お支払いはありません…」の代わりにこの文）。

- [ ] **Step 4: 通るのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalMyPage.test.ts`
Expected: PASS（11件）

- [ ] **Step 5: インスタと「開いた」の DB の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalMyPageDb.test.ts（頭は bf7EntryDb.test.ts 1〜25行の形。DB は ./data/test_recital_mypage.db）
const EV = 't-mypage';
const NOW = new Date('2026-12-20T12:00:00+09:00');
let token = ''; let hid = 0; let pid = 0; let otherPid = 0;
beforeAll(async () => {
  /* 型どおり initDb と台帳SQL */
  const { w } = await seed.seedFamilyEvent(core, EV);
  const r = await entry.submitEntry(seed.entryFor(EV, 'm'.repeat(32), [{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: [{ workId: w.W01, status: 'in' }] }]), NOW);
  if (!r.ok) throw new Error(r.message);
  token = r.token; hid = r.householdId;
  pid = Number((await core.getOne('SELECT id FROM recital_people WHERE household_id = ?', [hid]))!.id);
  const r2 = await entry.submitEntry(seed.entryFor(EV, 'n'.repeat(32), [{ firstName: '次郎', firstKana: 'ジロウ', birthday: '2014-01-01', works: [{ workId: w.W02, status: 'in' }] }], { email: 'b@example.com', phone: '09099990000' }), NOW);
  if (!r2.ok) throw new Error(r2.message);
  otherPid = Number((await core.getOne('SELECT id FROM recital_people WHERE household_id = ?', [r2.householdId]))!.id);
});

describe('requireHouseholdByToken', () => {
  it('形が合わない鍵・ちがう鍵は null、合えばその世帯', async () => {
    expect(await guard.requireHouseholdByToken('ABC')).toBeNull();
    expect(await guard.requireHouseholdByToken(token.toUpperCase())).toBeNull();
    expect(await guard.requireHouseholdByToken('0'.repeat(48))).toBeNull();
    expect((await guard.requireHouseholdByToken(token))!.household.id).toBe(hid);
  });
});

describe('updateInstaHandle', () => {
  it('自分の世帯の人なら、前後の空白だけ取って生のまま入れる', async () => {
    expect(await entry.updateInstaHandle(token, pid, '  @hanako_bsb ')).toEqual({ ok: true });
    expect((await core.getOne('SELECT insta_handle FROM recital_people WHERE id = ?', [pid]))!.insta_handle).toBe('@hanako_bsb');
  });
  it('空は null', async () => {
    await entry.updateInstaHandle(token, pid, '   ');
    expect((await core.getOne('SELECT insta_handle FROM recital_people WHERE id = ?', [pid]))!.insta_handle).toBeNull();
  });
  it('ほかの世帯の人・ちがう鍵は ok:false で何も変えない', async () => {
    expect(await entry.updateInstaHandle(token, otherPid, 'x')).toEqual({ ok: false });
    expect(await entry.updateInstaHandle('0'.repeat(48), pid, 'x')).toEqual({ ok: false });
  });
  it('変えた記録は insta_edit。値は残さない（R-18）', async () => {
    await entry.updateInstaHandle(token, pid, '@secret_handle');
    const rows = await core.getAll(`SELECT * FROM recital_changes WHERE action = 'insta_edit' AND household_id = ?`, [hid]);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('secret_handle');
  });
  it('受付を止めている間は ok:false（見るだけ）', async () => {
    await core.execute(`UPDATE recital_settings SET value = '1' WHERE event_key = ? AND key = 'suspended'`, [EV]);
    expect(await entry.updateInstaHandle(token, pid, '@x')).toEqual({ ok: false });
    await core.execute(`UPDATE recital_settings SET value = '0' WHERE event_key = ? AND key = 'suspended'`, [EV]);
  });
});

describe('markMyPageOpened', () => {
  it('opened_at は初めの1回だけ。mail_opened_at は控えから開いた時の初めの1回だけ', async () => {
    await fam.markMyPageOpened(hid, false, new Date('2026-12-20T03:00:00Z'));
    await fam.markMyPageOpened(hid, false, new Date('2026-12-21T03:00:00Z'));
    let h = await core.getOne('SELECT opened_at, mail_opened_at FROM recital_households WHERE id = ?', [hid]);
    expect(h!.opened_at).toBe('2026-12-20T03:00:00.000Z');
    expect(h!.mail_opened_at).toBeNull();
    await fam.markMyPageOpened(hid, true, new Date('2026-12-22T03:00:00Z'));
    await fam.markMyPageOpened(hid, true, new Date('2026-12-23T03:00:00Z'));
    h = await core.getOne('SELECT opened_at, mail_opened_at FROM recital_households WHERE id = ?', [hid]);
    expect(h!.opened_at).toBe('2026-12-20T03:00:00.000Z');
    expect(h!.mail_opened_at).toBe('2026-12-22T03:00:00.000Z');
  });
});
```

（時刻の形は `nowUtcIso` の出す形に合わせる。`nowUtcIso` がミリ秒を付けない形なら、期待値をその形にする。）

- [ ] **Step 6: 落ちるのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalMyPageDb.test.ts`
Expected: FAIL（`entry.updateInstaHandle is not a function`。16 が先に `recitalGuard.ts` を作っていれば、`requireHouseholdByToken` の試験は通る）

- [ ] **Step 7: 3つ（16 がまだなら5つ）を作る**

- `updateInstaHandle(token, personId, handle)`：`requireHouseholdByToken(token)` → 人がその世帯で `status='active'` か → `entryPhase(settings, now, household.extend_until) !== 'suspended'` → `handle?.trim() || null` を `withWriteTx` で書き、同じ中で `logChangeTx(tx, { eventKey, householdId, personId, action: 'insta_edit', actor: 'family' })`（`before`・`after` は渡さない）。長さは 100 文字まで（こえたら ok:false）。
- `markMyPageOpened(householdId, fromMail, now)`：`UPDATE … SET opened_at = COALESCE(opened_at, ?)`、`fromMail` の時は `mail_opened_at = COALESCE(mail_opened_at, ?)` も。値は `nowUtcIso(now)`。変えた記録は書かない。
- 16 がまだなら `isTokenShape`・`requireHouseholdByToken`（上の Interfaces の形）。

- [ ] **Step 8: 通るのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalMyPageDb.test.ts`
Expected: PASS（7件）

- [ ] **Step 9: `MoneyBox.tsx` を作る**

「あなたの整理番号 {refCode}」・世帯の言葉（`viewLabel`。大きく）・`lines`・合計（大きく）・人ごとの内わけ（`breakdown`）・お支払いずみ・残り・`lastPaid`（「{jpDate(paidOn)} {method} でお支払い」。method は card＝カード／bank＝銀行振込／cash＝現金／adjust＝調整）・`manyPeople` の時「ご家族の中で、いちばんお得になる組み合わせで計算しています。」・`hasMaybe` の時「迷っている作品は、金額に入っていません。」・`payText`（あれば「払う」の代わりに出す）・`children`。お支払いの所がいちばん上に来るように、ページの最初に置く。

- [ ] **Step 10: `src/app/bw6/my/actions.ts` と `InstaEditor.tsx` を作る**

- actions.ts の頭：「⚠️ 公開Server Actions(認証なし)。理由: 家庭のマイページ（鍵つきURL）から呼ぶため。edit_token の完全一致の1世帯だけを相手にする。ほかの世帯の人・中身は返さない。」 `updateInstaAction(token, personId, handle)` は `updateInstaHandle` を呼ぶだけ。
- `InstaEditor`（`'use client'`）：人ごとにインスタの欄（今の値・`RECITAL_INPUT_CLS`）と「保存」。欄の文は 4-2 画面2 の2つ。下に「お名前は、パンフレットとエンドロールに載ります。写真と映像は、パンフレットと、当日会場で流す映像・記録の映像に使います。」と「発表会の写真や映像は、スクールのSNS（Instagram など）でも使わせていただきます。事情のある方は、公式LINEでお知らせください。」。SNS に使ってよいかを選ぶ所は作らない。保存できなかったら「保存できませんでした。もう一度お試しください。」。

- [ ] **Step 11: `src/app/bw6/my/page.tsx` を作る**

頭に公開のわけ（鍵の完全一致の1世帯だけ）。`metadata = { title: 'BW6 マイページ', robots: { index: false, follow: false }, referrer: 'no-referrer' }`。
1. `const d = await requireHouseholdByToken(t)`。null か `d.household.status === 'merged'` なら「お申し込みが見つかりません」と「URLが正しいかご確認ください。マイページのURLは、こちらからもう一度メールで受け取れます。」＋ `/bw6/resend` へのリンクだけ（merged の時の文は仮。20 が世帯をまとめる形を作った時に見直す）。
2. `markMyPageOpened(d.household.id, from === 'mail')`。
3. `settings = getRecitalSettings(d.household.event_key)`、`works = listWorks(...)`、`phase = entryPhase(settings, nowMs, d.household.extend_until)`、`gate = payGate(settings, nowMs)`、`payState = payButtonState({ gate, view: d.view, m: d.money, refundTodo: d.refundTodo })`、`payDue = d.household.pay_due_override ?? settings.pay_due`、`hasIn`／`hasMaybe` は `d.casts` の `in`／`maybe`（作品が `dropped` の行は数えない）。
4. 上から：`MoneyBox`（`viewLabel = householdViewLabel(d.view, d.money.remaining)`、`lines = myTopLines(...)`、`payText = payAreaText(payState, settings.pay_open_at)`。`payState === 'show'` の時は、21 ができるまで `payText` に「お支払いは、準備中です」を入れる。21 がここを `children` の `<PaySection …/>` に置きかえる）→ つぎにやること（`nextTodos`。`canEditWorks` は 14 では false）→ お申し込みの中身（人ごと・作品ごとに「出る」「迷っている」。`out` は薄く「やめた作品」、作品が `dropped` は「スクールの都合で、なくなりました」。`closedNotice` があれば上に。`phase === 'suspended'` の時は「ただいま受付を止めています。再開までお待ちください」）→ `FAMILY_ADD_LINE` → 載せる名前・インスタ（`InstaEditor`。`phase === 'suspended'` の時は値を見せるだけ）→ `FiveLines` → こまったら（「カードも銀行振込もむずかしいときは、公式LINEでご相談ください。」＋公式LINE のボタン `rel="noreferrer noopener"`）。
5. クライアント部品へ渡すのは、`token`・人の id と名前とインスタ・作品の名前と状態・金額の数だけ。電話・メール・生年月日・`staff_note`・`mails`・`changes` は渡さない（R-66）。
6. 「払う」の文の下の「うまく進まないときは、ブラウザで開いてください」は 21 が付ける。

- [ ] **Step 12: `/bw6/resend` を作る**

- actions.ts の頭：「⚠️ 公開Server Action(認証なし)。理由: 公式LINE の『発表会』ボタンからURLを送り直すため。答えはいつも同じ文（申込があるかは出さない）。IP とメールの両方で回数を数える。」 `resendUrlAction(eventKey, pv, email)`：`checkPublicEventKey` が false なら答えの文だけ返す → `checkRateLimit('bw6:resend:'+ip, ...RECITAL_RATE.resendIp)` と `checkRateLimit('bw6:resend-to:'+<メールの sha256 先頭16けた>, ...RECITAL_RATE.resendEmail)`（13 と同じキー）のどちらかが false なら `{ message: RECITAL_MSG.rate }` → `resendMyPageUrl(eventKey, { email })`（送った数は見ない）→ `{ message: 'お申し込みがあれば、マイページのURLを送りました' }`。メールの形が合わない時も同じ文（形で申込の有無が分からないように）。
- page.tsx：`getRecitalPublicContext`。見出し「マイページのURLを送ります」、メール欄（`RECITAL_INPUT_CLS`）とボタン（`ResendForm.tsx`、`'use client'`。押したら答えの文を出し、ボタンは押せなくする）。「控えが届かないときは、公式LINEでお知らせください。」＋公式LINE。

- [ ] **Step 13: 画面を目で確かめる（M5）**

`npm run dev`。13 で作った試しの世帯の `/bw6/my?t=<鍵>` を開く。確かめる：お支払いの所がいちばん上／世帯の言葉が「仮受付」、整理番号が4けた、合計・残りが申込の時と同じ／インスタの欄に打って文字が見え、保存して開き直すと残る／鍵を1文字変えると「見つかりません」／`&from=mail` で開くと `mail_opened_at` が入る（DB で見る）／ページのソースに `noindex` と `no-referrer` があり、電話・メール・生年月日が HTML に無い（ソース表示で検索）／`/bw6/resend` に、ある・ないメールを入れても同じ文、4回目で「少し時間をおいて…」。

- [ ] **Step 14: コミット**

```bash
git add src/lib/recitalMyPage.ts src/lib/recitalEntryDb.ts src/lib/recitalFamilyDb.ts \
  src/lib/__tests__/recitalMyPage.test.ts src/lib/__tests__/recitalMyPageDb.test.ts \
  src/components/recital/MoneyBox.tsx \
  src/app/bw6/my/page.tsx src/app/bw6/my/actions.ts src/app/bw6/my/InstaEditor.tsx \
  src/app/bw6/resend/page.tsx src/app/bw6/resend/actions.ts src/app/bw6/resend/ResendForm.tsx
# 16 より先に作った時だけ：
git add src/lib/recitalGuard.ts
git commit -m "feat(bw6): マイページ（見る・インスタ）とURLの送り直し

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: マイページの「作品を足す・やめる」（12/8 に出すか決める。切れる形）

**Files:**
- Create: `src/lib/recitalWorkEdit.ts`（純。ボタンを出すか・押す前の文）
- Modify: `src/lib/recitalFamilyDb.ts`（`previewHouseholdEdits`・`applyFamilyWorkEdits` を足す）
- Create: `src/app/bw6/my/WorkEditor.tsx`
- Modify: `src/app/bw6/my/actions.ts`（2つ足す）、`src/app/bw6/my/page.tsx`（`WorkEditor` を置く1か所と `canEditWorks`）
- Modify: `src/lib/recitalMail.ts`（`mypageItems` の1行だけ）
- Test: `src/lib/__tests__/recitalWorkEdit.test.ts`、`src/lib/__tests__/recitalWorkEditDb.test.ts`

切れる形：このタスクの変更は上のファイルだけ。出さないと決めたら、このタスクのコミットを入れない（14 のマイページは「見る・インスタ」のまま動く）。控えのメールの「（　）の中」（K221）は、このタスクが直す：`recitalMail.ts` の `mypageItems` を「お支払い、インスタ」から「お支払い、インスタ、作品を足す・やめる」に変える（このコミットに入れる。入れないと決めたら、メールも元のまま）。`recitalMail.test.ts` に「控えの本文に『作品を足す・やめる』がある」を1つ足す。

**Interfaces:**
- Consumes:
  - 2：`CastStatus`、`entryPhase`
  - 3：`expectedCharges`、`FeePerson`
  - 6：`loadHouseholdDetail`、`listWorks`、`getRecitalSettings`
  - 8：`HouseholdEdit`、`applyHouseholdEdits(householdId, edits, ctx)`（`ctx.by='family'`）
  - 9：`readHouseholdMoney(householdId)`、`recordManualPayment(...)`（試験で「払ったあと」を作るのに使う）。`afterMoneyChanged` は呼ばない（8 の `applyHouseholdEdits` が中で呼ぶ）
  - 10：メールは送らない（変更の控えは 8 の `applyHouseholdEdits` が中で1通送る）
  - 12：`yenJa`
  - 13：`RECITAL_INPUT_CLS`、`seedFamilyEvent`・`entryFor`
  - 14：`requireHouseholdByToken`、`src/app/bw6/my/page.tsx` の中身の欄
- Produces:
  - `src/lib/recitalWorkEdit.ts`：
    ```ts
    export type EditCastLite = { workId: number; status: CastStatus };
    export type EditWorkLite = { id: number; title: string; status: string; selectable: boolean }; // selectable = entry_mode 'form' かつ status 'open'
    export type EditRow = { workId: number; title: string; status: CastStatus; dropped: boolean; canToIn: boolean; canOut: boolean; lineOnly: boolean; lastBeforePay: boolean };
    export function workEditOptions(x: { paid: number; casts: EditCastLite[]; works: EditWorkLite[]; maxWorks: number }): { addable: number[]; rows: EditRow[] };
    export type EditItem = { kind: 'add' | 'to_in' | 'out' | 'last_out'; title: string; personName: string; wasIn: boolean };
    export function editConfirmText(x: { paid: number; items: EditItem[]; totalBefore: number; totalAfter: number; remainingBefore: number; remainingAfter: number }): { lines: string[]; confirmLabel: string };
    ```
  - `src/lib/recitalFamilyDb.ts`：
    ```ts
    export type FamilyEdit = { personId: number; workId: number; status: 'in' | 'out' };
    export async function previewHouseholdEdits(householdId: number, edits: FamilyEdit[], now?: Date): Promise<{ ok: true; totalBefore: number; totalAfter: number; remainingBefore: number; remainingAfter: number } | { ok: false; code: 'closed' | 'max_works' | 'paid_no_maybe' | 'last_work' | 'invalid'; message: string }>;
    export async function applyFamilyWorkEdits(token: string, edits: FamilyEdit[], now?: Date): Promise<{ ok: true; totalBefore: number; totalAfter: number } | { ok: false; code: 'not_found' | 'closed' | 'max_works' | 'paid_no_maybe' | 'last_work' | 'invalid'; message: string }>;
    ```
  - `src/app/bw6/my/actions.ts`：`previewWorkEditsAction(token: string, edits: FamilyEdit[])`、`saveWorkEditsAction(token: string, edits: FamilyEdit[])`

- [ ] **Step 1: ボタンと押す前の文の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalWorkEdit.test.ts
import { describe, it, expect } from 'vitest';
import { workEditOptions, editConfirmText } from '../recitalWorkEdit';

const works = [1, 2, 3, 4, 5, 6].map((id) => ({ id, title: `W0${id}の作品`, status: 'open', selectable: true }))
  .concat([{ id: 7, title: 'W07の作品', status: 'draft', selectable: false }, { id: 9, title: 'W09の作品', status: 'dropped', selectable: false }]);

describe('workEditOptions（05 5-5・K222）', () => {
  it('払う前・最後の1作品はやめられる（取りやめの文になる）。足せるのは open だけ', () => {
    const o = workEditOptions({ paid: 0, casts: [{ workId: 1, status: 'in' }], works, maxWorks: 5 });
    expect(o.rows[0]).toMatchObject({ workId: 1, canOut: true, lastBeforePay: true, lineOnly: false });
    expect(o.addable).toEqual([2, 3, 4, 5, 6]);
  });
  it('払ったあと・最後の「出る」はボタンの代わりに LINE の文（迷っているは数えない）', () => {
    const o = workEditOptions({ paid: 26500, casts: [{ workId: 1, status: 'in' }, { workId: 2, status: 'maybe' }], works, maxWorks: 5 });
    expect(o.rows.find((r) => r.workId === 1)).toMatchObject({ canOut: false, lineOnly: true });
    expect(o.rows.find((r) => r.workId === 2)).toMatchObject({ canToIn: true, canOut: true });
  });
  it('出る＋迷っているが5つなら足せない', () => {
    const casts = [1, 2, 3, 4, 5].map((workId) => ({ workId, status: 'in' as const }));
    expect(workEditOptions({ paid: 0, casts, works, maxWorks: 5 }).addable).toEqual([]);
  });
  it('やめた作品はボタン無しで、もう1回足せる。取りやめの作品はボタン無し', () => {
    const o = workEditOptions({ paid: 0, casts: [{ workId: 1, status: 'in' }, { workId: 3, status: 'out' }, { workId: 9, status: 'in' }], works, maxWorks: 5 });
    expect(o.rows.find((r) => r.workId === 3)).toMatchObject({ canToIn: false, canOut: false });
    expect(o.addable).toContain(3);
    expect(o.rows.find((r) => r.workId === 9)).toMatchObject({ dropped: true, canToIn: false, canOut: false, lineOnly: false });
  });
});

describe('editConfirmText（04 4-2 マイページでの変え方の文）', () => {
  const one = (kind: 'add' | 'to_in' | 'out' | 'last_out', wasIn = true) => [{ kind, title: 'W02の作品', personName: 'ヤマダ ハナコ', wasIn }];
  it('払う前に足す', () => {
    expect(editConfirmText({ paid: 0, items: one('add'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 26500, remainingAfter: 32500 }).lines)
      .toEqual(['『W02の作品』を足します。', '金額が 26,500円 から 32,500円 に変わります。']);
  });
  it('払う前にやめる・迷っている→出る・最後の1作品', () => {
    expect(editConfirmText({ paid: 0, items: one('out'), totalBefore: 32500, totalAfter: 26500, remainingBefore: 32500, remainingAfter: 26500 }).lines)
      .toEqual(['『W02の作品』をやめます。', '金額が 32,500円 から 26,500円 に変わります。']);
    expect(editConfirmText({ paid: 0, items: one('to_in'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 26500, remainingAfter: 32500 }).lines[0]).toBe('『W02の作品』に出ます。');
    expect(editConfirmText({ paid: 0, items: one('last_out'), totalBefore: 26500, totalAfter: 0, remainingBefore: 26500, remainingAfter: 0 }).lines)
      .toEqual(['ヤマダ ハナコさんの出演を取りやめます。Tシャツも取り消します。', '金額が 26,500円 から 0円 に変わります。']);
  });
  it('払ったあとに足す（迷っている→出るも同じ文）＝追加分は残りのふえた分', () => {
    const t = editConfirmText({ paid: 26500, items: one('add'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000 });
    expect(t.lines).toEqual(['『W02の作品』を足します。', '作品を足すと、追加で 6,000円 のお支払いが出ます。']);
    expect(editConfirmText({ paid: 26500, items: one('to_in'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000 }).lines[0]).toBe('『W02の作品』を足します。');
  });
  it('払ったあとにやめる', () => {
    expect(editConfirmText({ paid: 35500, items: one('out'), totalBefore: 35500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 0 }))
      .toEqual({ lines: ['『W02の作品』をやめます。', 'お支払いずみの分は、お返しできません。よろしいですか？'], confirmLabel: 'この作品をやめる' });
  });
  it('払ったあと、お支払いずみの分が当たって追加が0円（場面C）', () => {
    expect(editConfirmText({ paid: 32500, items: one('add'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 0 }).lines)
      .toEqual(['『W02の作品』を足します。', 'お支払いずみの分が当たるので、追加のお支払いはありません。']);
  });
  it('入れ替え（外す・足すを一緒に。決定1回）', () => {
    const t = editConfirmText({ paid: 32500, items: [{ kind: 'out', title: 'W01の作品', personName: 'ヤマダ ハナコ', wasIn: true }, { kind: 'add', title: 'W03の作品', personName: 'ヤマダ ハナコ', wasIn: false }],
      totalBefore: 32500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 0 });
    expect(t.lines).toEqual(['『W01の作品』をやめます。', '『W03の作品』を足します。', 'お支払いずみの分は、お返しできません。よろしいですか？']);
    expect(t.confirmLabel).toBe('決定する');
  });
});
```

- [ ] **Step 2: 落ちるのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalWorkEdit.test.ts`
Expected: FAIL（`Cannot find module '../recitalWorkEdit'`）

- [ ] **Step 3: `src/lib/recitalWorkEdit.ts` を作る**

- `workEditOptions`：その人の出演だけを渡される。作品が `dropped` の行は全部 false。`canToIn = status==='maybe'`。`canOut`：`in`・`maybe` で、`paid > 0 && status==='in' && その人の in の数===1` の時だけ false で `lineOnly=true`。`lastBeforePay = paid===0 && in＋maybe の数===1`。`addable`＝`selectable` の作品のうち、その人が `in`・`maybe` でない物（`out` は入る）。`in＋maybe ≥ maxWorks` なら空。足すのは「出る」だけ（ボタンは「作品を足す」「出るに変える」「この作品をやめる」の3つ。4-2）。
- `editConfirmText`：品目ごとに1行（`add`＝「『X』を足します。」、`to_in`＝払う前「『X』に出ます。」／払ったあと「『X』を足します。」、`out`＝「『X』をやめます。」、`last_out`＝「（名前）さんの出演を取りやめます。Tシャツも取り消します。」）。そのあと、払う前は「金額が A から B に変わります。」（変わらなければ出さない）。払ったあとは、`remainingAfter − remainingBefore > 0` なら「作品を足すと、追加で ◯円 のお支払いが出ます。」、足す品目があって0なら「お支払いずみの分が当たるので、追加のお支払いはありません。」（この1文はこちらで決めた仮の文。12/8 に TARO が見る）、`wasIn` の `out` があれば最後に「お支払いずみの分は、お返しできません。よろしいですか？」。`confirmLabel` は品目が `out` 1つで払ったあとなら「この作品をやめる」、ほかは「決定する」。

- [ ] **Step 4: 通るのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalWorkEdit.test.ts`
Expected: PASS（10件）

- [ ] **Step 5: DB の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalWorkEditDb.test.ts（頭は bf7EntryDb.test.ts 1〜25行の形。DB は ./data/test_recital_workedit.db）
const EV = 't-workedit';
const NOW = new Date('2026-12-20T12:00:00+09:00');
let w: Record<string, number>; let n = 0;
beforeAll(async () => { /* 型どおり initDb と台帳SQL */ ({ w } = await seed.seedFamilyEvent(core, EV)); });

async function household(people: { firstName: string; firstKana: string; birthday: string; works: string[] }[], paid: number) {
  n += 1;
  const r = await entry.submitEntry(seed.entryFor(EV, String(n).padStart(32, '0'),
    people.map((p) => ({ ...p, works: p.works.map((c) => ({ workId: w[c], status: 'in' as const })) })),
    { email: `h${n}@example.com`, phone: `0900000${String(n).padStart(4, '0')}` }), NOW);
  if (!r.ok) throw new Error(r.message);
  if (paid > 0) await money.recordManualPayment(r.householdId, { method: 'cash', amount: paid, paidOn: '2026-12-20', memo: '試し' }, 'テスト');
  const pids = (await core.getAll('SELECT id FROM recital_people WHERE household_id = ? ORDER BY seq', [r.householdId])).map((x) => Number(x.id));
  return { hid: r.householdId, token: r.token, pids };
}
const both = async (hid: number, token: string, edits: { personId: number; workId: number; status: 'in' | 'out' }[]) => {
  const p = await fam.previewHouseholdEdits(hid, edits, NOW);
  const a = await fam.applyFamilyWorkEdits(token, edits, NOW);
  return { p, a };
};

describe('押す前の金額は、決定のあとの金額と同じ（足す例・へらす例・場面）', () => {
  it('1人1作品を払ってから1作品足す：26,500→32,500、残り 6,000', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01'] }], 26500);
    const { p, a } = await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W02, status: 'in' }]);
    expect(p).toMatchObject({ ok: true, totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000 });
    expect(a).toEqual({ ok: true, totalBefore: 26500, totalAfter: 32500 });
    expect((await money.readHouseholdMoney(h.hid)).m.remaining).toBe(6000);
  });
  it('兄1・妹1を払ってから兄が1作品足す：34,500→37,500', async () => {
    const h = await household([{ firstName: '一郎', firstKana: 'イチロウ', birthday: '2012-04-10', works: ['W01'] }, { firstName: 'さくら', firstKana: 'サクラ', birthday: '2016-06-01', works: ['W02'] }], 34500);
    const { p, a } = await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W03, status: 'in' }]);
    expect(p).toMatchObject({ ok: true, totalBefore: 34500, totalAfter: 37500 });
    expect(a).toMatchObject({ ok: true, totalAfter: 37500 });
  });
  it('へらす例：3作品を払う→1つへらす 32,500→別の1つを足す 35,500→もう1つ足す 38,500（残り 3,000）', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01', 'W02', 'W03'] }], 35500);
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W03, status: 'out' }])).a).toMatchObject({ ok: true, totalAfter: 32500 });
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W04, status: 'in' }])).a).toMatchObject({ ok: true, totalAfter: 35500 });
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W05, status: 'in' }])).a).toMatchObject({ ok: true, totalAfter: 38500 });
    expect((await money.readHouseholdMoney(h.hid)).m.remaining).toBe(3000);
  });
  it('場面D（払う前）：2作品 32,500→足す 35,500→やめる 32,500', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01', 'W02'] }], 0);
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W03, status: 'in' }])).p).toMatchObject({ ok: true, totalBefore: 32500, totalAfter: 35500 });
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W02, status: 'out' }])).a).toMatchObject({ ok: true, totalAfter: 32500 });
  });
});

describe('止める所', () => {
  it('場面E：払ったあと、妹の最後の「出る」をやめるのは last_work（LINE へ）', async () => {
    const h = await household([{ firstName: '一郎', firstKana: 'イチロウ', birthday: '2012-04-10', works: ['W01'] }, { firstName: 'さくら', firstKana: 'サクラ', birthday: '2016-06-01', works: ['W02'] }], 34500);
    const { p, a } = await both(h.hid, h.token, [{ personId: h.pids[1], workId: w.W02, status: 'out' }]);
    expect(p).toMatchObject({ ok: false, code: 'last_work' });
    expect(a).toMatchObject({ ok: false, code: 'last_work' });
  });
  it('6作品目は max_works', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01', 'W02', 'W03', 'W04', 'W05'] }], 0);
    expect((await both(h.hid, h.token, [{ personId: h.pids[0], workId: w.W06, status: 'in' }])).a).toMatchObject({ ok: false, code: 'max_works' });
  });
  it('change_close_at を過ぎたら closed', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01'] }], 0);
    const late = new Date('2027-02-01T00:00:00+09:00');
    expect(await fam.applyFamilyWorkEdits(h.token, [{ personId: h.pids[0], workId: w.W02, status: 'in' }], late)).toMatchObject({ ok: false, code: 'closed' });
  });
  it('ちがう鍵は not_found、ほかの世帯の人は invalid、準備中の作品は invalid', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01'] }], 0);
    const g = await household([{ firstName: '次郎', firstKana: 'ジロウ', birthday: '2014-01-01', works: ['W01'] }], 0);
    expect(await fam.applyFamilyWorkEdits('0'.repeat(48), [{ personId: h.pids[0], workId: w.W02, status: 'in' }], NOW)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await fam.applyFamilyWorkEdits(h.token, [{ personId: g.pids[0], workId: w.W02, status: 'in' }], NOW)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await fam.applyFamilyWorkEdits(h.token, [{ personId: h.pids[0], workId: w.W07, status: 'in' }], NOW)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('変更の控えは、決定1回に1通', () => {
  it('入れ替え（外す・足す）を一緒に決定しても change は1通。金額は変わらない', async () => {
    const h = await household([{ firstName: '花子', firstKana: 'ハナコ', birthday: '2015-05-01', works: ['W01', 'W02'] }], 32500);
    const a = await fam.applyFamilyWorkEdits(h.token, [{ personId: h.pids[0], workId: w.W01, status: 'out' }, { personId: h.pids[0], workId: w.W03, status: 'in' }], NOW);
    expect(a).toEqual({ ok: true, totalBefore: 32500, totalAfter: 32500 });
    const rows = await core.getAll(`SELECT id FROM recital_mail_log WHERE household_id = ? AND mail_kind = 'change'`, [h.hid]);
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 6: 落ちるのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalWorkEditDb.test.ts`
Expected: FAIL（`fam.previewHouseholdEdits is not a function`）

- [ ] **Step 7: `recitalFamilyDb.ts` に2つを足す**

- `previewHouseholdEdits(householdId, edits, now)`：8 の `applyHouseholdEdits(householdId, edits.map((e) => ({ type: 'cast_set', ...e })), { actor: 'family', by: 'family', now, dryRun: true })` を呼んで返すだけ（確かめも計算も 8 と同じ関数。写さない）。
- `applyFamilyWorkEdits(token, edits, now)`：`requireHouseholdByToken`（null なら `not_found`）→ 人がその世帯にいるか・足す作品が `entry_mode='form'` かつ `status='open'` か（ちがえば `invalid`）→ `applyHouseholdEdits(householdId, edits.map((e) => ({ type: 'cast_set', ...e })), { actor: 'family', by: 'family', now })` → 結果を返すだけ。変更の控えのメールと `afterMoneyChanged` は 8 の `applyHouseholdEdits` が中でする（8 の Interfaces の約束）ので、ここでは送らない・呼ばない。

- [ ] **Step 8: 通るのを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalWorkEditDb.test.ts`
Expected: PASS（9件）

- [ ] **Step 9: actions と `WorkEditor.tsx` を作り、マイページに置く**

- actions.ts に足す：`previewWorkEditsAction(token, edits)`（`requireHouseholdByToken` → `previewHouseholdEdits`）と `saveWorkEditsAction(token, edits)`（`applyFamilyWorkEdits`）。`edits` は `status` が `'in'`・`'out'` の物だけ通す（ほかの形は `invalid`）。
- `WorkEditor`（`'use client'`）：props は `token`・人ごとの `{ personId, name, rows: EditRow[], addable: { id, title }[] }`・`paid`・`total`・`remaining` だけ。順は「えらぶ → 金額を見る → 決定」（4-2）。各行に「出るに変える」「この作品をやめる」、`lineOnly` の行は「出演を全部やめるときは、公式LINEでお知らせください。」、人ごとに「作品を足す」（`addable` から選ぶ select、`RECITAL_INPUT_CLS`）。選んだ変更はためておき、「金額を見る」で `previewWorkEditsAction` → `editConfirmText` の文とボタン（`confirmLabel`）→ 押したら `saveWorkEditsAction`（押したらすぐ押せなくする）。`ok:false` は `message` を出す。決定のあとは `router.refresh()`。準備中の作品は「準備中（決まったら、マイページから足せます）」と見せて選べない。
- page.tsx：「お申し込みの中身」の欄に `WorkEditor` を置く。出すのは `entryPhase(settings, nowMs, extend_until) === 'open'` の時だけ（`change_close_at` を過ぎたら・止めている間は出さない）。「出演なし」の世帯も、この時は「作品を足す」を出す。`nextTodos` の `canEditWorks` を、`WorkEditor` を出す時は true にする。

- [ ] **Step 10: 画面を目で確かめる（M5）**

`npm run dev`。試しの世帯のマイページで：作品を1つ足す→「金額が 26,500円 から 32,500円 に変わります。」→決定で金額が変わり、変更の控えが1通（`recital_mail_log`）／「作品を足す」の欄に打って（選んで）文字が見える／5作品で「作品を足す」が出ない／スタッフ用の手の入金（無ければ試験と同じ `recordManualPayment` を node から）で払ったあとに足すと「作品を足すと、追加で 6,000円 のお支払いが出ます。」／払ったあとに最後の「出る」をやめるボタンが無く、LINE の文が出る／設定の `change_close_at` を過去にすると欄ごと消える。

- [ ] **Step 11: コミット**

```bash
git add src/lib/recitalWorkEdit.ts src/lib/recitalFamilyDb.ts \
  src/lib/__tests__/recitalWorkEdit.test.ts src/lib/__tests__/recitalWorkEditDb.test.ts \
  src/app/bw6/my/WorkEditor.tsx src/app/bw6/my/actions.ts src/app/bw6/my/page.tsx
git commit -m "feat(bw6): マイページの作品を足す・やめる

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### このまとまりで、計画が仮に決めた物（見直しの人が確かめる）

1. 本番が `suspended=1` のまま開ける時刻の前は、公開ページに「止めています」でなく「◯月◯日（◯）◯時から受け付けます」と出す（`publicPhase`。表示だけ）。
2. 料金の早見の「カードでお支払いのときの手数料は、スクールが持ちます。」と、作品を足す時の「お支払いずみの分が当たるので、追加のお支払いはありません。」は、設計書に文が無いので仮に書いた。12/8 の「見て確かめること」で TARO が見る。
3. 画面3 の合計は、選ぶたびにサーバの `quoteEntry` で出す（事前登録の人も画面3 から正しい額。連打よけは付けない＝R-33）。
4. フォームから送る人の `category` はいつも `student`（フォームでは会員かを聞かない）。
5. マイページで足すのは「出る」だけ（「まだ迷っている」で足すボタンは作らない。4-2 のボタン3つに合わせた）。
6. まとめられた世帯（`status='merged'`）の古い鍵は「見つかりません」と出す（20 が世帯をまとめる時に見直す）。
7. 「払った金額・払い方・日」は、プラスの入金のいちばん新しい1行の払い方と日、金額は「お支払いずみ」の合計で出す（取り消しのマイナスの行を家庭に見せない）。

---

### 足した名前（split.md ③に無かった物）

- `src/lib/recitalPreview.ts`：`resolvePreviewEvent`
- `src/lib/recitalPublic.ts`（新しいファイル）：`yenJa`・`jpDate`・`slashDate`・`slashDateTime`・`jpOpenLabel`・`fiveLines`・`FeeTableData`・`feeTableFromRules`・`publicPhase`・`FAMILY_ADD_LINE`・`RECITAL_MSG`
- `src/lib/recitalFamilyDb.ts`（新しいファイル）：`PublicWork`・`listPublicWorks`・`QuotePerson`・`quoteEntry`・`resendMyPageUrl`・`markMyPageOpened`・`FamilyEdit`・`previewHouseholdEdits`・`applyFamilyWorkEdits`
- `src/lib/recitalEntryForm.ts`（新しいファイル）：`DraftPerson`・`EntryDraft`・`toKatakana`・`entryStepErrors`・`workCountNotice`・`draftToSubmission`・`doneScreen`
- `src/lib/recitalMyPage.ts`（新しいファイル）：`MyTopInput`・`myTopLines`・`closedNotice`・`nextTodos`・`payAreaText`
- `src/lib/recitalWorkEdit.ts`（新しいファイル）：`EditCastLite`・`EditWorkLite`・`EditRow`・`workEditOptions`・`EditItem`・`editConfirmText`
- `src/app/bw6/context.ts`（新しいファイル）：`RecitalPublicContext`・`getRecitalPublicContext`・`checkPublicEventKey`
- `src/app/bw6/entry/actions.ts`：`EntryActionResult`・`precheckEntryAction`・`quoteEntryAction`・`submitEntryAction`
- `src/app/bw6/my/actions.ts`：`updateInstaAction`・`previewWorkEditsAction`・`saveWorkEditsAction`
- `src/app/bw6/resend/actions.ts`：`resendUrlAction`
- 画面の部品：`src/components/recital/inputCls.ts` の `RECITAL_INPUT_CLS`、`src/app/bw6/guide/PrintButton.tsx`、`src/app/bw6/my/InstaEditor.tsx`、`src/app/bw6/resend/ResendForm.tsx`
- 試験の種：`src/lib/__tests__/recitalFamilySeed.ts` の `seedFamilyEvent`・`entryFor`
- 試験のファイル（split.md ①の一覧に足す）：`recitalPublic.test.ts`・`recitalEntryForm.test.ts`・`recitalEntryPublicDb.test.ts`・`recitalMyPage.test.ts`・`recitalMyPageDb.test.ts`・`recitalWorkEdit.test.ts`・`recitalWorkEditDb.test.ts`
- 連打よけのキー：`bw6:precheck:<IP>`・`bw6:submit:<IP>`・`bw6:resend:<IP>`・`bw6:resend-to:<メールか電話の sha256 先頭16けた>`
- 端末の下書きのキー：`bw6-entry-draft:<event_key>`

---

## まとまり「ス」：スタッフの画面（Task 16〜20）

このまとまりは、スタッフが段階1（〜2026-12-15（火）12:00）で使う画面を作る。並び：16 は 2・6 の後／17 は 6 の後／18 は 3・6・11 の後／19 は 8・9・10 の後／20 は 8・9・5 と 21 の後（21 の `expireOpenCheckout` を使う）（20 は 18 の `searchMembers` も使うので、ス の中では 16→17→18→19→20 の順に進める）。段階2より後の画面（お金の画面・人ごと作品ごとの見方・CSV・出演とりやめ・この世帯は待つ・返金を記録・返す分を作る・家族を足す）は「後の計画へ」。

### このまとまりの全部のタスクに効く決まり

- 画面は `src/app/staff/bw6/…/page.tsx`（Server Component）。頭で `if (!(await isAuthorizedServer())) redirect('/staff/events/login');`（`src/app/staff/mocchin/page.tsx` と同じ）。押す処理は同じ場所の `actions.ts`（`'use server'`）に置き、**どの action も1行目で `await requireRecitalStaff()`**（Task 16 で作る）。
- ヘッダーは `@/components/StaffPageHeader`。色は `brand-*`／`navy-*`／`sand-*`（`orange-*` を新しく使わない）。**入力欄（input・select・textarea）は全部、文字色と下地色を両方書く**（例 `className="bg-white text-navy-900 …"`）。作ったあと、実際に打って字が見えるかを見る。
- どの画面もスマホ幅（375px）で使える。表は `sm:` より狭い時は世帯ごと・行ごとのカードにする。
- 確かめの窓（`confirm()`）は使わない。押しまちがいよけは「2段階ボタン」（1回目で中身を見せ、2回目で実行）。`src/app/staff/xmas/OrderActions.tsx` と同じ形。
- お金・設定・確定にかかわるボタンは、押す前に自分の名前を選ぶ（`StaffNamePicker`。Task 16）。サーバ側でも、名前が `RECITAL_STAFF_NAMES` に入っていなければ、lib の関数が `throw new Error('staff_name')` する（このまとまりで足す lib の関数は全部）。
- 画面の `searchParams`・`params` は Promise（Next 16。`src/app/staff/bf6/reception/page.tsx` の書き方）。作る前に `node_modules/next/dist/docs/01-app` の該当ページを読む（`AGENTS.md`）。
- どの発表会を見るかは `?ev=`。`pickStaffEventKey(ev)`（Task 16）で `bw6`／`bw6-test`／`bw6-smoke` のどれかにし、それ以外は `bw6`。`is_test=1` の発表会を見ている時は、ヘッダーの下に「試しの発表会（◯◯）を見ています」の帯を出す。
- ログ・`console.*`・エラー文に、氏名・電話・メール・名義を出さない。
- 試験は1ファイルずつ回す：`npx vitest run <ファイル>`。全件（`npm test`）・`tsc` 全体・`next build` は回さない。dev サーバでの画面の確かめは M5 で行う（M1 では回さない）。
- **計画に書いていないことに当たったら、自分で決めずに止まって知らせる。** 迷いやすい所には、各タスクに「止まって知らせる」と書いた。

### このまとまりで気をつける入力（試験を各タスクに入れた）

1. 名前を選ばずに押した → lib の関数が `staff_name` で拒む（Task 16・20 の試験）。
2. 「世帯をまとめる」を2回押した（2つの画面から）→ 2回目は `not_active` で拒み、お金は動かない（Task 20）。
3. 試しの発表会の世帯が、本番の人数に混ざる → 混ざらない（Task 16）。
4. 設定の欄から `pay_ok_at`・`suspended`・`stripe_mode` を直そうとした → `checkSettingValue`（Task 2）が拒む。
5. 古い画面で作品を取りやめた（その間に申込が増えた）→ `count_changed` で拒む（Task 17）。

---

### Task 16: 守りと最初の画面

**Files:**
- Create（14 が先に作っていれば Modify：`requireRecitalStaff` を足すだけ）: `src/lib/recitalGuard.ts`
- Modify: `src/lib/recital.ts`（`pickStaffEventKey`・`bankToldWaitDue` を足す）
- Modify: `src/lib/recitalMatch.ts`（`matchMember` の中の休会・退会の条件を `memberWarn` として外に出すだけ。ふるまいは変えない）
- Modify: `src/lib/recitalDb.ts`（`countRecitalPeople`・`listAttention`・`dismissAttention`・`searchHouseholds` を足す）
- Create: `src/components/recital/StaffNamePicker.tsx`
- Create: `src/app/staff/bw6/page.tsx`・`src/app/staff/bw6/actions.ts`・`src/app/staff/bw6/AttentionList.tsx`・`src/app/staff/bw6/labels.ts`
- Modify: `src/app/staff/page.tsx`（カード1枚）
- Create（試験の道具）: `src/lib/__tests__/recitalStaffSeed.ts`
- Test: `src/lib/__tests__/recitalStaffPure.test.ts`・`src/lib/__tests__/recitalGuard.test.ts`・`src/lib/__tests__/recitalStaffHome.test.ts`

**Interfaces:**
- Consumes（2）: `RECITAL_EVENT`・`RecitalSettings`・`PeopleCounts`・`CountPerson`・`countPeople(people, now)`・`isCountedCast(work, cast)`・`moneySummary(x)`・`householdView(x)`・`payGate(s, nowMs)`・`jstToMs(s)`・`BANK_TOLD_WAIT_DAYS`・`RECITAL_STAFF_NAMES`
- Consumes（5）: `MemberLite`・`matchFeePreset(p, presets, members)`
- Consumes（2・6）: `normalizePhone`（2）・`loadMembersLite()`（6。見てほしいことの2番・3番で会員を `MemberLite` に詰めるのは必ずこれ。休会の印は member_type から入る）
- Consumes（6）: `getRecitalEvent(eventKey)`・`getRecitalSettings(eventKey)`・`loadHouseholdDetail(householdId): Promise<HouseholdDetail | null>`・`logChangeTx(tx, c)`・`HouseholdRow`
- Consumes（既存）: `isAuthorizedServer()`（`src/lib/eventAuth.ts`）・`normalizeKana`（**`@/lib/csvUtil` から**。同じ名前が `party.ts` などにもあるので取り違えない）・`todayJst`・`nowUtcIso`（`src/lib/dateJst.ts`）
- Produces:
  - `src/lib/recitalGuard.ts`：`requireRecitalStaff(): Promise<void>`（だめなら `throw new Error('Unauthorized')`）／`isTokenShape(t: unknown): t is string`（`/^[0-9a-f]{48}$/`）／`requireHouseholdByToken(t: string | null | undefined): Promise<HouseholdDetail | null>`
  - `src/lib/recital.ts`：`pickStaffEventKey(v: string | null | undefined): string`／`bankToldWaitDue(toldAtUtc: string, nowMs: number, restFrom: string, restTo: string): boolean`
  - `src/lib/recitalMatch.ts`：`memberWarn(m: MemberLite): 'leave' | 'withdrawn' | null`
  - `src/lib/recitalDb.ts`：`countRecitalPeople(eventKey: string, now?: Date): Promise<PeopleCounts>`／`type AttentionItem = { no: 1 | 2 | 3 | 4 | 5 | 8; label: string; href: string; householdId?: number; personId?: number }`／`listAttention(eventKey: string, now?: Date): Promise<AttentionItem[]>`／`dismissAttention(eventKey: string, item: { no: 1 | 3; householdId?: number; personId?: number }, staffName: string): Promise<void>`／`searchHouseholds(eventKey: string, q: string): Promise<HouseholdRow[]>`
  - `src/components/recital/StaffNamePicker.tsx`：`default function StaffNamePicker(props: { value: string; onChange: (name: string) => void }): JSX.Element`
  - `src/lib/__tests__/recitalStaffSeed.ts`（17〜20 の試験も使う）：
    ```ts
    export async function seedEvent(ev: string, o?: { isTest?: boolean; settings?: Record<string, string> }): Promise<void>;
    export async function seedRules(ev: string): Promise<void>;           // 03 3-4 の初めの8行
    export async function seedWork(ev: string, code: string, o?: { feeType?: string; status?: string; title?: string }): Promise<number>;
    export type SeedPerson = { lastKana?: string; firstKana?: string; birthday?: string | null; category?: string; feeClass?: string | null; matchStatus?: string; memberId?: number | null; casts: [workId: number, status: 'in' | 'maybe' | 'out'][] };
    export async function seedHousehold(ev: string, o: { ref?: string; phone?: string; contactLast?: string; contactLastKana?: string; email?: string; people: SeedPerson[]; charges?: number[]; payments?: number[]; refundsTodo?: number[]; recompute?: boolean }): Promise<{ householdId: number; personIds: number[]; token: string }>;
    export async function seedMember(o: { fullName: string; kana: string; birthday: string | null; status?: string }): Promise<number>;
    ```

- [ ] **Step 1: 純関数の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalStaffPure.test.ts
import { describe, it, expect } from 'vitest';
import { pickStaffEventKey, bankToldWaitDue } from '../recital';

describe('pickStaffEventKey', () => {
  it('決まった3つだけ通し、ほかは本番', () => {
    expect(pickStaffEventKey(undefined)).toBe('bw6');
    expect(pickStaffEventKey('bw6-test')).toBe('bw6-test');
    expect(pickStaffEventKey('bw6-smoke')).toBe('bw6-smoke');
    expect(pickStaffEventKey('t-x')).toBe('bw6');
    expect(pickStaffEventKey('BW6-TEST')).toBe('bw6');
  });
});

describe('bankToldWaitDue（振り込みましたのまま3日。休みの間は数えない。JST の日付で数える）', () => {
  const R = ['2026-12-30', '2027-01-03'] as const;
  const at = (s: string) => Date.parse(s);
  it('2/5（金）に押した → 2/7 はまだ・2/8（月）の朝に出る', () => {
    expect(bankToldWaitDue('2027-02-05T01:00:00.000Z', at('2027-02-07T23:59:00+09:00'), ...R)).toBe(false);
    expect(bankToldWaitDue('2027-02-05T01:00:00.000Z', at('2027-02-08T00:00:00+09:00'), ...R)).toBe(true);
  });
  it('12/29 に押した → 12/30〜1/3 は数えず、1/6 に出る', () => {
    expect(bankToldWaitDue('2026-12-29T03:00:00.000Z', at('2027-01-05T12:00:00+09:00'), ...R)).toBe(false);
    expect(bankToldWaitDue('2026-12-29T03:00:00.000Z', at('2027-01-06T08:00:00+09:00'), ...R)).toBe(true);
  });
  it('JST 2/5 01:00（UTC では 2/4）に押した日は 2/5 と数える', () => {
    expect(bankToldWaitDue('2027-02-04T16:00:00.000Z', at('2027-02-07T12:00:00+09:00'), ...R)).toBe(false);
    expect(bankToldWaitDue('2027-02-04T16:00:00.000Z', at('2027-02-08T00:00:00+09:00'), ...R)).toBe(true);
  });
});
```

- [ ] **Step 2: 回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalStaffPure.test.ts`
Expected: FAIL（`pickStaffEventKey is not a function` など）

- [ ] **Step 3: `src/lib/recital.ts` に2つを足す**

`pickStaffEventKey`：`Object.values(RECITAL_EVENT)` に一字一句あれば、その値。無ければ `RECITAL_EVENT.live`。
`bankToldWaitDue`：押した日 D＝`toldAtUtc` の JST の日付。D の次の日から「今の JST の日付」までのうち、`restFrom`〜`restTo`（両端ふくむ）に入らない日を数え、`BANK_TOLD_WAIT_DAYS` 以上なら true。日付の足し算は `shiftDays`（`src/lib/dateJst.ts`）。この3日は、29 の `listToldWaiting` も同じ関数を使う（2つ書かない）。

- [ ] **Step 4: 回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalStaffPure.test.ts`
Expected: PASS

- [ ] **Step 5: 守りの試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalGuard.test.ts
import { describe, it, expect, vi } from 'vitest';
const auth = vi.hoisted(() => ({ ok: false }));
vi.mock('@/lib/eventAuth', () => ({ isAuthorizedServer: async () => auth.ok }));
import { requireRecitalStaff, isTokenShape } from '../recitalGuard';

describe('requireRecitalStaff', () => {
  it('ログインしていなければ throw、していれば通る', async () => {
    auth.ok = false; await expect(requireRecitalStaff()).rejects.toThrow('Unauthorized');
    auth.ok = true;  await expect(requireRecitalStaff()).resolves.toBeUndefined();
  });
});
describe('isTokenShape（48けたの小文字 hex だけ）', () => {
  it.each([
    ['a'.repeat(48), true], ['0123456789abcdef'.repeat(3), true],
    ['A'.repeat(48), false], ['a'.repeat(47), false], ['a'.repeat(49), false],
    ['g'.repeat(48), false], [123, false], [null, false], [undefined, false],
  ])('%s → %s', (t, want) => expect(isTokenShape(t)).toBe(want));
});
```

- [ ] **Step 6: 回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalGuard.test.ts`
Expected: FAIL（`Cannot find module '../recitalGuard'`）

- [ ] **Step 7: `src/lib/recitalGuard.ts` を作る**

`requireRecitalStaff`：`isAuthorizedServer()` が false なら `throw new Error('Unauthorized')`。
`requireHouseholdByToken`：`isTokenShape` が false なら DB を引かずに `null`。合えば `SELECT id FROM recital_households WHERE edit_token = ?` → 無ければ `null`、あれば `loadHouseholdDetail(id)`。`status`（`merged`）での出し分けはしない（マイページ 14 の仕事）。

- [ ] **Step 8: 回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalGuard.test.ts`
Expected: PASS

- [ ] **Step 9: 試験の道具 `recitalStaffSeed.ts` を作る**

上の Interfaces の6つ。行は台帳SQL（Task 1）の列名どおりに INSERT する（NOT NULL の列は全部うめる。`edit_token` は `randomBytes(24).toString('hex')`、`submit_key` は `seed-<連番>`、`ref` を渡さなければ `String(1000 + seq)`）。名前は「試験」「テスト」などの仮の字だけ（実名を書かない）。
- `seedEvent`：`recital_events` 1行（`is_test`）＋設定は `RECITAL_SETTING_DEFAULTS` に `o.settings` を重ねて全部入れる。
- `charges` は1つの数ごとに `item_code='base'`・`ref=''`・`person_id`＝1人目の id・`status='active'` の行（数える試験のためだけ）。`recompute: true` の時は `charges` を使わず、人と出演を入れたあと `withWriteTx((tx) => recomputeChargesTx(tx, id, 'test'))`（8）で作る。
- `payments` は1つの数ごとに `method='cash'`・`source='manual'`・`paid_on='2026-12-20'`。`refundsTodo` は `recital_refunds` に `status='todo'`・`reason_no=1`。
- `seedWork` の `status` の初めの値は `open`、`fee_type` は `counted`。
- 6 の `recitalTestSeed.ts` の `seedHousehold` とは引数の形がちがうので、`recitalStaffSeed.ts` は別に作る（6 のファイルは変えない）。どの試験がどれを使うか：6〜11・21〜24・27〜28 の DB の試験は `recitalTestSeed.ts`、13〜15 は `recitalFamilySeed.ts`、16〜20 は `recitalStaffSeed.ts`。1つの試験ファイルで2つの `seedHousehold` を混ぜない（使う時は `import * as staffSeed` のように名前を分ける）。

- [ ] **Step 10: DB の試験を書く（落ちる）**

頭の20行は `src/lib/__tests__/bf7EntryDb.test.ts` の1〜25行と同じ形（`TEST_DB = './data/test_recital_staff_home.db'`、毎回消す、`initDb()` のあと台帳SQLを全部流す）。発表会のキーは試験ごとに `t-home-…`。

```ts
// src/lib/__tests__/recitalStaffHome.test.ts（頭は bf7EntryDb.test.ts 1〜25行の形）
describe('countRecitalPeople（05 5-9 の例 6行）', () => {
  it.each([
    // [名前, 人と出演, 請求の合計, 入金, 出る, 済み, まだ, 迷っている]
    ['1人1作品・未払い',          [[['W1', 'in']]],                         [26500], [],            1, 0, 1, 0],
    ['その世帯が払った',          [[['W1', 'in']]],                         [26500], [26500],       1, 1, 0, 0],
    ['兄1妹1を払い兄が1作品足した', [[['W1', 'in'], ['W2', 'in']], [['W1', 'in']]], [37500], [34500], 2, 0, 2, 0],
    ['その 3,000 を払った',       [[['W1', 'in'], ['W2', 'in']], [['W1', 'in']]], [37500], [34500, 3000], 2, 2, 0, 0],
    ['兄1妹1を払い妹がやめた',     [[['W1', 'in']], [['W1', 'out']]],          [26500], [34500],       1, 1, 0, 0],
    ['迷っているだけ（1人）',      [[['W1', 'maybe']]],                       [],      [],            0, 0, 0, 1],
  ])('%s', async (name, people, charges, payments, going, paid, unpaid, maybe) => {
    const ev = `t-home-${name}`;
    await seedEvent(ev);
    const w = { W1: await seedWork(ev, 'W01'), W2: await seedWork(ev, 'W02') };
    await seedHousehold(ev, { people: people.map((cs) => ({ casts: cs.map(([c, s]) => [w[c], s]) })), charges, payments });
    expect(await db.countRecitalPeople(ev)).toMatchObject({ going, paid, unpaid, maybe });
  });
  it('参加費なし・Tシャツ代だけの人は「出る人」に入れず、別の行（special）', async () => {
    await seedEvent('t-home-sp');
    const w = await seedWork('t-home-sp', 'W01');
    await seedHousehold('t-home-sp', { people: [{ casts: [[w, 'in']] }, { feeClass: 'free', casts: [[w, 'in']] }, { feeClass: 'tshirt_only', casts: [[w, 'in']] }], charges: [29500] });
    expect(await db.countRecitalPeople('t-home-sp')).toMatchObject({ going: 1, special: 2 });
  });
  it('試しの発表会の世帯は数えない／ほかの発表会の数も変えない', async () => {
    await seedEvent('t-home-live'); await seedEvent('t-home-test', { isTest: true });
    const a = await seedWork('t-home-live', 'W01'); const b = await seedWork('t-home-test', 'W01');
    await seedHousehold('t-home-live', { people: [{ casts: [[a, 'in']] }], charges: [26500] });
    await seedHousehold('t-home-test', { people: [{ casts: [[b, 'in']] }], charges: [26500] });
    expect((await db.countRecitalPeople('t-home-test')).going).toBe(0);
    expect((await db.countRecitalPeople('t-home-live')).going).toBe(1);
    expect((await db.countRecitalPeople('t-home-live')).countedAt).not.toBe('');
  });
});

describe('listAttention', () => {
  it('1番：カナと生年月日が同じ人が別の世帯 → 1件（後の世帯）。「問題なし」で消え、記録に個人の値を書かない', async () => {
    const ev = 't-home-a1'; await seedEvent(ev); const w = await seedWork(ev, 'W01');
    const p = { lastKana: 'テスト', firstKana: 'ハナコ', birthday: '2015-04-02', casts: [[w, 'in']] as [number, 'in'][] };
    await seedHousehold(ev, { people: [p] });
    const b = await seedHousehold(ev, { people: [p] });
    const items = (await db.listAttention(ev)).filter((i) => i.no === 1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ householdId: b.householdId, personId: b.personIds[0], href: `/staff/bw6/entries/${b.householdId}` });
    await db.dismissAttention(ev, { no: 1, householdId: b.householdId, personId: b.personIds[0] }, RECITAL_STAFF_NAMES[0]);
    expect((await db.listAttention(ev)).filter((i) => i.no === 1)).toHaveLength(0);
    const log = await core.getOne(`SELECT after_json FROM recital_changes WHERE event_key=? AND action='attention_dismissed'`, [ev]);
    expect(String(log?.after_json)).not.toContain('ハナコ');
  });
  it('1番：同じ電話 → 「ご家族」の文。まとめた世帯（merged）は出ない', async () => { /* phone を同じにした2世帯 → label に 'ご家族'。片方を status='merged' にすると 0件 */ });
  it('2番：照合が pending・unmatched の人は出る／manual・none は出ない', async () => { /* 4人を入れて 2件 */ });
  it('3番：事前登録とカナだけ合う（生年月日ちがい）・印が空 → 出る／印が入っていれば出ない／「問題なし」で消える', async () => { /* seedMember＋recital_fee_presets 1行 */ });
  it('4番：払うを開ける前は出ない／開けたら台帳の new の行と「振り込みましたのまま3日」の世帯が出る', async () => {
    const ev = 't-home-a4';
    await seedEvent(ev, { settings: { pay_open_at: '2026-12-15 12:00', pay_ok_at: '' } });
    /* recital_bank_rows に dir='in'・kind='transfer'・state='new' の行1つ。
       世帯1つ：残り 26,500・bank_told_at='2027-02-05T01:00:00.000Z' */
    const now = new Date('2027-02-08T08:00:00+09:00');
    expect((await db.listAttention(ev, now)).filter((i) => i.no === 4)).toHaveLength(0);
    await core.execute(`UPDATE recital_settings SET value='2026-12-14 10:00' WHERE event_key=? AND key='pay_ok_at'`, [ev]);
    expect((await db.listAttention(ev, now)).filter((i) => i.no === 4)).toHaveLength(2);
    expect((await db.listAttention(ev, new Date('2027-02-07T12:00:00+09:00'))).filter((i) => i.no === 4)).toHaveLength(1);
  });
  it('5番：返す分 todo 6,000 → 「6,000円」の1件。残りもある世帯は「返す分を、足した作品に当てるか、決めてください」も出る', async () => { /* refundsTodo: [6000] */ });
  it('8番：いちばん新しいメールが failed → 出る／その後 sent → 出ない', async () => { /* recital_mail_log に2行 */ });
  it('名前を選んでいない「問題なし」は拒む', async () => {
    await expect(db.dismissAttention('t-home-a1', { no: 1, householdId: 1 }, '')).rejects.toThrow('staff_name');
  });
});

describe('searchHouseholds と requireHouseholdByToken', () => {
  it('整理番号・ひらがなのカナ・連絡する人の漢字で見つかる／ほかの発表会は出ない', async () => {
    const ev = 't-home-s'; await seedEvent(ev); await seedEvent('t-home-s2'); const w = await seedWork(ev, 'W01');
    const h = await seedHousehold(ev, { ref: '1001', contactLast: '試験', people: [{ lastKana: 'テスト', firstKana: 'ジロウ', casts: [[w, 'in']] }] });
    await seedHousehold('t-home-s2', { ref: '1001', people: [{ casts: [] }] });
    for (const q of ['1001', '１００１', ' 1001 ', 'てすと', 'ジロウ', '試験']) {
      expect((await db.searchHouseholds(ev, q)).map((r) => r.id)).toEqual([h.householdId]);
    }
  });
  it('鍵の形がちがえば null、知らない鍵も null、正しい鍵なら世帯の中身', async () => {
    const ev = 't-home-t'; await seedEvent(ev);
    const h = await seedHousehold(ev, { people: [{ casts: [] }] });
    expect(await guard.requireHouseholdByToken('xyz')).toBeNull();
    expect(await guard.requireHouseholdByToken('0'.repeat(48))).toBeNull();
    expect((await guard.requireHouseholdByToken(h.token))?.household.id).toBe(h.householdId);
  });
});
```

`/* … */` の所は、上の書いてある試験と同じ形で、コメントの中身のとおりに書く（期待値はコメントの数のまま）。

- [ ] **Step 11: 回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalStaffHome.test.ts`
Expected: FAIL（`db.countRecitalPeople is not a function`）

- [ ] **Step 12: `memberWarn` を `src/lib/recitalMatch.ts` に出す**

`matchMember` の中で `warn` を決めている条件を、そのまま `memberWarn(m)` に移し、`matchMember` はそれを呼ぶ。`npx vitest run src/lib/__tests__/recitalMatch.test.ts` が今までどおり PASS することを見る。条件が `matchMember` の中に見つからない形だったら、止まって知らせる。

- [ ] **Step 13: `src/lib/recitalDb.ts` に4つを足す**

- `countRecitalPeople`：発表会の `active` の世帯の `active` の人ごとに `CountPerson` を作って `countPeople(people, now ?? new Date())` に渡す。`countedIn`＝`isCountedCast(work, cast)` が true の出演の数、`maybeCount`＝`maybe` で作品が `dropped` でない出演の数、`householdRemaining`＝その世帯の `moneySummary({ chargeAmounts: 生きている請求, paymentAmounts: 入金全部, refundTodoAmounts: todo の返す分 }).remaining`、`isTestEvent`＝`recital_events.is_test = 1`。読むのは表ごとに1回ずつ（世帯ごとに引かない。150世帯で60秒をこえないため）。
- `listAttention`：下の6つを、この順（1・2・3・4・5・8）に並べて返す。何も無ければ `[]`。`href` は世帯があれば `/staff/bw6/entries/<householdId>`、4番は `/staff/bw6/bank`。金額は `toLocaleString('ja-JP')` に「円」。
  | no | 出す時 | label |
  |---|---|---|
  | 1 | 別の `active` の世帯どうしで、(a) 人の `normalizeKana(last_kana+first_kana)` と `birthday` が同じ（同じ人かも）、(b) 電話（`normalizePhone` の形）が同じ、(c) 連絡する人の `contact_last_name` が同じで `normalizeKana(contact_last_kana)` も同じ（同じ家族かも）。1組の世帯につき1件、後の世帯（`seq` が大きい方）に付ける。(a) があれば (a) を出す。`personId` は (a) のときだけ後の人 | (a)「同じ人が2回申し込んでいるかもしれません（<前の整理番号>・<後の整理番号>）」／(b)(c)「同じご家族が2回申し込んでいるかもしれません（…・…）」 |
  | 2 | `match_status` が `pending` か `unmatched` の人。または `auto` で `member_id` の会員が `memberWarn` ≠ null の人（スタッフが決めた `manual` になれば消える） | 「会員との照合の確認待ち：<整理番号> <姓><名>」／「会員と合わない申込：…」／「休会中の会員と合いました：…」／「退会した会員と合いました：…」 |
  | 3 | `fee_class_override` が空の人で、`matchFeePreset(人, 発表会の事前登録, 登録された会員だけの MemberLite)` が `{ suspect: true }` | 「特別な料金の対象かもしれません：<整理番号> <姓><名>」 |
  | 4 | `payGate(s, now) === 'open'` の時だけ。(a) `recital_bank_rows` の `dir='in' AND kind='transfer'` で、`state IN ('new','hold')` か、`state='matched'` で、その行の `bank_transaction_id` を持つ入金の合計が行の金額より少ない行、1行1件（28 の `listReviewRows` と同じ条件にする）。(b) `active` で残りがあり、`bank_told_at` があり、`bankToldWaitDue(bank_told_at, now, s.bank_rest_from, s.bank_rest_to)` の世帯、1世帯1件 | (a)「見てほしい入金：<row_date>」／(b)「『振り込みました』のまま3日：<整理番号>」 |
  | 5 | `recital_refunds` の `todo` 1行1件。加えて、todo があり残りもある世帯に1件 | 「返金の待ち：<整理番号> <金額>円」（`waiting_reply=1` なら後ろに「（返事待ち）」）／「返す分を、足した作品に当てるか、決めてください：<整理番号>」 |
  | 8 | その世帯の `recital_mail_log` のうち `status IN ('sent','failed')` のいちばん新しい行が `failed` | 「届かなかったメール：<整理番号>」 |
  1番と3番は、`recital_changes` に `action='attention_dismissed'` で `after_json` の `{no, householdId, personId}`（`personId` が無ければ `null`）が同じ行があれば出さない。
- `dismissAttention`：名前を確かめ、`withWriteTx` の中で `logChangeTx(tx, { eventKey, householdId, personId, action: 'attention_dismissed', after: { no, householdId: householdId ?? null, personId: personId ?? null }, actor: staffName })`。after には番号だけを入れる（名前・カナを入れない）。
- `searchHouseholds`：`q` を `normalize('NFKC')` して前後の空白をとって、空なら `[]`（LINE で聞いた「２７１４」を全角で打っても当たる）。4けたの数字なら `ref_code` が同じ世帯。それ以外は、連絡する人の姓名（そのまま部分一致）と、連絡する人・世帯の人のカナ（`normalizeKana` してから部分一致）。`merged` の世帯も出す（整理番号は両方残るため）。新しい順に20件まで。

- [ ] **Step 14: 回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalStaffHome.test.ts`
Expected: PASS

- [ ] **Step 15: `StaffNamePicker` を作る**

`'use client'`。`<select>`（文字色と下地色を両方）で「名前を選んでください」＋`RECITAL_STAFF_NAMES`。最後に選んだ名前を `localStorage` の `recital_staff_name` に覚える（読む・書くは両方 `try/catch`。読めなくても画面は動く）。マウント時に覚えた名前があれば `onChange` で入れる。

- [ ] **Step 16: 最初の画面 `/staff/bw6` を作る**

`page.tsx`（上から）：
1. `StaffPageHeader`（title「BW6 発表会」、`rightExtra` に発表会の切りかえ `?ev=bw6`／`?ev=bw6-test`／`?ev=bw6-smoke`）。
2. 本番（`bw6`）のときだけ、帯を2つ：`settings.suspended` なら「まだ止めたままです」、`settings.pay_ok_at` が空なら「支払いは、まだ開けていません」（どちらも設定の画面へのリンク付き）。
3. 探す欄：`<form method="get">` の `q`（placeholder「名前・カナ・整理番号で探す」）。`q` があれば `searchHouseholds` の結果を、整理番号・連絡する人・（`merged` なら「まとめた」）の行で出し、`/staff/bw6/entries/<id>` へリンク。
4. 数字：「出る人 N人（目標<goal_people>）」を大きく、「お支払いずみ N人 ／ まだ N人」、小さく「迷っている N人」「参加費なし・Tシャツ代だけの人 N人」「<countedAt を JST の M/D HH:MM> 時点」。
5. `AttentionList`：見出し「見てほしいこと N件」（N＝全部の件数）。**0件なら見出しごと何も出さない。** 番号ごとにまとめ、1・2・3・5・8 は1件ずつリンク、4 は「見てほしい入金 N件」の1行だけ（リンク `/staff/bw6/bank`）。1番・3番の行には「問題なし」（2段階ボタン＋`StaffNamePicker`）→ `dismissAttentionAction`。
6. 各画面へのボタン：作品（`/staff/bw6/works`）・申込（`/staff/bw6/entries`）・設定（`/staff/bw6/settings`）。見てほしい入金・入金の取り込みのボタンは 29 が足す。どのリンクも今の `?ev=` を付けたまま。
`actions.ts`：`dismissAttentionAction(ev: string, item: { no: 1 | 3; householdId?: number; personId?: number }, staffName: string): Promise<{ ok: true } | { ok: false; error: string }>` → `requireRecitalStaff()` → `dismissAttention(pickStaffEventKey(ev), item, staffName)` → `revalidatePath('/staff/bw6')`。
`labels.ts`：（世帯の見え方の言葉は全部 Task 2 の `householdViewLabel(view, remaining)` を使い、ここに表を作らない）`MATCH_STATUS_LABEL`（auto→自動で合った／pending→会員との照合の確認待ち／unmatched→合わない／none→会員ではない／manual→スタッフが決めた）。

- [ ] **Step 17: スタッフのホームにカードを足す**

`src/app/staff/page.tsx` の一覧の、`/staff/mocchin` の次に1つ：`{ href: '/staff/bw6', icon: PartyPopper, title: 'BW6 発表会（申込・お支払い）', description: '申込の数・見てほしいこと・作品・設定（本番 2027/4/11）' }`。

- [ ] **Step 18: 画面を見て確かめる（M5）**

Run: `npm run dev`（M5）→ スタッフでログイン → 375px 幅で `/staff/bw6?ev=bw6-test` を開く。
Expected: 横に広がらない／探す欄に「てすと」と打つと字が見え、試しの世帯が出る／試しの帯が出る／見てほしいことが0件なら見出しが無い／`/staff/bw6` で本番の帯2つが出る。`npx eslint src/app/staff/bw6 src/components/recital/StaffNamePicker.tsx src/lib/recitalGuard.ts` がエラーなし。

- [ ] **Step 19: コミット**

```bash
git add src/lib/recitalGuard.ts src/lib/recital.ts src/lib/recitalMatch.ts src/lib/recitalDb.ts \
  src/components/recital/StaffNamePicker.tsx src/app/staff/bw6/page.tsx src/app/staff/bw6/actions.ts \
  src/app/staff/bw6/AttentionList.tsx src/app/staff/bw6/labels.ts src/app/staff/page.tsx \
  src/lib/__tests__/recitalStaffSeed.ts src/lib/__tests__/recitalStaffPure.test.ts \
  src/lib/__tests__/recitalGuard.test.ts src/lib/__tests__/recitalStaffHome.test.ts
git commit -m "feat(bw6): スタッフの最初の画面（数字・見てほしいこと・探す）と守り

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: 作品の画面と想定一覧

**Files:**
- Create: `src/app/staff/bw6/works/page.tsx`・`src/app/staff/bw6/works/WorkForm.tsx`・`src/app/staff/bw6/works/actions.ts`・`src/app/staff/bw6/works/print/page.tsx`
- Modify: `src/app/staff/bw6/labels.ts`（作品の言葉を足す）
- Modify: `src/lib/recitalDb.ts`（`listWorkPickOptions` を足す）
- Modify: `src/lib/recitalEntryDb.ts`（`dropWork` を足す）
- Test: `src/lib/__tests__/recitalWorksStaff.test.ts`

**Interfaces:**
- Consumes（6）: `listWorks(eventKey): Promise<WorkRow[]>`・`saveWork(eventKey, w: WorkInput, staffName): Promise<{ id: number; workCode: string }>`・`listWorkCounts(eventKey): Promise<Map<number, { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean }>>`
- Consumes（8・9）: `recomputeChargesTx(tx, householdId, actor)`・`readHouseholdMoneyTx(tx, householdId)`・`afterMoneyChanged(householdId, 'total')`
- Consumes（16）: `requireRecitalStaff`・`pickStaffEventKey`・`StaffNamePicker`・`recitalStaffSeed.ts`
- Produces:
  - `src/lib/recitalDb.ts`：`listWorkPickOptions(): Promise<{ classes: { id: number; label: string }[]; instructors: { id: number; name: string }[] }>`
  - `src/lib/recitalEntryDb.ts`：`dropWork(workId: number, confirmCount: number, staffName: string): Promise<{ ok: true; households: number } | { ok: false; code: 'not_found' | 'count_changed' | 'paid_household'; count: number; households?: number }>`

**WorkInput について**：この画面が `saveWork` に渡すのは、03 3-4 の「第1」の列（`kind`・`title`・`class_label`・`slot_label`・`target_label`・`genre`・`entry_mode`・`fee_type`・`extra_fee`・`capacity`・`status`・`public_note`・`staff_note`・`sort_order`）と、`classes: { lesson_master_id: number | null; label: string }[]`・`instructors: { instructor_id: number | null; display_name: string; role: 'choreo' | 'perform' | 'assist'; sort_order: number }[]`（6 の `WorkInput` が正本。snake_case のまま。`sort_order` は画面の行の順に 1 から）。W番号は `saveWork` が登録順に付け、この画面からは変えない。

- [ ] **Step 1: 試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalWorksStaff.test.ts（頭は bf7EntryDb.test.ts 1〜25行の形。TEST_DB='./data/test_recital_works_staff.db'）
describe('listWorkPickOptions', () => {
  it('active のクラスとイントラだけ', async () => {
    /* lesson_master に active=1 と 0 を1つずつ、instructors に active=1 と 0 を1つずつ入れる */
    const o = await db.listWorkPickOptions();
    expect(o.classes.map((c) => c.label)).toContain('試験クラスA');
    expect(o.classes.map((c) => c.label)).not.toContain('試験クラス休み');
    expect(o.instructors.map((i) => i.name)).toEqual(expect.not.arrayContaining(['試験講師休み']));
  });
});

describe('dropWork（段階1：払った世帯がいれば取りやめない）', () => {
  it('未払いの 1人2作品（32,500）の W02 を取りやめ → 26,500。作品は dropped', async () => {
    const ev = 't-works-1'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01'); const w2 = await seedWork(ev, 'W02');
    const h = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in'], [w2, 'in']] }] });
    expect((await money.readHouseholdMoney(h.householdId)).m.total).toBe(32500);
    expect(await entry.dropWork(w2, 1, RECITAL_STAFF_NAMES[0])).toEqual({ ok: true, households: 1 });
    expect((await money.readHouseholdMoney(h.householdId)).m.total).toBe(26500);
    expect((await core.getOne('SELECT status FROM recital_works WHERE id=?', [w2]))?.status).toBe('dropped');
  });
  it('払った世帯（26,500 済み）がその作品に出る → paid_household。作品も請求も変わらない', async () => {
    const ev = 't-works-2'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01');
    const h = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], payments: [26500] });
    expect(await entry.dropWork(w1, 1, RECITAL_STAFF_NAMES[0])).toMatchObject({ ok: false, code: 'paid_household', count: 1, households: 1 });
    expect((await core.getOne('SELECT status FROM recital_works WHERE id=?', [w1]))?.status).toBe('open');
    expect((await money.readHouseholdMoney(h.householdId)).m.total).toBe(26500);
  });
  it('見た時の人数とちがえば count_changed（古い画面から押した）', async () => {
    /* 出る1人の作品に confirmCount=0 → { ok:false, code:'count_changed', count:1 } */
  });
  it('出演が0の作品はそのまま取りやめ（households: 0）／名前が無ければ throw', async () => {
    /* dropWork(w, 0, name) → { ok:true, households:0 }。dropWork(w, 0, '') → rejects 'staff_name' */
  });
});
```

`seedWork` の `status` の初めの値は `open` にしておく（16 の道具）。

- [ ] **Step 2: 回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalWorksStaff.test.ts`
Expected: FAIL（`listWorkPickOptions is not a function`）

- [ ] **Step 3: `listWorkPickOptions` と `dropWork` を作る**

`listWorkPickOptions`：`lesson_master`（`active=1`。`label`＝`class_name`。`target` があれば「class_name（target）」）と `instructors`（`active=1`。`name`）を、それぞれ名前の順で。
`dropWork`：名前を確かめ、1つの `withWriteTx` の中で：作品を読む（無ければ `not_found`）→ その作品の `in`・`maybe` の出演（人が `active`、世帯が `active`）を数えて `count`→ `count !== confirmCount` なら `count_changed`→ その作品に `in` の出演がある世帯のうち、`readHouseholdMoneyTx(tx, id).m.paid > 0` の世帯が1つでもあれば `paid_household`（何も書かない）→ 作品の `status` を `dropped`→ その作品に出演がある世帯ごとに `recomputeChargesTx(tx, id, staffName)`。書き込みのあと（tx の外）で、その世帯ごとに `afterMoneyChanged(id, 'total')`。家庭へのメールは出さない（作品がなくなる時の家庭への一言 7-9 と返す分4番は後の計画）。
わけ：払った世帯がいる取りやめは「返す分4番」が要り、それは後の計画のため。段階1で払った世帯がいる作品を取りやめたい時は、TARO に知らせる（画面の文にも書く）。

- [ ] **Step 4: 回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalWorksStaff.test.ts`
Expected: PASS

- [ ] **Step 5: 作品の画面 `/staff/bw6/works` を作る**

`page.tsx`：`listWorks`・`listWorkCounts`・`listWorkPickOptions` を読む。一覧の列（04 4-4）：W番号／名前／クラス（`recital_work_classes` の label を「・」でつなぐ）／担当（`display_name` を「・」）／受け方／料金の扱い／状態／出る N人／迷っている N人／お支払いずみ N人・まだ N人。`snsNg` の作品に印「SNS に出さない人がいる」。並びは `sort_order`→`work_code`。スマホでは1作品1カード。上に「作品を足す」と「印刷用の想定一覧」（`/staff/bw6/works/print?ev=…`）。
`WorkForm.tsx`（`'use client'`。足す・直すで同じ形）：上の WorkInput の欄。`extra_fee` は `fee_type='extra'` の時だけ出す。クラスは行を足せる（`lesson_master` から選ぶか、「外部（手で入れる）」を選んで label を打つ）。担当も行を足せる（`instructors` から選べば `display_name` に名前が入る。外部は `instructor_id=null` で名前を手で）。状態の選び肢は 準備中／受付中／確定 の3つ。`dropped` の作品は状態を変えられない（取りやめを戻すのは後の計画）。`StaffNamePicker` を付けて「保存」。
`labels.ts` に足す言葉：kind（class→クラス作品／instructor→イントラナンバー／guest→ゲスト／club→ダンス部／special→スペシャル／ending→エンディング／external→外部振付）、entry_mode（form→フォームで受ける／staff→スタッフが入れる／none→受けない）、fee_type（counted→作品の数に数える／not_counted→数えない（お金なし）／extra→別料金／separate→別建て（MOCCHIN））、status（draft→準備中／open→受付中／fixed→確定／dropped→取りやめ）、role（choreo→振付／perform→出演もする／assist→補助）。
`actions.ts`：
- `saveWorkAction(ev: string, w: WorkInput & { id?: number }, staffName: string): Promise<{ ok: true; workCode: string } | { ok: false; error: string }>`：`requireRecitalStaff`→名前→`listWorkCounts` でその作品の `in + maybe` が1以上なのに `fee_type` か `extra_fee` を変えようとしていたら「申込がある作品の料金の扱いは、変えられません」で拒む（請求が作り直されないため）。`status: 'dropped'` が来たら拒む（取りやめは `dropWorkAction` だけ）→`saveWork`→`revalidatePath`。
- `dropWorkAction(workId: number, confirmCount: number, staffName: string)`：2段階ボタンの1回目で「この作品に申込が N人あります。取りやめますか」（N は今の `in + maybe`）を見せ、2回目で `dropWork(workId, N, staffName)`。`paid_household` は「お支払いずみの世帯が N世帯あります。今は取りやめられません。TARO に知らせてください」、`count_changed` は「人数が変わりました。画面を開き直してください」。

- [ ] **Step 6: 印刷用 `/staff/bw6/works/print` を作る**

資料53「作品の想定一覧」：見出し「作品の想定一覧（<JST の M月D日> 時点）」、列は W番号・名前・種類・クラス・担当・対象（`target_label`）・今の人数（出る N／迷っている N）。`dropped` は出さない。下地は白・字は黒、`@media print` でヘッダーとボタンを隠す（`print:hidden`）。A4 縦で1作品1行。

- [ ] **Step 7: 画面を見て確かめる（M5）**

Run: `npm run dev`（M5）→ `/staff/bw6/works?ev=bw6-test`。
Expected: 作品を足すと次のW番号が付く／直してもW番号が変わらない／外部の担当を手で入れられる／375px で横に広がらない／入力の字が見える／申込がある作品の料金の扱いを変えると拒む文が出る／`print` を印刷プレビューで見て1行ずつ出る。`npx eslint src/app/staff/bw6/works` がエラーなし。

- [ ] **Step 8: コミット**

```bash
git add src/app/staff/bw6/works/page.tsx src/app/staff/bw6/works/WorkForm.tsx src/app/staff/bw6/works/actions.ts \
  src/app/staff/bw6/works/print/page.tsx src/app/staff/bw6/labels.ts src/lib/recitalDb.ts src/lib/recitalEntryDb.ts \
  src/lib/__tests__/recitalWorksStaff.test.ts
git commit -m "feat(bw6): 作品の画面（一覧・足す・直す・取りやめ）と想定一覧の印刷

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: 設定の画面

**Files:**
- Create: `src/app/staff/bw6/settings/page.tsx`・`actions.ts`・`SettingsForm.tsx`・`GateButtons.tsx`・`FeeRulesTable.tsx`・`FeePresetsPanel.tsx`・`TestToolsPanel.tsx`
- Modify: `src/lib/recitalDb.ts`（`saveFeeRule`・`listFeePresets`・`saveFeePreset`・`deleteFeePreset`・`searchMembers` を足す）
- Test: `src/lib/__tests__/recitalSettingsStaff.test.ts`

**Interfaces:**
- Consumes（2）: `RECITAL_SETTING_KEYS_SHOWN`・`RECITAL_SETTING_KEYS_LOCKED`・`entryPhase`・`payGate`・`RECITAL_EVENT`・`checkSettingValue(key, value): string | null`（表と試験は Task 2 にある。ここでは作らない）
- Consumes（3）: `FeeRule`・`feeCheck(rules, checkFirst, checkFamily): { ok; first; family; tentative }`
- Consumes（4）: `isValidRef(code)`
- Consumes（5）: `MemberLite`
- Consumes（6 の `loadMembersLite`）: 会員を `MemberLite` に詰めるのは必ずこれ（休会の印をそろえるため）
- Consumes（6）: `getRecitalEvent`・`getRecitalSettings`・`listFeeRules(eventKey): Promise<(FeeRule & { id: number })[]>`（6 が作った物。ここでは作らない）・`saveRecitalSetting(eventKey, key, value, staffName)`・`setPayOk(eventKey, staffName)`・`setSuspended(eventKey, on, staffName): Promise<{ ok: boolean; reason?: 'fee_check' | 'tentative' | 'consent_empty' | 'privacy_empty' | 'line_empty' }>`
- Consumes（11）: `resetTestEvent(eventKey, { dryRun }): Promise<Record<string, number>>`
- Consumes（12）: `recitalPreviewKey(eventKey)`（URL の形 `?ev=`・`pv=` は 12 が決めた物）
- Consumes（16）: `requireRecitalStaff`・`pickStaffEventKey`・`StaffNamePicker`・`recitalStaffSeed.ts`
- Produces:
  - `src/lib/recitalDb.ts`：
    ```ts
    export async function saveFeeRule(eventKey: string, rule: FeeRule & { id?: number }, staffName: string): Promise<{ ok: true; id: number } | { ok: false; code: 'opened' | 'invalid' }>;
    export type FeePresetRow = { id: number; memberId: number; feeClass: 'no_coop' | 'tshirt_only' | 'free'; memo: string | null; createdBy: string; createdAt: string; member: MemberLite | null };
    export async function listFeePresets(eventKey: string): Promise<FeePresetRow[]>;
    export async function saveFeePreset(eventKey: string, x: { memberId: number; feeClass: 'no_coop' | 'tshirt_only' | 'free'; memo: string | null }, staffName: string): Promise<{ ok: true; id: number } | { ok: false; code: 'no_member' }>;
    export async function deleteFeePreset(eventKey: string, id: number, staffName: string): Promise<void>;
    export async function searchMembers(q: string): Promise<MemberLite[]>;   // 20 も使う
    ```

- [ ] **Step 1: DB の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalSettingsStaff.test.ts（頭は bf7EntryDb.test.ts 1〜25行の形。TEST_DB='./data/test_recital_settings_staff.db'）
const NAME = RECITAL_STAFF_NAMES[0];
describe('料金の規則', () => {
  it('受付を開ける前（suspended=1）は直せる／開けたあと（suspended=0）は opened で拒む', async () => {
    await seedEvent('t-set-1', { settings: { suspended: '1' } }); await seedRules('t-set-1');
    const r = (await db.listFeeRules('t-set-1'))[0];
    expect(await db.saveFeeRule('t-set-1', { ...r, unit_amount: 16500 }, NAME)).toMatchObject({ ok: true });
    await core.execute(`UPDATE recital_settings SET value='0' WHERE event_key='t-set-1' AND key='suspended'`);
    expect(await db.saveFeeRule('t-set-1', { ...r, unit_amount: 16000 }, NAME)).toEqual({ ok: false, code: 'opened' });
  });
  it('一度開けてから止め直しても opened で拒む（entry_opened の記録がある）', async () => {
    await seedEvent('t-set-1b', { settings: { suspended: '1' } }); await seedRules('t-set-1b');
    await core.execute(`INSERT INTO recital_changes (event_key, action, actor, created_at) VALUES ('t-set-1b', 'entry_opened', 'TARO', ?)`, [new Date().toISOString()]);
    const r = (await db.listFeeRules('t-set-1b'))[0];
    expect(await db.saveFeeRule('t-set-1b', { ...r, unit_amount: 16500 }, NAME)).toEqual({ ok: false, code: 'opened' });
  });
  it('初めの8行で検算が合う（feeCheck の ok）', async () => {
    await seedEvent('t-set-2'); await seedRules('t-set-2');
    expect(feeCheck(await db.listFeeRules('t-set-2'), [26500, 32500, 35500, 38500, 41500], 8000)).toMatchObject({ ok: true, tentative: false });
  });
});
describe('特別な料金の事前登録', () => {
  it('1人の会員に1行（2回目は種類を直す）。消せる。会員が無ければ no_member', async () => {
    await seedEvent('t-set-3');
    const m = await seedMember({ fullName: '試験 太郎', kana: 'シケン タロウ', birthday: '2010-05-05' });
    await db.saveFeePreset('t-set-3', { memberId: m, feeClass: 'no_coop', memo: null }, NAME);
    await db.saveFeePreset('t-set-3', { memberId: m, feeClass: 'free', memo: '直した' }, NAME);
    const rows = await db.listFeePresets('t-set-3');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ memberId: m, feeClass: 'free', member: { id: m } });
    await db.deleteFeePreset('t-set-3', rows[0].id, NAME);
    expect(await db.listFeePresets('t-set-3')).toHaveLength(0);
    expect(await db.saveFeePreset('t-set-3', { memberId: 999999, feeClass: 'free', memo: null }, NAME)).toEqual({ ok: false, code: 'no_member' });
  });
  it('searchMembers：ひらがなのカナでも漢字でも見つかる', async () => {
    const m = await seedMember({ fullName: '試験 花子', kana: 'シケン ハナコ', birthday: null });
    expect((await db.searchMembers('しけんはなこ')).map((x) => x.id)).toContain(m);
    expect((await db.searchMembers('試験')).map((x) => x.id)).toContain(m);
    expect(await db.searchMembers('  ')).toEqual([]);
  });
});
```

- [ ] **Step 2: 回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalSettingsStaff.test.ts`
Expected: FAIL（`db.saveFeeRule is not a function`）

- [ ] **Step 3: `src/lib/recitalDb.ts` に5つを作る**

- `saveFeeRule`：名前を確かめる→「`suspended`=0、または `recital_changes` にその発表会の `entry_opened` の行が1つでもある、または `is_test=0` の世帯が1つでもある」なら `opened`（03 3-4・決まり3：受付を開けたら料金の設定は変えない。止め直しても戻らない）→`payer_role`・`item_code` が `FeeRule` の値か、`nth_from ≥ 1`、`nth_to` は空か `≥ nth_from`、`unit_amount ≥ 0`、`qty ≥ 1` でなければ `invalid`→`id` があれば UPDATE、無ければ INSERT。
- `listFeePresets`：`recital_fee_presets` を `boom_members` と左結合し、会員を `loadMembersLite` と同じ詰め方で `MemberLite` にする（会員の名前・カナ・生年月日はこの表に写さない。3-9）。
- `saveFeePreset`：名前→会員が無ければ `no_member`→`(event_key, member_id)` が同じ行があれば `fee_class`・`memo` を直し、無ければ INSERT（`created_by`＝名前）。
- `deleteFeePreset`：名前→その発表会の行だけ消す。もう申し込んだ人の印は変わらない（K226。消しても、足しても）。
- `searchMembers`：空白をとって空なら `[]`。`loadMembersLite()` の結果を `normalizeKana(full_name_kana)` が `normalizeKana(q)` を含む、または `full_name`（空白をとった物）が `q`（空白をとった物）を含む、で20件まで。カナの比べ方は JS 側で行う（会員は約220件）。

- [ ] **Step 4: 回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalSettingsStaff.test.ts`
Expected: PASS

- [ ] **Step 5: 設定の画面 `/staff/bw6/settings` を作る**

`page.tsx`（上から。`?ev=` で発表会を切りかえ）：
1. 状態：受付（`entryPhase` を「止めています／受付の前／受付中／締切のあと」）・支払い（`payGate` を「まだ／準備中（時刻は来たが鍵がまだ）／開いている」）。
2. `GateButtons`（`'use client'`）：
   - 「受付を開ける」（`suspended` が true の時）：2段階ボタン＋名前→`openEntryAction`→`setSuspended(ev, false, name)`。`reason` の文：`fee_check`「検算が合いません。料金の規則を直してください」／`tentative`「仮の金額の行があります」／`consent_empty`「同意の文が空です」／`privacy_empty`「使い道の知らせ（privacy_text）が空です」／`line_empty`「公式LINEのURL（line_url）が空です」。開けたあとは `entry_open_at` の時刻で自動で開く、と1行書く。
   - 「受付を止める」（`suspended` が false の時）：2段階＋名前→`setSuspended(ev, true, name)`。
   - 「支払いを開ける」（`pay_ok_at` が空の時だけ）：チェック2つ「TARO から『開けてよい』の返事をもらいましたか」「本番の少額の試しは、通りましたか」の両方に印を付けるまで押せない。`bank_text` が空の時だけ、上に「振込先（bank_text）が空です。このまま開けるとカードだけになります」と出し、3つ目のチェック「カードだけで開けてよい」も付けるまで押せない（4-9・K210）→名前→`setPayOk(ev, name)`。押したあとは「◯月◯日 ◯時に開けました（<pay_ok_at>）」を出すだけ（戻すボタンは作らない。止めたい時は `pay_open_at` を先へ動かす。K224）。
3. `FeeRulesTable`：規則の行（何作品目・金額×数・見せる名前・仮）と、その下に**いつも**検算：`feeCheck(rules, s.fee_check_first, s.fee_check_family)` の `first`（5つ）と `family` を早見表と並べ、合えば「合っています」、合わなければ赤で「合いません」。`suspended` が true の間だけ、行の金額・数・名前・仮を直せる（`saveFeeRuleAction`）。
4. `SettingsForm`：`RECITAL_SETTING_KEYS_SHOWN` の鍵を、まとまりごと（日付と締切／人数／文／振込／メール）に、3-4 の表の「中身」を短くした見出しで出す（見出しの言葉はこのファイルの中の表に置く）。`pay_ok_at`・`bank_audit_done_at`・`suspended`・`stripe_mode` は値を見せるだけ（直す欄を出さない）。`bank_text`・`ref_skip` は「作る人が入れる。台帳SQL・リポジトリには書かない」の注意を添える。保存は1つの鍵ずつ（`saveSettingAction`）。
5. `FeePresetsPanel`：登録の一覧（会員の名前・カナ・種類「協力チケットなし／Tシャツ代だけ／参加費なし」・メモ・入れた人）と、会員を探す欄（`searchMembersAction`）→ 選んで種類とメモ→名前→「登録する」。行ごとに「消す」（2段階）。上に「受付を開ける前に入れる。あとから足しても、もう申し込んだ人は変わらない（世帯の画面の『特別な料金』で直す）」と1行。
6. 試し用のURL：`previewPathAction(ev)` がパスを返し、画面で `location.origin` を前に付けて写す（［写す］ボタン。`navigator.clipboard.writeText` を try/catch）。
7. `TestToolsPanel`（`ev === RECITAL_EVENT.test` のときだけ出す）：「テストデータを消す」→1回目で `resetTestEvent(ev, { dryRun: true })` の件数の表を出し、2回目で `dryRun: false`。

`actions.ts`（どれも1行目 `requireRecitalStaff()`、`ev` は `pickStaffEventKey` を通す、名前を確かめる、最後に `revalidatePath('/staff/bw6/settings')` と `revalidatePath('/staff/bw6')`）：
- `saveSettingAction(ev, key, value, staffName)`：`checkSettingValue(key, value)` が null でなければその文を返す→`saveRecitalSetting`。
- `openEntryAction(ev, staffName)`／`suspendEntryAction(ev, staffName)`／`openPayAction(ev, answers: { replied: boolean; smokeOk: boolean; cardOnlyOk?: boolean }, staffName)`（`replied`・`smokeOk` が両方 true でなければ拒む。`bank_text` が空の時は `cardOnlyOk` も true でなければ拒む）。
- `saveFeeRuleAction(ev, rule, staffName)`・`searchMembersAction(q)`・`saveFeePresetAction(ev, x, staffName)`・`deleteFeePresetAction(ev, id, staffName)`。
- `previewPathAction(ev): Promise<{ path: string }>`：`is_test=1` の発表会は `/bw6/entry?ev=<ev>&pv=<recitalPreviewKey(ev)>`、本番は `/bw6/entry?pv=<recitalPreviewKey(ev)>`。12 の受け方とちがっていたら、12 に合わせる。
- `resetTestDataAction(ev, dryRun: boolean, staffName)`：`ev === RECITAL_EVENT.test` かつ `getRecitalEvent(ev).is_test === 1` でなければ拒む→`resetTestEvent(ev, { dryRun })`。

- [ ] **Step 6: 画面を見て確かめる（M5）**

Run: 計画の頭の「手元の画面の確かめ」のとおり手元のファイルDBで `npm run dev`（M5）→ `/staff/bw6/settings?ev=bw6-test` と `/staff/bw6/settings`。
Expected: 検算がいつも出て「合っています」／手元のDBの `bw6` の行で `consent_items`（と `privacy_text`・`line_url`）を空にして「受付を開ける」→「同意の文が空です」（それぞれの文）／「支払いを開ける」はチェック2つを付けるまで押せず、`bank_text` が空なら3つ目も要る／`pay_ok_at` の欄が無い／`entry_open_at` に `2026/12/15` と打つと拒む文／試しの発表会でだけ「テストデータを消す」が出て、1回目は件数だけ／375px で横に広がらない／全部の欄で字が見える。`npx eslint src/app/staff/bw6/settings` がエラーなし。

- [ ] **Step 7: コミット**

```bash
git add src/app/staff/bw6/settings/page.tsx src/app/staff/bw6/settings/actions.ts src/app/staff/bw6/settings/SettingsForm.tsx \
  src/app/staff/bw6/settings/GateButtons.tsx src/app/staff/bw6/settings/FeeRulesTable.tsx \
  src/app/staff/bw6/settings/FeePresetsPanel.tsx src/app/staff/bw6/settings/TestToolsPanel.tsx \
  src/lib/recitalDb.ts src/lib/__tests__/recitalSettingsStaff.test.ts
git commit -m "feat(bw6): 設定の画面（受付と支払いの鍵・料金の規則と検算・特別な料金の事前登録・試しの道具）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: 申込の一覧と世帯の画面（12/15 に要る物）

**Files:**
- Create: `src/app/staff/bw6/entries/page.tsx`
- Create: `src/app/staff/bw6/entries/[id]/page.tsx`・`[id]/actions.ts`・`[id]/HouseholdEditor.tsx`・`[id]/MoneyButtons.tsx`・`[id]/CopyButtons.tsx`
- Create: `src/lib/recitalLineReplies.ts`
- Modify: `src/lib/recitalDb.ts`（`listEntryRows` を足す）
- Modify: `src/app/staff/bw6/labels.ts`（メール・入金の言葉を足す）
- Test: `src/lib/__tests__/recitalLineReplies.test.ts`・`src/lib/__tests__/recitalEntriesStaff.test.ts`

**Interfaces:**
- Consumes（2）: `householdViewLabel(v, remaining)`・`moneySummary`・`householdView`・`HouseholdView`・`RECITAL_STAFF_NAMES`・`jstToMs`・`recitalMyUrl(token)`
- Consumes（6）: `loadHouseholdDetail(householdId)`・`getRecitalSettings`・`HouseholdDetail`
- Consumes（8）: `applyHouseholdEdits(householdId, edits: HouseholdEdit[], ctx: EditCtx)`（中で変更の控えを送り `afterMoneyChanged` を呼ぶ）・`changeHouseholdEmail(householdId, email, staffName): Promise<{ token: string }>`（中で新しいアドレスへ `resend_url` を送る）・`HouseholdEdit`
- Consumes（9）: `recordManualPayment(householdId, { method: 'cash' | 'adjust'; amount; paidOn; memo }, staffName): Promise<{ paymentId; after }>`・`cancelRefund(refundId, reason, staffName)`（どちらも中で `afterMoneyChanged` を呼ぶ。このタスクは呼ばない）
- Consumes（10）: `sendRecitalMail({ kind, householdId, dedupeKey?, via? })`・`sendPaidMail(householdId, paymentId, via, opts?)`・`countRecitalMailsToday(now?)`
- Consumes（16）: `requireRecitalStaff`・`pickStaffEventKey`・`StaffNamePicker`・`recitalStaffSeed.ts`
- Consumes（既存）: `weekdayJst`・`todayJst`（`src/lib/dateJst.ts`）
- Produces:
  - `src/lib/recitalDb.ts`：
    ```ts
    export type EntryListRow = { id: number; refCode: string; contactName: string; peopleCount: number; worksCount: number; total: number; paid: number; remaining: number; overpaid: number; view: HouseholdView; mailOpened: boolean; bankTold: boolean; payMethod: string | null };
    export async function listEntryRows(eventKey: string): Promise<EntryListRow[]>;   // active の世帯だけ・新しい順
    ```
  - `src/lib/recitalLineReplies.ts`：
    ```ts
    export const RECITAL_LINE_REPLIES: readonly { key: string; title: string; text: string }[];  // 10個＋つなぎ1つ＝11行
    export function fillLineReply(text: string, d: { refCode: string; remaining: number; payDue: string; resendUrl: string }): string;
    ```
  - 世帯の画面の置き場（23 が「振り込みましたの印を付ける」を「お支払い」の欄に、28 が「この入金を取り消す」を入金の行の横に足す）：`[id]/page.tsx` の「お支払い」の欄と入金の行は、それぞれ1つの部品（`StaffPaySection`・`PaymentRows` という名前の関数。家庭の部品 `src/app/bw6/my/PaySection.tsx` と名前を分ける）にまとめておき、23・28 はその中に足す。

- [ ] **Step 1: ひな形の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalLineReplies.test.ts
import { describe, it, expect } from 'vitest';
import { RECITAL_LINE_REPLIES, fillLineReply } from '../recitalLineReplies';

describe('公式LINEの返事のひな形（付録 D）', () => {
  it('10個とつなぎ1つ。題は付録 D のまま', () => {
    expect(RECITAL_LINE_REPLIES).toHaveLength(11);
    expect(RECITAL_LINE_REPLIES[0].title).toBe('振り込みました。届いていますか');
    expect(RECITAL_LINE_REPLIES[4].title).toBe('整理番号を付け忘れました（まちがえました）／去年の振込先に振り込みました');
    expect(RECITAL_LINE_REPLIES[10]).toMatchObject({ key: 'tsunagi', text: '確認して、お返事します。' });
  });
  it('期限は pay_due から曜日を計算して入れる・送り直しのURLを入れる・{ } が残らない', () => {
    const d = { refCode: '1007', remaining: 3000, payDue: '2027-02-10', resendUrl: 'https://example.test/bw6/resend' };
    const t10 = fillLineReply(RECITAL_LINE_REPLIES[9].text, d);
    expect(t10).toContain('2月10日（水）');
    expect(fillLineReply(RECITAL_LINE_REPLIES[8].text, d)).toContain('https://example.test/bw6/resend');
    for (const r of RECITAL_LINE_REPLIES) expect(fillLineReply(r.text, d)).not.toMatch(/[{}]/);
    expect(fillLineReply('{整理番号} {残り}', d)).toBe('1007 3,000円');
  });
});
```

- [ ] **Step 2: 回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalLineReplies.test.ts`
Expected: FAIL（`Cannot find module '../recitalLineReplies'`）

- [ ] **Step 3: `src/lib/recitalLineReplies.ts` を作る**

`RECITAL_LINE_REPLIES` の `title` と `text` は、設計書 `ch/ap.md` の「D. 公式LINEの返事のひな形」の表の「家庭の言葉（題）」と「返す文（案）」を、**一字一句**写す（`text` は外側のかぎかっこ「」を除く）。置きかえは2つだけ：文の中の「2月10日（水）」→ `{期限}`、「（送り直しのページのURL）」→ `{送り直しURL}`。`key` は `'1'`〜`'10'` と `'tsunagi'`。
`fillLineReply`：`{整理番号}`→`refCode`、`{残り}`→`remaining.toLocaleString('ja-JP') + '円'`、`{期限}`→`payDue` から「M月D日（曜）」（曜は `weekdayJst(payDue)` から。文に曜日を直書きしない）、`{送り直しURL}`→`resendUrl`。2番の「（◯月◯日）」はスタッフが入れる所なので、そのまま残す。文は案で、受付の前に TARO が直す（直すのはこのファイル）。

- [ ] **Step 4: 回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalLineReplies.test.ts`
Expected: PASS

- [ ] **Step 5: 一覧の試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalEntriesStaff.test.ts（頭は bf7EntryDb.test.ts 1〜25行の形。TEST_DB='./data/test_recital_entries_staff.db'）
describe('listEntryRows', () => {
  it('お金と見え方が世帯の画面（loadHouseholdDetail）と同じ・merged は出ない・新しい順', async () => {
    const ev = 't-ent-1'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01'); const w2 = await seedWork(ev, 'W02');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });                                    // 仮受付 26,500
    const b = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], payments: [26500] });                 // 申込完了
    const c = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in'], [w2, 'in']] }], payments: [26500] });     // 追加分 6,000
    const d = await seedHousehold(ev, { people: [{ casts: [[w1, 'out']] }] });                                                   // 出演なし
    const m = await seedHousehold(ev, { people: [{ casts: [[w1, 'in']] }] });
    await core.execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [a.householdId, m.householdId]);
    const rows = await db.listEntryRows(ev);
    expect(rows.map((r) => r.id)).toEqual([d, c, b, a].map((h) => h.householdId));
    expect(rows.find((r) => r.id === c.householdId)).toMatchObject({ total: 32500, paid: 26500, remaining: 6000, view: 'complete_extra', worksCount: 2, peopleCount: 1 });
    expect(rows.find((r) => r.id === a.householdId)).toMatchObject({ view: 'tentative', remaining: 26500 });
    expect(rows.find((r) => r.id === b.householdId)).toMatchObject({ view: 'complete', remaining: 0 });
    expect(rows.find((r) => r.id === d.householdId)).toMatchObject({ view: 'none' });
    for (const r of rows) {
      const det = await db.loadHouseholdDetail(r.id);
      expect({ total: r.total, paid: r.paid, remaining: r.remaining, view: r.view }).toEqual({ ...pick(det!.money, ['total', 'paid', 'remaining']), view: det!.view });
    }
  });
  it('振り込みましたの印がある世帯は bankTold が true', async () => {
    const ev = 't-ent-2'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    const b = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    await core.execute(`UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-21', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [new Date().toISOString(), a.householdId]);
    const rows = await db.listEntryRows(ev);
    expect(rows.find((r) => r.id === a.householdId)?.bankTold).toBe(true);
    expect(rows.find((r) => r.id === b.householdId)?.bankTold).toBe(false);
  });
});
```

（`pick` は試験ファイルの中の小さな関数。）

- [ ] **Step 6: 回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalEntriesStaff.test.ts`
Expected: FAIL（`db.listEntryRows is not a function`）

- [ ] **Step 7: `listEntryRows` を作る**

表ごとに1回ずつ読み（世帯・人・出演と作品・生きている請求・入金・todo の返す分）、JS で世帯ごとにまとめる。`worksCount`＝`in`・`maybe` で作品が `dropped` でない出演の数。`hasIn`＝`in` で作品が `dropped` でない出演がある、`hasMaybe`＝同じく `maybe`。お金は `moneySummary`、見え方は `householdView`。`loadHouseholdDetail` の数え方とちがう所が出たら（試験の最後の for が落ちたら）、こちらで合わせず、止まって知らせる。`contactName`＝`contact_last_name + ' ' + contact_first_name`。`mailOpened`＝`mail_opened_at` がある、`bankTold`＝`bank_told_at` がある。

- [ ] **Step 8: 回して通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalEntriesStaff.test.ts`
Expected: PASS

- [ ] **Step 9: 申込の一覧 `/staff/bw6/entries` を作る**

上に、見え方ごとの数「仮受付 N世帯（N人）／申込完了 N世帯（N人）／申込完了（追加分がお支払い待ち）N世帯（N人）／出演なし N世帯（N人）」（R-101。人は `peopleCount` の和）。しぼりこみ `?view=all|tentative|complete|complete_extra|none`（「期限を過ぎた」は総点検のあとなので後の計画）。行：整理番号／連絡する人／人数／作品の数／今の金額／払った額／残り／状態（`householdViewLabel(view, remaining)`）／メールから開いたか（開いていなければ小さく「控えから未開」）／`bankTold` なら小さく「確認中」。行を押すと `/staff/bw6/entries/<id>`。スマホでは1世帯1カード。上に `searchHouseholds` と同じ探す欄（16 の画面と同じ form で `/staff/bw6?q=` へ送ってよい）。

- [ ] **Step 10: 世帯の画面 `/staff/bw6/entries/[id]` を作る**

`loadHouseholdDetail(id)`。無ければ `notFound()`。発表会の設定は世帯の `event_key` で読む（`?ev=` は使わない）。上から（04 4-4）：
1. 整理番号（大きく）・合計・払った額・残り（大きく）・状態（`householdViewLabel`）・「お支払いずみの分 N円」（`overpaid > 0` の時）・`merged` なら「まとめた（まとめ先：<整理番号>へのリンク）」。入金の行に `source='manual'` で `memo` が「移した」でないプラスの行と、`source` が `stripe_webhook` か `stripe_recheck` の行が両方あれば「二重の記録かもしれません」（9 の手順6と同じ条件）。
2. `StaffPaySection`「お支払い」：払い方（`pay_method`：card→カード／bank→銀行振込／cash→現金／空→まだ選んでいない）・「振り込みました」の印（日・お名前・金額・押した時・`bank_told_by`：family→家庭／staff→スタッフ）と「確認中」。
3. 中身：人ごとに、名前・カナ・生年月日・学年（`schoolGrade(birthday, show_date)`）・特別な料金の印・会員との照合（`MATCH_STATUS_LABEL`）・インスタ・名前/写真/SNS の印・Tシャツ・出演（W番号・作品名・状態）。
4. `PaymentRows` 入金の行：日・金額・払い方（bank→銀行振込／card→カード／cash→現金／adjust→調整）・どこから（bank_auto→自動で当てた／bank_staff→人が当てた／stripe_webhook→カード／manual→手で）・メモ。
5. 返す分の行：金額・わけ（`reason`）・状態（todo→返金の待ち／done→返した／cancelled→取り消した）。`todo` の行の横に「返す分を取り消す」（理由必須・名前・2段階）。
6. 送ったメール：種類（receipt→受付の控え／change→変更の控え／complete→申込完了／extra_complete→追加分のお支払い完了／remaining→あと◯円のお知らせ／resend_url→URLの送り直し／bank_guide→お振込みのご案内）・状態（sent→送った／failed→失敗／waiting→待ち／cancelled→取りやめ）・日時。アドレスは出さない。
7. 変えた記録：日時・`action`・だれが・理由・家庭から聞いた日時。
8. 上の右に小さく「今日の送信 N通」（`countRecitalMailsToday()`。`warn` なら赤で「（上限に近いです）」。03・7-7。最初の画面〔16〕には出さない）。
9. ボタン（`CopyButtons`・`HouseholdEditor`・`MoneyButtons`）：「代わりに直す」「マイページのURLを写す」「控えを送り直す」「メールアドレスを直す」「手で入金を記録」「公式LINEのひな形」。スマホでも全部押せる。

`HouseholdEditor`（`'use client'`）：人ごとの欄（姓・名・セイ・メイ・生年月日・載せる名前・Tシャツ・インスタ・`name_ok`・`photo_ok`・`sns_ok`・メモ）、出演（その発表会の `dropped` でない作品を選んで 出る／迷っている／やめた）、連絡する人の欄（姓名・カナ・電話・メモ）。下に「理由」（必須）・「家庭から聞いた日時」（任意。`datetime-local`）・名前。変わった欄だけを `HouseholdEdit[]` にして送る。結果の `code` の文：`closed`「締切のあとです」／`max_works`「5作品をこえます」／`paid_no_maybe`「お支払いのあとは『迷っている』に戻せません」／`last_work`「最後の1作品です。公式LINEで家庭に確かめてください」／`invalid`「入れた値を確かめてください」。

`MoneyButtons`（`'use client'`）：「手で入金を記録」＝払い方（現金／調整）・日（今日が初めの値。先の日は不可）・金額・メモ（調整は必須）・名前。調整はマイナスも入れられる（打ちまちがいの打ち消し。「入金の記録は消さない。まちがいはマイナスの行で打ち消す」5-6。欄の下に「打ちまちがいは、同じ額をマイナスで入れて打ち消します」と1行）。金額が残りより少なければ、押す前に「一部だけの入金です。ご家庭には『追加分 ◯円のお支払い待ち』と出ます。」を出す。振込は選べない（文で「振込は『見てほしい入金』から当てます」）。

`CopyButtons`（`'use client'`）：
- 「マイページのURLを写す」：押した時だけ `myPageUrlAction` で URL をもらって写す（鍵を初めの HTML に入れない。`location.origin` はスタッフが開いている bw5-app なので使わない）。横に「LINE の相手が、この世帯の人だと分かる時だけ貼る」。
- 「控えを送り直す」：2段階→`resendReceiptAction`→結果（送った／失敗）。
- 「メールアドレスを直す」：新しいアドレス（字の色と下地）・名前・2段階→`changeEmailAction`。「古いURLは使えなくなります」と出す。
- 「公式LINEのひな形」：11行の題を並べ、押すと `fillLineReply(text, { refCode, remaining, payDue: 世帯の pay_due_override か設定の pay_due, resendUrl: RECITAL_PUBLIC_ORIGIN + '/bw6/resend' })` を見せて［写す］。

`[id]/actions.ts`（どれも1行目 `requireRecitalStaff()`、名前のいるものは `RECITAL_STAFF_NAMES` を確かめる、最後に `revalidatePath('/staff/bw6/entries/' + id)`）：
- `editHouseholdAction(householdId, edits: HouseholdEdit[], x: { reason: string; receivedAtJst: string | null; staffName: string })`：理由が空なら拒む。`receivedAtJst`（`YYYY-MM-DDTHH:MM`）は `jstToMs` で UTC ISO に直して `receivedAt` へ→`applyHouseholdEdits(householdId, edits, { actor: staffName, by: 'staff', reason, receivedAt })`。変更の控えと `afterMoneyChanged` は 8 が中でするので、ここでは送らない・呼ばない。
- `myPageUrlAction(householdId): Promise<{ url: string }>`：`recitalMyUrl(edit_token)`（Task 2。家庭向けの `https://event.boom-sendai.com/bw6/my?t=…`）。記録・ログに鍵を出さない。
- `resendReceiptAction(householdId)`：`sendRecitalMail({ kind: 'receipt', householdId })` の `status` を返す（08 の「直ったあとに控えを送り直す」）。
- `changeEmailAction(householdId, email, staffName)`：空白をとって、`@` を1つ含み空白が無いか見る→`changeHouseholdEmail`（新しいアドレスへの `resend_url` は 8 が中で送る。ここでは送らない）。
- `recordManualPaymentAction(householdId, x: { method: 'cash' | 'adjust'; amount: number; paidOn: string; memo: string }, staffName)`：`method` が2つのどちらか・`cash` は1以上の整数、`adjust` は0でない整数（9 の決まりと同じ）・`paidOn` が `isIsoDate` で `todayJst()` 以下・調整ならメモが空でない→`recordManualPayment`（`afterMoneyChanged` は中で呼ばれる）→`sendPaidMail(householdId, paymentId, x.method)` だけを呼ぶ。払った額が0未満になる時は 9 の `recital_money:negative` を「払った額がマイナスになります」の文で返す。
- `cancelRefundAction(householdId, refundId, reason, staffName)`：理由が空なら拒む→`cancelRefund(refundId, reason, staffName)`。

- [ ] **Step 11: 画面を見て確かめる（M5）**

Run: `npm run dev`（M5）→ 試しの発表会で申込を2件作る → `/staff/bw6/entries?ev=bw6-test` → 1件を開く。
Expected: 一覧の上に「◯世帯（◯人）」／しぼりこみが効く／世帯の画面で「代わりに直す」で作品を1つ足すと合計が変わり、変えた記録に理由と聞いた日時が出る／「マイページのURLを写す」で写したURLが開ける／「手で入金を記録」で現金 26,500 を入れると「申込完了」になり、送ったメールに「申込完了」が出る（試しなので `test_mail_to` へ）／ひな形10番に「2月10日（水）」が入っている／375px で全部のボタンが押せる／全部の欄で字が見える。`npx eslint src/app/staff/bw6/entries src/lib/recitalLineReplies.ts` がエラーなし。

- [ ] **Step 12: コミット**

```bash
git add src/app/staff/bw6/entries/page.tsx 'src/app/staff/bw6/entries/[id]/page.tsx' 'src/app/staff/bw6/entries/[id]/actions.ts' \
  'src/app/staff/bw6/entries/[id]/HouseholdEditor.tsx' 'src/app/staff/bw6/entries/[id]/MoneyButtons.tsx' \
  'src/app/staff/bw6/entries/[id]/CopyButtons.tsx' src/app/staff/bw6/labels.ts src/lib/recitalLineReplies.ts src/lib/recitalDb.ts \
  src/lib/__tests__/recitalLineReplies.test.ts src/lib/__tests__/recitalEntriesStaff.test.ts
git commit -m "feat(bw6): 申込の一覧と世帯の画面（代わりに直す・URLを写す・控え・メール・手で入金・ひな形）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: 世帯をまとめる・特別な料金ボタン・照合を決める

**逃げ道**：12/8（火）に出すか決める。外すと決めたら作らない（ほかのタスクは動く。8・9 を呼ぶだけ）。外した時は、12/22（火）までは作る人が手で直す（5-1）。**最後の見直しは Fable**（お金にさわるため）。

**Files:**
- Create: `src/lib/recitalStaffDb.ts`
- Modify: `src/app/staff/bw6/entries/[id]/page.tsx`・`[id]/actions.ts`
- Create: `src/app/staff/bw6/entries/[id]/FeeClassPanel.tsx`・`[id]/MergePanel.tsx`・`[id]/MatchPanel.tsx`
- Test: `src/lib/__tests__/recitalStaffDb.test.ts`

**Interfaces:**
- Consumes（2）: `FeeClass`・`MoneySummary`・`RECITAL_STAFF_NAMES`
- Consumes（5）: `MemberLite`・`matchMember(p, members)`
- Consumes（6）: `logChangeTx`・`loadHouseholdDetail`
- Consumes（8）: `recomputeChargesTx(tx, householdId, actor): Promise<{ totalBefore; totalAfter; firstPersonId }>`
- Consumes（9）: `readHouseholdMoneyTx(tx, householdId): Promise<HouseholdMoney>`・`createRefundTx(tx, { householdId, amount, reasonNo, reason, createdBy, ... })`・`afterMoneyChanged(householdId, 'total')`・`refundForDecrease({ totalBefore, paid, totalAfter }): number`（返す額の式。ここに式を写さない）
- Consumes（10）: `sendRecitalMail({ kind: 'change', householdId })`（まとめられた世帯へは、10 が `merged` を見て `change.merged` を入れる）
- Consumes（6）: `loadMembersLite()`（照合の候補を `MemberLite` に詰めるのはこれ）
- Consumes（18）: `searchMembers(q)`（画面で会員を探す）
- Consumes（21）: `expireOpenCheckout(householdId, reason)`（**20 は 21 の後に始める**。20 は 12/8 に出すか決める逃げ道のタスクなので、後へ回しても困らない）
- Produces（`src/lib/recitalStaffDb.ts`）:
  ```ts
  export type FeeChangePreview = { changed: boolean; totalBefore: number; totalAfter: number; refund: number; extra: number; adjustActive: number };
  export async function setFeeClass(personId: number, feeClass: FeeClass, reason: string, staffName: string, opts?: { dryRun?: boolean }): Promise<FeeChangePreview>;
  export async function addAdjustCharge(householdId: number, x: { direction: 'down' | 'up'; amount: number; reason: string }, staffName: string, opts?: { dryRun?: boolean }): Promise<{ ok: true; totalBefore: number; totalAfter: number } | { ok: false; code: 'over_total' | 'invalid' }>;
  export async function voidAdjustCharge(chargeId: number, reason: string, staffName: string): Promise<{ ok: boolean }>;
  export type MergeResult = { ok: true; totalBefore: number; totalAfter: number; moved: number; refund: number } | { ok: false; code: 'same' | 'not_active' | 'other_event' | 'has_adjust' | 'has_refund_todo' | 'bad_pair' };
  export async function mergeHouseholds(fromId: number, intoId: number, x: { reason: string; samePeople: { dropPersonId: number; keepPersonId: number }[] }, staffName: string, opts?: { dryRun?: boolean }): Promise<MergeResult>;
  export async function listMatchCandidates(personId: number): Promise<{ candidates: MemberLite[]; presets: Record<number, Exclude<FeeClass, null>> }>;
  export async function decideMemberMatch(personId: number, choice: { memberId: number } | { none: true }, reason: string, staffName: string, opts?: { dryRun?: boolean }): Promise<FeeChangePreview & { presetClass: Exclude<FeeClass, null> | null; keptClass: FeeClass }>;
  ```
  `dryRun: true` は、同じ書き込みを `withWriteTx` の中で全部やってから、ファイルの中だけの印のエラーを投げて巻き戻し、結果だけ返す（押す前の「今の合計 → 直したあと」を、本番と同じ計算で出すため）。`dryRun` の時は、tx の外の仕事（メール・`afterMoneyChanged`・`expireOpenCheckout`）をしない。

- [ ] **Step 1: 試験を書く（落ちる）**

```ts
// src/lib/__tests__/recitalStaffDb.test.ts（頭は bf7EntryDb.test.ts 1〜25行の形。TEST_DB='./data/test_recital_staff_db.db'）
const N = RECITAL_STAFF_NAMES[0];
const total = async (h: number) => (await money.readHouseholdMoney(h)).m;
async function one(ev: string, casts: ('W1' | 'W2')[][], payments: number[] = []): Promise<{ h: number; p: number[] }> { /* ev が初めてなら seedEvent・seedRules・seedWork('W01')・seedWork('W02')。casts の 'W1'/'W2' を作品 id に直し、すべて 'in' で seedHousehold（recompute: true, payments）。返すのは householdId と personIds */ }

describe('setFeeClass（特別な料金ボタン。5-1・5-7 の例）', () => {
  it('払った 1人1作品（26,500）を「協力チケットなし」に → 19,000、返す分 7,500（3番）', async () => {
    const { h, p } = await one('t-sd-1', [['W1']], [26500]);
    const r = await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N);
    expect(r).toMatchObject({ changed: true, totalBefore: 26500, totalAfter: 19000, refund: 7500, extra: 0 });
    expect(await core.getOne(`SELECT amount, reason_no, status FROM recital_refunds WHERE household_id=?`, [h])).toMatchObject({ amount: 7500, reason_no: 3, status: 'todo' });
    expect(await total(h)).toMatchObject({ total: 19000, paid: 19000, remaining: 0 });
  });
  it('未払いなら返す分は作らない（Tシャツ代だけ → 3,000）', async () => {
    const { h, p } = await one('t-sd-2', [['W1']]);
    expect(await staff.setFeeClass(p[0], 'tshirt_only', '登録もれ', N)).toMatchObject({ changed: true, totalBefore: 26500, totalAfter: 3000, refund: 0 });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id=?`, [h]))?.n).toBe(0);
  });
  it('兄2・妹1（37,500）で妹を「Tシャツ代だけ」→ 1人目が兄に入れかわり 35,500', async () => {
    const { h, p } = await one('t-sd-3', [['W1', 'W2'], ['W1']]);
    expect(await total(h)).toMatchObject({ total: 37500 });
    expect(await staff.setFeeClass(p[1], 'tshirt_only', '登録もれ', N)).toMatchObject({ totalAfter: 35500 });
  });
  it('同じ種類をもう一度 → changed:false、記録は増えない', async () => {
    const { h, p } = await one('t-sd-4', [['W1']]);
    await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N);
    const n = (await core.getOne(`SELECT COUNT(*) n FROM recital_changes WHERE household_id=?`, [h]))?.n;
    expect(await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N)).toMatchObject({ changed: false, totalBefore: 19000, totalAfter: 19000, refund: 0, extra: 0 });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_changes WHERE household_id=?`, [h]))?.n).toBe(n);
  });
  it('払った 19,000（協力チケットなし）を「ふつう」に戻す → 26,500、追加分 7,500、返す分なし', async () => {
    const { h, p } = await one('t-sd-5', [['W1']]);
    await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N);
    await money.recordManualPayment(h, { method: 'cash', amount: 19000, paidOn: '2026-12-20', memo: '' }, N);
    expect(await staff.setFeeClass(p[0], null, '戻した', N)).toMatchObject({ totalAfter: 26500, extra: 7500, refund: 0 });
    expect((await money.readHouseholdMoney(h)).view).toBe('complete_extra');
  });
  it('dryRun は同じ数を返し、DB は変わらない', async () => {
    const { h, p } = await one('t-sd-6', [['W1']], [26500]);
    const before = await core.getAll(`SELECT * FROM recital_charges WHERE household_id=?`, [h]);
    expect(await staff.setFeeClass(p[0], 'no_coop', '試し', N, { dryRun: true })).toMatchObject({ totalAfter: 19000, refund: 7500 });
    expect(await core.getAll(`SELECT * FROM recital_charges WHERE household_id=?`, [h])).toEqual(before);
    expect((await core.getOne(`SELECT fee_class_override f FROM recital_people WHERE id=?`, [p[0]]))?.f).toBeNull();
  });
  it('名前が無ければ throw', async () => {
    const { p } = await one('t-sd-7', [['W1']]);
    await expect(staff.setFeeClass(p[0], 'no_coop', '登録もれ', '')).rejects.toThrow('staff_name');
  });
});

describe('そのほかの金額の直し（adjust。K228）', () => {
  it('26,500 を 1,000 下げる → 25,500（is_exception=1）／合計をこえて下げられない／取り消すと戻る／上げる', async () => {
    const { h } = await one('t-sd-a', [['W1']]);
    expect(await staff.addAdjustCharge(h, { direction: 'down', amount: 1000, reason: '試し' }, N)).toMatchObject({ ok: true, totalAfter: 25500 });
    expect(await staff.addAdjustCharge(h, { direction: 'down', amount: 30000, reason: '試し' }, N)).toEqual({ ok: false, code: 'over_total' });
    const adj = await core.getOne(`SELECT id, amount FROM recital_charges WHERE household_id=? AND item_code='adjust' AND status='active'`, [h]);
    expect(adj?.amount).toBe(-1000);
    expect((await core.getOne(`SELECT is_exception FROM recital_changes WHERE household_id=? AND action='adjust_add'`, [h]))?.is_exception).toBe(1);
    await staff.voidAdjustCharge(Number(adj!.id), 'まちがい', N);
    expect((await total(h)).total).toBe(26500);
    expect(await staff.addAdjustCharge(h, { direction: 'up', amount: 2000, reason: '試し' }, N)).toMatchObject({ totalAfter: 28500 });
  });
});

describe('mergeHouseholds（5-2・5-7 の例）', () => {
  it('別々に払った家族（26,500＋26,500）→ 34,500、返す分 18,500（2番）、入金は「調整」で移す', async () => {
    const A = await one('t-sd-m1', [['W1']], [26500]); const B = await one('t-sd-m1', [['W1']], [26500]);
    const r = await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    expect(r).toEqual({ ok: true, totalBefore: 53000, totalAfter: 34500, moved: 26500, refund: 18500 });
    expect(await core.getAll(`SELECT household_id, method, amount, memo FROM recital_payments WHERE memo='移した' ORDER BY amount`)).toEqual([
      { household_id: B.h, method: 'adjust', amount: -26500, memo: '移した' }, { household_id: A.h, method: 'adjust', amount: 26500, memo: '移した' }]);
    expect(await core.getOne(`SELECT status, merged_into FROM recital_households WHERE id=?`, [B.h])).toEqual({ status: 'merged', merged_into: A.h });
    expect(await core.getOne(`SELECT reason_no, amount FROM recital_refunds WHERE household_id=?`, [A.h])).toEqual({ reason_no: 2, amount: 18500 });
    expect(await total(A.h)).toMatchObject({ total: 34500, paid: 34500, remaining: 0 });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_charges WHERE household_id=? AND status='active'`, [B.h]))?.n).toBe(0);
  });
  it('まとめても両方の整理番号はそのまま', async () => {
    const A = await one('t-sd-m6', [['W1']]); const B = await one('t-sd-m6', [['W1']]);
    const refs = async () => (await core.getAll(`SELECT id, ref_code FROM recital_households WHERE id IN (?,?) ORDER BY id`, [A.h, B.h]));
    const before = await refs();
    await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    expect(await refs()).toEqual(before);
  });
  it('同じ子の二重（両方 26,500 済み）→ 26,500、返す分 26,500。片方の人は withdrawn・出演は out', async () => {
    const A = await one('t-sd-m2', [['W1']], [26500]); const B = await one('t-sd-m2', [['W1']], [26500]);
    const r = await staff.mergeHouseholds(B.h, A.h, { reason: '二重', samePeople: [{ dropPersonId: B.p[0], keepPersonId: A.p[0] }] }, N);
    expect(r).toMatchObject({ ok: true, totalAfter: 26500, refund: 26500 });
    expect(await core.getOne(`SELECT status, merged_into FROM recital_people WHERE id=?`, [B.p[0]])).toEqual({ status: 'withdrawn', merged_into: A.p[0] });
    expect((await core.getAll(`SELECT status FROM recital_casts WHERE person_id=?`, [B.p[0]])).every((c) => c.status === 'out')).toBe(true);
  });
  it('未払いどうし → 34,500。入金の行も返す分も作らない', async () => {
    const A = await one('t-sd-m3', [['W1']]); const B = await one('t-sd-m3', [['W1']]);
    expect(await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: true, totalBefore: 53000, totalAfter: 34500, moved: 0, refund: 0 });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id IN (?,?)`, [A.h, B.h]))?.n).toBe(0);
  });
  it('2回目は not_active（お金は動かない）／同じ世帯は same／もとに手の調整があれば has_adjust', async () => {
    const A = await one('t-sd-m4', [['W1']], [26500]); const B = await one('t-sd-m4', [['W1']], [26500]); const C = await one('t-sd-m4', [['W1']]);
    await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    const pays = (await core.getOne(`SELECT COUNT(*) n FROM recital_payments`))?.n;
    expect(await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: false, code: 'not_active' });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_payments`))?.n).toBe(pays);
    expect(await staff.mergeHouseholds(A.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: false, code: 'same' });
    await staff.addAdjustCharge(C.h, { direction: 'down', amount: 1000, reason: '試し' }, N);
    expect(await staff.mergeHouseholds(C.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: false, code: 'has_adjust' });
  });
  it('dryRun は数だけ返し、もとの世帯は active のまま', async () => {
    const A = await one('t-sd-m5', [['W1']], [26500]); const B = await one('t-sd-m5', [['W1']], [26500]);
    const pays = (await core.getOne(`SELECT COUNT(*) n FROM recital_payments`))?.n;
    expect(await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N, { dryRun: true })).toMatchObject({ ok: true, totalAfter: 34500, refund: 18500 });
    expect((await core.getOne(`SELECT status FROM recital_households WHERE id=?`, [B.h]))?.status).toBe('active');
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_payments`))?.n).toBe(pays);
  });
});

describe('照合を決める（5-8）', () => {
  it('事前登録（協力チケットなし）の会員と結ぶ → manual・印が入り 19,000', async () => {
    /* seedMember＋recital_fee_presets（no_coop）。人は match_status='pending'・印は空・1人1作品・未払い
       decideMemberMatch(p, { memberId: m }, '確かめた', N) → { presetClass:'no_coop', keptClass:'no_coop', totalAfter:19000 }。people は member_id=m・match_status='manual' */
  });
  it('印がもう「参加費なし」なら変えない（K226）', async () => { /* → { changed:false, presetClass:'no_coop', keptClass:'free' } */ });
  it('払ったあとに結んで下がった → 返す分 7,500（3番）', async () => { /* 26,500 済み → refund 7500 */ });
  it('「会員ではない」→ none・member_id 空', async () => { /* match_status 'none' */ });
  it('listMatchCandidates：カナが合い生年月日がちがう会員が候補に出る', async () => { /* candidates に m */ });
});
```

`/* … */` の所は、上の書いてある試験と同じ形で、コメントの中身のとおりに書く（期待値はコメントの数のまま）。

- [ ] **Step 2: 回して落ちるのを見る**

Run: `npx vitest run src/lib/__tests__/recitalStaffDb.test.ts`
Expected: FAIL（`Cannot find module '../recitalStaffDb'`）

- [ ] **Step 3: `setFeeClass`・`addAdjustCharge`・`voidAdjustCharge` を作る**

`setFeeClass`（1つの `withWriteTx`）：名前→人を読む（`active`、世帯も `active`。ちがえば throw）→今の印と同じなら何も書かずに `{ changed: false, … }`（合計は今の値）→`before = readHouseholdMoneyTx`→印を書く→`recomputeChargesTx(tx, 世帯, staffName)`→`after = readHouseholdMoneyTx`→`refund = refundForDecrease({ totalBefore: before.m.total, paid: before.m.paid, totalAfter: after.m.total })`（Task 9。払っていなければ 0 になる）。`refund > 0` なら `createRefundTx(tx, { householdId, amount: refund, reasonNo: 3, reason: '払ったあとに、スタッフが特別な料金の種類を直した', createdBy: 'system' })`→`extra = max(0, after.m.remaining − before.m.remaining)`→`logChangeTx(tx, { action: 'fee_class_set', before: { feeClass: 前 }, after: { feeClass: 後 }, reason, actor: staffName, isException: false })`。`adjustActive`＝生きている `adjust` の行の合計。tx の外：合計が変わったら `sendRecitalMail({ kind: 'change', householdId })` と `afterMoneyChanged(householdId, 'total')`。
`addAdjustCharge`：`amount` は1以上の整数、理由が空でない（ちがえば `invalid`）→下げる時、`amount > 今の合計` なら `over_total`→`recital_charges` に `item_code='adjust'`・`ref=''`・`label='手の調整'`・`qty=1`・`unit_amount=amount=`（下げる時はマイナス）・`status='active'`・`due_on`＝設定の `pay_due`→`logChangeTx(action: 'adjust_add', isException: true, after: { amount }, reason)`。返す分は作らない（K217）。tx の外は `setFeeClass` と同じ。
`voidAdjustCharge`：`item_code='adjust'` で `active` の行だけ。`status='void'`・`void_reason`・`voided_at=nowUtcIso()`→`logChangeTx(action: 'adjust_void', isException: true)`。tx の外は同じ。

- [ ] **Step 4: 回して、特別な料金と adjust の試験が通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalStaffDb.test.ts -t "setFeeClass|adjust"`
Expected: PASS

- [ ] **Step 5: `mergeHouseholds` を作る**

1つの `withWriteTx` の中で、この順：
1. 名前。`fromId === intoId` → `same`。両方を読み、どちらかが `active` でない → `not_active`、`event_key` がちがう → `other_event`。
2. `bf = readHouseholdMoneyTx(from)`・`bi = readHouseholdMoneyTx(into)`。`from` に生きている `adjust` の請求があれば `has_adjust`、`bf.refundTodo > 0` なら `has_refund_todo`（先に片づけてもらう）。
3. `samePeople` の各組：`dropPersonId` と `keepPersonId` が from と into に1人ずつでなければ `bad_pair`。
4. `from` の人を全部 `household_id = into` に移す。`samePeople` の `dropPersonId` は `status='withdrawn'`・`merged_into=keepPersonId`、その人の `in`・`maybe` の出演は `out`（`withdrawn_at=nowUtcIso()`・`withdraw_reason='同じ人の二重（世帯をまとめた）'`）。
5. `recomputeChargesTx(tx, into, staffName)` と `recomputeChargesTx(tx, from, staffName)`（from の行は全部 void になる）。
6. `P = from の入金の amount の合計`。`P ≠ 0` なら、入金の行を2つ直接 INSERT：from に `−P`、into に `+P`（どちらも `method='adjust'`・`source='manual'`・`memo='移した'`・`paid_on=todayJst()`・`confirmed_by=staffName`）。それぞれ `logChangeTx(action: 'payment_recorded', after: { amount, memo: '移した', fromId, intoId })`。**`insertPaymentTx` は使わない**（わけ：入金が残りをこえた時に1番の返す分を作る働きがあり、まとめる時の返す分は2番で、下の8で作るため）。`event_ledger` にも出さない（5-2）。
7. 「振り込みました」の印：from に印があり into に無ければ、5つの列を into へ写す。from の5つの列は空にする。変えた記録には日と金額だけ（名義は入れない）。
8. `from` を `status='merged'`・`merged_into=into`。`after = readHouseholdMoneyTx(into)`。`totalBefore = bf.m.total + bi.m.total`、`paidSum = bf.m.paid + bi.m.paid`、`refund = refundForDecrease({ totalBefore, paid: paidSum, totalAfter: after.m.total })`（Task 9）。`refund > 0` なら `createRefundTx(tx, { householdId: into, amount: refund, reasonNo: 2, reason: '世帯をまとめた', createdBy: 'system' })`。
9. `logChangeTx(householdId: into, action: 'household_merged', before: { fromId, intoId, totalBefore }, after: { totalAfter: after.m.total, refund }, reason, actor: staffName)`。整理番号は、どちらも変えない。
tx の外（`dryRun` でない時）：`expireOpenCheckout(fromId, 'merged')`→`afterMoneyChanged(intoId, 'total')`→`sendRecitalMail({ kind: 'change', householdId: intoId })`→`sendRecitalMail({ kind: 'change', householdId: fromId })`。`merged` の世帯へ送る変更の控えの中身（まとめ先の整理番号と「ご家族のお申し込みが2つに分かれていました。1つにまとめて、金額を直しました。」）は 10 の `RecitalMailData.change.merged` が持つ。`merged` の世帯の鍵でマイページを開いた時の出し方も 14 の範囲（無ければ止まって知らせる）。

- [ ] **Step 6: 回して、まとめる試験が通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalStaffDb.test.ts -t "mergeHouseholds"`
Expected: PASS

- [ ] **Step 7: `listMatchCandidates`・`decideMemberMatch` を作る**

`listMatchCandidates`：会員を全部 `MemberLite` で読み、`matchMember(人, members)` の `candidateIds` の会員を返す。`presets` はその発表会の `recital_fee_presets` の `{ member_id: fee_class }`。
`decideMemberMatch`（1つの `withWriteTx`）：名前→`{ none: true }` なら `member_id=NULL`・`match_status='none'`→`{ memberId }` なら会員が無ければ throw、`member_id`・`match_status='manual'`。その会員に事前登録があり、人の印が空なら、`setFeeClass` と同じ中身（印→作り直し→返す分3番→`fee_class_set`）を同じ tx で行う（中身は1つの関数にまとめ、`setFeeClass` と共有する。2つ書かない）。印がもう入っていれば変えない（`keptClass` に今の印、`presetClass` に登録の種類を入れて返す。K226）。`logChangeTx(action: 'match_decided', after: { memberId: … | null, status }, reason)`（名前・カナ・生年月日は入れない）。tx の外は `setFeeClass` と同じ（合計が変わった時だけ）。

- [ ] **Step 8: 回して全部通るのを見る**

Run: `npx vitest run src/lib/__tests__/recitalStaffDb.test.ts`
Expected: PASS

- [ ] **Step 9: 世帯の画面に3つの欄をつなぐ**

`[id]/page.tsx` の「ボタン」の所に足す（どれも押す前に名前・2段階）：
- `FeeClassPanel`「特別な料金」：人を選ぶ→種類（ふつう／協力チケットなし／Tシャツ代だけ／参加費なし）と理由→「たしかめる」で `feeClassAction(…, { dryRun: true })` の結果を「今の合計 ◯円 → 直したあと ◯円」「返す分 ◯円」か「追加分 ◯円」で出し、`adjustActive ≠ 0` なら「手の調整 ◯円があります」→「直す」で `dryRun: false`。合計が上がる時は「押す前に、公式LINEで家庭に一言伝えてください」を出す。中に、たたんだ「そのほかの金額の直し」：下げる／上げる・金額・理由→たしかめる（`dryRun`）→足す。生きている `adjust` の行の一覧と、行ごとの「取り消す」（理由必須）。合計が 0 と数えられている時は「行の合計が 0 より小さいので、合計は 0 と数えています」。
- `MergePanel`「世帯をまとめる」：相手の世帯を整理番号か名前で探す（`searchHouseholds`）→どちらに残すか（初めの値は、先に申し込んだ方＝`seq` が小さい方を残す）→同じ人の組（カナと生年月日が同じ人の組を初めから並べ、残す人を選ぶ）→理由→たしかめる（`dryRun`）で「合計 ◯円 → ◯円」「移す入金 ◯円」「返す分 ◯円」→まとめる。結果が `not_active` なら「もうまとめてあります。画面を開き直してください」。
- `MatchPanel`「照合を決める」（`match_status` が `pending`・`unmatched` の人、休会・退会と合った人の横）：候補（`listMatchCandidates`。名前・カナ・生年月日・状態・事前登録の種類）と、会員を探す欄（`searchMembers`）→選ぶ→たしかめる（`dryRun`）で、金額が変わる時は「今の合計 → 結んだあと」、印が残る時は「登録は ◯◯、今は △△」→結ぶ。横に「会員ではない」。
`[id]/actions.ts` に足す：`feeClassAction(personId, feeClass, reason, staffName, dryRun)`・`adjustAction(householdId, x, staffName, dryRun)`・`voidAdjustAction(householdId, chargeId, reason, staffName)`・`mergeAction(fromId, intoId, x, staffName, dryRun)`・`matchAction(personId, choice, reason, staffName, dryRun)`・`matchCandidatesAction(personId)`。どれも `requireRecitalStaff()`→lib→`revalidatePath`（まとめた時は両方の世帯の画面と `/staff/bw6`）。

- [ ] **Step 10: 画面を見て確かめる（M5）**

Run: `npm run dev`（M5）→ 試しの発表会で、同じ電話の2世帯を作り、片方に現金 26,500 を入れる。
Expected: `/staff/bw6?ev=bw6-test` の見てほしいこと1番から世帯を開き、「世帯をまとめる」のたしかめで数が出てから、まとめると、もとの世帯が「まとめた」になり1番が消える／「特別な料金」のたしかめで「今の合計 → 直したあと」が出る／375px で全部押せる／欄の字が見える。`npx eslint 'src/app/staff/bw6/entries/[id]' src/lib/recitalStaffDb.ts` がエラーなし。

- [ ] **Step 11: コミット**

```bash
git add src/lib/recitalStaffDb.ts src/lib/__tests__/recitalStaffDb.test.ts \
  'src/app/staff/bw6/entries/[id]/page.tsx' 'src/app/staff/bw6/entries/[id]/actions.ts' \
  'src/app/staff/bw6/entries/[id]/FeeClassPanel.tsx' 'src/app/staff/bw6/entries/[id]/MergePanel.tsx' \
  'src/app/staff/bw6/entries/[id]/MatchPanel.tsx'
git commit -m "feat(bw6): 世帯をまとめる・特別な料金（そのほかの金額の直し）・照合を決める

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 12: 最後の見直しを Fable に頼む**

見てもらう所：5-7 の返す額の式（`setFeeClass`・`mergeHouseholds`・`decideMemberMatch`）、`insertPaymentTx` を通さない「移す」入金の行、`dryRun` の巻き戻しで何も残らないこと、tx の中で外の API を呼んでいないこと。

---

### 足した名前（③に無かった物。このまとまりで作る）

| ファイル | 名前 | 使うタスク |
|---|---|---|
| `src/lib/recital.ts` | `pickStaffEventKey(v: string \| null \| undefined): string` | 16〜19 |
| `src/lib/recital.ts` | `bankToldWaitDue(toldAtUtc: string, nowMs: number, restFrom: string, restTo: string): boolean` | 16（29 の `listToldWaiting` も使う） |
| `src/lib/recitalMatch.ts` | `memberWarn(m: MemberLite): 'leave' \| 'withdrawn' \| null`（`matchMember` の中から出すだけ） | 16 |
| `src/lib/recitalDb.ts` | `listWorkPickOptions()` | 17 |
| `src/lib/recitalDb.ts` | `saveFeeRule`・`type FeePresetRow`・`listFeePresets`・`saveFeePreset`・`deleteFeePreset`・`searchMembers` | 18（`searchMembers` は 20 も） |
| `src/lib/recitalDb.ts` | `type EntryListRow`・`listEntryRows(eventKey)` | 19 |
| `src/lib/recitalEntryDb.ts` | `dropWork(workId, confirmCount, staffName)` | 17 |
| `src/lib/recitalStaffDb.ts`（新しいファイル） | `type FeeChangePreview`・`setFeeClass`・`addAdjustCharge`・`voidAdjustCharge`・`type MergeResult`・`mergeHouseholds`・`listMatchCandidates`・`decideMemberMatch` | 20 |
| `src/lib/recitalLineReplies.ts`（新しいファイル） | `RECITAL_LINE_REPLIES`・`fillLineReply` | 19 |
| `src/components/recital/StaffNamePicker.tsx` | props `{ value: string; onChange: (name: string) => void }` | 16〜20 |
| `src/lib/__tests__/recitalStaffSeed.ts`（試験の道具） | `seedEvent`・`seedRules`・`seedWork`・`type SeedPerson`・`seedHousehold`・`seedMember` | 16〜20 の試験 |
| `src/app/staff/bw6/labels.ts` | 画面の言葉の表（照合・作品・メール・入金。見え方は `householdViewLabel`） | 16〜19 |
| 各 `actions.ts` | `dismissAttentionAction`／`saveWorkAction`・`dropWorkAction`／`saveSettingAction`・`openEntryAction`・`suspendEntryAction`・`openPayAction`・`saveFeeRuleAction`・`searchMembersAction`・`saveFeePresetAction`・`deleteFeePresetAction`・`previewPathAction`・`resetTestDataAction`／`editHouseholdAction`・`myPageUrlAction`・`resendReceiptAction`・`changeEmailAction`・`recordManualPaymentAction`・`cancelRefundAction`・`feeClassAction`・`adjustAction`・`voidAdjustAction`・`mergeAction`・`matchAction`・`matchCandidatesAction` | 16〜20 |
| 世帯の画面の中の部品名 | `StaffPaySection`（23 が足す所）・`PaymentRows`（28 が足す所） | 19・23・28 |
| （6 と合わせる形） | `WorkInput` の `classes: { lesson_master_id: number \| null; label: string }[]` と `instructors: { instructor_id: number \| null; display_name: string; role: 'choreo' \| 'perform' \| 'assist'; sort_order: number }[]`（6 の形が正本） | 17 |

---

## 払（pay）支払い：カード・お振込みのご案内・振り込みました・声かけ — タスク 21〜24

並び：21 は 9・10・14 の後 → 22。23 は 9・10・14・19 の後。24 は 10 と 28 の後（28 の `listReviewRows` と 27 の `bankStartDate` を使う。**12/13（日）までに `JOBS` を出す**。27・28 が 12/11 までに終わらない時は、24 を先に出す道は無いので、その時点で止まって知らせる）。
見直し：21・22・23 はお金にさわるので、最後の見直しは Fable。24 は通常の見直し。
作る係への決まり（4つとも）：**計画に書いていないことに当たったら、自分で決めずに、止まって知らせる。** 迷いやすい所には、その場所に「止まる」と書いた。

このまとまりで使う正本：設計書 05 5-6（カード・開いている支払い・「振り込みました」・TARO への声かけ・メール）、03 3-4 households・payments、03 3-9 checkouts・imports、04 4-2 マイページ・お振込みのご案内、07 7-5、決まりの紙 `decisions-v5.md` 2-6・2-20・2-22・2-24（食いちがえば決まりの紙）。

### このまとまりの Review Focus（全体の Review Focus へ合わせる候補）
1. 家庭が「払う」を2つのタブで同時に押す → 開いている支払いは1つだけ（部分一意で2つ目を弾き、「もう一度押してください」）。試験は 21 の Step 5。
2. 金額を変えた直後に、切るのが間に合わず古い画面で払えてしまう → 届いた本物の額で記録し、こえた分は返す分の1番。試験は 22 の Step 5。
3. Stripe に聞けない（障害・時間切れ）→ 「ご入金を確認しています」を出し「払う」を出さない（2回払わせない。R-98）。試験は 21 の Step 5（`syncCardCheckout` が throw する）。
4. 「振り込みました」に未来の日・0円・空の名前・残り0 → 受けない。試験は 23 の Step 1。
5. 声かけの休みの境目（12/29 夜は出る・12/30〜1/3 は出ない・1/4 朝に1回・1/4 夜はふだんどおり）。試験は 24 の Step 1。

---

### Task 21: カード：開いている支払い

**Files:**
- Create: `src/lib/recitalStripe.ts`（純＋fetch。Stripe の作る／聞く／切る・鍵の選び方。今ある催しのファイルはさわらない＝K131）
- Create: `src/lib/recitalPayDb.ts`（開いている支払い `recital_checkouts` の作る・聞いて合わせる・切る）
- Create: `src/app/bw6/my/PaySection.tsx`（マイページの「払う」の所）
- Modify: `src/lib/recitalMoneyDb.ts`（`afterMoneyChanged` にカードの作り直しを足す。`stripe_recheck` の語は 9 で入れてある）
- Modify: `src/app/bw6/my/page.tsx`（開いた時に `syncCardCheckout`、`PaySection` を置く）
- Modify: `src/app/bw6/my/actions.ts`（`payByCardAction` を足す）
- Test: `src/lib/__tests__/recitalStripe.test.ts`（純。fetch は `vi.stubGlobal`）
- Test: `src/lib/__tests__/recitalPayDb.test.ts`（DB：`file:./data/test_recital_pay.db`。`bf7EntryDb.test.ts` 1〜25行の型）

**Interfaces:**
- Consumes:
  - 2：`payGate(s, nowMs): PayGate`、`payableAmount(m, told | null): number`、`payButtonState({gate, view, m, refundTodo})`、`jstToMs`、`recitalMyUrl(token)`（決済の戻り先。2 が作った物。ここでは作らない）、型 `RecitalSettings`（`stripe_mode`・`pay_open_at`・`pay_ok_at`）
  - 6：`getRecitalSettings(eventKey)`、`logChangeTx`
  - 9：`readHouseholdMoney(id): Promise<HouseholdMoney>`、`readHouseholdMoneyTx(tx, id)`、`insertPaymentTx(tx, p: PaymentInput, actor)`、`afterMoneyChanged(id, cause)`（中身は空で作られている）
  - 10：`sendPaidMail(householdId, paymentId, via, opts?)`
  - 14：`requireHouseholdByToken(t): Promise<HouseholdDetail | null>`、マイページ `src/app/bw6/my/page.tsx`
  - 既存：`withWriteTx`・`getOne`・`execute`（`src/lib/db.ts`）、`nowUtcIso`・`todayJst`（`src/lib/dateJst.ts`）
- Produces:
  - `buildRecitalCheckoutParams(p): URLSearchParams`・`stripeKeyFor(mode): string`・`createRecitalCheckout(mode, params): Promise<{ id; url }>`・`retrieveRecitalCheckout(mode, sessionId): Promise<{ status: string; payment_status: string; payment_intent: string | null; amount_total: number | null; url: string | null }>`（**`url` を足した**）・`expireRecitalCheckout(mode, sessionId): Promise<boolean>`
  - `startCardPayment(token, { confirmNotBank?, confirmTold? }): Promise<{ url: string } | { blocked: 'ask_bank' | 'told_open' | 'not_open' | 'nothing_due' | 'refund_hold' }>`
  - `syncCardCheckout(householdId): Promise<void>`（聞けなかった時は throw）
  - `expireOpenCheckout(householdId, reason): Promise<void>`
  - `payByCardAction(token, opts)`（Server Action）
  - 22・23 が `recitalPayDb.ts` に足す。23 が `PaySection.tsx` に `BankGuide` を入れる。

- [ ] **Step 1: 純の試験を書く（`recitalStripe.test.ts`）**

```ts
const base = { eventKey: 't-pay', householdId: 12, checkoutId: 34, amount: 26500, email: 'family@example.invalid', refCode: '1007', successUrl: 'https://event.boom-sendai.com/bw6/my?t=aa&paid=1', cancelUrl: 'https://event.boom-sendai.com/bw6/my?t=aa', expiresAt: 1765800000 };

it('params：金額はサーバの額・カードだけ・30分・印は session と payment_intent_data の両方', () => {
  const p = buildRecitalCheckoutParams(base);
  expect(p.get('mode')).toBe('payment');
  expect(p.get('payment_method_types[0]')).toBe('card');
  expect(p.get('payment_method_types[1]')).toBeNull();
  expect(p.get('line_items[0][price_data][currency]')).toBe('jpy');
  expect(p.get('line_items[0][price_data][unit_amount]')).toBe('26500');
  expect(p.get('line_items[0][quantity]')).toBe('1');
  expect(p.get('line_items[0][price_data][product_data][name]')).toBe('BW6 出演料（整理番号 1007）');
  expect(p.get('expires_at')).toBe('1765800000');
  for (const pre of ['metadata', 'payment_intent_data[metadata]']) {
    expect(p.get(`${pre}[recital_event_key]`)).toBe('t-pay');
    expect(p.get(`${pre}[recital_household_id]`)).toBe('12');
    expect(p.get(`${pre}[recital_checkout_id]`)).toBe('34');
  }
  expect(p.get('client_reference_id')).toBe('recital-12-34');
  expect(p.get('customer_email')).toBe('family@example.invalid');
});
it('顧客を作らない', () => {
  const p = buildRecitalCheckoutParams(base);
  expect(p.has('customer')).toBe(false);
  expect(p.has('customer_creation')).toBe(false);
});
it('メールが無い世帯は customer_email を付けない', () => {
  expect(buildRecitalCheckoutParams({ ...base, email: null }).has('customer_email')).toBe(false);
});
it('stripeKeyFor：test は試しの鍵だけ・本番の鍵へ落ちない', () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_x'); vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_test_y');
  expect(stripeKeyFor('test')).toBe('sk_test_y');
  expect(stripeKeyFor('live')).toBe('sk_live_x');
  vi.stubEnv('STRIPE_TEST_SECRET_KEY', '');
  expect(() => stripeKeyFor('test')).toThrow();
  vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_live_wrong');
  expect(() => stripeKeyFor('test')).toThrow();   // 試しの欄に本番の鍵が入っていたら使わない
});
it('retrieve：聞けなかったら throw・開いていれば url を返す', async () => { /* fetch を 500 → rejects.toThrow()／200 {status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/cs_1',payment_intent:null,amount_total:26500} → url 一致 */ });
it('expire：失敗しても throw せず false', async () => { /* fetch reject → false */ });
it('create：鍵は mode で選ぶ', async () => { /* test で呼ぶと Authorization が Bearer sk_test_y */ });
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalStripe.test.ts`
Expected: FAIL（`buildRecitalCheckoutParams` が無い）

- [ ] **Step 3: `src/lib/recitalStripe.ts` の5つを作る**

- `buildRecitalCheckoutParams(p: { eventKey: string; householdId: number; checkoutId: number; amount: number; email: string | null; refCode: string; successUrl: string; cancelUrl: string; expiresAt: number }): URLSearchParams` — 形は `buildMocchinCheckoutFormParams`（`src/lib/mocchinStripe.ts` 8行）にそろえる。足すのは `payment_method_types[0]=card` と、3つの印を `metadata[...]` と `payment_intent_data[metadata][...]` の両方に。`customer`・`customer_creation` は書かない（K172）。
- `stripeKeyFor(mode: 'test' | 'live'): string` — `test`＝`STRIPE_TEST_SECRET_KEY`（`_test_` を含まなければ throw）、`live`＝`STRIPE_SECRET_KEY`。空は throw（文：`カード決済は、準備中です`）。
- `createRecitalCheckout(mode, params): Promise<{ id: string; url: string }>` — `createBf6CheckoutSession`（`src/lib/bf6Stripe.ts` 95行）と同じ fetch。鍵だけ `stripeKeyFor(mode)`。失敗の文も同じ（Stripe のエラーはログだけ）。
- `retrieveRecitalCheckout(mode, sessionId)` — GET `/v1/checkout/sessions/<id>`。**応答が ok でない・fetch が落ちた時は throw**（`retrieveCheckoutSession` は unknown を返すが、ここは「聞けなかった」を呼ぶ側に知らせるため throw）。
- `expireRecitalCheckout(mode, sessionId): Promise<boolean>` — `expireKioskCheckoutSession`（`src/lib/kioskStripe.ts` 66行）と同じ。throw しない。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalStripe.test.ts`
Expected: PASS

- [ ] **Step 5: DB の試験を書く（`recitalPayDb.test.ts`）**

準備（このファイルの中の関数）：
- `seedPayEvent(eventKey, stripeMode)`：`recital_events` に1行（`is_test=1`）、`recital_settings` に `entry_open_at='2026-01-01 00:00'`・`entry_close_at`／`change_close_at`＝`'2099-01-31 23:59'`・`pay_open_at='2026-01-01 00:00'`・`pay_ok_at='2026-01-01 00:00'`・`pay_due='2099-02-10'`・`suspended='0'`・`stripe_mode`・`bank_text='（試しの振込先）'`・`test_mail_to='test@example.invalid'`、料金の規則は 3 の試験と同じ8行（03 3-4 の規則）、作品2本（`entry_mode='form'`・`status='open'`・`fee_type='counted'`）。
- `submitEntry` で1世帯（1人・1作品）。**最初に合計が 26,500 であることを確かめる**（ちがえば規則の入れ方のまちがい。止まって知らせる）。
- `newHousehold(): Promise<{ hid: number; token: string }>`：上と同じ形でもう1世帯足す（試験ごとに別の世帯が要る時）。
- fetch は `vi.stubGlobal` で、POST `/v1/checkout/sessions` → `{ id: 'cs_test_<n>', url: 'https://checkout.stripe.com/c/pay/cs_test_<n>' }`、GET `/v1/checkout/sessions/<id>` → 試験ごとに決める状態、POST `.../expire` → ok。`STRIPE_TEST_SECRET_KEY='sk_test_dummy'`。

```ts
it('作る：金額は今の残り・開いている行1つ・pay_method=card', async () => {
  const r = await startCardPayment(token, {});
  expect(r).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  expect(sentParams(0).get('line_items[0][price_data][unit_amount]')).toBe('26500');
  expect(await openRows(hid)).toEqual([{ amount: 26500, stripe_session_id: 'cs_test_1', status: 'open' }]);
  expect((await row(hid)).pay_method).toBe('card');
});
it('同じ残りなら同じURL（作り直さない）', async () => {
  stripeState('cs_test_1', { status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  expect(await startCardPayment(token, {})).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  expect(createCalls()).toBe(1);
});
it('残りが変われば古い方を切って作り直す（afterMoneyChanged）', async () => {
  await recordManualPayment(hid, { method: 'cash', amount: 1000, paidOn: '2026-12-20', memo: '試し' }, '試し');
  await afterMoneyChanged(hid, 'payment');               // 9 が中で呼んでいても、2回目は何も起きない
  expect(expireCalls()).toContain('cs_test_1');
  expect(await openRows(hid)).toEqual([]);              // 切った行は closed
  await startCardPayment(token, {});
  expect(sentParams(1).get('line_items[0][price_data][unit_amount]')).toBe('25500');
});
it('振込で全額当たり残り0になると、開いているカードの画面を切る', async () => {
  const { hid: h6, token: t6 } = await newHousehold();   // 準備の submitEntry と同じ形で1世帯（合計 26,500）
  await startCardPayment(t6, {});
  const sid = (await openRows(h6))[0].stripe_session_id;
  await withWriteTx((tx) => insertPaymentTx(tx, { householdId: h6, method: 'bank', amount: 26500, paidOn: '2026-12-21', source: 'bank_staff' }, '試し'));
  await afterMoneyChanged(h6, 'payment');
  expect(await openRows(h6)).toEqual([]);
  expect(expireCalls()).toContain(sid);
});
it('2つのタブで同時に押しても開いている行は1つ', async () => {
  const rs = await Promise.allSettled([startCardPayment(token2, {}), startCardPayment(token2, {})]);
  expect(await openRows(hid2)).toHaveLength(1);
  expect(rs.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
});
it('振込を選んだ世帯は1回聞く', async () => {
  await execute("UPDATE recital_households SET pay_method='bank' WHERE id=?", [hid3]);
  expect(await startCardPayment(token3, {})).toEqual({ blocked: 'ask_bank' });
  expect(await startCardPayment(token3, { confirmNotBank: true })).toHaveProperty('url');
});
it('「振り込みました」の印がある間は止める・残りが印より多ければ差額だけ（K204：32,500−26,500＝6,000）', async () => {
  await execute("UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-20', bank_told_name='4827 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [nowUtcIso(), hid4]);
  expect(await startCardPayment(token4, { confirmNotBank: true })).toEqual({ blocked: 'told_open' });
  await addWork(hid4);                                   // applyHouseholdEdits で2作品目 → 32,500
  await startCardPayment(token4, { confirmTold: true });
  expect(lastParams().get('line_items[0][price_data][unit_amount]')).toBe('6000');
});
it('印の額が残り以上なら金額は変えない（26,500）', async () => { /* told 26500・合計 26500 → confirmTold で 26500 */ });
it('支払いの鍵が閉じていれば not_open（pay_ok_at が空）', async () => { /* t-pay-closed：pay_ok_at を入れない → { blocked: 'not_open' } */ });
it('残り0なら nothing_due', async () => { /* 26500 を cash で記録 → { blocked: 'nothing_due' } */ });
it('sync：払い終わっていたら1回だけ記録（source=stripe_recheck・pi も入る）', async () => {
  stripeState('cs_test_9', { status: 'complete', payment_status: 'paid', amount_total: 26500, payment_intent: 'pi_9' });
  await syncCardCheckout(hid5); await syncCardCheckout(hid5);
  expect(await payments(hid5)).toEqual([{ method: 'card', amount: 26500, source: 'stripe_recheck', stripe_session_id: 'cs_test_9', stripe_pi_id: 'pi_9' }]);
  expect((await checkout('cs_test_9')).status).toBe('paid');
});
it('sync：切れていたら expired', async () => { /* status:'expired' → 行 expired・入金なし */ });
it('sync：聞けなかったら throw（入金も状態も変えない）', async () => { /* GET が 500 → rejects.toThrow()・行は open のまま */ });
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPayDb.test.ts`
Expected: FAIL（`startCardPayment` が無い）

- [ ] **Step 7: `recitalPayDb.ts` の3つと、`afterMoneyChanged` のカードの所を作る**

- `startCardPayment(token, opts)` の順（ここに無い分かれ道に当たったら止まる）：
  1. `requireHouseholdByToken(token)`。null なら throw（画面は「見つかりません」）。
  2. 開いている行があれば、先に `syncCardCheckout(householdId)`（「払う」の時に聞く。R-98）。throw はそのまま上へ。
  3. `getRecitalSettings`・`readHouseholdMoney` を読み直し、`payButtonState({ gate: payGate(s, Date.now()), view, m, refundTodo })` が `before`/`preparing` → `{ blocked: 'not_open' }`、`refund_hold` → `refund_hold`、`hidden` → `nothing_due`。
  4. 印（`told`）が開いていて `confirmTold` が無い → `told_open`。印が無く `payMethod==='bank'` で `confirmNotBank` が無い → `ask_bank`（K194）。
  5. `amount = payableAmount(m, told)`。0 以下 → `nothing_due`。
  6. 開いている行があり、`amount` が同じで、Stripe が `open` → その `url` を返す。額がちがう・`stripe_session_id` が空の行・Stripe が `open` でない → `expireOpenCheckout(householdId, 'amount_changed')`。
  7. `withWriteTx` で `recital_checkouts` に `status='open'`・`amount`・`created_at`・`expires_at`（今＋30分。UTC ISO）を入れ、`pay_method='card'` にする。部分一意で弾かれたら throw（画面は「もう一度押してください」）。
  8. 書き込みの外で `createRecitalCheckout(s.stripe_mode, buildRecitalCheckoutParams({ ..., successUrl: recitalMyUrl(token) + '&paid=1', cancelUrl: recitalMyUrl(token), expiresAt: 秒 }))` → `stripe_session_id` を書く。作れなかったら行を `closed` にして throw。
- `syncCardCheckout(householdId)`：`status='open'` の行を1つ読む（無ければ何もしない。`stripe_session_id` が空なら `closed` にして終わり）。`retrieveRecitalCheckout`（throw はそのまま）→ `complete` かつ `payment_status==='paid'`：下の「カードの入金を書く核」を `source: 'stripe_recheck'`・`stripeEventId: null` で呼ぶ／`expired` → 行を `expired`／`open` → 何もしない。
- カードの入金を書く核（このファイルの中だけの関数。22 も使う）：1つの `withWriteTx` の中で、同じ `stripe_event_id`・`stripe_session_id`・`stripe_pi_id`（空は除く）の入金があれば `duplicate`。無ければ `insertPaymentTx(tx, { householdId, method: 'card', amount: 本物の額, paidOn: todayJst(), source, stripeEventId, stripeSessionId, stripePiId }, 'system')`、その checkout 行を `status='paid'`・`stripe_pi_id` を入れる。一意の違反で落ちたら `duplicate` として扱う。書き込みの外で `afterMoneyChanged(householdId, 'payment')` → `sendPaidMail(householdId, paymentId, 'card')`（メールの失敗はログだけ）。
- `expireOpenCheckout(householdId, reason)`：開いている行を `closed` にし、`stripe_session_id` があれば `expireRecitalCheckout(mode, id)`。Stripe で切れなくても `closed` のまま（間に合わず払われた分は、22 が本物の額で受ける）。`reason` はログにだけ出す（列は無い）。
- `recitalMoneyDb.ts` の `afterMoneyChanged(householdId, cause)` に足す：開いている行の `amount` と、今の `payableAmount(m, told)` がちがう（0 になった時も）なら `expireOpenCheckout(householdId, 'amount_changed')`。新しい画面は、次に家庭が「払う」を押した時に作る（計画で決めた。見直しの人が確かめる）。`recitalPayDb` からは**関数の中で `await import('./recitalPayDb')`**（2つのファイルが互いを読むため）。ここの失敗は `console.error` だけで、呼んだ操作は止めない。

- [ ] **Step 8: 通ることを確かめる（9 の試験もこわしていない）**

Run: `npx vitest run src/lib/__tests__/recitalPayDb.test.ts` → PASS
Run: `npx vitest run src/lib/__tests__/recitalMoneyDb.test.ts` → PASS

- [ ] **Step 9: `PaySection.tsx` と、マイページへのつなぎを作る**

- `src/app/bw6/my/actions.ts` に `payByCardAction(token: string, opts: { confirmNotBank?: boolean; confirmTold?: boolean }): Promise<{ url: string } | { blocked: ... } | { error: string }>`（`startCardPayment` を呼び、throw は `{ error }` にする）。
- `src/app/bw6/my/page.tsx`：開いている行がある世帯は、描く前に `syncCardCheckout`。throw したら `checking=true`（「ご入金を確認しています」を出し、「払う」を出さない）。そのあと世帯を読み直す。
- `PaySection.tsx`（`'use client'`）の出し分けは 04 4-2「マイページ」の「その時だけ重ねて出すもの」の文をそのまま：`payButtonState` の `before`＝「お支払いは ◯月◯日から」／`preparing`＝「お支払いは、準備中です」／`refund_hold`＝「お預かりしている分があります。スクールからご連絡します」／`show`＝「払う」→ カードか銀行振込（現金は出さない）。`&paid=1` で戻った時は「お支払いを受け付けました。完了のメールが届きます。この画面は、閉じて大丈夫です。もう一度払う必要は、ありません。」だけで「払う」を出さない。ボタンの下に「うまく進まないときは、ブラウザで開いてください」。
- `blocked` の出し方（決まりの紙 2-20 の表）：`ask_bank`＝「まだ振り込んでいませんか」→［まだ振り込んでいません］で `confirmNotBank:true`／［もう振り込みました］は 23 の3つの欄を開く。`told_open`＝残りが印の額より多くなければ「確認中です。カードで払うと二重になります」（「もどる」を大きく、「それでもカードで払う」を小さく）、多ければ「お振込みの ◯円は、確認中です。のこりの ◯円だけを、カードで払います」。
- 銀行振込の所は、この段では「銀行振込は、準備中です」で押せない形にしておく（中身は 23）。
- 外へ出るリンクは `rel="noreferrer"`。
- 画面の確かめ（M5 で。M1 では dev を回さない）：`bw6-test` の世帯で、カード→試しの決済画面が開く／戻ると受付の文だけ／`pay_ok_at` を空にした発表会で「準備中」。試しの鍵が無いあいだは、ここだけ飛ばして知らせる。

- [ ] **Step 10: コミット**

```bash
git add src/lib/recitalStripe.ts src/lib/recitalPayDb.ts src/lib/recitalMoneyDb.ts src/app/bw6/my/PaySection.tsx src/app/bw6/my/page.tsx src/app/bw6/my/actions.ts src/lib/__tests__/recitalStripe.test.ts src/lib/__tests__/recitalPayDb.test.ts
git commit -m "$(cat <<'EOF'
feat(bw6): カードの開いている支払い（作る・聞く・切る）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: カードの知らせの記録

**Files:**
- Modify: `src/lib/recitalStripe.ts`（`parseRecitalWebhookEvent`）
- Modify: `src/lib/recitalPayDb.ts`（`applyRecitalWebhookEvent`・`handleRecitalWebhook`）
- Modify: `src/app/api/bf6/stripe-webhook/route.ts`（署名の確かめと JSON の読みのすぐ後、`parseMocchinWebhookEvent` より前に分岐1つ。今の分岐は1行も変えない）
- Create: `src/app/api/recital/stripe-test-webhook/route.ts`
- Test: `src/lib/__tests__/recitalStripe.test.ts`、`src/lib/__tests__/recitalPayDb.test.ts`
- Test: `src/app/api/bf6/stripe-webhook/__tests__/route.test.ts`、`src/app/api/recital/stripe-test-webhook/__tests__/route.test.ts`

**Interfaces:**
- Consumes：21 の「カードの入金を書く核」・`expireOpenCheckout`、6 の `getRecitalSettings`、10 の `sendPaidMail`、既存 `verifyStripeSignature`（`src/lib/bf6Stripe.ts` 13行）・`notifyTaro`（`src/lib/notify.ts` 62行。`formatSubject` は `${prefix} ${subject}` なので題に頭を重ねない）
- Produces：
  - `type RecitalWebhookEvent = { eventId: string; type: string; livemode: boolean; eventKey: string; householdId: number; checkoutId: number | null; sessionId: string | null; piId: string | null; amountTotal: number | null; paymentStatus: string | null }`
  - `parseRecitalWebhookEvent(event: unknown): RecitalWebhookEvent | null`
  - `applyRecitalWebhookEvent(ev): Promise<{ status: 'paid' | 'duplicate' | 'expired' | 'acked' | 'mode_mismatch' | 'not_found'; householdId?: number; paymentId?: number }>`
  - `handleRecitalWebhook(event: unknown): Promise<{ handled: false } | { handled: true; httpStatus: 200 | 500; result: string }>`（足した名前。2つの受け口が同じ物を呼ぶ。throw しない）

- [ ] **Step 1: 読む試験を書く（`recitalStripe.test.ts` に足す）**

```ts
const session = (meta: Record<string, string>, over = {}) => ({ id: 'evt_1', type: 'checkout.session.completed', livemode: false,
  data: { object: { id: 'cs_test_1', payment_intent: 'pi_1', amount_total: 26500, payment_status: 'paid', metadata: meta, ...over } } });
const meta = { recital_event_key: 't-pay', recital_household_id: '12', recital_checkout_id: '34' };

it('発表会の印がある完了の知らせを読む', () => {
  expect(parseRecitalWebhookEvent(session(meta))).toEqual({ eventId: 'evt_1', type: 'checkout.session.completed', livemode: false, eventKey: 't-pay', householdId: 12, checkoutId: 34, sessionId: 'cs_test_1', piId: 'pi_1', amountTotal: 26500, paymentStatus: 'paid' });
});
it('発表会でない知らせは null（MOCCHIN の印・印なし）', () => {
  expect(parseRecitalWebhookEvent(session({ mocchin_entry_id: '5', mocchin_step: '0' }))).toBeNull();
  expect(parseRecitalWebhookEvent(session({}))).toBeNull();
  expect(parseRecitalWebhookEvent({ id: 'evt_x' })).toBeNull();
});
it('世帯の番号が数でなければ null', () => {
  expect(parseRecitalWebhookEvent(session({ ...meta, recital_household_id: '12a' }))).toBeNull();
});
it('payment_intent の知らせ（印は payment_intent_data から）も発表会の分として読む', () => {
  const ev = { id: 'evt_2', type: 'payment_intent.succeeded', livemode: true, data: { object: { id: 'pi_1', object: 'payment_intent', metadata: meta } } };
  expect(parseRecitalWebhookEvent(ev)).toMatchObject({ type: 'payment_intent.succeeded', livemode: true, sessionId: null, piId: 'pi_1', householdId: 12 });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalStripe.test.ts`
Expected: FAIL（`parseRecitalWebhookEvent` が無い）

- [ ] **Step 3: `parseRecitalWebhookEvent` を作る**

`metadata.recital_event_key`（空でない文字）と `metadata.recital_household_id`（数字だけ）が両方ある時だけ読む。見分けるのは印だけ（種類では見分けない。K129）。`object` が checkout session（`id` が `cs_`）なら `sessionId`＝`id`・`piId`＝`payment_intent`、payment_intent（`id` が `pi_`）なら `sessionId=null`・`piId`＝`id`、それ以外（`charge.*` など）は `piId`＝`object.payment_intent`。`livemode` は `event.livemode === true`。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalStripe.test.ts`
Expected: PASS

- [ ] **Step 5: 記録の試験を書く（`recitalPayDb.test.ts` に足す）**

21 の `seedPayEvent('t-pay', 'test')` に加え、`seedPayEvent('t-pay-live', 'live')` を作る。`ev(over)` は `RecitalWebhookEvent` を組む関数。`stripeEvent(over)` は Stripe の `checkout.session.completed` の形の生の知らせを組む関数（`id`・`amount_total`（初めは 26500）・`householdId`（初めは `hid`。metadata に入れる）を上書きできる）。`hid` は `beforeEach` で毎回新しく作る世帯（合計 26,500・`W01` に出る・開いている checkout 行1つ〔`stripe_session_id`=`cs_test_<hid>`・`amount` 26500〕）。`ev()` の初めの値は `{ eventKey: 't-pay', householdId: hid, sessionId: 'cs_test_' + hid, piId: 'pi_' + hid, amountTotal: 26500, paymentStatus: 'paid', type: 'checkout.session.completed', livemode: false }`。`payments(h)` は世帯の入金の行の配列。`liveHid` は `t-pay-live` の世帯（`beforeAll` で1つ作る）。

```ts
it('同じ知らせ2回で入金1回', async () => {
  expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_a' }))).status).toBe('paid');
  expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_a' }))).status).toBe('duplicate');
  expect(await payments(hid)).toHaveLength(1);
});
it('同じ画面の別の知らせ（マイページで先に記録ずみ）も duplicate', async () => {
  // 21 の試験と同じく fetch を mock：GET checkout は { status: 'complete', payment_status: 'paid', amount_total: 26500, payment_intent: 'pi_' + hid }
  await syncCardCheckout(hid);
  expect(await payments(hid)).toHaveLength(1);
  expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_b' }))).status).toBe('duplicate');   // 同じ sessionId
  expect(await payments(hid)).toHaveLength(1);
});
it('試しの鍵の知らせは本番の鍵の発表会に当たらない（mode_mismatch・何も書かない）', async () => {
  expect((await applyRecitalWebhookEvent(ev({ eventKey: 't-pay-live', householdId: liveHid, livemode: false }))).status).toBe('mode_mismatch');
  expect(await payments(liveHid)).toHaveLength(0);
  expect((await applyRecitalWebhookEvent(ev({ livemode: true }))).status).toBe('mode_mismatch'); // 逆も
});
it('払い済みでない完了・charge.* は acked で何も書かない', async () => {
  expect((await applyRecitalWebhookEvent(ev({ paymentStatus: 'unpaid' }))).status).toBe('acked');
  expect((await applyRecitalWebhookEvent(ev({ type: 'charge.refunded', sessionId: null }))).status).toBe('acked');
  expect(await payments(hid)).toHaveLength(0);
});
it('期限切れの知らせは行を expired', async () => {
  expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_exp', type: 'checkout.session.expired', paymentStatus: 'unpaid', amountTotal: null }))).status).toBe('expired');
  expect((await core.getOne('SELECT status s FROM recital_checkouts WHERE stripe_session_id=?', ['cs_test_' + hid])).s).toBe('expired');
  expect(await payments(hid)).toHaveLength(0);
});
it('印の発表会と世帯の発表会がちがえば not_found', async () => {
  expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_o', eventKey: 't-other' }))).status).toBe('not_found');
  expect(await payments(hid)).toHaveLength(0);
});
it('本物の額で記録・こえた分は返す分の1番（古い画面で 30,000 払えた）', async () => {
  await applyRecitalWebhookEvent(ev({ eventId: 'evt_c', amountTotal: 30000 }));
  expect((await payments(hid))[0].amount).toBe(30000);
  expect(await refundsTodo(hid)).toEqual([{ amount: 3500, reason_no: 1 }]);
});
it('振込で払い終わった世帯にカードの完了の知らせ → 入金 26,500 を記録・返す分1番 26,500（source_payment_id はカードの入金）・完了メールは出ない', async () => {
  const { hid: h7 } = await newHousehold();
  await withWriteTx((tx) => insertPaymentTx(tx, { householdId: h7, method: 'bank', amount: 26500, paidOn: '2026-12-20', source: 'bank_staff' }, '試し'));
  const r = await handleRecitalWebhook(stripeEvent({ id: 'evt_f', householdId: h7 }));
  expect(r).toMatchObject({ handled: true, httpStatus: 200 });
  const card = (await payments(h7)).find((p) => p.method === 'card');
  expect(card?.amount).toBe(26500);
  const ref = await getOne('SELECT amount, reason_no, source_payment_id FROM recital_refunds WHERE household_id=? AND status=?', [h7, 'todo']);
  expect([Number(ref.amount), Number(ref.reason_no), Number(ref.source_payment_id)]).toEqual([26500, 1, card!.id]);
  expect(await mailKinds(h7)).not.toContain('complete');
});
it('handleRecitalWebhook：発表会でない知らせは handled:false', async () => {
  expect(await handleRecitalWebhook({ id: 'evt_m', type: 'checkout.session.completed', data: { object: { metadata: { mocchin_entry_id: '1', mocchin_step: '0' } } } })).toEqual({ handled: false });
});
it('handleRecitalWebhook：記録したらメールを呼び、メールが失敗しても 200', async () => {
  const r = await handleRecitalWebhook(stripeEvent({ id: 'evt_d' }));  // メールの鍵が無い試験環境＝送れない
  expect(r).toEqual({ handled: true, httpStatus: 200, result: 'recital_paid' });
  expect(await mailKinds(hid)).toContain('complete');
});
it('handleRecitalWebhook：適用に失敗したら 500（金額の無い完了の知らせ）', async () => {
  expect(await handleRecitalWebhook(stripeEvent({ id: 'evt_e', amount_total: null }))).toMatchObject({ handled: true, httpStatus: 500 });
  expect(await payments(hid)).toHaveLength(0);
});
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPayDb.test.ts`
Expected: FAIL（`applyRecitalWebhookEvent` が無い）

- [ ] **Step 7: `applyRecitalWebhookEvent` と `handleRecitalWebhook` を作る**

- `applyRecitalWebhookEvent(ev)` の順：
  1. 世帯を `id` で引き、無い・`event_key` が `ev.eventKey` とちがう → `not_found`。世帯が `merged` なら `merged_into` の世帯に記録する（お金は本物なので記録を落とさない。`console.error` を1行。計画で決めた。見直しの人が確かめる）。
  2. `getRecitalSettings(event_key).stripe_mode` が `live` なのに `ev.livemode` が false、または `test` なのに true → `mode_mismatch`（何も書かない。K130 の守りはここ1か所）。
  3. `checkout.session.completed` かつ `paymentStatus==='paid'` → `amountTotal` が数でなければ throw（Stripe に送り直させる）。21 の「カードの入金を書く核」を `source: 'stripe_webhook'`・`stripeEventId: ev.eventId` で → `paid` か `duplicate`。checkout 行の額と本物の額がちがえば `console.error`（額だけ。名前は出さない）。
  4. `checkout.session.expired` → その `stripe_session_id` の行が `open` なら `expired` にする → `expired`。
  5. ほか（払い済みでない完了・`payment_intent.*`・`charge.*`）→ `acked`。**`charge.*` の自動の記録（異議）は後の計画。** 返金・異議の知らせに印が乗るか（U38）は Stripe の文書で確かめ、結果を `recitalStripe.ts` の頭に1行書く。印が乗らない知らせは今の流れに落ちるので、そこで何かが記録されそうなら止まって知らせる。
- `handleRecitalWebhook(event)`：`parseRecitalWebhookEvent` が null → `{ handled: false }`。あれば `applyRecitalWebhookEvent`。throw したら `notifyTaro({ subject: 'カードの入金の記録に失敗しました', body: 'Stripe が送り直します。知らせの番号 ' + eventId, subjectPrefix: '【BOOM】BW6' })`（失敗は握る。名前・金額は書かない。07 7-5「いつも」の行）して `{ handled: true, httpStatus: 500, result: 'recital_apply_failed' }`。うまくいけば `{ handled: true, httpStatus: 200, result: 'recital_' + status }`（記録とメールは「書く核」の中。メールの失敗は 200 のまま）。

- [ ] **Step 8: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPayDb.test.ts`
Expected: PASS

- [ ] **Step 9: 受け口の試験を書く**

`src/app/api/bf6/stripe-webhook/__tests__/route.test.ts`（`vi.mock('@/lib/recitalPayDb', () => ({ handleRecitalWebhook: vi.fn() }))`、`vi.mock('@/lib/mocchinEntryDb')` の `applyMocchinWebhookEvent` を見張る。`STRIPE_WEBHOOK_SECRET` を入れ、`createHmac('sha256', secret).update(\`${t}.${payload}\`)` で正しい署名を作る。ほかの部品は本物のまま import。import で落ちたら止まって知らせる）：

```ts
it('発表会の知らせは発表会の分岐で返し、MOCCHIN に流さない', async () => {
  handle.mockResolvedValue({ handled: true, httpStatus: 200, result: 'recital_paid' });
  const res = await POST(signed(mocchinLikeEventWithRecitalMeta));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ received: true, result: 'recital_paid' });
  expect(applyMocchin).not.toHaveBeenCalled();
});
it('handled:false なら今の流れ（MOCCHIN）へ', async () => { /* handle → {handled:false}・MOCCHIN の印 → applyMocchin が呼ばれる */ });
it('発表会の適用失敗は 500', async () => { /* {handled:true,httpStatus:500} → 500 */ });
it('署名がちがえば発表会の分岐も呼ばない（400）', async () => { /* handle not called */ });
```

`src/app/api/recital/stripe-test-webhook/__tests__/route.test.ts`：`STRIPE_TEST_WEBHOOK_SECRET` で署名。秘密が無い→500、署名ちがい→400、`handled:false`→200 `{ received: true, result: 'not_recital' }`（ほかの催しには流さない）、`handled:true` の 200/500 はそのまま。

- [ ] **Step 10: 落ちることを確かめる**

Run: `npx vitest run src/app/api/bf6/stripe-webhook/__tests__/route.test.ts` → FAIL
Run: `npx vitest run src/app/api/recital/stripe-test-webhook/__tests__/route.test.ts` → FAIL

- [ ] **Step 11: 受け口を直す・作る**

- `src/app/api/bf6/stripe-webhook/route.ts`：`event = JSON.parse(payload)` のすぐ後、`parseMocchinWebhookEvent` より前に3行だけ足す（`const recital = await handleRecitalWebhook(event); if (recital.handled) return NextResponse.json(recital.httpStatus === 200 ? { received: true, result: recital.result } : { error: 'apply failed' }, { status: recital.httpStatus });`）。今の分岐・`payment_intent.` の行（107〜110行）は1行も変えない。
- `src/app/api/recital/stripe-test-webhook/route.ts`：頭に `// ⚠️ 公開API(認証なし)。理由: Stripe の試しの鍵の知らせを受ける発表会だけの受け口。認可は STRIPE_TEST_WEBHOOK_SECRET の署名で行う。`、`dynamic='force-dynamic'`・`runtime='nodejs'`。形は上の本体と同じ（秘密だけちがう）。発表会でない知らせは `not_recital` で 200（ほかの催しの処理を呼ばない）。
- Stripe の試しの画面にこの受け口を登録するのは TARO（計画の終わりの「作る前に止まって聞く物」の1番）。本体の受け口の Stripe 側の設定は見るだけで変えない（R25）。

- [ ] **Step 12: 通ることを確かめる**

Run: `npx vitest run src/app/api/bf6/stripe-webhook/__tests__/route.test.ts` → PASS
Run: `npx vitest run src/app/api/recital/stripe-test-webhook/__tests__/route.test.ts` → PASS
Run: `npx vitest run src/lib/__tests__/recitalPayDb.test.ts` → PASS

- [ ] **Step 13: Stripe の試しのモードの受け口と鍵を用意する（TARO の操作が要る所はまとめて1回で頼む）**

Vercel の環境変数の控え（`.env.vercel-prod-snapshot`）には `STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET` しか無いので、`STRIPE_TEST_SECRET_KEY`・`STRIPE_TEST_WEBHOOK_SECRET` はまだ無いものとして進める（控えが古いこともある。Vercel の画面で名前だけ確かめる。値は見ない）。
1. Stripe の試しのモードで受け口 `https://bw5-app.vercel.app/api/recital/stripe-test-webhook` を登録（知らせは `checkout.session.completed`・`checkout.session.expired`）。
2. 出た秘密を Vercel に `STRIPE_TEST_WEBHOOK_SECRET`、試しの秘密鍵を `STRIPE_TEST_SECRET_KEY` として入れる（Production と Preview）。
値は計画にもコードにもチャットにも書かない。ブラウザで Claude ができる所は Claude がやり、ログイン・2段階認証など TARO にしかできない所だけを、計画の終わりの「作る前に止まって聞く物」の A-1 として1回で頼む。入るまでは、21・22 の手での確かめ（本物の試しの決済）だけを止め、ほかは進める。

- [ ] **Step 14: コミット**

```bash
git add src/lib/recitalStripe.ts src/lib/recitalPayDb.ts src/app/api/bf6/stripe-webhook/route.ts src/app/api/recital/stripe-test-webhook/route.ts src/lib/__tests__/recitalStripe.test.ts src/lib/__tests__/recitalPayDb.test.ts src/app/api/bf6/stripe-webhook/__tests__/route.test.ts src/app/api/recital/stripe-test-webhook/__tests__/route.test.ts
git commit -m "$(cat <<'EOF'
feat(bw6): カードの知らせを発表会の分岐で記録（試しの鍵の受け口つき）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: お振込みのご案内と「振り込みました」

**Files:**
- Create: `src/app/bw6/my/BankGuide.tsx`
- Modify: `src/lib/recitalPayDb.ts`（`chooseBankTransfer`・`markBankTold`）
- Modify: `src/lib/recitalMoneyDb.ts`（`afterMoneyChanged` にご案内の出し直しを足す）
- Modify: `src/app/bw6/my/PaySection.tsx`・`src/app/bw6/my/actions.ts`（`chooseBankAction`・`markBankToldAction`）
- Modify: `src/lib/recitalMyPage.ts`（`parseYenInput` を足す）・Test: `src/lib/__tests__/recitalMyPage.test.ts`（足す）
- Modify: `src/app/staff/bw6/entries/[id]/page.tsx`・`src/app/staff/bw6/entries/[id]/actions.ts`（「振り込みましたの印を付ける」と `markBankToldByStaffAction`）
- Test: `src/lib/__tests__/recitalPayDb.test.ts`

**Interfaces:**
- Consumes：21 の `expireOpenCheckout`・`PaySection`、10 の `maybeResendBankGuide(householdId)`（`bank_guide:<世帯id>:<金額>:<通し番号>` で、いちばん新しいご案内と金額がちがう時だけ出す・残り0なら出さない）、9 の `readHouseholdMoney`、6 の `logChangeTx`、8 の `applyHouseholdEdits`（試験で作品を足す）、16 の `requireRecitalStaff`・`StaffNamePicker`、19 の世帯の画面
- Produces：
  - `chooseBankTransfer(token): Promise<{ ok: true } | { blocked: 'not_open' | 'no_bank_text' | 'nothing_due' }>`
  - `markBankTold(householdId, { date, name, amount }, by: 'family' | 'staff', actor, now?): Promise<{ ok: boolean; code?: 'future' | 'nothing_due' }>`（形がおかしい入力は throw）
  - `afterMoneyChanged`：`cause==='total'` かつ `pay_method==='bank'` の時だけ `maybeResendBankGuide`
  - Server Action：`chooseBankAction(token)`・`markBankToldAction(token, x)`・`markBankToldByStaffAction(householdId, x, staffName)`
  - 28 の「この入金を取り消す」は、9 の `payment_recorded` の記録の `before.told`（at・date・amount・by）から印を戻す（名義は記録に無いので戻らない）。ここで書く `bank_told` の記録は、押し直しの前の値を残すためだけ。
  - `parseYenInput(x: string): number | null`（`src/lib/recitalMyPage.ts` に足す。純。NFKC にして `,`・`円`・空白を取り、1以上の整数なら数、ちがえば null）

- [ ] **Step 1: 試験を書く（`recitalPayDb.test.ts` に足す）**

```ts
it('銀行振込を選ぶ：pay_method=bank・開いているカードの画面を切る・ご案内1通', async () => {
  await startCardPayment(token, {});
  expect(await chooseBankTransfer(token)).toEqual({ ok: true });
  expect((await row(hid)).pay_method).toBe('bank');
  expect(await openRows(hid)).toEqual([]);
  expect(await guideKeys(hid)).toEqual([`bank_guide:${hid}:26500:1`]);
});
it('同じ金額で選び直してもご案内は増えない', async () => {
  await chooseBankTransfer(token);
  expect(await guideKeys(hid)).toHaveLength(1);
});
it('出し直しは合計が変わった時だけ（26,500→32,500→26,500 で3通）', async () => {
  await addWork(hid);   // applyHouseholdEdits → afterMoneyChanged(hid,'total')
  await dropWork(hid);
  expect(await guideKeys(hid)).toEqual([`bank_guide:${hid}:26500:1`, `bank_guide:${hid}:32500:2`, `bank_guide:${hid}:26500:3`]);
});
it('当てた・取り消しただけでは出さない', async () => {
  await recordManualPayment(hid, { method: 'cash', amount: 1000, paidOn: '2026-12-20', memo: '試し' }, '試し');
  await afterMoneyChanged(hid, 'payment');
  expect(await guideKeys(hid)).toHaveLength(3);
});
it('カードの世帯は合計が変わってもご案内を出さない', async () => { /* pay_method='card' の世帯で addWork → guideKeys 0 */ });
it('bank_text が空なら選べない・メールも出ない', async () => { /* bank_text='' の発表会 → { blocked: 'no_bank_text' }・guideKeys 0 */ });
it('支払いの鍵が閉じていれば not_open・残り0なら nothing_due', async () => { /* 2つ */ });

const now = new Date('2026-12-20T03:00:00Z'); // JST 12/20 12:00
it('振り込みました：未来の日は不可', async () => {
  expect(await markBankTold(hid2, { date: '2026-12-21', name: '4827 ヤマダ ハナコ', amount: 26500 }, 'family', 'family', now)).toEqual({ ok: false, code: 'future' });
});
it('振り込みました：初めて押すと5つの列が入る', async () => {
  expect(await markBankTold(hid2, { date: '2026-12-20', name: '4827 ヤマダ ハナコ', amount: 26500 }, 'family', 'family', now)).toEqual({ ok: true });
  expect(await told(hid2)).toEqual({ bank_told_at: '2026-12-20T03:00:00.000Z', bank_told_date: '2026-12-20', bank_told_name: '4827 ヤマダ ハナコ', bank_told_amount: 26500, bank_told_by: 'family' });
});
it('押し直しは日・名前・金額だけ（押した時と、だれが押したかは変えない）・前の値は記録へ・名前は記録に入れない', async () => {
  await markBankTold(hid2, { date: '2026-12-19', name: 'ヤマダ ハナコ', amount: 26000 }, 'staff', '試し', new Date('2026-12-21T01:00:00Z'));
  expect(await told(hid2)).toMatchObject({ bank_told_at: '2026-12-20T03:00:00.000Z', bank_told_date: '2026-12-19', bank_told_amount: 26000, bank_told_by: 'family' });
  const logs = await changes(hid2, 'bank_told');
  expect(logs).toHaveLength(2);
  expect(JSON.parse(logs[1].before_json)).toEqual({ date: '2026-12-20', amount: 26500, by: 'family' });
  expect(JSON.stringify(logs)).not.toContain('ヤマダ');
});
it('振り込みました：残りが無ければ nothing_due', async () => {
  const { hid: h } = await newHousehold();
  await recordManualPayment(h, { method: 'cash', amount: 26500, paidOn: '2026-12-20', memo: '' }, '試し');
  expect(await markBankTold(h, { date: '2026-12-20', name: '4827 ヤマダ ハナコ', amount: 26500 }, 'family', 'family', new Date('2026-12-20T03:00:00Z'))).toEqual({ ok: false, code: 'nothing_due' });
});
it('振り込みました：0円・空の名前・日付の形ちがいは throw', async () => {
  const { hid: h } = await newHousehold(); const now = new Date('2026-12-20T03:00:00Z');
  await expect(markBankTold(h, { date: '2026-12-20', name: 'ヤマダ', amount: 0 }, 'family', 'family', now)).rejects.toThrow();
  await expect(markBankTold(h, { date: '2026-12-20', name: '  ', amount: 26500 }, 'family', 'family', now)).rejects.toThrow();
  await expect(markBankTold(h, { date: '12/20', name: 'ヤマダ', amount: 26500 }, 'family', 'family', now)).rejects.toThrow();
});
it('振り込みましたで開いているカードの画面を切る', async () => {
  const { hid: h, token: t } = await newHousehold();
  await startCardPayment(t, {});
  await markBankTold(h, { date: '2026-12-20', name: '4827 ヤマダ ハナコ', amount: 26500 }, 'family', 'family', new Date('2026-12-20T03:00:00Z'));
  expect(await openRows(h)).toEqual([]);
});
```

`addWork(hid)`／`dropWork(hid)` は `applyHouseholdEdits`（`cast_set` で2作品目を `in`／`out`）のあとに `afterMoneyChanged(hid, 'total')` を呼ぶ（8 が中で呼んでいても、2回目は同じ金額なので出ない）。`guideKeys(hid)` は `SELECT dedupe_key FROM recital_mail_log WHERE household_id=? AND mail_kind='bank_guide' ORDER BY id`（送った・失敗のどちらも数える。試験の環境はメールの鍵が無いので失敗で残る）。ちがう形で残る作りなら止まって知らせる。

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPayDb.test.ts`
Expected: FAIL（`chooseBankTransfer` が無い）

- [ ] **Step 3: `chooseBankTransfer`・`markBankTold`・`afterMoneyChanged` のご案内の所を作る**

- `chooseBankTransfer(token)`：`requireHouseholdByToken`（null は throw）→ 鍵が `open` でない → `not_open`／`bank_text` が空 → `no_bank_text`（K210）／`payableAmount(m, told)` が0以下 → `nothing_due`。`pay_method='bank'` にする（書き込み1回）→ 書き込みの外で `expireOpenCheckout(id, 'bank_chosen')` → `maybeResendBankGuide(id)`（初めは出る。同じ金額なら出ない＝続けて2回は出さない）。
- `markBankTold(householdId, x, by, actor, now = new Date())`：`x.date` が `isIsoDate` でない・`x.name` が空白だけ・`x.amount` が1以上の整数でない → throw。`x.date > todayJst(now)` → `future`。`readHouseholdMoney` の `m.remaining` が0 → `nothing_due`。1つの `withWriteTx` で、印が無ければ5列を入れる（`bank_told_at=nowUtcIso(now)`）、あれば `bank_told_date`・`bank_told_name`・`bank_told_amount` だけ直す。`logChangeTx`（`action: 'bank_told'`・`before`＝前の `{ date, amount, by }` か null・`after`＝今の `{ date, amount, by }`・名前は入れない＝R-18 と 2-20・`actor`）。書き込みの外で `expireOpenCheckout(householdId, 'bank_told')`（二重払いを止めるため。計画で決めた）。メールは出さない。
- `afterMoneyChanged`：21 の所のあとに、`cause==='total'` かつ世帯の `pay_method==='bank'` の時だけ `maybeResendBankGuide(householdId)`（`await import('./recitalMail')`。失敗は `console.error` だけ）。`payment` では出さない（D5 2-24。一部だけ当てたあとに2通にしない）。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalPayDb.test.ts` → PASS
Run: `npx vitest run src/lib/__tests__/recitalMoneyDb.test.ts` → PASS
Run: `npx vitest run src/lib/__tests__/recitalMyPage.test.ts` → PASS（`parseYenInput` を足したあと）

- [ ] **Step 5: `BankGuide.tsx` と、家庭・スタッフのボタンを作る**

- `BankGuide.tsx`（マイページの「払う」の中。別URLは作らない）：文は決まりの紙 `decisions-v5.md` 2-24「画面の文（このまま使う）」をそのまま。差し込む物：金額＝`payableAmount(m, told)`（`toLocaleString('ja-JP')`）、期限＝`pay_due_override` か `pay_due` を「2027年2月10日（水）」の形（曜日は `weekdayJst` で出す。暗算しない）、振込先＝設定 `bank_text` を改行のまま（`white-space: pre-wrap`。**`bank_text` には銀行・支店・口座・受取人名の行だけを入れ、※の1行は画面の固定の文**＝計画で決めた）、整理番号＝`ref_code`、コピーの1行＝`${ref_code} ${contact_last_kana} ${contact_first_kana}`、年末年始の1行は今日が `bank_rest_to` 以下の時だけ（日付は `bank_rest_from`・`bank_rest_to` から。K215）。
- ［コピーする］はその1行だけを `navigator.clipboard.writeText`（try/catch。だめなら字を選んだ状態にする）。金額と振込先は字のまま（絵にしない）。
- 銀行ごとの早見（`<details>` でたたむ。04 4-2 の7行と「限度額の引き上げに日がかかるときは、カードでもお支払いいただけます」）。
- 一番下に［振り込みました］（残りがある間だけ）と［カードで払う］（21 の流れ。`pay_method='bank'` なので1回聞かれる）。
- ［振り込みました］の3つの欄（決まりの紙 2-20・04 4-2 の表）：お振込みの日（年・月・日を選ぶ。今日より先は選べない。初めは今日）／お名前（うすい字の例「4827 ヤマダ ハナコ」、下に小さく「通帳やアプリに出る、振り込んだ方のお名前」）／金額（初めは今の残り。印があればその値）。**3つとも文字色と下地色を両方書く。** 3つ入れないと送れない。押したあとは 2-24「『振り込みました』を押したあとの画面」の3行。
- 進みの出し方（2-20「家庭の画面の状態」）：「◯月◯日 ご連絡を受けました」→「確認中」→「◯月◯日に ◯円を確認しました」（いちばん新しい `method='bank'` の入金の `bank_date` と `amount`）。残りが印の額より多い時は「お振込み 26,500円（確認中）／のこり 6,000円」の形。
- `PaySection.tsx`：銀行振込を押す → `chooseBankAction` → `BankGuide`。`pay_method='bank'` の世帯は開いた時から `BankGuide` を出す。`bank_text` が空なら「銀行振込は、準備中です」で押せない（21 で置いた所を入れかえる）。
- `actions.ts`：`chooseBankAction(token)`・`markBankToldAction(token, x: { date: string; name: string; amount: string })`（金額は `parseYenInput` で数にする。null なら `{ error: '金額を確かめてください。' }`→`requireHouseholdByToken` → `markBankTold(id, …, 'family', 'family')`。throw は捕まえて `{ error: '入力を確かめてください。' }` で返す。エラーの画面にしない）。金額の欄は `inputMode="numeric"`。
- `parseYenInput` の試験（`recitalMyPage.test.ts` に足す）：`it.each([['26,500', 26500], ['２６５００', 26500], ['26500円', 26500], [' 26500 ', 26500], ['0', null], ['', null], ['abc', null]])('%s → %s', (x, want) => expect(parseYenInput(x)).toBe(want))`。
- スタッフ：`src/app/staff/bw6/entries/[id]/page.tsx` の「お支払い」の欄（19 の `StaffPaySection`）に［振り込みましたの印を付ける］（同じ3つの欄＋`StaffNamePicker`）、`actions.ts` に `markBankToldByStaffAction(householdId, x, staffName)`（頭で `requireRecitalStaff()` → `markBankTold(householdId, x, 'staff', staffName)`）。
- 画面の確かめ（M5 で）：`bw6-test` で、銀行振込→ご案内の文が決まりの紙のまま／コピーで1行だけ写る／未来の日が選べない／押したあと「確認中」／スタッフの画面で押すと家庭の画面も「確認中」。iPhone と LINE の中のブラウザで欄の文字が見える。

- [ ] **Step 6: コミット**

```bash
git add src/app/bw6/my/BankGuide.tsx src/app/bw6/my/PaySection.tsx src/app/bw6/my/actions.ts src/lib/recitalPayDb.ts src/lib/recitalMoneyDb.ts src/lib/recitalMyPage.ts src/lib/__tests__/recitalMyPage.test.ts "src/app/staff/bw6/entries/[id]/page.tsx" "src/app/staff/bw6/entries/[id]/actions.ts" src/lib/__tests__/recitalPayDb.test.ts
git commit -m "$(cat <<'EOF'
feat(bw6): お振込みのご案内と「振り込みました」

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: 声かけと朝の「ア」

**Files:**
- Create: `src/lib/recitalAsk.ts`（純）
- Modify: `src/lib/recitalBankDb.ts`（`getBankAskFacts` を足す）
- Create: `src/app/api/cron/recital-bank-ask/route.ts`
- Create: `src/app/api/cron/recital-morning/route.ts`
- Modify: `workers/boom-cron/index.js`（`JOBS` に5行）
- Test: `src/lib/__tests__/recitalAsk.test.ts`、`src/lib/__tests__/recitalBankDb.test.ts`（足す）
- Test: `src/app/api/cron/recital-bank-ask/__tests__/route.test.ts`、`src/app/api/cron/recital-morning/__tests__/route.test.ts`

**Interfaces:**
- Consumes：2 の `parseRecitalSettings`・`payGate`・`jstToMs`、6 の `getRecitalSettings`、10 の `flushWaitingMails(eventKey, now?, limit?)`、27 の `bankStartDate(eventKey, s): Promise<string>`（開始日の正本。ここで計算し直さない）、28 の `listReviewRows(eventKey)`、既存 `cronAuthorized`（`src/lib/inboxAlert/cronAuth.ts`）・`notifyTaro`・`todayJst`・`shiftDays`
- Produces：
  - `shouldAskTaro(x: { nowJst: string; slot: string; s: RecitalSettings; gate: PayGate; okBatchToday: boolean }): boolean`（`nowJst`＝JST `'YYYY-MM-DD HH:MM'`、`slot`＝`'08:00'`（朝）か `bank_ask_at` の時刻）
  - `buildAskMessage(x: { startDate: string; lastShotOn: string | null; reviewCount: number; url: string; afterRest?: boolean }): { subject: string; body: string }`（`afterRest` を足した。`subject` に頭は付けない＝`notifyTaro` が `【BOOM】BW6` を付ける）
  - `getBankAskFacts(eventKey: string, now: Date): Promise<{ startDate: string; lastShotOn: string | null; reviewCount: number; okBatchToday: boolean }>`（足した名前）
  - `JOBS` の label：`recital-morning`・`recital-bank-ask-1900`・`recital-bank-ask-2030`

段階1で出すのは3つだけ：夜7時・夜8時半（`bank_ask_at`）と 1/4 朝8時。**次の朝に催促がある夜の「夕方5時より後の束」の決まり・2/8〜2/10 の昼・2/12 の総点検の文・2/15 からの月曜は、後の計画へ**（催促と総点検が後の計画のため）。

- [ ] **Step 1: 試験を書く（`recitalAsk.test.ts`）**

```ts
const s = parseRecitalSettings([
  { key: 'pay_open_at', value: '2026-12-15 12:00' }, { key: 'pay_ok_at', value: '2026-12-14 10:00' },
  { key: 'bank_text', value: '（試しの振込先）' }, { key: 'bank_ask_at', value: '19:00,20:30' },
  { key: 'bank_rest_from', value: '2026-12-30' }, { key: 'bank_rest_to', value: '2027-01-03' },
  { key: 'bank_audit_on', value: '2027-02-12' },
]);
const ask = (nowJst: string, slot: string, over: Partial<{ s: RecitalSettings; okBatchToday: boolean }> = {}) => {
  const ss = over.s ?? s;
  return shouldAskTaro({ nowJst, slot, s: ss, gate: payGate(ss, jstToMs(nowJst)), okBatchToday: over.okBatchToday ?? false });
};

it('開けた日の夜から出る', () => { expect(ask('2026-12-15 19:00', '19:00')).toBe(true); expect(ask('2026-12-15 20:30', '20:30')).toBe(true); });
it('開ける前は出ない', () => { expect(ask('2026-12-14 19:00', '19:00')).toBe(false); });
it('pay_ok_at が空なら出ない', () => { expect(ask('2026-12-20 19:00', '19:00', { s: { ...s, pay_ok_at: null } })).toBe(false); });
it('bank_text が空なら出ない', () => { expect(ask('2026-12-20 19:00', '19:00', { s: { ...s, bank_text: '' } })).toBe(false); });
it('その日に合った束があれば出ない（20:30 も）', () => {
  expect(ask('2026-12-20 19:00', '19:00', { okBatchToday: true })).toBe(false);
  expect(ask('2026-12-20 20:30', '20:30', { okBatchToday: true })).toBe(false);
});
it('休みの境目：12/29 は出る・12/30〜1/3 は出ない・1/4 朝に1回・1/4 夜はふだんどおり', () => {
  expect(ask('2026-12-29 19:00', '19:00')).toBe(true);
  expect(ask('2026-12-30 19:00', '19:00')).toBe(false);
  expect(ask('2027-01-03 20:30', '20:30')).toBe(false);
  expect(ask('2027-01-04 08:00', '08:00')).toBe(true);
  expect(ask('2027-01-05 08:00', '08:00')).toBe(false);
  expect(ask('2026-12-20 08:00', '08:00')).toBe(false);
  expect(ask('2027-01-04 19:00', '19:00')).toBe(true);
});
it('bank_ask_at に無い時刻は出ない', () => { expect(ask('2026-12-20 12:00', '12:00')).toBe(false); });
it('2/12 からは段階1では出ない（総点検の文は後の計画）', () => {
  expect(ask('2027-02-11 19:00', '19:00')).toBe(true);
  expect(ask('2027-02-12 19:00', '19:00')).toBe(false);
});

it('いつもの文：金額と名前を書かない', () => {
  const m = buildAskMessage({ startDate: '2026-12-14', lastShotOn: '2026-12-20', reviewCount: 3, url: 'https://bw5-app.vercel.app/staff/bw6/bank' });
  expect(m.subject).toBe('入金のスクショをお願いします');
  expect(m.body).toBe('BW6 入金のスクショをお願いします。\n開始日は 12月14日。前に撮ったのは 12月20日。\n見てほしい入金 3件　https://bw5-app.vercel.app/staff/bw6/bank');
  expect(m.body).not.toMatch(/円/);
});
it('見てほしい入金が0件ならその行を出さない・前に撮った日が無ければ開始日だけ', () => {
  expect(buildAskMessage({ startDate: '2026-12-14', lastShotOn: null, reviewCount: 0, url: 'u' }).body).toBe('BW6 入金のスクショをお願いします。\n開始日は 12月14日。');
});
it('休み明けの文', () => {
  const m = buildAskMessage({ startDate: '2026-12-29', lastShotOn: '2026-12-29', reviewCount: 0, url: 'u', afterRest: true });
  expect(m.subject).toBe('入金のスクショをお願いします（休み明け）');
  expect(m.body).toBe('休みの間の分を、お願いします。\n開始日を 12月29日 にして、まとめて撮ってください。');
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalAsk.test.ts`
Expected: FAIL（`shouldAskTaro` が無い）

- [ ] **Step 3: `src/lib/recitalAsk.ts` を作る**

- `shouldAskTaro`：共通で `gate==='open'` かつ `s.bank_text.trim()` が空でない。日付 `d = nowJst.slice(0, 10)`。`slot==='08:00'` → `d === shiftDays(s.bank_rest_to, 1)` の時だけ true（`bank_rest_to` が空なら false）。ほかの `slot` → `s.bank_ask_at` に入っている・`d` が `bank_rest_from`〜`bank_rest_to`（両端を含む）の外・`d < s.bank_audit_on`・`!okBatchToday` の全部で true。
- `buildAskMessage`：文は 07 7-5「声かけの文」のいつもの文と休み明けの文（頭の `題：` の行は `subject` へ。`【BOOM】BW6 ` は付けない）。日は「12月14日」（曜日は付けない）。「見てほしい入金」の行は1件以上の時だけ、終わりに全角空白1つ＋`url`。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalAsk.test.ts`
Expected: PASS

- [ ] **Step 5: `getBankAskFacts` の試験を書く（`recitalBankDb.test.ts` に足す）**

```ts
it('台帳が空なら開始日は「払う」を開けた日の前の日（12/15 に開ければ 12/14）', async () => {
  // 設定 pay_open_at='2026-12-15 12:00'・pay_ok_at='2026-12-14 10:00'
  expect((await getBankAskFacts('t-ask', new Date('2026-12-15T10:00:00Z'))).startDate).toBe('2026-12-14');
});
it('開始日は台帳のいちばん新しい振込の入金の行の日（manual は数えない）', async () => {
  // 27 の試験の束を作る関数で、12/18 の chat の入金と、12/19 の manual の入金を入れる
  expect((await getBankAskFacts('t-ask', new Date('2026-12-20T10:00:00Z'))).startDate).toBe('2026-12-18');
});
it('今日の合った束：chat/file の ok だけ・manual と ng は数えない・前に撮った日はいちばん新しい ok の shot_on', async () => {
  // recital_imports に直に：12/20 JST 18:00 の manual ok、12/20 18:30 の chat ng:12/20:26500、12/19 の chat ok（shot_on 2026-12-19）
  const f = await getBankAskFacts('t-ask', new Date('2026-12-20T11:00:00Z'));
  expect(f.okBatchToday).toBe(false);
  expect(f.lastShotOn).toBe('2026-12-19');
  // 12/20 19:10 JST の chat ok を足す → true
});
it('見てほしい入金の数は listReviewRows の数', async () => {
  const before = (await getBankAskFacts('t-ask', new Date('2026-12-20T10:00:00Z'))).reviewCount;
  // 27 の試験の束を作る関数で、12/20 の「振込 ヤマダ ハナコ」（番号なし）の入金1行を入れる
  const f = await getBankAskFacts('t-ask', new Date('2026-12-20T10:00:00Z'));
  expect(f.reviewCount).toBe(before + 1);
  expect(f.reviewCount).toBe((await listReviewRows('t-ask')).length);
});
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankDb.test.ts`
Expected: FAIL（`getBankAskFacts` が無い）

- [ ] **Step 7: `getBankAskFacts` を作る**

- `startDate`：27 の `bankStartDate(eventKey, s)` を呼ぶだけ（決まり：`recital_bank_rows` の `dir='in' AND kind='transfer' AND source IN ('chat','file') AND state <> 'void'` の `MAX(row_date)`。無ければ「`pay_open_at` と `pay_ok_at` の遅い方の日付」の前の日（`shiftDays(…, -1)`。`pay_ok_at` の形は 6 の `setPayOk` が書く形。ちがう形なら止まって知らせる）。前の束が合わなかった日は台帳が増えないので、そのまま最後に合った日になる。
- `lastShotOn`：`recital_imports` の `kind='statement' AND check_result='ok' AND source IN ('chat','file')` で `imported_at` がいちばん新しい行の `shot_on`。
- `okBatchToday`：同じしぼりで、`imported_at` が今日（JST）の 0:00 以後（`new Date(jstToMs(todayJst(now))).toISOString()` と、`nowUtcIso` と同じ形で文字のまま比べる）。手で打った束は数えない（K211）。
- `reviewCount`：`(await listReviewRows(eventKey)).length`（画面と同じ数え方）。

- [ ] **Step 8: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankDb.test.ts`
Expected: PASS

- [ ] **Step 9: 定期の入口の試験を書く**

`recital-bank-ask/__tests__/route.test.ts`（`vi.mock('@/lib/notify')`・`vi.mock('@/lib/db')`（`getAll` が発表会の行を返す）・`vi.mock('@/lib/recitalDb')`・`vi.mock('@/lib/recitalBankDb')`。時計は `vi.setSystemTime`）：

```ts
it('鍵が無ければ 401', async () => { expect((await POST(req('/api/cron/recital-bank-ask?slot=19:00', {}))).status).toBe(401); });
it('slot の形がちがえば 400', async () => { /* slot=7pm → 400 */ });
it('条件がそろえば TARO に1回（頭は【BOOM】BW6）・試しの発表会には出さない', async () => {
  vi.setSystemTime(new Date('2026-12-20T10:00:00Z'));   // JST 19:00
  events([{ event_key: 'bw6', is_test: 0 }, { event_key: 'bw6-test', is_test: 1 }]);
  const res = await POST(req('/api/cron/recital-bank-ask?slot=19:00', auth));
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0]).toMatchObject({ subject: '入金のスクショをお願いします', subjectPrefix: '【BOOM】BW6' });
  expect(await res.json()).toEqual({ ok: true, asked: 1 });
});
it('合った束がある日は出さない', async () => { /* okBatchToday:true → notify 0 */ });
```

`recital-morning/__tests__/route.test.ts`：発表会ごとに `flushWaitingMails` を呼ぶ（試しの発表会も）／`2027-01-03T23:00:00Z`（JST 1/4 8:00）の時だけ `afterRest` の文で1回／`2026-12-20T23:00:00Z` は呼ばない／1つの発表会の flush が throw してもほかは続ける。

- [ ] **Step 10: 落ちることを確かめる**

Run: `npx vitest run src/app/api/cron/recital-bank-ask/__tests__/route.test.ts` → FAIL
Run: `npx vitest run src/app/api/cron/recital-morning/__tests__/route.test.ts` → FAIL

- [ ] **Step 11: 2つの入口を作る**

- 形は `src/app/api/cron/mail-health/route.ts` にそろえる（頭のコメントに「proxy の外。CRON_SECRET／CRON_SECRET_CF で認可」、`dynamic`・`runtime='nodejs'`・`maxDuration=60`、`POST` と `GET` を同じ関数、最初に `cronAuthorized`）。
- `recital-bank-ask`：`slot` を `?slot=` から読む（`/^\d{2}:\d{2}$/` でなければ 400）。`SELECT event_key FROM recital_events WHERE is_test = 0` の発表会ごとに、`getRecitalSettings`・`getBankAskFacts(eventKey, now)` → `shouldAskTaro({ nowJst, slot, s, gate: payGate(s, now.getTime()), okBatchToday })` が true なら `notifyTaro({ ...buildAskMessage({ startDate, lastShotOn, reviewCount, url: 'https://bw5-app.vercel.app/staff/bw6/bank' }), subjectPrefix: '【BOOM】BW6' })`。`nowJst` は `todayJst(now)` と JST の時:分。返すのは `{ ok: true, asked: <数> }` だけ（名前・金額を返さない）。知らせの相手は TARO だけ（G-14 が「KEIKO にも」なら、そのとき足す）。
- `recital-morning`：全部の発表会（`is_test` を問わず）で `flushWaitingMails(eventKey, now)`（1回20通まで。発表会ごとに try/catch）。`?retry=1` の時（08:05・08:10 の追い打ち）は flush だけで、声かけはしない。`retry` が無い時だけ、`is_test=0` の発表会で `slot: '08:00'` の `shouldAskTaro` → true なら `afterRest: true` の文で `notifyTaro`。
- 試験の決まり：試験のDBには種の `bw6-test`（`is_test=1`）が入っているので、「`is_test=0` を全部回す」試験は自分の発表会（`t-ask` を `is_test=0` で作る）だけが数に入ることを確かめ、`asked` の期待にほかの発表会を入れない（12/13 に `bw6` の種が入ったあとは `bw6` も数に入るので、その時は `pay_ok_at` が空の `bw6` は声かけしない＝0 を足した数で見る）。返すのは `{ ok: true, sent, failed, asked }`。毎朝の見回り①・イ・②は後の計画で、このルートに足す（今は書かない）。

- [ ] **Step 12: 通ることを確かめる**

Run: `npx vitest run src/app/api/cron/recital-bank-ask/__tests__/route.test.ts` → PASS
Run: `npx vitest run src/app/api/cron/recital-morning/__tests__/route.test.ts` → PASS

- [ ] **Step 13: `JOBS` に5行を足す**

`workers/boom-cron/index.js` の `JOBS` の終わりに、なぜの1行コメントをつけて：

```js
  // ── BW6 発表会（段階1）。朝8時＝夜に待たせた振込の確認メールを出す「ア」と 1/4 の休み明けの声かけ。
  // 夜7時・8時半＝TARO への入金のスクショの声かけ（出すかどうかはアプリが設定 bank_ask_at などで決める）。
  { at: '08:00', path: '/api/cron/recital-morning', label: 'recital-morning' },
  { at: '08:05', path: '/api/cron/recital-morning?retry=1', label: 'recital-morning-retry1' },  // 待ちが20通をこえた朝の追い打ち（flush だけ）
  { at: '08:10', path: '/api/cron/recital-morning?retry=1', label: 'recital-morning-retry2' },
  { at: '19:00', path: '/api/cron/recital-bank-ask?slot=19:00', label: 'recital-bank-ask-1900' },
  { at: '20:30', path: '/api/cron/recital-bank-ask?slot=20:30', label: 'recital-bank-ask-2030' },
```

`bank_ask_at` を変えた時は、この時刻表も合わせて直す（アプリは表に無い時刻を撃たれない）。

- [ ] **Step 14: 出す（12/13（日）まで。アプリの main への push が Vercel に出たあと）**

`workers/boom-cron` には package.json が無いので `npx` を使わず、全体に入っている wrangler を直接呼ぶ。先に `which wrangler`。無ければ止まって知らせる（M1 は `/opt/homebrew/bin/wrangler`）。
Run: `cd workers/boom-cron && wrangler deploy --dry-run` → 時刻表の読み込みエラーが無い
Run: `cd workers/boom-cron && wrangler deploy` → Deployed
確かめ：Worker の動作確認の画面（GET /）に5行が出る／`?run=recital-bank-ask-1900`（鍵つき）で1回撃って `{"ok":true,"asked":0}`（本番 `bw6` は `pay_ok_at` が空なので0）。wrangler のログインが切れていたら、止まって知らせる（TARO の手が要る）。

- [ ] **Step 15: コミット**

```bash
git add src/lib/recitalAsk.ts src/lib/recitalBankDb.ts src/app/api/cron/recital-bank-ask/route.ts src/app/api/cron/recital-morning/route.ts workers/boom-cron/index.js src/lib/__tests__/recitalAsk.test.ts src/lib/__tests__/recitalBankDb.test.ts src/app/api/cron/recital-bank-ask/__tests__/route.test.ts src/app/api/cron/recital-morning/__tests__/route.test.ts
git commit -m "$(cat <<'EOF'
feat(bw6): TARO への入金のスクショの声かけと朝8時の「ア」

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### 足した名前（③ に無かった物）

| 名前 | 場所 | わけ |
|---|---|---|
| `retrieveRecitalCheckout` の返り値に `url: string \| null` | `src/lib/recitalStripe.ts` | 「同じ残りなら同じURL」を返すため（`recital_checkouts` に url の列は無い） |
| `handleRecitalWebhook(event: unknown): Promise<{ handled: false } \| { handled: true; httpStatus: 200 \| 500; result: string }>` | `src/lib/recitalPayDb.ts` | 本体の受け口と試しの受け口が同じ物を呼ぶ |
| `buildAskMessage` の引数に `afterRest?: boolean` | `src/lib/recitalAsk.ts` | 1/4 の休み明けの文（題と本文がちがう） |
| `getBankAskFacts(eventKey: string, now: Date): Promise<{ startDate: string; lastShotOn: string \| null; reviewCount: number; okBatchToday: boolean }>` | `src/lib/recitalBankDb.ts` | 夜の声かけと朝の入口の両方が使う（開始日・前に撮った日・見てほしい入金の数・今日の合った束） |
| `payByCardAction`・`chooseBankAction`・`markBankToldAction` | `src/app/bw6/my/actions.ts` | マイページの Server Action |
| `markBankToldByStaffAction(householdId, x, staffName)` | `src/app/staff/bw6/entries/[id]/actions.ts` | 世帯の画面の「振り込みましたの印を付ける」 |

---

## 振（bank）振込の取り込みと当てる — タスク25〜30

並び：25・26 は 4（と 2）の後すぐ始めてよい（どちらも純関数）。27 は 9・10・25・26 の後。28 は 27・16・19 の後（19 の世帯の画面に足し、16 の `requireRecitalStaff`・`StaffNamePicker` を使う）。29 は 28・16 の後（16 の `searchHouseholds`・`pickStaffEventKey`・`bankToldWaitDue` を使う）。30 は 27 の後。
入口（27）・当てる計算（26）・取り消し（28）の最後の見直しは Fable。
このまとまりの正：決まりの紙 2-16〜2-24（とくに 2-17・2-18・2-19・2-23・2-24）、05 5-6「読む役と、入口」〜「メールを出す時刻と、取り消し」と「確かめる例（場面の表）1〜45」、04 4-4「見てほしい入金」「入金の取り込み」、03 3-9 `recital_bank_rows`・`recital_imports`。食いちがえば決まりの紙が勝つ。

作る係へ（このまとまり全部）：**計画に書いていないことに当たったら、自分で決めずに、止まって知らせる。** とくに、ほかのタスク（9・10・16・19）の関数が、ここに書いた形とちがう時。

---

### Task 25: 束の計算（純）`recitalBankBatch.ts`

**Files:**
- Create: `src/lib/recitalBankBatch.ts`
- Test: `src/lib/__tests__/recitalBankBatch.test.ts`

**Interfaces:**
- Consumes: `readRefFromDesc(descRaw): { ref: string | null; refOk: boolean; nameRaw: string; descNorm: string }`（4・`@/lib/recitalRef`）
- Produces（型は split ③ のまま）:
  - `type BankBatchRowIn`・`type BankBatchIn`・`type LedgerRowLite`・`type NormRow`
  - `const BANK_BATCH_MAX_ROWS = 400`（足した名前。1つの束の行の上限。こえたら月ごとに分けて渡す）
  - `validateBatchShape(x: unknown): { ok: true; batch: BankBatchIn } | { ok: false; error: string }`
  - `inferRowYear(mmdd: string, handedJstDate: string): string`（作れない日付は `''`）
  - `buildRowKey(r: { rowDate: string; dir: string; amount: number; balance: number | null }): string`
  - `normalizeBatch(b: BankBatchIn, handedJstDate: string): NormRow[]`（上が新しい順）
  - `checkBatch(b, rows, ledger, { startDate }): { ok: true } | { ok: false; near: { date: string; amount: number }; joinMismatch?: { ledgerRowId: number; pos: string }[] }`
  - `flagRows(rows: NormRow[], ledger: LedgerRowLite[]): NormRow[]`
  - `parseGmoStatementCsv(buf: Uint8Array): BankBatchIn['rows']`

決めごと（この節で決めた。作る係は、このとおりに作る）：
- `pos` は `'<何枚目>-<上から何行目>'`（例 `'2-3'`）。`manual` は `'m-1'`、`file` は `'f-<CSVの行番号>'`。
- `rows` は、どの `source` でも「上が新しい順」（スマホの画面の順）。`file` は `parseGmoStatementCsv` がこの順にして返す。
- `row_key` は `` `${rowDate}|${dir}|${amount}|${balance ?? ''}` ``。同じ束で重なれば、古い方（下）から数えて2つ目に `#2`、3つ目に `#3`。
- `recital-` の import は `./recitalRef` ではなく `@/lib/recitalRef`（ほかの lib と同じ）。

- [ ] **Step 1: 失敗する試験を書く**

試験の束は、残高がつながるように作った架空の数字（実在の残高・入金ではない）。整理番号は検査に合う `2714`・`3657`（欠番でない）。名前の例は「ヤマダ ハナコ」だけ。

```ts
import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { BANK_BATCH_MAX_ROWS, validateBatchShape, inferRowYear, buildRowKey, normalizeBatch, checkBatch, flagRows, parseGmoStatementCsv, type BankBatchIn, type BankBatchRowIn, type LedgerRowLite } from '../recitalBankBatch';

const r = (pos: string, date: string, dir: 'in' | 'out', amount: number | null, balance: number | null, kind: 'transfer' | 'debit' | 'other', desc = '', over: Partial<BankBatchRowIn> = {}): BankBatchRowIn =>
  ({ pos, date, dir, amount, balance, kind, desc, cut: false, unread: '', ...over });
const b = (rows: BankBatchRowIn[], over: Partial<BankBatchIn> = {}): BankBatchIn =>
  ({ event_key: 't-batch', source: 'chat', shot_on: '2026-12-16', range_from: '2026-12-14', range_to: '2026-12-16', images: 2, account: '円普通預金', rows, ...over });
// 2枚。1-3 と 2-1 が重ねた同じ行。いちばん下はデビット（last の印が付かない形）
const SAMPLE = [
  r('1-1', '12/16', 'in', 26500, 153000, 'transfer', '振込　２７１４　ヤマダ　ハナコ'),
  r('1-2', '12/15', 'out', 1000, 126500, 'debit'),
  r('1-3', '12/15', 'in', 6000, 127500, 'transfer', '振込 3657 ヤマダ タロウ'),
  r('2-1', '12/15', 'in', 6000, 127500, 'transfer', '振込 3657 ヤマダ タロウ'),
  r('2-2', '12/14', 'out', 500, 121500, 'debit'),
  r('2-3', '12/14', 'out', 3000, 122000, 'debit'),
];
const L = (over: Partial<LedgerRowLite>): LedgerRowLite => ({ id: 1, row_key: '', row_date: '2026-12-15', dir: 'in', amount: 6000, balance: 127500, kind: 'transfer', source: 'chat', state: 'new', ...over });

describe('validateBatchShape', () => {
  it('形が合えば ok', () => expect(validateBatchShape(b(SAMPLE)).ok).toBe(true));
  it('source がちがう・event_key が空・行が多すぎるは ng', () => {
    expect(validateBatchShape({ ...b(SAMPLE), source: 'x' }).ok).toBe(false);
    expect(validateBatchShape({ ...b(SAMPLE), event_key: '' }).ok).toBe(false);
    expect(validateBatchShape(b(Array.from({ length: BANK_BATCH_MAX_ROWS + 1 }, (_, i) => r(`1-${i + 1}`, '12/16', 'out', 1, 1, 'debit')))).ok).toBe(false);
  });
  it('amount が null なのに unread に amount が無いのは ng', () => {
    expect(validateBatchShape(b([r('1-1', '12/16', 'in', null, 1, 'transfer')])).ok).toBe(false);
    expect(validateBatchShape(b([r('1-1', '12/16', 'in', null, 1, 'transfer', '', { unread: 'amount' })])).ok).toBe(true);
  });
  it('manual は残高が空なら ng・日付は年月日', () => {
    expect(validateBatchShape(b([r('m-1', '2026-12-16', 'in', 26500, null, 'transfer', '振込 2714 ヤマダ ハナコ')], { source: 'manual', images: 0 })).ok).toBe(false);
    expect(validateBatchShape(b([r('m-1', '12/16', 'in', 26500, 1, 'transfer', 'x')], { source: 'manual', images: 0 })).ok).toBe(false);
  });
});

describe('inferRowYear（渡した日 JST より先にならない、いちばん新しい年）', () => {
  it('1/4 に渡した 12/29 は 2026年', () => expect(inferRowYear('12/29', '2027-01-04')).toBe('2026-12-29'));
  it('当日はその年・1日でも先なら前の年', () => {
    expect(inferRowYear('1/4', '2027-01-04')).toBe('2027-01-04');
    expect(inferRowYear('01/05', '2027-01-04')).toBe('2026-01-05');
  });
  it('ない日付は空', () => expect(inferRowYear('2/30', '2027-03-01')).toBe(''));
});

describe('normalizeBatch', () => {
  it('重ね撮りを1本にする（6行→5行）・年を決める・番号を読む', () => {
    const rows = normalizeBatch(b(SAMPLE), '2026-12-16');
    expect(rows.map((x) => x.pos)).toEqual(['1-1', '1-2', '1-3', '2-2', '2-3']);
    expect(rows[0]).toMatchObject({ rowDate: '2026-12-16', refRead: '2714', refOk: 1, descRaw: '振込　２７１４　ヤマダ　ハナコ', rowKey: '2026-12-16|in|26500|153000' });
    expect(rows[1]).toMatchObject({ descRaw: null, refRead: null, refOk: 0 }); // 出金は摘要を持たない
  });
  it('同じ鍵が1つの束に2つ：下が鍵のまま、上に #2', () => {
    const rows = normalizeBatch(b([
      r('1-1', '12/15', 'in', 6000, 127500, 'transfer', '振込 3657 ヤマダ タロウ'),
      r('1-2', '12/15', 'out', 6000, 121500, 'debit'),
      r('1-3', '12/15', 'in', 6000, 127500, 'transfer', '振込 3657 ヤマダ タロウ'),
    ], { images: 1 }), '2026-12-16');
    expect(rows[0].rowKey).toBe('2026-12-15|in|6000|127500#2');
    expect(rows[2].rowKey).toBe('2026-12-15|in|6000|127500');
  });
  it('4827 は検査に合わない（refOk 0）', () => {
    expect(normalizeBatch(b([r('1-1', '12/16', 'in', 26500, 1, 'transfer', '振込 4827 ヤマダ ハナコ')], { images: 1 }), '2026-12-16')[0]).toMatchObject({ refRead: '4827', refOk: 0 });
  });
});

describe('checkBatch', () => {
  const ok = (bb: BankBatchIn, ledger: LedgerRowLite[] = [], startDate = '2026-12-14') => checkBatch(bb, normalizeBatch(bb, '2026-12-16'), ledger, { startDate });
  it('合う束', () => expect(ok(b(SAMPLE))).toEqual({ ok: true }));
  it('残高が1円ちがう → いちばん上のあたり（12/16 の 26,500円）', () => {
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, balance: 153001 } : x));
    expect(ok(b(bad))).toEqual({ ok: false, near: { date: '2026-12-16', amount: 26500 } });
  });
  it('日付が下へ新しくなる → ng', () => {
    const bad = SAMPLE.map((x) => (x.pos === '2-3' ? { ...x, date: '12/16' } : x));
    expect(ok(b(bad)).ok).toBe(false);
  });
  it('枚のつなぎ目に重ねた行が無い → 1枚目のいちばん下のあたり', () => {
    expect(ok(b(SAMPLE.filter((x) => x.pos !== '2-1')))).toMatchObject({ ok: false, near: { date: '2026-12-15', amount: 6000 } });
  });
  it('期間の開始日が声かけの日より後 → ng（amount 0 で開始日を返す）', () => {
    expect(ok(b(SAMPLE, { range_from: '2026-12-15' }))).toEqual({ ok: false, near: { date: '2026-12-14', amount: 0 } });
  });
  it('金額が読めない行がある束は入れない', () => {
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, amount: null, unread: 'amount' } : x));
    expect(ok(b(bad)).ok).toBe(false);
  });
  it('摘要だけ読めない行は入れる', () => {
    const u = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, unread: 'desc' } : x));
    expect(ok(b(u))).toEqual({ ok: true });
  });
  it('前の日までの振込の入金と、残高まで同じ行がある → ok', () => {
    expect(ok(b(SAMPLE), [L({ id: 7, row_key: '2026-12-15|in|6000|127500' })])).toEqual({ ok: true });
  });
  it('つなぎ目だけ合わない → 台帳の行と今回の行を並べて返す', () => {
    expect(ok(b(SAMPLE), [L({ id: 7, row_key: '2026-12-15|in|6000|127000', balance: 127000 })]))
      .toMatchObject({ ok: false, joinMismatch: [{ ledgerRowId: 7, pos: '1-3' }] });
  });
  it('つなぎ目は manual の行・デビットの行では見ない', () => {
    expect(ok(b(SAMPLE), [L({ id: 8, source: 'manual', balance: 999, row_key: '2026-12-15|in|6000|999' })])).toEqual({ ok: true });
  });
  it('manual は検算を見ない（残高があれば ok）・file は 1 と 2 だけ（開始日は見ない）', () => {
    const m = b([r('m-1', '2026-12-16', 'in', 26500, 999, 'transfer', '振込 2714 ヤマダ ハナコ')], { source: 'manual', images: 0 });
    expect(checkBatch(m, normalizeBatch(m, '2026-12-16'), [], { startDate: '2026-12-14' })).toEqual({ ok: true });
    const f = b(SAMPLE.filter((x) => x.pos !== '2-1').map((x, i) => ({ ...x, pos: `f-${i + 2}`, date: `2026-${x.date.replace('/', '-')}` })), { source: 'file', images: 0, range_from: '2026-12-15' });
    expect(checkBatch(f, normalizeBatch(f, '2026-12-16'), [], { startDate: '2026-12-14' })).toEqual({ ok: true });
  });
});

describe('flagRows', () => {
  const norm = (rows: BankBatchRowIn[]) => normalizeBatch(b(rows, { images: 1 }), '2026-12-16');
  it('日付だけちがう・金額だけちがう台帳の行 → twin', () => {
    const rows = norm([r('1-1', '12/16', 'in', 6000, 127500, 'transfer', '振込 3657 ヤマダ タロウ'), r('1-2', '12/16', 'out', 1, 121500, 'debit')]);
    expect(flagRows(rows, [L({ row_key: '2026-12-15|in|6000|127500' })])[0].checkFlag).toBe('twin');
    expect(flagRows(rows, [L({ row_date: '2026-12-16', amount: 5000, row_key: '2026-12-16|in|5000|127500' })])[0].checkFlag).toBe('twin');
  });
  it('いちばん下が台帳にまだ無い振込の入金 → last／もうある行なら付かない', () => {
    const rows = norm([r('1-1', '12/16', 'out', 1, 127499, 'debit'), r('1-2', '12/15', 'in', 6000, 127500, 'transfer', '振込 3657 ヤマダ タロウ')]);
    expect(flagRows(rows, [])[1].checkFlag).toBe('last');
    expect(flagRows(rows, [L({ row_key: '2026-12-15|in|6000|127500' })])[1].checkFlag).toBe(null);
  });
  it('日付・入出・金額が同じ manual の行が台帳にある → manual_twin（twin より先）', () => {
    const rows = norm([r('1-1', '12/15', 'in', 6000, 127500, 'transfer', '振込 3657 ヤマダ タロウ'), r('1-2', '12/15', 'out', 1, 121500, 'debit')]);
    expect(flagRows(rows, [L({ source: 'manual', balance: 999, row_key: '2026-12-15|in|6000|999' })])[0].checkFlag).toBe('manual_twin');
  });
});

describe('parseGmoStatementCsv', () => {
  it('Shift_JIS の CSV を、上が新しい順の行にする', () => {
    const csv = '日付,摘要,入金金額,出金金額,残高,メモ\r\n2026/12/15,ﾃﾞﾋﾞｯﾄ,,1000,126500,\r\n2026/12/16,振込 2714 ﾔﾏﾀﾞ ﾊﾅｺ,26500,,153000,\r\n';
    const rows = parseGmoStatementCsv(new Uint8Array(iconv.encode(csv, 'shift_jis')));
    expect(rows).toEqual([
      { pos: 'f-3', date: '2026-12-16', dir: 'in', amount: 26500, balance: 153000, kind: 'transfer', desc: '振込 2714 ﾔﾏﾀﾞ ﾊﾅｺ', cut: false, unread: '' },
      { pos: 'f-2', date: '2026-12-15', dir: 'out', amount: 1000, balance: 126500, kind: 'debit', desc: '', cut: false, unread: '' },
    ]);
  });
});

it('buildRowKey', () => expect(buildRowKey({ rowDate: '2026-12-16', dir: 'in', amount: 26500, balance: 153000 })).toBe('2026-12-16|in|26500|153000'));
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankBatch.test.ts`
Expected: FAIL（`Cannot find module '../recitalBankBatch'`）

- [ ] **Step 3: `src/lib/recitalBankBatch.ts` を作る**

各関数の決まり（試験で決まらない所だけ）：
- `validateBatchShape`：`event_key` 1〜40字／`source` は `chat|manual|file`／`shot_on` は `YYYY-MM-DD`／`range_from`・`range_to` は `YYYY-MM-DD` か `YYYY/MM/DD`（`/` は `-` にそろえて返す）／`images` は 0 以上の整数／`account` は文字／`rows` は 1〜`BANK_BATCH_MAX_ROWS` 行／行の `dir`・`kind` は決まった語／`amount`・`balance` は 0 以上の整数か null（null は `unread` にその名前がある時だけ。`manual` の `balance` は null 不可）／`date` は `chat` なら `M/D`（0埋めあり・なし両方）、`file`・`manual` は `YYYY-MM-DD`／`desc` は 200字で切る／`unread` は `''` か `date,amount,balance,desc,dir` の語をカンマでつないだ物／`manual` の行は `dir='in'`・`kind='transfer'` だけ／`first_ok` は boolean か無し。
- `inferRowYear`：`handedJstDate` の年 Y で `Y-MM-DD` を作り、`handedJstDate` より後なら Y−1。どちらも作れない日付（2/30 など）は `''`。
- `normalizeBatch`：①`pos` の枚・行の数で並べる ②`chat` だけ、枚 k のいちばん下から数えた並びと、枚 k+1 のいちばん上から数えた並びが（日付・入出・金額・残高で）いちばん長く一致する所を、枚 k+1 の側から消す ③日付：`chat` は `inferRowYear`（`''` なら `unread` に `date` を足す）、ほかはそのまま ④入金の振込の行で `desc` があるときだけ `readRefFromDesc` で `descRaw`・`descNorm`・`refRead`・`refOk` を入れる（ほかの行は `descRaw`・`descNorm`・`refRead` が null、`refOk` 0）⑤`amount`・`balance` が null の行は `amount` を 0 にする（その束は `checkBatch` が ng にする）⑥`rowKey` を付け、同じ鍵は下から数えて2つ目以降に `#n` ⑦`checkFlag` は null。
  ⚠️ 重ね撮りの1本化は「つなぎ目だけ」。1枚の中の同じ並びは消さない。ここが試験とちがう動きになったら、止まって知らせる。
- `checkBatch`：見る順は ⓪読めない（`unread` に `date`・`amount`・`balance`・`dir` がある行 → その行の日付と金額）→ 1 残高（となりの2行の上の行を `near` に）→ 2 日付 → 3 枚のつなぎ目（`b.rows` の枚 k のいちばん下が、枚 k+1 のいちばん上と同じか。ちがえば枚 k のいちばん下を `near`）→ 5 開始日（`range_from > startDate` なら `near: { date: startDate, amount: 0 }`）→ 4 前の日までのつなぎ目（最後に見るので、`joinMismatch` は「束の中は合っている」時だけ出る）。`manual` は ⓪ と「残高が null でない」だけ。`file` は ⓪・1・2 だけ。`chat` は全部。
  - 4 のやり方：台帳の行のうち `dir='in'`・`kind='transfer'`・`source` が `chat|file`・`state<>'void'` の物が1つも無ければ見ない。あれば、束の入金の振込の行のどれかの鍵（`#n` をふくむ）が、その台帳の行のどれかの `row_key` と同じなら合格。1つも同じでなければ ng。そのとき、日付・入出・金額が同じで残高だけちがう組を `joinMismatch: [{ ledgerRowId, pos }]` に入れ、`near` は束のいちばん下の行。
- `flagRows`：鍵が台帳（`state<>'void'`）にもうある行には付けない。入金の振込の行にだけ、`manual_twin`（台帳の `source='manual'` の行と日付・入出・金額が同じ）→ `twin`（入出・金額・残高が同じで日付だけちがう／日付・入出・残高が同じで金額だけちがう）→ `last`（束のいちばん下の行）の順で、最初に当たった1つ。
- `parseGmoStatementCsv`：`new TextDecoder('shift_jis')` で読む。見出しの名前で列を探す（`日付`・`摘要`・`入金金額`・`出金金額`・`残高`。無ければ throw）。引用符つきの欄も読める小さい CSV の分け方を中に持つ（`scripts/bf7_ws_match_transfers.mjs` の `parseCsvLine` と同じ考え）。金額の `,`・`円`・`¥`・空白は取る。日付は `/` を `-` に、0埋め。入金が 0 より大きければ `in`、ほかは `out`。`kind`：入金で摘要が `振込` で始まる → `transfer`、摘要（NFKC 後）に `デビット` → `debit`、ほか `other`。`desc` は入金の振込の行だけ（ほかは `''`）。CSV が古い順なら逆にして返す（はじめと終わりの日付でくらべる）。
  ⚠️ 列の形は今の GMO の CSV（`日付,摘要,入金金額,出金金額,残高,メモ`）が前提（④C-16）。TARO の試しの明細（U55）で形がちがうと分かったら、この関数だけを直す。ほかは変えない。
- 試験の `iconv-lite` は node_modules にある（間接の依存。package.json には足さない）。無ければ止まって知らせる。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankBatch.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recitalBankBatch.ts src/lib/__tests__/recitalBankBatch.test.ts
git commit -m "feat(bw6): 入金の束の正規化と検算（recitalBankBatch）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 26: 当てる計算（純）`recitalBankMatch.ts`

**Files:**
- Create: `src/lib/recitalBankMatch.ts`
- Test: `src/lib/__tests__/recitalBankMatch.test.ts`

**Interfaces:**
- Consumes: `isValidRef(code): boolean`（4）、`FIRST5_LIMIT = 5`・`type HouseholdView`（2）
- Produces（型は split ③ のまま）:
  - `type ReviewKind`・`type MatchHousehold`・`type MatchRow`・`type Candidate`
  - `surnameMatches(nameRaw: string, surnamesKana: string[], toldName: string | null): boolean`
  - `decideRow(row: MatchRow, byRef: Map<string, MatchHousehold>, ctx: { first5Done: number; firstOk: boolean; sameRefOpenAmounts: number[] }): { auto: true; householdId: number } | { auto: false; reviewKind: ReviewKind | null; householdId: number | null }`
  - `candidatesFor(row: MatchRow, all: MatchHousehold[]): { list: Candidate[]; notice: string | null }`

- [ ] **Step 1: 失敗する試験を書く**

金額は料金表の額（26,500／32,500／6,000）だけ。当たる場面の番号は検査に合う `2714`（世帯A）・`3657`（世帯B）。

```ts
import { describe, it, expect } from 'vitest';
import { decideRow, candidatesFor, surnameMatches, type MatchHousehold, type MatchRow } from '../recitalBankMatch';

const H = (over: Partial<MatchHousehold> = {}): MatchHousehold => ({ id: 1, refCode: '2714', status: 'active', mergedInto: null, view: 'tentative', remaining: 26500, totalBeforeLastDrop: null, surnamesKana: ['ヤマダ'], told: null, ...over });
const R = (over: Partial<MatchRow> = {}): MatchRow => ({ id: 10, source: 'chat', dir: 'in', kind: 'transfer', amount: 26500, remainingOfRow: 26500, refRead: '2714', refOk: 1, nameRaw: 'ヤマダハナコ', unread: null, cut: 0, checkFlag: null, rowDate: '2026-12-16', ...over });
const by = (...hs: MatchHousehold[]) => new Map(hs.map((h) => [h.refCode, h]));
const CTX = { first5Done: 5, firstOk: false, sameRefOpenAmounts: [] as number[] };
const kind = (row: MatchRow, hs: MatchHousehold[], ctx = CTX) => decideRow(row, by(...hs), ctx);

describe('decideRow：場面の表（05 5-6）', () => {
  it('1 ぴったり → 自動', () => expect(kind(R(), [H()])).toEqual({ auto: true, householdId: 1 }));
  it('2 差額の2回目（今の残り 6,000 に 6,000）→ 自動', () => expect(kind(R({ amount: 6000, remainingOfRow: 6000 }), [H({ view: 'complete_extra', remaining: 6000 })]).auto).toBe(true));
  it('3 同じ番号の2件目（残り 0）→ paid', () => expect(kind(R(), [H({ view: 'complete', remaining: 0 })])).toEqual({ auto: false, reviewKind: 'paid', householdId: 1 }));
  it('4 足すとぴったり（32,500 に 26,500 と 6,000）→ 両方 sum', () => {
    const h = H({ remaining: 32500 });
    expect(kind(R(), [h], { ...CTX, sameRefOpenAmounts: [6000] })).toMatchObject({ reviewKind: 'sum' });
    expect(kind(R({ amount: 6000, remainingOfRow: 6000 }), [h], { ...CTX, sameRefOpenAmounts: [26500] })).toMatchObject({ reviewKind: 'sum' });
  });
  it('5 金額が少ない → short／7 多い → over', () => {
    expect(kind(R(), [H({ remaining: 32500 })])).toMatchObject({ reviewKind: 'short' });
    expect(kind(R({ amount: 32500, remainingOfRow: 32500 }), [H()])).toMatchObject({ reviewKind: 'over' });
  });
  it('10 出演なし・11 まとめた世帯 → gone', () => {
    expect(kind(R(), [H({ view: 'none' })])).toMatchObject({ reviewKind: 'gone' });
    expect(kind(R(), [H({ status: 'merged', mergedInto: 2 })])).toMatchObject({ reviewKind: 'gone' });
  });
  it('12 番号なし → no_ref（姓と金額が合っても当てない）', () => expect(kind(R({ refRead: null, refOk: 0 }), [H()])).toEqual({ auto: false, reviewKind: 'no_ref', householdId: null }));
  it('13・32 例の 4827 は bad_ref／検査に合っても世帯が無ければ bad_ref', () => {
    expect(kind(R({ refRead: '4827', refOk: 0 }), [H()])).toMatchObject({ reviewKind: 'bad_ref' });
    expect(kind(R({ refRead: '3657', refOk: 1 }), [H()])).toMatchObject({ reviewKind: 'bad_ref', householdId: null });
  });
  it('14 姓が合わない → name', () => expect(kind(R({ nameRaw: 'スズキイチロウ' }), [H()])).toMatchObject({ reviewKind: 'name' }));
  it('16 出金・デビット → 見ない', () => {
    expect(kind(R({ dir: 'out' }), [H()])).toEqual({ auto: false, reviewKind: null, householdId: null });
    expect(kind(R({ kind: 'debit' }), [H()])).toEqual({ auto: false, reviewKind: null, householdId: null });
  });
  it('17 読めない → unread（ほかより先）／19 手で打った → manual', () => {
    expect(kind(R({ unread: 'desc', refRead: null }), [H()])).toMatchObject({ reviewKind: 'unread' });
    expect(kind(R({ source: 'manual' }), [H()])).toMatchObject({ reviewKind: 'manual' });
  });
  it('18 後ろが切れていても姓が読めれば自動', () => expect(kind(R({ cut: 1, nameRaw: 'ヤマダハ' }), [H()]).auto).toBe(true));
  it('20 はじめの5件：4件までは first5、はいの束か5件目からは自動', () => {
    expect(kind(R(), [H()], { ...CTX, first5Done: 4 })).toMatchObject({ reviewKind: 'first5' });
    expect(kind(R(), [H()], { ...CTX, first5Done: 4, firstOk: true }).auto).toBe(true);
    expect(kind(R(), [H()], { ...CTX, first5Done: 5 }).auto).toBe(true);
  });
  it('33〜35 印（twin・last・manual_twin）は、5つそろっても自動にしない・種類は付けない（はいがあっても）', () => {
    for (const f of ['twin', 'last', 'manual_twin']) {
      expect(kind(R({ checkFlag: f }), [H()], { ...CTX, firstOk: true })).toEqual({ auto: false, reviewKind: null, householdId: 1 });
    }
  });
  it('比べるのは今の残り（合計 32,500・払った 26,500 → 残り 6,000）', () => {
    expect(kind(R({ amount: 6000, remainingOfRow: 6000 }), [H({ view: 'complete_extra', remaining: 6000 })]).auto).toBe(true);
    expect(kind(R({ amount: 32500, remainingOfRow: 32500 }), [H({ view: 'complete_extra', remaining: 6000 })])).toMatchObject({ reviewKind: 'over' });
  });
  it('36 のこりの行（53,000 のうち 26,500 がのこり）はのこりの額で比べる', () => {
    expect(kind(R({ amount: 53000, remainingOfRow: 26500 }), [H()]).auto).toBe(true);
  });
});

describe('candidatesFor（K203）', () => {
  const A = H({ id: 1, refCode: '2714', surnamesKana: ['ヤマダ'], remaining: 32500 });
  const B = H({ id: 2, refCode: '3657', surnamesKana: ['スズキ'], remaining: 26500 });
  it('39 番号は A・姓と金額は B → B を上に、文を出す。選んだ形にはしない（top は上に出す印）', () => {
    const c = candidatesFor(R({ nameRaw: 'スズキハナコ' }), [A, B]);
    expect(c.list.map((x) => x.householdId)).toEqual([2, 1]);
    expect(c.list[0]).toMatchObject({ top: true });
    expect(c.list[0].why).toEqual(expect.arrayContaining(['amount', 'surname']));
    expect(c.list[1].why).toContain('ref');
    expect(c.notice).toBe('番号とお名前が、別のご家庭を指しています。家庭に確かめてから、押してください');
  });
  it('40 番号なし・同じ姓と金額の世帯が2つ → どちらも上に出さない', () => {
    const X = H({ id: 3, refCode: '5188', surnamesKana: ['ヤマダ'], remaining: 26500 });
    const Y = H({ id: 4, refCode: '6405', surnamesKana: ['ヤマダ'], remaining: 26500 });
    const c = candidatesFor(R({ refRead: null, refOk: 0 }), [X, Y]);
    expect(c.list.every((x) => !x.top)).toBe(true);
    expect(c.notice).toBe('同じ姓・同じ金額のご家庭が 2つあります。家庭に確かめてから、押してください');
  });
  it('40 そのうち「振り込みました」の印（日・金額・名義）が合うのが1つ → その世帯を上に', () => {
    const X = H({ id: 3, refCode: '5188', surnamesKana: ['ヤマダ'], remaining: 26500, told: { date: '2026-12-15', name: 'ヤマダ ハナコ', amount: 26500 } });
    const Y = H({ id: 4, refCode: '6405', surnamesKana: ['ヤマダ'], remaining: 26500 });
    const c = candidatesFor(R({ refRead: null, refOk: 0 }), [X, Y]);
    expect(c.list[0]).toMatchObject({ householdId: 3, top: true });
    expect(c.list[0].why).toContain('told');
  });
  it('9 2家庭まとめ（53,000）→ 同じ姓の2世帯に sum', () => {
    const X = H({ id: 3, refCode: '5188', remaining: 26500 });
    const Y = H({ id: 4, refCode: '6405', remaining: 26500 });
    const c = candidatesFor(R({ refRead: null, refOk: 0, amount: 53000, remainingOfRow: 53000 }), [X, Y]);
    expect(c.list.filter((x) => x.why.includes('sum')).map((x) => x.householdId).sort()).toEqual([3, 4]);
  });
  it('名義のどこかに検査に合う4けた → ref／へらす前の合計と同じ → before_drop／まとめた世帯は先の世帯も', () => {
    const M = H({ id: 5, refCode: '7778', status: 'merged', mergedInto: 6 });
    const T = H({ id: 6, refCode: '8363', surnamesKana: ['タナカ'], remaining: 6000, totalBeforeLastDrop: 26500 });
    const c = candidatesFor(R({ refRead: null, refOk: 0, nameRaw: 'タナカ7778' }), [M, T]);
    expect(c.list.find((x) => x.householdId === 5)?.why).toContain('ref');
    expect(c.list.find((x) => x.householdId === 6)?.why).toEqual(expect.arrayContaining(['ref', 'before_drop', 'surname']));
  });
  it('15 関係ない入金 → 候補0', () => expect(candidatesFor(R({ refRead: null, refOk: 0, nameRaw: 'カ)ナニカ', amount: 1234, remainingOfRow: 1234 }), [A, B]).list).toEqual([]));
});

describe('surnameMatches', () => {
  it('半角・全角・空白・小さいカナをそろえる', () => {
    expect(surnameMatches('ﾔﾏﾀﾞ ﾊﾅｺ', ['ヤマダ'], null)).toBe(true);
    expect(surnameMatches('ヤマダ　ハナコ', ['やまだ'], null)).toBe(true);
    expect(surnameMatches('ｼﾖｳｼﾞﾊﾅｺ', ['ショウジ'], null)).toBe(true);
  });
  it('「振り込みました」の名義と同じなら合う・空の姓では合わない', () => {
    expect(surnameMatches('スズキイチロウ', ['ヤマダ'], 'スズキ イチロウ')).toBe(true);
    expect(surnameMatches('スズキイチロウ', [''], null)).toBe(false);
  });
  it('長音（ー・ｰ・-）のゆれをそろえる', () => {
    expect(surnameMatches('ｵｰﾉﾊﾅｺ', ['オーノ'], null)).toBe(true);
    expect(surnameMatches('ｵ-ﾉﾊﾅｺ', ['オーノ'], null)).toBe(true);
  });
  it('「振り込みました」の名義の頭の番号と区切りは、Task 4 と同じ並びで外す（全角の番号・長音の区切りも）', () => {
    expect(surnameMatches('ヤマダハナコ', ['スズキ'], '２７１４ーヤマダ ハナコ')).toBe(true);
    expect(surnameMatches('ヤマダハナコ', ['スズキ'], '2714/ヤマダハナコ')).toBe(true);
  });
});
describe('「振り込みました」の印と作品を足したあとの差額', () => {
  it('印の額と同じでも、今の残りより少なければ short（自動にしない）', () => {
    const h = H({ view: 'tentative', remaining: 32500, told: { date: '2026-12-15', name: 'ヤマダ ハナコ', amount: 26500 } });
    expect(kind(R({ amount: 26500, remainingOfRow: 26500 }), [h])).toMatchObject({ auto: false, reviewKind: 'short', householdId: 1 });
    expect(candidatesFor(R({ amount: 26500, remainingOfRow: 26500, rowDate: '2026-12-16' }), [h]).list[0].why).toContain('told');
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankMatch.test.ts`
Expected: FAIL（`Cannot find module '../recitalBankMatch'`）

- [ ] **Step 3: `src/lib/recitalBankMatch.ts` を作る**

- `surnameMatches`：そろえ方 `norm(s)` ＝ NFKC → 空白（半角・全角）を取る → ひらがなをカタカナに → 小さいカナ（ァィゥェォッャュョヮヵヶ）を大きいカナに → 長音（`ー`・`-`。半角の `ｰ` は NFKC で `ー` になる）を取る（Task 5 の `normalizeKana` と同じ考え。銀行の名義は長音が `ｰ` や `-` で出る）。`norm(nameRaw)` が、空でない `norm(姓)` のどれかで始まれば true。`toldName` は NFKC のあと、頭の数字と、Task 4 の区切りの並び（`-‐‑‒–—―−ー・.,、。/`）と空白を外してから `norm` し、`norm(nameRaw)` と同じなら true。`normalizeKana`（csvUtil）そのものは使わない（ヅ/ズを同じにしないため）。
- 下の表と上の試験が食いちがったら、試験が正本（表は順番を見せるための物）。止まって知らせる。
- `decideRow`：`amt = row.remainingOfRow`、`h = row.refRead ? byRef.get(row.refRead) : undefined`。上から見て最初に当たった物を返す（K149）。返す `householdId` は、`auto` でない時も `h` があれば `h.id`（3 と 4 は null）。

| 順 | 条件 | 返す物 |
|---|---|---|
| 0 | `dir≠'in'` か `kind≠'transfer'` | `{ auto:false, reviewKind:null, householdId:null }` |
| 1 | `row.unread` がある | `unread` |
| 2 | `row.source==='manual'` | `manual` |
| 3 | `refRead` が null | `no_ref` |
| 4 | `refOk!==1` か `h` が無い | `bad_ref` |
| 5 | `h.status==='merged'` か `h.view==='none'` | `gone` |
| 6 | `h.remaining===0` | `paid` |
| 7 | `amt < h.remaining` で、`sameRefOpenAmounts` の1つ以上の部分和 ＋ `amt` ＝ `h.remaining` | `sum` |
| 8 | `amt < h.remaining` | `short` |
| 9 | `amt > h.remaining` | `over` |
| 10 | `!surnameMatches(row.nameRaw, h.surnamesKana, h.told?.name ?? null)` | `name` |
| 11 | `row.checkFlag` がある | `reviewKind:null`（印だけで止める。`firstOk` でも止める） |
| 12 | `ctx.first5Done < FIRST5_LIMIT && !ctx.firstOk` | `first5` |
| 13 | ほか | `{ auto:true, householdId:h.id }` |

  `sameRefOpenAmounts` は多くても数件。部分和は全部の組を試してよい（10件をこえたら sum にしない）。
- `candidatesFor`：`amt = row.remainingOfRow`。理由（`why`）の付け方：
  - `ref`：`(row.refRead ?? '') + row.nameRaw` の数字の並び（4けた以上）の中の、4けたの切り出し全部のうち `isValidRef` に合う物が `refCode` の世帯（状態は問わない）。`merged` の世帯なら `mergedInto` の世帯にも `ref`。
  - ここから下は `status='active'` かつ `view≠'none'` の世帯だけ。`told`：`told.amount===amt` かつ `told.date` と `row.rowDate` の差が前後3日以内。`amount`：`remaining===amt`（`amt>0`）。`surname`：`surnameMatches(row.nameRaw, h.surnamesKana, h.told?.name ?? null)`。`sum`：`surname` が付く2世帯で `remaining` の和が `amt`（両方に付ける）。`before_drop`：`totalBeforeLastDrop===amt`。
  - 上に出す（`top`）：`SA` ＝ `amount` と `surname` の両方が付いた世帯。`SA` が1つ → その世帯を `top`。そのとき `ref` の世帯がほかにあれば `notice` ＝「番号とお名前が、別のご家庭を指しています。家庭に確かめてから、押してください」。`SA` が2つ以上 → `told` が付いていて、しかも `told.name` で `surnameMatches` が合う世帯がちょうど1つならその世帯だけ `top`。`notice` ＝「同じ姓・同じ金額のご家庭が ◯つあります。家庭に確かめてから、押してください」（◯は `SA` の数。半角数字）。
  - 並び：`top` → `ref` が付いた世帯 → `why` の数が多い順 → `householdId` の小さい順。10件まで。理由が1つも無い世帯は入れない。
  - 「お名前が合いません」の印は `candidatesFor` では返さない（番号の世帯の `why` に `surname` が無いことで、画面が出す。29）。
  ⚠️ `told` の「近い」（前後3日）と、「合う」（それに名義も）は、この計画で決めた。12/28 のあとの数え直し（U43）で TARO が変えると言えば、ここだけ直す。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankMatch.test.ts`
Expected: PASS

- [ ] **Step 5: 最後の見直し（Fable）**

Fable の見直しの人に渡す物：決まりの紙 2-19 全部、05 5-6 の場面の表 1〜45、この2ファイル。見てもらう所：11個の順、印と `first_ok` の強さの順（印が勝つ）、「姓が合うだけでは当てない」、K203 の並べ方。直しが出たら直してから次へ。

- [ ] **Step 6: コミット**

```bash
git add src/lib/recitalBankMatch.ts src/lib/__tests__/recitalBankMatch.test.ts
git commit -m "feat(bw6): 振込の入金を当てる計算（recitalBankMatch）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: 束を入れる（DB）と入口

**Files:**
- Create: `src/lib/recitalBankDb.ts`
- Create: `src/app/api/staff/recital/bank-rows/route.ts`
- Test: `src/lib/__tests__/recitalBankDb.test.ts`（DB。`file:./data/test_recital_bank.db` を毎回消して作る。`bf7EntryDb.test.ts` 1〜25行の型）
- Test: `src/app/api/staff/recital/bank-rows/__tests__/route.test.ts`

**Interfaces:**
- Consumes:
  - 25 の全部、26 の `decideRow`・`surnameMatches`・`type MatchHousehold`・`type MatchRow`・`type ReviewKind`
  - `readRefFromDesc`（4）、`FIRST5_LIMIT`・`moneySummary`・`householdView`・`type RecitalSettings`（2）
  - `getRecitalEvent`・`getRecitalSettings`・`logChangeTx`（6）
  - `readHouseholdMoneyTx(tx, id): Promise<HouseholdMoney>`・`insertPaymentTx(tx, p: PaymentInput, actor): Promise<{ paymentId; before; after; refundId }>`・`afterMoneyChanged(householdId, 'payment')`（9。`insertPaymentTx` は、守り〔同じ台帳行×同じ世帯の生きているプラスは1つ・1台帳行の合計は行の額まで・0未満を拒む〕と、残りをこえた分の返す分（1番）と、「振り込みました」の印を閉じることと、変えた記録 `payment_recorded` を、全部自分でやる）
  - `sendPaidMail(householdId, paymentId, 'bank', { now, forceWait? })`（10。夜は「待ち」、`bank_paid:<入金id>` の鍵も 10 がやる。`forceWait: true` なら昼でも「待ち」で記録だけして送らない＝朝8時か「待ちのメールを、今出す」で出る）
  - `todayJst`・`shiftDays`・`nowUtcIso`（`@/lib/dateJst`）、`withWriteTx`・`getAll`・`getOne`・`execute`（`@/lib/db`）、`withAuth`（`@/lib/eventAuth`）
- Produces:
  - `type IngestResult`（split ③ に **`flagged: number` を足す**。印だけで止まった行の数。足した名前）
  - `ingestBankBatch(b: BankBatchIn, mode: 'dry' | 'commit', importedBy: string, now?: Date): Promise<IngestResult>`
  - `bankStartDate(eventKey: string, s: RecitalSettings): Promise<string>`（足した名前。声かけの「開始日」と検算5の日。24 の声かけの文もこれを使う）
  - 内部で使う「全世帯の当てる材料をまとめて読む」読み方（28 も使う。export するなら名前は `loadMatchHouseholds(eventKey: string): Promise<MatchHousehold[]>`。足した名前）
  - `POST /api/staff/recital/bank-rows`：入る物 `{ mode: 'dry' | 'commit'; imported_by?: string; batch: BankBatchIn }`、返す物 `IngestResult`（数字と日付と整理番号だけ）

決めごと（この節で決めた）：
- 開始日（`bankStartDate`。**この関数が正本**。24 の声かけもこれを呼ぶ）：台帳の `dir='in'`・`kind='transfer'`・`state<>'void'`・`source IN ('chat','file')` の行の、いちばん新しい `row_date`（手で打った `manual` の行は数えない。数えると次の束が manual の日から始まり、前の chat の行が束に入らず検算4で落ちる）。無ければ「`pay_open_at` と `pay_ok_at` の遅い方の日付」の前の日（`shiftDays(…, -1)`。`pay_ok_at` が空なら `pay_open_at` の前の日。決まりの紙 7-5「最初は『払う』を開ける日の前の日」）。
- 「はじめの5件」の数（`first5Done`）：その発表会の `recital_payments` で `source='bank_auto'` かつ `amount>0` の行の、`bank_transaction_id` の数（取り消しても数は減らさない。④C-12：スタッフが `first5` の行を押して当てた分も `bank_auto` で入る＝28）。
- `check_result`：合った束は `ok`、合わない束は `ng:<M/D>:<円>`（例 `ng:12/16:26500`。開始日で合わない時は円が 0）。`IngestResult.check.near` は `'12月16日の 26,500円の行のあたり'`、円が 0 の時は `'12月14日（期間の開始日）'`。
- `lastOkDate`：`recital_imports` の `kind='statement'`・`source` が `chat|file`・`check_result='ok'` のいちばん新しい `imported_at` の JST の日付。無ければ null。
- 1つの世帯の当てる材料（`MatchHousehold`）：`refCode`＝`ref_code`、`surnamesKana`＝その世帯の人の `last_kana` 全部＋`contact_last_kana`、`told`＝`bank_told_amount` が入っている時だけ、`remaining`・`view` は 2 の `moneySummary`・`householdView` で出す、`totalBeforeLastDrop`＝その世帯の `recital_changes` の `action='total_changed'` で合計が下がった、いちばん新しい行の「前の合計」。全世帯をまとめて読む時は、表ごとに1本の SQL で集めてから計算する（世帯ごとに `readHouseholdMoney` を呼ばない。遅い）。
  ⚠️ `total_changed` の `before`/`after` の形は 8 の `recomputeChargesTx` が書く形に合わせる。読めなければ止まって知らせる。

- [ ] **Step 1: 失敗する試験を書く（DB）**

試験のDBは `bf7EntryDb.test.ts` 1〜25行と同じ作り（`process.env.TURSO_DATABASE_URL = 'file:./data/test_recital_bank.db'`、`initDb()`、台帳SQLを全部流す）。この試験ファイルの中だけの小さい助け（export しない）：
- `seedEvent(eventKey)`：`recital_events` に `is_test=1` の行、設定は `saveRecitalSetting` で `pay_open_at='2026-12-15 12:00'`・`bank_rest_from='2026-12-30'`・`bank_rest_to='2027-01-03'`・`test_mail_to=''`。
- `seedHousehold(eventKey, { ref, lastKana, charges })`：世帯（`ref_code`・48けたの `edit_token`・`contact_last_kana`）・人1人（`last_kana`）・作品1つと `in` の出演・`active` の請求の行。表の NOT NULL の列は 1 の `recitalSchema.ts` を見て埋める。
- 束は 25 の試験と同じ `r()`・`b()` の形。束のいちばん下は、台帳にある行かデビットにする（`last` の印を付けないため）。
- 試験の決まり：この試験ファイルは自分の `t-bank-*` の発表会だけを見る（種の `bw6-test` の行を数に入れない）。

```ts
describe('ingestBankBatch', () => {
  const NOON = new Date('2026-12-16T12:00:00+09:00');
  // ev ごとに seedEvent。A＝2714 ヤマダ 26,500
  it('合う束を commit：台帳に全部入り、5件がたまっていれば、ぴったりの行が自動で当たる', async () => {
    const ev = 't-bank-1'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    const res = await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(res).toMatchObject({ mode: 'commit', check: { ok: true }, read_rows: 5, inserted: 5, existing: 0, rejected: 0, auto_matched: 1 });
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
    const row = await getOne(`SELECT state, match_by, row_date FROM recital_bank_rows WHERE event_key=? AND ref_read='2714'`, [ev]);
    expect(row).toMatchObject({ state: 'matched', match_by: 'auto', row_date: '2026-12-16' });
    const mail = await getOne(`SELECT dedupe_key, status FROM recital_mail_log WHERE household_id=? AND dedupe_key LIKE 'bank_paid:%'`, [A]);
    expect(['sent', 'failed']).toContain(mail?.status); // 昼は待ちにしない（試しの宛先が空なら failed）
  });
  it('同じ束を2回渡しても、行も入金も増えない（束の記録は2行）', async () => {
    const ev = 't-bank-2'; await seedEvent(ev); await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    const bb = { ...b(SAMPLE, { event_key: ev }), first_ok: true };
    await ingestBankBatch(bb, 'commit', 'test', NOON);
    const again = await ingestBankBatch(bb, 'commit', 'test', NOON);
    expect(again).toMatchObject({ inserted: 0, existing: 5, auto_matched: 0 });
    expect((await getOne(`SELECT COUNT(*) n FROM recital_bank_rows WHERE event_key=?`, [ev]))?.n).toBe(5);
    expect((await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE event_key=?`, [ev]))?.n).toBe(1);
    expect((await getOne(`SELECT COUNT(*) n FROM recital_imports WHERE event_key=?`, [ev]))?.n).toBe(2);
  });
  it('合わない束：1行も入れず、束の記録は残る（commit は読んだ行を rejected に）', async () => {
    const ev = 't-bank-3'; await seedEvent(ev);
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, balance: 153001 } : x));
    const res = await ingestBankBatch(b(bad, { event_key: ev }), 'commit', 'test', NOON);
    expect(res.check).toEqual({ ok: false, near: '12月16日の 26,500円の行のあたり', lastOkDate: null });
    expect((await getOne(`SELECT COUNT(*) n FROM recital_bank_rows WHERE event_key=?`, [ev]))?.n).toBe(0);
    expect(await getOne(`SELECT inserted, rejected, read_rows, check_result FROM recital_imports WHERE event_key=?`, [ev]))
      .toMatchObject({ inserted: 0, rejected: 5, read_rows: 5, check_result: 'ng:12/16:26500' });
  });
  it('dry：合えば何も残さない／合わなければ束の記録に日時・source・check_result だけ', async () => {
    const ev = 't-bank-4'; await seedEvent(ev);
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'dry', 'test', NOON);
    expect((await getOne(`SELECT COUNT(*) n FROM recital_imports WHERE event_key=?`, [ev]))?.n).toBe(0);
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, balance: 153001 } : x));
    await ingestBankBatch(b(bad, { event_key: ev }), 'dry', 'test', NOON);
    expect(await getOne(`SELECT read_rows, inserted, shot_on, check_result, source FROM recital_imports WHERE event_key=?`, [ev]))
      .toMatchObject({ read_rows: 0, inserted: 0, shot_on: null, check_result: 'ng:12/16:26500', source: 'chat' });
    expect((await getOne(`SELECT COUNT(*) n FROM recital_bank_rows WHERE event_key=?`, [ev]))?.n).toBe(0);
  });
  it('はじめの5件：first_ok なしの commit では当てず first5 で待つ → はいの束で、待っていた行も当たる', async () => {
    const ev = 't-bank-5'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    const dry = await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'dry', 'test', NOON);
    expect(dry.needs_first_ok).toBe(true);
    expect(dry.first5_rows).toEqual([{ pos: '1-1', ref: '2714', amount: 26500, conditions: [true, true, true, true, true] }, expect.objectContaining({ pos: '1-3', ref: '3657' })]);
    const c1 = await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', NOON);
    expect(c1).toMatchObject({ auto_matched: 0, review: { first5: 1 } });
    expect((await readHouseholdMoney(A)).m.remaining).toBe(26500);
    const c2 = await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(c2).toMatchObject({ inserted: 0, auto_matched: 1 });
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
  });
  it('開始日：manual の 12/19 があっても、chat の 12/18 の日（manual は数えない）／台帳が空なら pay_open_at と pay_ok_at の遅い方の前の日', async () => {
    const ev = 't-bank-sd'; await seedEvent(ev);
    expect(await bankStartDate(ev, await getRecitalSettings(ev))).toBe('2026-12-14');   // pay_open_at 12/15 12:00・pay_ok_at 空
    await saveRecitalSetting(ev, 'pay_open_at', '2026-12-15 12:00', 'test');
    await execute(`INSERT INTO recital_settings (event_key, key, value, created_at) VALUES (?, 'pay_ok_at', '2026-12-17 09:00', ?) ON CONFLICT(event_key,key) DO UPDATE SET value=excluded.value`, [ev, new Date().toISOString()]);
    expect(await bankStartDate(ev, await getRecitalSettings(ev))).toBe('2026-12-16');
    await insertLedgerRow(ev, { row_date: '2026-12-18', source: 'chat' }); await insertLedgerRow(ev, { row_date: '2026-12-19', source: 'manual' });
    expect(await bankStartDate(ev, await getRecitalSettings(ev))).toBe('2026-12-18');
  });
  it('はいの束で、前の束から first5 で待っていて今回の束に写っていない行も当たる（2-23）', async () => {
    const ev = 't-bank-5b'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', NOON);                       // 2714 の 12/16 の行は first5 で待つ
    const day2 = [r('1-1', '12/18', 'in', 5000, 158000, 'transfer', '振込 ﾀﾅｶ ｲﾁﾛｳ'), r('1-2', '12/16', 'in', 26500, 153000, 'transfer', '振込　２７１４　ヤマダ　ハナコ')];
    await ingestBankBatch(b(day2, { event_key: ev }), 'commit', 'test', new Date('2026-12-18T12:00:00+09:00'));   // 開始日は 12/18 になる
    const day3 = [r('1-1', '12/19', 'out', 1000, 157000, 'debit'), r('1-2', '12/18', 'in', 5000, 158000, 'transfer', '振込 ﾀﾅｶ ｲﾁﾛｳ')];  // 2714 の行は写っていない
    const dry = await ingestBankBatch(b(day3, { event_key: ev }), 'dry', 'test', new Date('2026-12-19T12:00:00+09:00'));
    expect(dry.first5_rows?.map((x) => x.ref)).toContain('2714');                                         // 台帳の first5 の行は全部見せる
    await ingestBankBatch({ ...b(day3, { event_key: ev }), first_ok: true }, 'commit', 'test', new Date('2026-12-19T12:00:00+09:00'));
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
  });
  it('出金・デビットは新しい束の行で入れかえる／振込の入金は入れかえない', async () => {
    const ev = 't-bank-6'; await seedEvent(ev);
    // 1日目：12/16 デビット 1,000（残高 125,500）と、いちばん下に 12/15 デビット 500（残高 126,500）
    await ingestBankBatch({ ...b([r('1-1', '12/16', 'out', 1000, 125500, 'debit'), r('1-2', '12/15', 'out', 500, 126500, 'debit')], { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    await insertLedgerRow(ev, { row_date: '2026-12-16', source: 'manual', dir: 'in', kind: 'transfer', amount: 3000, balance: null });
    // 2日目：同じ 12/16 のデビットが 1,200（残高 125,300）で出た。いちばん下は台帳にある 12/15 の行
    await ingestBankBatch({ ...b([r('1-1', '12/16', 'out', 1200, 125300, 'debit'), r('1-2', '12/15', 'out', 500, 126500, 'debit')], { event_key: ev }), first_ok: true }, 'commit', 'test', new Date('2026-12-17T12:00:00+09:00'));
    const rows = await getAll(`SELECT amount, dir, source, state FROM recital_bank_rows WHERE event_key=? AND row_date='2026-12-16' ORDER BY id`, [ev]);
    expect(rows).toEqual([
      { amount: 1000, dir: 'out', source: 'chat', state: 'void' },
      { amount: 3000, dir: 'in', source: 'manual', state: 'new' },
      { amount: 1200, dir: 'out', source: 'chat', state: 'new' },
    ]);
  });
  it('1/4 に渡した束の 12/29 の行は 2026年', async () => {
    const ev = 't-bank-7'; await seedEvent(ev);
    await ingestBankBatch(b([r('1-1', '12/29', 'out', 1000, 152000, 'debit'), r('1-2', '12/28', 'out', 500, 153000, 'debit')], { event_key: ev }), 'commit', 'test', new Date('2027-01-04T09:00:00+09:00'));
    expect((await getAll(`SELECT row_date FROM recital_bank_rows WHERE event_key=? ORDER BY row_date`, [ev])).map((x) => x.row_date)).toEqual(['2026-12-28', '2026-12-29']);
  });
  it('当てる順は古い順：同じ番号 26,500 が同じ日に2件 → 下（古い）の 1-2 が自動、上の 1-1 は paid（場面3）', async () => {
    const ev = 't-bank-8'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    await insertLedgerRow(ev, { row_date: '2026-12-15', dir: 'out', kind: 'debit', amount: 1000, balance: 127000, source: 'chat' }); // 1-3 と同じ行（row_key は buildRowKey で作る）
    const rows = [
      r('1-1', '12/16', 'in', 26500, 180000, 'transfer', '振込 2714 ヤマダ ハナコ'),
      r('1-2', '12/16', 'in', 26500, 153500, 'transfer', '振込 2714 ヤマダ ハナコ'),
      r('1-3', '12/15', 'out', 1000, 127000, 'debit'),
    ];
    await ingestBankBatch({ ...b(rows, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    const got = await getAll(`SELECT balance, state, match_by, review_kind FROM recital_bank_rows WHERE event_key=? AND dir='in' ORDER BY balance`, [ev]);
    expect(got).toEqual([
      { balance: 153500, state: 'matched', match_by: 'auto', review_kind: null },
      { balance: 180000, state: 'new', match_by: null, review_kind: 'paid' },
    ]);
    expect((await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id=?`, [A]))?.n).toBe(1);
  });
  it('手で打った行と日付・金額が同じ行 → 両方に manual_twin、新しい行は当てない（場面35）', async () => {
    const ev = 't-bank-9'; await seedEvent(ev); await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    await insertLedgerRow(ev, { row_date: '2026-12-16', source: 'manual', dir: 'in', kind: 'transfer', amount: 26500, balance: null, desc_raw: '振込 2714 ヤマダ ハナコ' });
    const res = await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(res.auto_matched).toBe(0); expect(res.flagged).toBeGreaterThanOrEqual(1);
    expect((await getAll(`SELECT check_flag FROM recital_bank_rows WHERE event_key=? AND row_date='2026-12-16' AND dir='in'`, [ev])).map((x) => x.check_flag)).toEqual(['manual_twin', 'manual_twin']);
  });
  it('いちばん下が新しい振込の入金 → last、当てない、flagged に数える（場面34）', async () => {
    const ev = 't-bank-10'; await seedEvent(ev); await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    const res = await ingestBankBatch({ ...b([r('1-1', '12/16', 'out', 1000, 152500, 'debit'), r('1-2', '12/16', 'in', 26500, 153500, 'transfer', '振込 2714 ヤマダ ハナコ')], { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(res).toMatchObject({ auto_matched: 0, flagged: 1 });
    expect((await getOne(`SELECT check_flag FROM recital_bank_rows WHERE event_key=? AND dir='in'`, [ev]))?.check_flag).toBe('last');
  });
  it('夜 21:30 に当たった → メールの記録は waiting', async () => {
    const ev = 't-bank-11'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', new Date('2026-12-16T21:30:00+09:00'));
    expect((await getOne(`SELECT status FROM recital_mail_log WHERE household_id=? AND dedupe_key LIKE 'bank_paid:%'`, [A]))?.status).toBe('waiting');
  });
  it('1つの束で当たった行が10件をこえたら、11件目からのメールは waiting（関数は60秒まで）', async () => {
    const ev = 't-bank-12'; await seedEvent(ev);
    const refs = await twelveRefs();                       // 試験の中の小さな関数：pickRef で検査に合う番号を12個
    const hs = [] as number[]; for (const ref of refs) hs.push(await seedHousehold(ev, { ref, lastKana: 'ヤマダ', charges: [26500] }));
    // 新しい順に12行（残高は下から 26,500 ずつふえる）＋いちばん下にデビット1行
    const rows = refs.map((ref, i) => r(`1-${i + 1}`, '12/16', 'in', 26500, 126500 + 26500 * (12 - i), 'transfer', `振込 ${ref} ヤマダ ハナコ`)).concat(r('1-13', '12/15', 'out', 1000, 126500, 'debit'));
    await ingestBankBatch({ ...b(rows, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    const st = (await getAll(`SELECT status FROM recital_mail_log WHERE event_key=? AND dedupe_key LIKE 'bank_paid:%'`, [ev])).map((x) => x.status);
    expect(st).toHaveLength(12);
    expect(st.filter((x) => x === 'waiting')).toHaveLength(2);
  });
  it('返す物に名義が入らない', async () => {
    const res = await ingestBankBatch(b(SAMPLE, { event_key: 't-bank-1' }), 'dry', 'test', NOON);
    expect(JSON.stringify(res)).not.toMatch(/ヤマダ|ﾔﾏﾀﾞ/);
  });
});
```

（`insertLedgerRow(ev, over)` は試験の中の小さな関数：台帳に1行を SQL で入れる。初めの値は `dir='in'`・`kind='transfer'`・`amount=26500`・`balance=150000`・`source='chat'`・`state='new'`、`row_key` は 25 の `buildRowKey` で作る。`twelveRefs()` は 4 の `pickRef` で検査に合う番号を12個作る。）

- [ ] **Step 2: 入口の試験を書く**

`route.test.ts`（`withdrawal-export/__tests__/route.test.ts` と同じ型。`@/lib/eventAuth` と `@/lib/recitalBankDb` を `vi.mock`）：

```ts
it('スタッフでなければ 401', async () => { isAuthorized.mockResolvedValueOnce(false); expect((await POST(req({}))).status).toBe(401); });
it('mode が dry/commit でない・形が合わない → 400、ingestBankBatch を呼ばない', async () => {
  expect((await POST(req({ mode: 'x', batch: goodBatch }))).status).toBe(400);
  expect((await POST(req({ mode: 'dry', batch: { ...goodBatch, source: 'x' } }))).status).toBe(400);
  expect(ingestBankBatch).not.toHaveBeenCalled();
});
it('合えば ingestBankBatch(batch, mode, imported_by) の結果をそのまま返す', async () => {
  ingestBankBatch.mockResolvedValueOnce(result);
  const res = await POST(req({ mode: 'commit', imported_by: 'Claude', batch: goodBatch }));
  expect(res.status).toBe(200);
  expect(ingestBankBatch).toHaveBeenCalledWith(expect.objectContaining({ event_key: goodBatch.event_key }), 'commit', 'Claude');
  expect(await res.json()).toEqual(result);
});
it('発表会が無い → 404', async () => { ingestBankBatch.mockRejectedValueOnce(new Error('no_event')); expect((await POST(req({ mode: 'dry', batch: goodBatch }))).status).toBe(404); });
```

- [ ] **Step 3: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankDb.test.ts`
Expected: FAIL（`Cannot find module '../recitalBankDb'`）
Run: `npx vitest run src/app/api/staff/recital/bank-rows/__tests__/route.test.ts`
Expected: FAIL（`Cannot find module '../route'`）

- [ ] **Step 4: `ingestBankBatch` と `bankStartDate` を `src/lib/recitalBankDb.ts` に作る**

流れ（この順。決まりの紙 2-17・2-18・2-19・2-23）：

1. `getRecitalEvent(b.event_key)` が null なら `throw new Error('no_event')`。`now ??= new Date()`、`handed = todayJst(now)`、`s = await getRecitalSettings(b.event_key)`。
2. 台帳（`state<>'void'`）を `LedgerRowLite[]` で読む。`startDate = await bankStartDate(...)`。
3. `rows = normalizeBatch(b, handed)` → `check = checkBatch(b, rows, ledger, { startDate })`。
4. 合わない時：
   - `dry`：`recital_imports` に1行（`kind='statement'`・`source`・`check_result`・`imported_by`・`imported_at=nowUtcIso(now)`、`read_rows`・`inserted`・`existing`・`rejected` は 0、`shot_on`〜`images` は NULL）。
   - `commit`：`recital_imports` に1行（束の列は全部入れる。`read_rows=rows.length`・`inserted=0`・`existing=0`・`rejected=rows.length`）。
   - 返す：`check: { ok:false, near, lastOkDate }`、`join_mismatch`（`joinMismatch` の台帳の行の `{ date: row_date, amount }`）、数は全部 0（`read_rows` だけ `rows.length`）。**台帳・入金には何も書かない。**
5. 合う時の分け方：鍵が台帳にある行 → `existing`。ない行 → 新しい行（`flagRows` で印を付ける）。入れかえる行：台帳の、入金の振込でない行（`dir='out'` か `kind<>'transfer'`）のうち、`row_date` が「束のいちばん下の行の日付」より後で、束の新しい行の最大の日付まで、しかも鍵が束に無い物。
   ⚠️ いちばん下の日付の日は入れかえない（いちばん下の行は「1行多く」写しただけで、その日の行が全部写っていないことがあるため）。
6. `dry`：書かない。新しい行と、束の中の `first5` で待っていた行について、下の 7 の当て方を**記憶の中だけで**まねる（自動で当たった世帯の残りは、その場で減らして次の行を見る）。`first_ok` は付けずに見る。返す：`inserted`（入るはずの数）・`existing`・`auto_matched`・`review`・`flagged`・`needs_first_ok`（`first5Done < FIRST5_LIMIT` で、5つの条件がそろい印の無い行が1つでもある）・`first5_rows`（`first5Done < FIRST5_LIMIT` の時だけ。新しい入金の振込の行と、**台帳で `review_kind='first5'`・`state='new'` の行の全部**〔この束に写っていない行も〕の `{ pos, ref: refRead, amount, conditions:[①,②,③,④,⑤] }`。束に写っていない行の `pos` は `'ledger-<id>'`。5つは `decideRow` と同じ見方で数える。TARO はこの並びを見て「はい」を返す）。
7. `commit`：
   - 1回の `withWriteTx` で：`recital_imports` に1行（`read_rows=rows.length`・`inserted`・`existing`・`rejected=0`・束の列・`check_result='ok'`）、新しい行を**下（古い）から順に** INSERT（`id` が古い順にふえる。`import_id`・`state='new'`・`check_flag`）、入れかえる行を `state='void'`・`memo='入れかえ'`・`decided_by='system'`・`decided_at`、`manual_twin` が付いた新しい行の相手の `manual` の行にも `check_flag='manual_twin'`、`logChangeTx`（`action='bank_imported'`、`after` は数だけ。名義・金額を入れない）。`read_rows ≠ inserted+existing+rejected` なら throw（3-7）。
   - 当てる行：新しく入った入金の振込の行＋（`first_ok` の時だけ）台帳で `state='new'`・`review_kind='first5'` の行の全部（この束に写っていない行も。決まりの紙 2-23「前から first5 で待っていた行も」）。`row_date` が古い順、同じ日は `id` が小さい順。
   - 1行ごとに `withWriteTx`：行を読み直す（`state` が `new` でなければとばす）→ のこり（行の額 − その行の入金の合計）→ `first5Done` を数える → 番号の世帯の材料（残りは `readHouseholdMoneyTx` で読み直す）→ `sameRefOpenAmounts`（同じ `ref_read` の、入金の振込で `state` が `new`/`hold` の、ほかの行ののこり）→ `decideRow(row, byRef, { first5Done, firstOk: b.first_ok === true, sameRefOpenAmounts })`。
     - 自動なら `insertPaymentTx(tx, { householdId, method:'bank', amount: のこり, paidOn: row_date, source:'bank_auto', confirmedBy: b.first_ok ? 'TARO' : null, bankRowId, bankDate: row_date, bankDesc: desc_raw, payerNameRaw: readRefFromDesc(desc_raw).nameRaw }, 'system')`、行を `state='matched'`・`match_by='auto'`・`review_kind=NULL`。
     - 自動でなければ `review_kind` を書く（印だけの行は NULL）。
   - 書き込みの外で、当たった行ごとに `sendPaidMail(householdId, paymentId, 'bank', { now, forceWait: その場で送った数 >= 10 })` → `afterMoneyChanged(householdId, 'payment')`。その場で送るのは先頭の10通まで、残りは「待ち」で記録して朝8時（と 8:05・8:10 の追い打ち）か 29 の「待ちのメールを、今出す」に任せる（Gmail の送り口は1通ごとにつなぎ直して1〜3秒かかる。関数は60秒まで。年末の休み明けに当たる行が20〜30件になる）。メールが失敗しても、続ける（入金は記録ずみ）。
   - 返す：数と `review`（種類ごと）と `flagged` と `needs_first_ok`（`first5` で待たせた行があれば true）。
8. **返す物に、名義・摘要・世帯の名前・残高を入れない**（K146）。整理番号・金額・日付・`pos` は返してよい。
9. 止めた催促をその場で出す（K211）は、ここでは作らない（後の計画）。

- [ ] **Step 5: 入口 `src/app/api/staff/recital/bank-rows/route.ts` を作る**

- 頭に `export const dynamic = 'force-dynamic'; export const runtime = 'nodejs'; export const maxDuration = 60;`。頭のコメントに「呼ぶのは scripts/recital_bank_push.mjs（読む役）。返すのは数字だけ。⚠️ proxy は cookie の有無しか見ないので withAuth で本検証（規約4.5）」。
- `export const POST = withAuth(async (req) => …)`：`mode` が `dry|commit` でなければ 400。`validateBatchShape(body.batch)` が ng なら 400（`{ error }`）。`imported_by` は 40字まで、無ければ `'chat'`。`ingestBankBatch` を呼んで `NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })`。`Error('no_event')` は 404、ほかは 500（`{ error: 'failed' }`。中身を返さない）。

- [ ] **Step 6: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankDb.test.ts`
Expected: PASS
Run: `npx vitest run src/app/api/staff/recital/bank-rows/__tests__/route.test.ts`
Expected: PASS

- [ ] **Step 7: 最後の見直し（Fable）**

渡す物：決まりの紙 2-17・2-18・2-19・2-23、05 5-6、この3ファイル。見てもらう所：合わない束で台帳と入金に1行も書かないこと、`dry` で書かないこと、1行ごとに残りを読み直していること、`first_ok` の行の範囲（台帳の `first5` の行の全部）、その場で送るメールが10通までであること、返す物に名義が無いこと、入れかえの範囲。

- [ ] **Step 8: コミット**

```bash
git add src/lib/recitalBankDb.ts src/lib/__tests__/recitalBankDb.test.ts src/app/api/staff/recital/bank-rows/route.ts src/app/api/staff/recital/bank-rows/__tests__/route.test.ts
git commit -m "feat(bw6): 入金の束を入れる入口と自動で当てる処理

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 28: 見てほしい入金のボタンと、入金の取り消し

**Files:**
- Modify: `src/lib/recitalBankDb.ts`（27 で作った物に足す）
- Modify: `src/app/staff/bw6/entries/[id]/page.tsx`・`src/app/staff/bw6/entries/[id]/actions.ts`（19 で作った物。入金の行に「この入金を取り消す」を足すだけ）
- Test: `src/lib/__tests__/recitalBankDb.test.ts`（27 の試験に `describe` を足す。`event_key` は `t-bank-b<番号>` で分ける）

**Interfaces:**
- Consumes: 26 の `decideRow`・`candidatesFor`・`surnameMatches`、27 の当てる材料の読み方、9 の `insertPaymentTx`・`readHouseholdMoneyTx`・`afterMoneyChanged`、10 の `sendPaidMail`・`cancelWaitingMailsTx(tx, paymentId)`、6 の `logChangeTx`・`loadHouseholdDetail`、16 の `requireRecitalStaff`・`StaffNamePicker`
  - 印をもどすのに読むのは、9 の `insertPaymentTx` が書く `action='payment_recorded'` の記録だけ：`after.paymentId`＝この入金の行の `before.told`（`{ at, date, amount, by }`）。名義は記録に無い（R-18）。
- Produces（split ③ の名前のまま）:
  - `type ReviewRowView`（中身はこの節で決めた。足した名前）：
    ```ts
    type ReviewRowView = {
      group: 'review' | 'no_candidate' | 'closed';
      rowId: number; rowDate: string; amount: number; leftover: number; isLeftover: boolean;
      nameRaw: string | null; state: 'new' | 'hold' | 'matched' | 'not_recital' | 'void';
      reviewKind: ReviewKind | null; checkFlag: 'twin' | 'last' | 'manual_twin' | null;
      flagPair: { rowId: number; rowDate: string; amount: number; source: string } | null;
      refRead: string | null; refHouseholdId: number | null; nameMismatch: boolean;
      candidates: (Candidate & { refCode: string; contactName: string; remaining: number })[];
      notice: string | null; memo: string | null;
      overInfo: { paidOn: string; totalChangedAt: string | null; sameDay: boolean } | null;
    };
    ```
    （残高 `balance` は持たせない。`closed` の行は `rowId`・`rowDate`・`amount`・`state` のほかは空）
  - `listReviewRows(eventKey): Promise<ReviewRowView[]>`
  - `assignBankRow(rowId, alloc: { householdId: number; amount: number }[], opts: { sendRemaining: boolean; confirmFlag: boolean }, staffName): Promise<{ paymentIds: number[] }>`
  - `setBankRowState(rowIds: number[], state: 'not_recital' | 'hold' | 'void', memo: string | null, staffName): Promise<void>`
  - `restoreBankRow(rowId, reason, staffName): Promise<void>`
  - `mergeManualRow(manualRowId, newRowId, staffName): Promise<void>`
  - `cancelBankPayment(paymentId, reason: 'wrong_household' | 'misread', staffName): Promise<{ ok: boolean; code?: 'refund_done' | 'negative' }>`
  - 世帯の画面の Server Action `cancelBankPaymentAction(formData: FormData)`（足した名前）
  - 失敗は `throw new Error(<語>)`。語は `not_found`・`bad_state`・`bad_alloc`・`confirm_flag`・`merged`・`has_payment`・`key_taken`・`reason_required`・`already_cancelled`、と 9 から上がってくる `recital_money:row_over`・`recital_money:live_exists`・`recital_money:negative`（画面が日本語の文に直す。`row_over`・`live_exists` は「ほかの人が、いま同じ入金を当てました。画面を開き直してください」）。`assignBankRow` は、書き込みの中で行の `state` とのこりを読み直してから当てる（2人が同時に押した時、あとの方はここか 9 の守りで止まる）

- [ ] **Step 1: 失敗する試験を書く**

```ts
describe('見てほしい入金のボタン', () => {
  // 世帯：A=2714 ヤマダ、B=3657 スズキ、C=5188 タナカ。はじめの5件は first_ok の束で済ませてから始める
  it('5 金額が少ない：一部として当てる。あと◯円を送るを選ぶと remaining のメール', async () => {
    // A は 32,500。26,500 の行（short）
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], { sendRemaining: true, confirmFlag: false }, 'KEIKO');
    expect((await readHouseholdMoney(A)).m.remaining).toBe(6000);
    expect(await mailKinds(A)).toContain('remaining');
  });
  it('5 送らないを選ぶと remaining のメールは出ない', async () => {
    // A2 は 32,500。26,500 の行（short）
    await assignBankRow(row2, [{ householdId: A2, amount: 26500 }], { sendRemaining: false, confirmFlag: false }, 'KEIKO');
    expect(await mailKinds(A2)).not.toContain('remaining');
  });
  it('7 金額が多い：全額が入金、こえた 6,000 はしくみの返す分（source_payment_id 付き）', async () => {
    const { paymentIds } = await assignBankRow(row32500, [{ householdId: A, amount: 32500 }], { sendRemaining: false, confirmFlag: false }, 'KEIKO');
    expect(await getOne(`SELECT amount, status, reason_no, source_payment_id FROM recital_refunds WHERE household_id=?`, [A]))
      .toMatchObject({ amount: 6000, status: 'todo', reason_no: 1, source_payment_id: paymentIds[0] });
  });
  it('4 足すとぴったり：1回押すと両方当たり、メールは1通（新しい方の入金の鍵）', async () => {
    const { paymentIds } = await assignBankRow(row26500, [{ householdId: A, amount: 26500 }], { sendRemaining: false, confirmFlag: false }, 'KEIKO');
    expect(paymentIds).toHaveLength(2);
    expect(await bankPaidMailKeys(A)).toEqual([`bank_paid:${Math.max(...paymentIds)}`]);
  });
  it('9 2つの世帯に分ける：合計が行の額でなければ通さない／合えば入金2行', async () => {
    await expect(assignBankRow(row53000, [{ householdId: A, amount: 26500 }, { householdId: B, amount: 20000 }], o, 'KEIKO')).rejects.toThrow('bad_alloc');
    expect((await assignBankRow(row53000, [{ householdId: A, amount: 26500 }, { householdId: B, amount: 26500 }], o, 'KEIKO')).paymentIds).toHaveLength(2);
  });
  it('36 分けた片方を取り消す：行は matched のまま、のこり 26,500 の行として出る。全額では当てられない', async () => {
    await cancelBankPayment(payB, 'wrong_household', 'KEIKO');
    const v = (await listReviewRows(ev)).find((x) => x.rowId === row53000);
    expect(v).toMatchObject({ state: 'matched', isLeftover: true, leftover: 26500 });
    await expect(assignBankRow(row53000, [{ householdId: C, amount: 53000 }], o, 'KEIKO')).rejects.toThrow('bad_alloc');
    await assignBankRow(row53000, [{ householdId: C, amount: 26500 }], o, 'KEIKO');
  });
  it('29 取り消し：マイナスの行・台帳の行は new・残りがもどる・自動のメールは出ない／そのあと別の世帯に当て直せる', async () => {
    const before = await mailCount(A);
    expect(await cancelBankPayment(payA, 'wrong_household', 'KEIKO')).toEqual({ ok: true });
    expect(await getOne(`SELECT amount FROM recital_payments WHERE household_id=? ORDER BY id DESC LIMIT 1`, [A])).toMatchObject({ amount: -26500 });
    expect(await rowState(row)).toBe('new');
    expect(await mailCount(A)).toBe(before);
    await assignBankRow(row, [{ householdId: C, amount: 26500 }], o, 'KEIKO');
  });
  it('37 取り消した入金に返す分（todo）→ cancelled／もう返した（done）→ refund_done で何も変えない', async () => {
    // A は 26,500。32,500 の行を当てる → 返す分 6,000（todo・source_payment_id＝その入金）
    const { paymentIds: [p1] } = await assignBankRow(row32500, [{ householdId: A, amount: 32500 }], o, 'KEIKO');
    await cancelBankPayment(p1, 'wrong_household', 'KEIKO');
    expect(await getOne(`SELECT amount, status FROM recital_refunds WHERE source_payment_id=?`, [p1])).toEqual({ amount: 6000, status: 'cancelled' });
    // 別の世帯 D（26,500）に 32,500 の行を当て、返す分を done にしてから取り消す
    const { paymentIds: [p2] } = await assignBankRow(row32500b, [{ householdId: D, amount: 32500 }], o, 'KEIKO');
    await execute(`UPDATE recital_refunds SET status='done' WHERE source_payment_id=?`, [p2]);
    const n = (await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id=?`, [D]))?.n;
    expect(await cancelBankPayment(p2, 'wrong_household', 'KEIKO')).toEqual({ ok: false, code: 'refund_done' });
    expect((await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id=?`, [D]))?.n).toBe(n);
  });
  it('払った額が 0 未満になる取り消し → negative', async () => {
    // E に 26,500 の行を当てたあと、手で −26,500 の調整（打ちまちがいの打ち消し）が入っている
    const { paymentIds: [p] } = await assignBankRow(rowE, [{ householdId: E, amount: 26500 }], o, 'KEIKO');
    await recordManualPayment(E, { method: 'adjust', amount: -26500, paidOn: '2026-12-16', memo: '打ちまちがい' }, 'KEIKO');
    expect(await cancelBankPayment(p, 'wrong_household', 'KEIKO')).toEqual({ ok: false, code: 'negative' });
    expect(await rowState(rowE)).toBe('matched');
  });
  it('misread で取り消して、同じ世帯に同じ額で当て直す → メールの記録がふえない', async () => {
    const n = await mailCount(A);
    await cancelBankPayment(payA, 'misread', 'KEIKO');
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect(await mailCount(A)).toBe(n);
  });
  it('取り消すと「振り込みました」の印がもどる（at・date・amount・by が同じ。名義は空）', async () => {
    const at0 = '2026-12-15T01:00:00.000Z';
    await execute(`UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-15', bank_told_name='2714 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [at0, F]);
    const { paymentIds: [p] } = await assignBankRow(rowF, [{ householdId: F, amount: 26500 }], o, 'KEIKO');
    expect((await getOne(`SELECT bank_told_at FROM recital_households WHERE id=?`, [F]))?.bank_told_at).toBeNull();
    await cancelBankPayment(p, 'wrong_household', 'KEIKO');
    expect(await getOne(`SELECT bank_told_at, bank_told_date, bank_told_amount, bank_told_by, bank_told_name FROM recital_households WHERE id=?`, [F]))
      .toEqual({ bank_told_at: at0, bank_told_date: '2026-12-15', bank_told_amount: 26500, bank_told_by: 'family', bank_told_name: null });
  });
  it('夜に当てて待ちになったメールは、取り消すと cancelled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-16T22:00:00+09:00'));
    const { paymentIds: [p] } = await assignBankRow(rowG, [{ householdId: G, amount: 26500 }], o, 'KEIKO');
    expect((await getOne(`SELECT status FROM recital_mail_log WHERE dedupe_key=?`, [`bank_paid:${p}`]))?.status).toBe('waiting');
    await cancelBankPayment(p, 'wrong_household', 'KEIKO');
    expect((await getOne(`SELECT status FROM recital_mail_log WHERE dedupe_key=?`, [`bank_paid:${p}`]))?.status).toBe('cancelled');
    vi.useRealTimers();
  });
  it('印のある行は confirmFlag なしでは当てない', async () => { await expect(assignBankRow(lastRow, [{ householdId: A, amount: 26500 }], { sendRemaining: false, confirmFlag: false }, 'KEIKO')).rejects.toThrow('confirm_flag'); });
  it('first5 の行を番号の世帯に当てる → source は bank_auto（はじめの5件に数える）', async () => {
    const ev = 't-bank-b5'; await seedEvent(ev); const H5 = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', new Date('2026-12-16T12:00:00+09:00'));   // first_ok なし → first5
    const row = (await getOne(`SELECT id FROM recital_bank_rows WHERE event_key=? AND review_kind='first5'`, [ev]))!.id;
    await assignBankRow(Number(row), [{ householdId: H5, amount: 26500 }], o, 'KEIKO');
    expect(await getOne(`SELECT source, confirmed_by FROM recital_payments WHERE household_id=?`, [H5])).toEqual({ source: 'bank_auto', confirmed_by: 'KEIKO' });
  });
  it('発表会ではない：名義が消える／もとにもどす：理由が要る、名義は空のまま', async () => {
    await setBankRowState([row], 'not_recital', null, 'KEIKO');
    expect(await getOne(`SELECT desc_raw, desc_norm, state FROM recital_bank_rows WHERE id=?`, [row])).toMatchObject({ desc_raw: null, desc_norm: null, state: 'not_recital' });
    await expect(restoreBankRow(row, '', 'KEIKO')).rejects.toThrow('reason_required');
    await restoreBankRow(row, '押しまちがい', 'KEIKO');
    expect(await getOne(`SELECT desc_raw, state FROM recital_bank_rows WHERE id=?`, [row])).toMatchObject({ desc_raw: null, state: 'new' });
  });
  it('当てた入金がある行は 読みまちがい・発表会ではない にできない', async () => { await expect(setBankRowState([matchedRow], 'void', null, 'KEIKO')).rejects.toThrow('has_payment'); });
  it('35 同じ入金にする：manual の行は void、当てた入金は新しい行へ付けかわる、メールは出ない', async () => {
    const ev = 't-bank-b35'; await seedEvent(ev); const H = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    const man = await insertLedgerRow(ev, { source: 'manual', amount: 26500, row_date: '2026-12-16', balance: null, desc_raw: '振込 2714 ヤマダ ハナコ' });
    const { paymentIds: [p] } = await assignBankRow(man, [{ householdId: H, amount: 26500 }], o, 'KEIKO');
    const n = await mailCount(H);
    const neu = await insertLedgerRow(ev, { source: 'chat', amount: 26500, row_date: '2026-12-16', desc_raw: '振込 2714 ヤマダ ハナコ', check_flag: 'manual_twin' });
    await mergeManualRow(man, neu, 'KEIKO');
    expect(await rowState(man)).toBe('void');
    expect(await getOne(`SELECT state, check_flag FROM recital_bank_rows WHERE id=?`, [neu])).toEqual({ state: 'matched', check_flag: null });
    expect(Number((await getOne(`SELECT bank_transaction_id t FROM recital_payments WHERE id=?`, [p]))?.t)).toBe(neu);
    expect(await mailCount(H)).toBe(n);
  });
  it('listReviewRows：残高を返さない・保留の行も出る・候補0は no_candidate・外した行は closed', async () => {
    const rows = await listReviewRows(ev);
    expect(rows.every((x) => !('balance' in x))).toBe(true);
  });
  it('listReviewRows は開くたびに種類を計算し直して書く（世帯が作品を足して残りが 32,500 になると、26,500 の行は over から short に変わる）', async () => {
    const ev = 't-bank-b20'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [20000] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 2714 ヤマダ ハナコ' });
    await listReviewRows(ev);
    expect((await getOne(`SELECT review_kind k FROM recital_bank_rows WHERE id=?`, [row]))?.k).toBe('over');
    await addCharge(A, 12500);                      // 合計 32,500 にする（試験の中の小さな関数。base の行を1つ足す）
    await listReviewRows(ev);
    expect((await getOne(`SELECT review_kind k FROM recital_bank_rows WHERE id=?`, [row]))?.k).toBe('short');
  });
  // ── 場面の表（5-6）で、ほかの試験に無かった物
  it('6 振込手数料ぶん少ない：short を「送らない」で当て → 差を手で調整 → 残り0 → メールはこの1通だけ（complete）', async () => {
    const ev = 't-bank-b6'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26060, desc_raw: '振込 2714 ヤマダ ハナコ' });
    await assignBankRow(row, [{ householdId: A, amount: 26060 }], { sendRemaining: false, confirmFlag: false }, 'KEIKO');
    expect(await mailKinds(A)).toEqual([]);
    const { paymentId } = await recordManualPayment(A, { method: 'adjust', amount: 440, paidOn: '2026-12-16', memo: '振込手数料ぶん' }, 'KEIKO');
    await sendPaidMail(A, paymentId, 'adjust');
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
    expect(await mailKinds(A)).toEqual(['complete']);
  });
  it('8 払い済みの世帯に 26,500 → 当てると全額が返す分1番・確認のメールは出ない', async () => {
    const ev = 't-bank-b8'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    await recordManualPayment(A, { method: 'cash', amount: 26500, paidOn: '2026-12-15', memo: '' }, 'KEIKO');
    const before = await mailCount(A);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 2714 ヤマダ ハナコ' });
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect(await getOne(`SELECT amount, reason_no FROM recital_refunds WHERE household_id=? AND status='todo'`, [A])).toMatchObject({ amount: 26500, reason_no: 1 });
    expect(await bankPaidMailKeys(A)).toEqual([]);
    expect(await mailCount(A)).toBe(before);
  });
  it('10・44 出演なしの世帯に当てても、返す分は自動で作らず、メールも0通', async () => {
    const ev = 't-bank-b10'; await seedEvent(ev); const N = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [], cast: 'out' });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 2714 ヤマダ ハナコ' });
    await assignBankRow(row, [{ householdId: N, amount: 26500 }], o, 'KEIKO');
    expect((await getOne(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id=?`, [N]))?.n).toBe(0);
    expect(await mailCount(N)).toBe(0);
  });
  it('11 まとめた世帯の番号で来た入金 → まとめ先を選んで当てて残り0', async () => {
    const ev = 't-bank-b11'; await seedEvent(ev);
    const into = await seedHousehold(ev, { ref: '1007', lastKana: 'ヤマダ', charges: [26500] });
    const from = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [] });
    await execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [into, from]);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 2714 ヤマダ ハナコ' });
    await expect(assignBankRow(row, [{ householdId: from, amount: 26500 }], o, 'KEIKO')).rejects.toThrow('merged');
    await assignBankRow(row, [{ householdId: into, amount: 26500 }], o, 'KEIKO');
    expect((await readHouseholdMoney(into)).m.remaining).toBe(0);
  });
  it('28「振り込みました」26,500 のあと作品を足して合計 32,500 → 26,500 の行は short、当てたあと残り 6,000', async () => {
    const ev = 't-bank-b28'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [32500] });
    await execute(`UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-15', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [new Date().toISOString(), A]);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 2714 ヤマダ ハナコ' });
    expect((await listReviewRows(ev)).find((x) => x.rowId === row)?.reviewKind).toBe('short');
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect((await readHouseholdMoney(A)).m.remaining).toBe(6000);
  });
  // ── 2人が同時に押す（Review Focus）
  it('同じ行を A と B に全額ずつ同時に当てる → 1つだけ通り、もう片方は row_over か bad_state で、入金は1行', async () => {
    const ev = 't-bank-bc1'; await seedEvent(ev);
    const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] }); const B = await seedHousehold(ev, { ref: '3657', lastKana: 'スズキ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 ヤマダ ハナコ' });
    const rs = await Promise.allSettled([assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'TARO'), assignBankRow(row, [{ householdId: B, amount: 26500 }], o, 'KEIKO')]);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const err = rs.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(['row_over', 'bad_state', 'recital_money:row_over']).toContain(String(err.reason.message));
    expect((await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE bank_transaction_id=?`, [row]))?.n).toBe(1);
  });
  it('同じ行を同じ世帯に2回 → 2回目は live_exists か bad_state、メールは1通', async () => {
    const ev = 't-bank-bc2'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '2714', lastKana: 'ヤマダ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 2714 ヤマダ ハナコ' });
    const rs = await Promise.allSettled([assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'TARO'), assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO')]);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await bankPaidMailKeys(A)).toHaveLength(1);
  });
});
```

`mailKinds(hid)`（その世帯の `recital_mail_log.mail_kind` の一覧）・`bankPaidMailKeys(hid)`・`mailCount(hid)`・`rowState(rowId)`・`o`（`{ sendRemaining:false, confirmFlag:false }`）・`addCharge(hid, n)` は、この試験ファイルの中だけの小さい助け（export しない）。`insertLedgerRow` は 27 の試験と同じ物（`desc_raw` を渡せば `ref_read`・`ref_ok` も 4 の `readRefFromDesc` で入れる）。`seedHousehold` の `cast: 'out'` は出演なしの世帯（27 の助けに足す）。`row`・`row2`・`row32500`・`row32500b`・`row26500`・`row53000`・`rowE`・`rowF`・`rowG`・`lastRow`・`matchedRow` と世帯 `A`・`A2`・`B`・`C`・`D`・`E`・`F`・`G` は、`describe` の頭の `beforeAll` で `t-bank-b1` に作る（番号はそれぞれ検査に合う物。金額は試験の名前のとおり）。

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankDb.test.ts`
Expected: FAIL（`assignBankRow is not a function` ほか）

- [ ] **Step 3: `listReviewRows` を作る**

- 出す行：入金の振込の行（`dir='in'`・`kind='transfer'`）で、`state` が `new`/`hold`、または `matched` でのこり（行の額 − その行の入金の合計）が 0 より大きい行 → `group` は候補があれば `review`、無ければ `no_candidate`。`state` が `not_recital`/`void` の入金の振込の行 → `group='closed'`（日付と金額だけ）。
- 世帯の材料は 27 のまとめ読みを1回。行ごとに `decideRow`（`firstOk=false`、`first5Done` は 27 と同じ数え方）を呼び、`auto:true` が返ったら `first5` として扱う（条件はそろっているが、自動で当てなかった行のため）。結果が前とちがえば `review_kind` を UPDATE（1回の `batch` で）。**ここで入金は作らない**（K147）。
- `candidatesFor` の結果に、世帯の `ref_code`・連絡する人の名前（`contact_last_name`＋`contact_first_name`）・今の残りを足す。`nameMismatch` は番号の世帯があって `surnameMatches` が合わない時 true。
- `flagPair`：`twin` は 25 の `twin` と同じ見方で見つけた台帳の行、`manual_twin` は相手の行（どちらの行にも出す）。
- `overInfo`：`reviewKind='over'` の行と、しくみの返す分がある世帯の行に、`paidOn`＝明細の日付、`totalChangedAt`＝その世帯の合計が下がった、いちばん新しい変えた記録の日時、`sameDay` は2つの JST の日付が同じ。
- 並び：`group` の順（review → no_candidate → closed）、その中は `row_date` の古い順。

- [ ] **Step 4: `assignBankRow` を作る**

1つの `withWriteTx` で：
1. 行を読む（無ければ `not_found`、入金の振込でなければ `bad_state`）。`state` が `new`/`hold` か、`matched` でのこりがある時だけ（ほかは `bad_state`）。
2. `alloc` は1つか2つ。どれも `amount>0`。合計がのこりと同じでなければ `bad_alloc`。2つに分けるのは、のこりが行の額と同じ時だけ（のこりの行は1世帯だけ。`bad_alloc`）。
3. `check_flag` があって `confirmFlag` が false なら `confirm_flag`。世帯が `merged` なら `merged`。
4. その行の今の種類を 26 の `decideRow` で出し直す。`sum` で、選んだ世帯が番号の世帯なら、同じ `ref_read` の決まっていない行のうち、足して残りになる組も、同じ書き込みで当てる（古い順）。
5. 世帯ごとに `insertPaymentTx(tx, { householdId, method:'bank', amount, paidOn: row_date, source, confirmedBy: staffName, bankRowId, bankDate: row_date, bankDesc: desc_raw, payerNameRaw }, staffName)`。`source` は、行の今の種類が `first5`（または 3 の `auto:true`）で、1世帯に全額を、番号の世帯へ当てる時だけ `'bank_auto'`（はじめの5件に数える。④C-12）、ほかは `'bank_staff'`。
6. 行：`state='matched'`、`match_by`（`source` が `bank_auto` なら `'auto'`、ほか `'staff'`）、`review_kind=NULL`、`decided_by`・`decided_at`。`logChangeTx`（`action='bank_row_decided'`、`after: { rowId, householdId, amount }`。名義を入れない）。
7. メールを出さない世帯を決める：その世帯の、いちばん新しい `action='payment_cancelled'` の変えた記録が `reason='misread'` で、同じ額で、そのあとに振込のプラスの入金がまだ無い時（K202）。
書き込みの外で：メールを出す世帯ごとに `sendPaidMail(householdId, その世帯で新しい方の paymentId, 'bank', { sendRemaining: opts.sendRemaining })`、全部の世帯に `afterMoneyChanged(householdId, 'payment')`。

- [ ] **Step 5: `setBankRowState`・`restoreBankRow`・`mergeManualRow` を作る**

- `setBankRowState`：どの行も入金の振込の行で、生きている入金（その行の入金の合計 > 0）が無いこと（あれば `has_payment`）。`not_recital` は `desc_raw`・`desc_norm` を NULL（日付・金額・残高・鍵は残す）。`hold` はメモを入れる。`void` は鍵から外れる。どれも `decided_by`・`decided_at`、`logChangeTx`（`bank_row_decided`、`after: { rowId, state }`）。1回の `withWriteTx`。
- `restoreBankRow`：`reason` が空なら `reason_required`。`state` が `not_recital`/`hold`/`void` の時だけ（ほかは `bad_state`）。`void` からもどす時に、同じ `row_key` の生きている行がもうあれば `key_taken`。`state='new'`。名義は空のまま（`not_recital` からもどした行）。変えた記録に理由。
  ⚠️ 名義を打ち直す欄は、この計画では作らない（もどした行は、自動ではもう当たらないので、スタッフは探す欄から世帯を選んで当てる）。打ち直しが要ると TARO が言えば後の計画。
- `mergeManualRow`：`manualRowId` は `source='manual'`・`state<>'void'`、`newRowId` は `source` が `chat|file`、日付・入出・金額が同じ、`newRowId` に生きている入金が無いこと（ちがえば `bad_state`）。1回の `withWriteTx` で、`manualRowId` の入金の行（マイナスの行もふくむ）の `bank_transaction_id`・`bank_date`・`bank_desc`・`payer_name_raw` を新しい行の物に付けかえる → 新しい行に `manual` の行の `state`・`match_by` を写す → `manual` の行は `void` → 両方の `check_flag` を NULL → 変えた記録。メールは出さない。

- [ ] **Step 6: `cancelBankPayment` を作る**

1つの `withWriteTx` で（決まりの紙 2-24「まちがって当てたとき」、K200・K202）：
1. 入金の行を読む。`method='bank'`・`amount>0`・`bank_transaction_id` があること（ちがえば `bad_state`）。同じ台帳の行×同じ世帯の合計が 0 以下なら `already_cancelled`。
2. `source_payment_id` がこの入金の返す分に `done` があれば、何も書かずに `{ ok:false, code:'refund_done' }`。`todo` は `cancelled` にして、`logChangeTx`（`refund_cancelled`）。
3. `insertPaymentTx(tx, { householdId, method:'bank', amount: -元の額, paidOn: todayJst(), source:'bank_staff', confirmedBy: staffName, bankRowId: 同じ台帳の行, memo: 理由の言葉 }, staffName)`。払った額が 0 未満になると 9 が拒む → `{ ok:false, code:'negative' }`（書き込みはまき戻る）。
4. 台帳の行：その行の入金の合計が 0 なら `state='new'`・`match_by=NULL`、0 より大きければ `matched` のまま。
5. 「振り込みました」の印：9 が書いた `action='payment_recorded'` で `after.paymentId`＝この入金の記録の `before.told` が null でなければ、`bank_told_at`・`bank_told_date`・`bank_told_amount`・`bank_told_by` をその値にもどす。`bank_told_name` は記録に無いので NULL のまま（決まりの紙 2-24「名義がもう消してあれば空のまま」と同じ扱い。家庭がもう一度押すか、スタッフが入れる）。その世帯に、もう新しい印が開いていれば、もどさない。
6. `cancelWaitingMailsTx(tx, paymentId)`（待ちのメールは「取りやめ」）。
7. `logChangeTx`（`action='payment_cancelled'`、`reason` に `'wrong_household'` か `'misread'`、`after: { paymentId, amount }`）。
書き込みの外で `afterMoneyChanged(householdId, 'payment')`。**メールは出さない。**

- [ ] **Step 7: 世帯の画面に「この入金を取り消す」を足す**

`src/app/staff/bw6/entries/[id]/page.tsx` の入金の行のうち、`method='bank'`・`amount>0` で、まだ取り消していない行の横にだけ出す。押すと：理由のラジオ2つ（「ちがう世帯に当てた」／「読みまちがいを直すため（同じ世帯に当て直す）」。選ばないと押せない）＋`StaffNamePicker`＋確かめの文。`actions.ts` の `cancelBankPaymentAction(formData)`：頭で `requireRecitalStaff()` → `cancelBankPayment(...)`。`refund_done` の時は「この入金から、もう ◯円を返しています。先に、TARO に知らせてください」（◯円は `loadHouseholdDetail` の返す分で `source_payment_id` がこの入金・`done` の合計）。`negative` の時は「払った額が 0 円より少なくなるため、取り消せません。作る人に知らせてください」。

- [ ] **Step 8: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankDb.test.ts`
Expected: PASS

- [ ] **Step 9: 最後の見直し（Fable）**

渡す物：決まりの紙 2-19・2-20・2-24、K200・K202・K205・K214・K216、05 5-6 の場面 4〜15・29・35〜37・45、このタスクの差分。見てもらう所：1台帳行の合計が行の額をこえないこと、2人が同時に押した時に1つだけ通ること、取り消しで返す分・印・待ちのメールがそろって片づくこと、misread のメールの止め方、`first5` の数え方。

- [ ] **Step 10: コミット**

```bash
git add src/lib/recitalBankDb.ts src/lib/__tests__/recitalBankDb.test.ts "src/app/staff/bw6/entries/[id]/page.tsx" "src/app/staff/bw6/entries/[id]/actions.ts"
git commit -m "feat(bw6): 見てほしい入金のボタンと、入金の取り消し

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 29: 見てほしい入金と、入金の取り込みの画面

**Files:**
- Modify: `src/lib/recitalBankDb.ts`（`listToldWaiting`・`listImports` を足す）
- Create: `src/app/staff/bw6/bank/page.tsx`・`src/app/staff/bw6/bank/actions.ts`
- Create: `src/app/staff/bw6/bank/import/page.tsx`・`src/app/staff/bw6/bank/import/actions.ts`
- Test: `src/lib/__tests__/recitalBankDb.test.ts`（`describe` を足す）

**Interfaces:**
- Consumes: 25 の `parseGmoStatementCsv`・`validateBatchShape`、27 の `ingestBankBatch`、28 の `listReviewRows`・`assignBankRow`・`setBankRowState`・`restoreBankRow`・`mergeManualRow`、10 の `flushWaitingMails(eventKey, now?, limit?)`・`countRecitalMailsToday(now?)`、16 の `requireRecitalStaff`・`StaffNamePicker`・`searchHouseholds`（候補に無い家庭を探して選ぶ）・`pickStaffEventKey`・`bankToldWaitDue(toldAtUtc, nowMs, restFrom, restTo)`（3日の数え方はこれだけ。ここで書き直さない）、2 の `BANK_TOLD_WAIT_DAYS`・`MAIL_SEND_FROM`・`MAIL_SEND_UNTIL`、`@/components/StaffPageHeader`
- Produces:
  - `listToldWaiting(eventKey: string, now?: Date): Promise<HouseholdRow[]>`
  - `listImports(eventKey: string): Promise<ImportRow[]>`（`recital_imports` の列そのまま。新しい順）
  - Server Actions（足した名前）：`/staff/bw6/bank/actions.ts` に `assignAction`・`splitAction`・`setStateAction`・`restoreAction`・`mergeManualAction`（世帯の画面の「世帯をまとめる」と名前を分ける）、`/staff/bw6/bank/import/actions.ts` に `manualEntryAction`・`fileImportAction`・`flushWaitingAction`

- [ ] **Step 1: 失敗する試験を書く**

```ts
describe('listToldWaiting（「振り込みました」のまま3日）', () => {
  it('2/5 に押した → 2/7 の朝は出ない、2/8 の朝に出る', async () => {
    // bank_told_at = 2027-02-05T03:00:00Z（JST 2/5 昼）、残り 26,500
    expect(await listToldWaiting(ev, new Date('2027-02-07T08:00:00+09:00'))).toHaveLength(0);
    expect((await listToldWaiting(ev, new Date('2027-02-08T08:00:00+09:00'))).map((h) => h.id)).toEqual([A]);
  });
  it('12/30〜1/3 は数えない（12/29 に押した → 1/6 に出る）', async () => {
    expect(await listToldWaiting(ev2, new Date('2027-01-05T08:00:00+09:00'))).toHaveLength(0);
    expect(await listToldWaiting(ev2, new Date('2027-01-06T08:00:00+09:00'))).toHaveLength(1);
  });
  it('残りが 0 の世帯・印が閉じた世帯は出ない', async () => {
    // ev の世帯 A に 26,500 の行を当てる（9 が印を閉じ、残りも 0）
    await assignBankRow(await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 2714 ヤマダ ハナコ' }), [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect(await listToldWaiting(ev, new Date('2027-02-08T08:00:00+09:00'))).toHaveLength(0);
  });
});
describe('listImports', () => {
  it('新しい順。dry の合わなかった行もふくむ', async () => {
    const ev = 't-bank-imp'; await seedEvent(ev);
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', new Date('2026-12-16T12:00:00+09:00'));
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, balance: 153001 } : x));
    await ingestBankBatch(b(bad, { event_key: ev }), 'dry', 'test', new Date('2026-12-17T12:00:00+09:00'));
    expect((await listImports(ev)).map((x) => x.check_result)).toEqual(['ng:12/16:26500', 'ok']);
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankDb.test.ts`
Expected: FAIL（`listToldWaiting is not a function`）

- [ ] **Step 3: `listToldWaiting`・`listImports` を作る**

- `listToldWaiting`：`bank_told_amount` が入っていて、残りが 0 より大きい世帯（`status='active'`）のうち、`bankToldWaitDue(bank_told_at, now.getTime(), s.bank_rest_from, s.bank_rest_to)` が true の物（16 の関数。最初の画面の見てほしいことの4番と同じ数え方）。並びは `bank_told_at` の古い順。
- `listImports`：`event_key` の `recital_imports` を `imported_at` の新しい順に全部。

- [ ] **Step 4: `/staff/bw6/bank` を作る**

- ファイルの頭に `export const maxDuration = 60;`（Server Action の当てる処理がふつうの時間で切れないように）。頭で `requireRecitalStaff()`。発表会の選び方は 16 の `/staff/bw6` と同じ（16 の決まりに合わせる。ちがう形が要りそうなら止まって知らせる）。`StaffPageHeader`（title「見てほしい入金」、`backHref='/staff/bw6'`）。色は `brand-*`/`navy-*`/`sand-*`。
- 上から：①「振り込みましたのまま3日」の世帯の一覧（整理番号・連絡する人・聞いたお振込みの日・お名前・金額。`listToldWaiting`）②`group='review'` の行（カード。日付・金額〔のこりの行は「のこり ◯円が、まだ当たっていません」〕・名義・種類の言葉〔決まりの紙 6-6 の表の言葉〕・印の文・保留のメモ・`overInfo`〔「入金の日 ◯月◯日／合計が変わった日 ◯月◯日 ◯時」、`sameDay` なら「家庭に確かめる」〕・`nameMismatch` なら「お名前が合いません」・`notice` の文・候補〔ラジオ。**どれも初めは選ばない**。整理番号・連絡する人・今の残り・どこが合っているか〕・探す欄〔`searchHouseholds`。候補に無い家庭を選ぶ〕・ボタン）③`group='no_candidate'` の行（チェックボックス＋まとめて「発表会ではない」）④`group='closed'` の行（たたむ。日付と金額だけ・「もとにもどす」）。**残高と、出金の行は出さない。**
- 印の文（このまま）：`twin`「台帳に、残高が同じ行があります（◯月◯日・◯円）。同じ入金なら、読みまちがいにする」（◯は `flagPair`）、`last`「いちばん下の行です。金額を、明細で確かめてください」、`manual_twin`「手で打った行と、同じ入金かもしれません」（相手の行と2つ並べ、「同じ入金にする」を置く）。
- ボタン：「この世帯に当てる」（`short` の時だけ「あと ◯円の知らせを送る／送らない」を選ぶ。印のある行は印の文を出して1回確かめてから `confirmFlag: true`）、「2つの世帯に分ける」（世帯2つと金額。初めの値はそれぞれの今の残り。合計が行の額と同じでないと押せない）、「発表会ではない」（押す前に「名義を消します。もどしても、名義は空のままです」）、「保留」（メモ。「家庭の名前・口座は、書かない」と欄の下に書く）、「読みまちがいにする」、「もとにもどす」（理由の欄）、「同じ入金にする」。のこりの行は「この世帯に当てる」だけ。どれも押す前に `StaffNamePicker` で名前を選ぶ。
- Server Action はどれも頭で `requireRecitalStaff()`、終わったら `revalidatePath('/staff/bw6/bank')`。投げられた語（28）を日本語に直して画面に出す。
- 入力欄（金額・メモ・理由・探す欄）は、文字の色と下地の色を両方書く（例 `text-navy-900 bg-white`）。スマホの幅では1行を1枚のカードにする。

- [ ] **Step 5: `/staff/bw6/bank/import` を作る**

- ファイルの頭に `export const maxDuration = 60;`（ファイルの取り込みの Server Action のため）。
- 右上に小さく「今日の送信 N通」（`countRecitalMailsToday()`。`warn` なら赤で「（上限に近いです）」）。
- 「はい」の束に写っていない `first5` の行も、「はい」で当たる（27 の決まり）。それでも残った `first5` の行は、見てほしい入金で人が当てる（`bank_auto` で数える）と、この画面の下に1行書く。
- 上に「いちばん新しい合った束」：`listImports` のうち `check_result='ok'` で `source` が `chat|file` の、いちばん新しい `imported_at`（JST で出す。手で打った束は数えない）。
- 束の一覧（新しい順）：入れた日時／どこから（チャット／手で打った／ファイル）／期間（`range_from`〜`range_to`）／読んだ・新しく入った・もうあった・はじいた数／検算（合った／合わない＋「◯月◯日のあたり」。**金額は出さない**）／だれが渡したか。
- 手で打つ欄：日付（年月日）・金額・残高・名義の4つ。4つとも入れないと押せない。`StaffNamePicker`。`manualEntryAction`：`{ event_key, source:'manual', shot_on: todayJst(), range_from: 日付, range_to: 日付, images: 0, account:'円普通預金', rows:[{ pos:'m-1', date, dir:'in', amount, balance, kind:'transfer', desc: 名義, cut:false, unread:'' }] }` を `validateBatchShape` → `ingestBankBatch(batch, 'commit', 名前)`。結果の数を出す（「手で打った行は、自動では当たりません。見てほしい入金で当ててください」）。
- 明細のファイル：`<input type="file" accept=".csv">`＋`StaffNamePicker`。`fileImportAction`：`File` → `Uint8Array` → `parseGmoStatementCsv` → `{ source:'file', shot_on: todayJst(), range_from: いちばん古い行の日付, range_to: いちばん新しい行の日付, images: 0, account:'円普通預金', rows }` → `validateBatchShape`（行が `BANK_BATCH_MAX_ROWS` をこえたら「月ごとに分けて入れてください」）→ `ingestBankBatch(batch, 'commit', 名前)`。合わなければ「◯月◯日のあたりが合いません」。
- 「待ちのメールを、今出す」：`StaffNamePicker`。JST の今が `MAIL_SEND_FROM`〜`MAIL_SEND_UNTIL` の外ならボタンを押せない形にし、`flushWaitingAction` でもサーバでもう一度確かめてから `flushWaitingMails(eventKey)`。結果「◯通出しました（失敗 ◯通）」。
- この画面にも、残高と出金の行は出さない。入力欄は文字色と下地色を両方。総点検のくらべる所と「総点検を済みにする」は後の計画。

- [ ] **Step 6: 通ることと画面を確かめる**

Run: `npx vitest run src/lib/__tests__/recitalBankDb.test.ts`
Expected: PASS
画面（M5 で、計画の頭の「手元の画面の確かめ」のとおり手元のファイルDBで `npm run dev`。M1 では回さない）：`bw6-test` で 12/8 の通し試しの束を入れ、`/staff/bw6/bank` に種類と候補が出る・候補が選ばれていない・残高が出ない・スマホの幅（375px）でカードになる・4つの入力欄に打った字が見える、を目で見る。

- [ ] **Step 7: コミット**

```bash
git add src/lib/recitalBankDb.ts src/lib/__tests__/recitalBankDb.test.ts src/app/staff/bw6/bank/page.tsx src/app/staff/bw6/bank/actions.ts src/app/staff/bw6/bank/import/page.tsx src/app/staff/bw6/bank/import/actions.ts
git commit -m "feat(bw6): 見てほしい入金と入金の取り込みの画面

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 30: 読む役のスクリプトと手順書

**Files:**
- Create: `scripts/recital_bank_push.mjs`
- Create（アプリの外・別のリポジトリ）: `~/BOOM/boom-events-hub/docs/bw6-bank-read.md`
- Modify（アプリの外）: `~/claude-shared/memory/-Users-kimurashintarou/MEMORY.md`（`~/.claude/projects/-Users-kimurashintarou/memory` のリンク先）
- Test: `src/lib/__tests__/recitalBankBatch.test.ts`（25 の `validateBatchShape` の試験に、手順書の見本の束を足す）

**Interfaces:**
- Consumes: `validateBatchShape`（25）、`POST /api/staff/recital/bank-rows`（27）、`IngestResult`（27）
- Produces: `node scripts/recital_bank_push.mjs <batch.json> --mode dry|commit [--prod]`、環境変数 `RECITAL_BASE_URL`（足した名前。無ければ `https://bw5-app.vercel.app`）

- [ ] **Step 1: 失敗する試験を書く**

手順書に載せる見本の束（架空。番号は 4827、名前はヤマダ ハナコ、金額は料金表の額）を、そのまま `validateBatchShape` に通す試験を 25 の試験ファイルに足す。

```ts
it('手順書の見本の束は形が合う', () => {
  const sample = { event_key: 'bw6', source: 'chat', shot_on: '2026-12-16', range_from: '2026-12-14', range_to: '2026-12-16', images: 1, account: '円普通預金',
    rows: [{ pos: '1-1', date: '12/16', dir: 'in', amount: 26500, balance: 100000, kind: 'transfer', desc: '振込　４８２７　ヤマダ　ハナコ', cut: false, unread: '' },
           { pos: '1-2', date: '12/15', dir: 'out', amount: 1000, balance: 73500, kind: 'debit', desc: '', cut: false, unread: '' }] };
  expect(validateBatchShape(sample).ok).toBe(true);
});
```

Run: `npx vitest run src/lib/__tests__/recitalBankBatch.test.ts`
Expected: PASS（25 ができていれば通る。通らなければ見本か 25 のどちらかが決まりとずれている → 止まって知らせる）

- [ ] **Step 2: `scripts/recital_bank_push.mjs` を作る**

作りは `scripts/bf7_ws_match_transfers.mjs` と同じ（10分の入場券→呼ぶ→`finally` で消す）。
- 引数：1つ目が束の JSON のパス。`--mode dry|commit` は必ず（無ければ使い方を出して `exit 1`）。`--prod` があれば `.env.production.local` を読み、送り先は `process.env.RECITAL_BASE_URL || 'https://bw5-app.vercel.app'`。無ければ手元（`http://localhost:3000`、入場券を入れる DB は `file:./data/bw6_dev.db`＝計画の頭の「手元の画面の確かめ」で dev サーバが見ている DB。`.env.local` は本番の DB を指しているので読まない）。
- 送る前に `validateBatchShape` で形を確かめる。`.ts` の部品は `@/` の import をふくむので、node だけでは読めない。`jiti`（node_modules にある 2.6.1。間接の依存）で読む：`createJiti(import.meta.url, { alias: { '@': <src の絶対パス> } })` → `await jiti.import('../src/lib/recitalBankBatch.ts')`。⚠️ `jiti` が無い・読めない時は、止まって知らせる（自分で別の読み方を作らない）。
- `admin_sessions` に `token`（`randomUUID()`）・`expires_at`（10分後）を入れる → `POST <BASE>/api/staff/recital/bank-rows`（`Cookie: staff_events_auth=<token>`、本文 `{ mode, imported_by: 'Claude（読む役）', batch }`）→ `finally` で消す。
- 出す物は数字だけ（名義・摘要は出さない。`IngestResult` に入っていないので、そのまま並べればよい）：
  ```
  検算：合った ／ 合わない（12月16日の 26,500円の行のあたり。最後に合った束：12月15日）
  新しく入る行 3 ／ もうある行 4 ／ 自動で当たる 1 ／ 印で止めた 0
  見てほしい入金：番号が無い 1、はじめの5件 1
  はいが要る束：はい
    1-1 番号 2714 26,500円 条件 ①○②○③○④○⑤○
  つなぎ目が合わない台帳の行：12月15日 6,000円
  ```
- 終わりの数：合った → 0、合わない → 2、ほかのエラー → 1。

- [ ] **Step 3: スクリプトを手元で確かめる**

M5 で、計画の頭の「手元の画面の確かめ」のとおり `TURSO_DATABASE_URL=file:./data/bw6_dev.db TURSO_AUTH_TOKEN= SKIP_DB_INIT=0 npm run dev` を立て、`bw6-test` の見本の束（`event_key` を `bw6-test` に変えた物）で：
Run: `node scripts/recital_bank_push.mjs /tmp/sample.json --mode dry`
Expected: 「検算：合った」と数が出る。名義（ヤマダ）が1文字も出ない。終わったあと `data/bw6_dev.db` の `admin_sessions` に入場券が残っていない（`SELECT COUNT(*) FROM admin_sessions WHERE expires_at > datetime('now')` が前と同じ）。401 が返ったら、入場券を入れた DB と dev サーバの DB がちがう（止まって知らせる）。
（M1 では dev を立てない。本番 `--prod` での確かめは、12/8 の通し試しの手順で行う）

- [ ] **Step 4: 手順書 `~/BOOM/boom-events-hub/docs/bw6-bank-read.md` を書く**

先に `git -C ~/BOOM/boom-events-hub pull --rebase`。中身（決まりの紙 2-17・2-18・2-22・2-23 の写し。言いかえない）：
1. 何のための紙か（2行）と、これを読む時（「BW6 入金のスクショが来た時」）。
2. 読む役がやること（4つ）と、やらないこと（2-17 の箇条書きのまま）。
3. 渡す形：束と行の表（2-17 の2つの表）、見本の束（Step 1 と同じ JSON）、決まり（重ねて撮った行は両方写す・いちばん下の1行多く・年は付けない・読めない所は `unread`・**入金の振込の行の `desc` は、画面の摘要を頭の「振込」から終わりまで、空白もそのまま写す〔名義をふくむ。番号を切り出さない。4 の `readRefFromDesc` は頭の「振込」を前提にしている〕**・出金とデビットは `desc` を空にする・メモのらんと、**出金の**相手の名前は写さない〔決まりの紙 2-17〕）。
4. 渡し方：束を JSON に書いて `node scripts/recital_bank_push.mjs <束.json> --mode dry --prod` → 結果を数字のまま TARO に見せる → 合っていれば `--mode commit --prod`。はいが要る束は、TARO の「はい」を待って、束に `"first_ok": true` を足して `commit`。
5. 合わなかった時（2-18 の6つのまま）と、つなぎ目だけ合わない時（スタッフの画面で前の行を「読みまちがいにする」→ 同じ束をもう一度。自分では直さない）。
6. TARO の手順（2-22 の「TARO がやること」3行）。
7. チャットが止まった日の道（`/staff/bw6/bank/import` の手で打つ欄とファイル）。
実在の残高・入金・名前・口座番号を書かない（例は 4827・ヤマダ ハナコ・料金表の額だけ）。

```bash
git -C ~/BOOM/boom-events-hub add docs/bw6-bank-read.md
git -C ~/BOOM/boom-events-hub commit -m "docs: BW6 入金のスクショを読む役の手順書

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C ~/BOOM/boom-events-hub push
```

- [ ] **Step 5: 全セッションの記憶に1行足す**

`~/claude-shared/memory/-Users-kimurashintarou/MEMORY.md` の Memory Index の「BW6プロジェクトメインセッション参照」の行の下に、1行だけ足す（同期はフックが自動でやる。ほかの行は変えない）：

```
- 🔴BW6 の入金のスクショが来たら、手順書（`~/BOOM/boom-events-hub/docs/bw6-bank-read.md`）のとおりに写して渡すだけ。チャットの中で当てない・メールを送らない・データベースに直接書かない
```

- [ ] **Step 6: コミット（アプリ）**

```bash
git add scripts/recital_bank_push.mjs src/lib/__tests__/recitalBankBatch.test.ts
git commit -m "feat(bw6): 読む役が入金の束を入口に渡すスクリプト

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 後の計画へ（1行）
見回り①・イ・②と催促・取り込みが古い朝の止め方（止めた回を commit の時に出す K211 もふくむ）、週1のまとめ、家族を足す・全部やめる、イントラのページ、MOCCHIN の読み込み、カードの異議の自動記録、返金を記録・返す分を作る・出演とりやめ・この世帯は待つ、お金の画面、総点検（くらべる画面・`file_seen`・日付の直し・「総点検を済みにする」）、2/8〜の声かけ、名義を消すスクリプト。

---

### 足した名前

| 名前 | 置き場 | 中身 |
|---|---|---|
| `BANK_BATCH_MAX_ROWS = 400` | `src/lib/recitalBankBatch.ts` | 1つの束の行の上限（60秒に入れるため。こえたら月ごとに分ける） |
| `IngestResult.flagged: number` | `src/lib/recitalBankDb.ts` | 印（`twin`/`last`/`manual_twin`）だけで止まった行の数（`review` は11個の種類しか持てないため） |
| `bankStartDate(eventKey, s): Promise<string>` | `src/lib/recitalBankDb.ts` | 開始日の正本（台帳のいちばん新しい振込の入金〔chat・file だけ〕の日。無ければ `pay_open_at` と `pay_ok_at` の遅い方の前の日）。検算5と 24 の声かけの文で使う |
| `loadMatchHouseholds(eventKey): Promise<MatchHousehold[]>` | `src/lib/recitalBankDb.ts` | 全世帯の当てる材料をまとめて読む（27・28 が使う） |
| `ReviewRowView` の中身 | `src/lib/recitalBankDb.ts` | split ③ に名前だけあった型の列（28 の Interfaces の型） |
| `cancelBankPaymentAction(formData)` | `src/app/staff/bw6/entries/[id]/actions.ts` | 「この入金を取り消す」の Server Action |
| `assignAction`・`splitAction`・`setStateAction`・`restoreAction`・`mergeManualAction` | `src/app/staff/bw6/bank/actions.ts` | 見てほしい入金のボタンの Server Action |
| `manualEntryAction`・`fileImportAction`・`flushWaitingAction` | `src/app/staff/bw6/bank/import/actions.ts` | 入金の取り込みの画面の Server Action |
| `RECITAL_BASE_URL` | 環境変数（スクリプトだけ） | `--prod` の送り先。無ければ `https://bw5-app.vercel.app` |
| 投げる語 `no_event`・`not_found`・`bad_state`・`bad_alloc`・`confirm_flag`・`merged`・`has_payment`・`key_taken`・`reason_required`・`already_cancelled` | `recitalBankDb.ts` の `Error.message` | 画面と入口が日本語の文・HTTP の数に直す |

---


---

## 作る前に止まって聞く物

作ることは止めない。TARO に頼む物は、まとめて1回で、押すボタンが1〜2個の形にして頼む。

**TARO に頼む物**
1. **Stripe の試しの鍵と、試しの受け口の登録**（9-2 ①）：`STRIPE_TEST_SECRET_KEY` と、Stripe の試しのモードに `/api/recital/stripe-test-webhook`（`checkout.session.completed`・`checkout.session.expired`）を登録して出る `STRIPE_TEST_WEBHOOK_SECRET`。Vercel に入れる所まで Claude がやり、TARO はログインと承認だけ（Task 22 の終わり）。無いあいだは 21・22 の手での確かめを飛ばして知らせる。
2. **本番の少額の試し**（9-2 ②）：`bw6-smoke` の額・だれが払うか・あとで返すか。12/13 の種（Task 11）に要る。LINE の中のブラウザからも1回。
3. **BW6 用の振込先**（11月中）と、できれば 12/4（金）までの試しの振込（名義の頭に 4827）・そのスクショ1回・明細ファイル1回（U41・U42・U44・U55）。Task 4 の摘要の読み方・Task 25 の `parseGmoStatementCsv`・Task 30 の読む役の決まりがこれで確かめられる。形がちがえば、その関数と手順書だけ直す。
4. **G-13（本番で「払う」を開けてよいか）**：12/8（火）の通し試し2のあと1回。返事までは `pay_ok_at` を入れない（Task 18 の「支払いを開ける」は、返事・少額の試し・〔`bank_text` が空なら〕カードだけでよい、の印が要る）。
5. **12/8（火）に決めてもらう物**：Task 15（マイページの「作品を足す・やめる」）と Task 20（世帯をまとめる・特別な料金ボタン・照合を決める）を 12/15 に出すか。メールの文（お振込みのご案内・控えの「次のご連絡は 2月ごろ」）を見てもらう。
6. **12/13（日）までに固まる文**：同意の文 `consent_items`・使い道の知らせ `privacy_text`（SNS の1行入り）・公式LINE の URL `line_url`・Tシャツの一覧（T7。12/1 までに無ければ `tshirt_sizes` を空にして欄を出さない）。3つの文が空のままだと「受付を開ける」が止まる（Task 6 の `setSuspended`）。

**作る人が調べてから決める物（TARO に聞かない。分からなければ止まって知らせる）**
7. U5：Gmail の1日の送信上限 → `RECITAL_MAIL_DAILY_WARN` をその8割に（分からなければ 400）。U2・U3 も同じ時に（Task 10）。
8. U12：本番の `boom_members.birthday` の形ごとの件数（読むだけ）→ `normalizeBirthday` の形（Task 5）。
9. U38：`charge.refunded`・`charge.dispute.*` に発表会の印が乗るか（段階1は受領だけ返す。Task 22）。
10. 同時20件の申込の合格の線（通し試し1の前に決めて 8-5 に書く。Task 7）。
11. 12/28（月）のあとの数え直し（U43・U48）で、「振り込みました」の「近い」（前後3日）と5つの数を見直す（Task 26）。

---

## 段階2以降の計画へ回した物

毎朝の見回り①・イ・②と催促・取り込みが古い朝の止め方（止めた回を commit の時に出す K211 もふくむ）、週1のまとめ（12/21〜）、家族を足す・全部やめる（12/22）、イントラのページ、MOCCHIN の読み込み、カードの異議の自動記録と `charge.*` の扱い、返金を記録・返す分を作る・出演とりやめ（返す分4番）・この世帯は待つ、お金の画面、総点検（くらべる画面・`file_seen`・日付の直し・「総点検を済みにする」）、2/8〜の声かけと 2/12 からの総点検の文、名義を消すスクリプト、名義を打ち直す欄。

---

## 見直しの指摘の扱い（2026-11-12 の見直し 66 件）

直した：63 件。内わけ（重い物から）：
- 「振り込みました」の印を戻す記録の形（3件の重なり）→ Task 9 の `payment_recorded.before.told` だけを正本にし、23・28 をそれに合わせた。名義は戻さない（R-18）。
- マイページの URL（3件の重なり）→ Task 2 の `RECITAL_PUBLIC_ORIGIN`・`recitalMyUrl` に1本化（10・14・19・21）。
- 変更の控えの二重・URL の送り直しの二重・`afterMoneyChanged` をだれが呼ぶか → 送る・呼ぶのは 7・8・9 の中だけ、呼ぶ側は呼ばない、と Interfaces に書いた。
- 手元の `npm run dev` が本番DBを向く・手元の `migrate.mjs` が流れない・種のファイル名の順 → 上の「手元の画面の確かめ」「出す手順」と `20261114_recital_seed_test.sql` に直した。
- 出演なしの世帯へのメール、場面6・8・10・11・28 の試験、カード×振込の二重の試験、読む役の「出金の」相手の名前、空の試験（9・10・20・22・27・28 は値を入れ、残りの短い書き方は上の決まりで埋める）。
- そのほか：開始日の決め方の1本化（`bankStartDate`）、料金の規則の守り（`entry_opened`）、文が空なら開けない（`privacy_empty`・`line_empty`）、調整のマイナス、送信数の印、はじめの5件（前の束の待ちも当てる）、返す分のカード優先、`buildEntryFeePeople`・`dryRun`、`QuotePerson` の漢字の名前、`checkSettingValue` の1本化、`WorkInput` の形、`updateInstaHandle` を 14 だけに、並びの逆転（24・20・28・29）、まとめた時の控え、試験の `created_at`、`listFeeRules`・`loadMembersLite`・`bankToldWaitDue`・`refundForDecrease` の1本化、試験の種の道具の使い分け、`mypageItems` を 15 が直す、名前のぶつかり（`StaffPaySection`・`mergeManualAction`・`recitalGuard` の Create/Modify）、60秒（`maxDuration`・20通・10通）、試し用の鍵の出し方、`--env-file`、`themeColor`、`wrangler` を直接、試験は自分の発表会だけ、Stripe の試しの鍵の手順、`stripe_recheck` の二重、全角数字、名義のゆれ、2人同時に当てる、時刻の境目、Task 8 の場面A〜E、Task 9 の空の試験、印のあとに作品を足した short、`parseYenInput`、`HOUSEHOLD_VIEW_LABEL` を作らない。

直さなかった：3 件。
- 「`decideRow` の表と Task 2 の Step 3 が試験の書き写し」：表は当てる順番（どれを先に見るか）を決める物で、試験だけでは順番が決まらないので残した。食いちがった時は試験が正、と Global Constraints に1行足した。
- 「参考（食いちがいなし・確認済み）」：直すことが無い。
- 「釣り合い（長さ）」：本体のコードは足していない。直すことが無い。
