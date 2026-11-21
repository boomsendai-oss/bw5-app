# BW6 進行システム 段階2（2026-12-16（水）〜2027-01-31（日）） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 段階1（申込・金額・カードと振込の支払い・入金の記録）の上に、12/16〜1/31 に要る物を足す：支払いを見守る物（毎朝の見回り・催促・週1回のまとめ・お金の画面・カードの異議）、世帯のお金のボタン、家庭の「家族を足す・全部やめる」、イントラのページ、申込の一覧の見方と CSV、人数と席の見込み、スタッフが代わりに申し込む、スクールの都合で返す形、MOCCHIN の読み込み、作る物と期限の一覧。2/1〜2/10 に動く物（見送り・お願い・催促）も、ここで作り終えて試す。

**Architecture:** 段階1の形をそのまま使う。計算は DB にさわらない純関数（新しく `recitalRemind.ts`・`recitalSummary.ts`・`recitalPatrol.ts`・`recitalCounts.ts`・`recitalInstructor.ts`）に置き、書き込みは `withWriteTx` の中、お金はかならず `insertPaymentTx`・`createRefundTx` を通す。家庭とスタッフへの自動メールは全部 `recitalMail.ts` の記録（`recital_mail_log`）と `dedupe_key` を通し、催促のように数が多いメールは「待ち」の行として積んでから `flushWaitingMails` で 20 通ずつ出す（朝8時と、8:15〜21:00 の15分おき）。朝の見回りは `/api/cron/recital-morning` の1本にまとめ、何度呼んでも同じ結果になる形（同じ日に2回動いても、メールは `dedupe_key` で1通）にする。

**Tech Stack:** Next.js 16（App Router・Server Actions）・TypeScript・Turso（libsql）・Vercel Hobby（関数は60秒まで）・vitest・Stripe（fetch で直接）・nodemailer（Gmail）・Cloudflare Workers（boom-cron の `JOBS`）。

**Spec:** 設計書 第5版（iCloud の `BOOM/成果物/BW6_進行システム設計/BW6_進行のしくみ_設計書_第5版.md`。この計画で「設計書 ◯◯行」と書いたのは、このファイルの行番号）と、決まりの紙 `decisions-v5.md`（同じフォルダの控え。作業場所に写すときは `.superpowers/sdd/2026-11-21-bw6-recital-stage2/ref/` に置く）。食いちがったら決まりの紙が勝つ。段階2の範囲の正本は設計書 8-7（5227〜5285行）と 8-2 の「第2段階へ回した物」の表。段階1の計画 `docs/superpowers/plans/2026-11-12-bw6-recital-stage1.md` と、その実装記録（裁定・持ち越し）の上に積む。段階1で決めた名前・型は変えない（変えたくなったら止まって知らせる）。

---

## Global Constraints

- 範囲は段階2だけ。段階3より後の物は作らない（終わりの「段階3へ回す物」）。必要に見えたら止まって知らせる。
- **計画に書いていないことに当たったら、自分で決めずに、止まって知らせる。** とくに、列を足したい・値の言葉を変えたい・設計書の数字と試験が合わない・家庭に見える文を変えたい、の4つ。
- 計画の文と試験が食いちがったら、試験（設計書の数字を入れた物）が正。直す前に止まって知らせる。試験の本体が `/* 入力 → 期待 */` の短い書き方の所は、その入力と期待をそのまま `expect` に書く（空の本体で出さない）。
- **本番の DB にさわらない。** 手元の `.env.local` は本番の DB を向いている。試験は `setupRecitalTestDb('<名前>')`（`src/lib/__tests__/recitalTestSeed.ts`）の手元のファイル DB で、画面の確かめは下の「手元の画面の確かめ」の `data/bw6_dev.db` で。本番の DB に流すのは台帳SQLだけで、流す人は「出す手順」に書いた人（作る係は流さない）。
- DB の試験は自分の `event_key`（`t-xxx`）の行だけを見る。種は `src/lib/__tests__/recitalStaffSeed.ts` の `seedEvent`・`seedRules`・`seedWork`・`seedHousehold`、`recitalTestSeed.ts` の `seedRecitalTestEvent`・`seedHousehold` を使う（新しい種の関数を足すときは、そのファイルに足す）。
- 試験は1ファイルずつ：`npx vitest run <ファイル>`。全件（`npm test`）・`tsc` 全体・`next build` は M1 で回さない（M5 で、各タスクのまとめの段に書いた時だけ）。
- 時計を使う試験は `vi.setSystemTime` か、関数に `now: Date` を渡す。JST の日付は `todayJst`・`shiftDays`・`weekdayJst`（`src/lib/dateJst.ts`）、設定の日時は `jstToMs`・`deadlineMs`（`src/lib/recital.ts`）でくらべる（文字のままの大小くらべは、同じ形の時だけ）。
- スキーマの変更は台帳SQL `scripts/migrations/20261216_recital_stage2.sql` の1本と、それと一字一句同じ `src/lib/db/recitalSchema2.ts` の `RECITAL_STAGE2_SCHEMA_STATEMENTS`（Task 1）。台帳SQLにはコメントを書かない。文の中に「`;` で終わる行」を作らない。外部キーと値の CHECK は付けない。`created_at` は `TEXT NOT NULL`（書く側が `nowUtcIso()`）。今ある表の列は変えない・消さない（足すのも Task 1 の1本だけ）。
- 関数は60秒まで。入口には `maxDuration = 60`。1回に送るメールは、その場で送るのは 10 通まで（`MAIL_NOW_MAX`）、待ちを出すのは 1回 20 通まで（`flushWaitingMails` の `limit`）。それより多い物は「待ち」の行にして、次の回（8:15〜21:00 の15分おき）にまかせる。
- 家庭へのメールは JST 8:00〜21:00 だけ（`inSendWindow`）。催促・ご案内・お願い・「まだ確認できていません」・迷っている作品の知らせは、送る直前（`deliver` の中）に「送らない世帯」の決まりをもう一度見て、当たれば `status='cancelled'` にして送らない（Task 16 の `remindSkipReason`）。
- 自動メールは、試しの発表会（`recital_events.is_test = 1`）では今までどおり `test_mail_to` へすりかえる（`deliver` の決まり）。週1回のまとめ・見回りが失敗した知らせ・TARO への声かけは、試しでない発表会だけ。
- bw5-app は公開リポジトリ。計画・コード・台帳SQL・試験・コミット文に、実名・電話・メール・口座番号・振込先の文・鍵・乱数を書かない（例は `example.com`・`example.invalid`・架空の名前・`090-1234-5678` の形だけ）。スタッフ宛のアドレスは設定 `staff_mail_to`（Task 1）に、設定の画面から入れる。
- 変えた記録（`recital_changes`）・ログ・`console.*`・エラー文・TARO への知らせに、メール・電話・生年月日・インスタ・振込の名義・家庭の名前を残さない（`logChangeTx` が伏せる。知らせは整理番号と数だけ）。
- 家庭に渡す URL は `recitalMyUrl(token)`、イントラに渡す URL は Task 13 の `recitalInstructorUrl(token)`（どちらも `RECITAL_PUBLIC_ORIGIN`）。スタッフ向けの URL は `STAFF_ORIGIN`（`src/lib/appOrigin.ts`）。住所を直書きしない。
- 入力欄は全部、文字色と下地色を両方書く（`RECITAL_INPUT_CLS`）。家庭とイントラの画面は生成り `#faf6f1` の下地に紺 `#101040` の文字。スタッフ画面は `brand-*`・`navy-*`・`sand-*` だけ（`orange-*` を使わない）。
- 確かめの窓（`confirm()`）は使わない。お金・取りやめ・送る・確定のボタンは2段階ボタンと名前の選択（`RECITAL_STAFF_NAMES`）。
- 新しい `route.ts` は `withAuth` で包むか、頭に「なぜ公開なのか」を書く（`CLAUDE.md` 4.5）。cron の入口は `cronAuthorized`（`src/lib/inboxAlert/cronAuth.ts`）。新しいページは Server Actions。Next.js 16 の書き方は、作る前に `node_modules/next/dist/docs/` の該当ページを読む（`searchParams`・`params` は Promise）。
- git は自分が作った・直したファイルだけをパス指定で add する（`git add -A`・`git add .` は使わない）。コミット文の最後に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。main へ push すると本番に出る。push は「出す手順」のとおりに、出す日を守る。
- **出す日の決まり：** 12/14（月）〜12/15（火）は bw5-app に push しない。段階2の最初の push は 12/16（水）の朝（受付が開いて1日たって落ち着いてから）。12/30（水）〜1/3（日）は push しない（TARO が見られない休み。仮に決めた）。各タスクの頭の「要る日」までに出す。`JOBS` を変えたタスクは、アプリの push が Vercel に出たあとに `wrangler deploy`（段階1 Task 24 の Step 14 と同じ手順）。
- お金にさわるタスク（3・5・6・7・17・20・21）の最後の見直しは Fable（段階1と同じ）。

## Review Focus

1. **朝8時の催促と同じころに入金が当たる**（7:59 に TARO の束が合う・8:00:30 にカードの知らせが来る・8:05 の追い打ちのあいだに振込が当たる）→ 払い終わった世帯に催促は行かない。待ちの行は送る直前に見直して `cancelled`。試験は Task 17（`deliver の直前に残りが0なら取りやめ`）。
2. **「振り込みました」の3日と休み**（2/5（金）に押す → 2/8（月）の朝に見る、12/29 に押す → 1/6 の朝に見る、押し直しで日が動かない）→ その間は催促も「イ」も出ない。3日目の朝に「イ」が1通だけ、同じ朝の催促は無し。試験は Task 16（`remindSkipReason`）・17。
3. **取り込みが古い朝と夜8時の線**（7:00 に束、15:00 に束、20:01 に束、同じ束を2回 commit、08:05 の追い打ち）→ 15:00 なら、その日のうちに1回だけ出る・20:01 なら出ない・2回目は出ない。試験は Task 17。
4. **まとめた世帯・出演なしの世帯・試しの発表会・返す分が残り以上の世帯への自動メール**（催促・迷っている知らせ・週のまとめ）→ まとめた世帯と出演なしと「しくみの待つ」には出ない。試しの発表会は `test_mail_to` だけ、週のまとめは出ない。試験は Task 16・17・4・19。
5. **家族を足す時のゆれ**（全角の生年月日「２０１５－０４－０１」、同じ人（カナ＋生年月日）が別の世帯にいる、払ったあとに足して1人目が入れかわる、「決定」の二度押し）→ 半角と同じに読む・同じ人は確かめを求める・差額だけが残りに出る・1人だけ足される。試験は Task 8。

---

## タスクの並び（全25タスク）と、要る日

| Task | 物 | 要る日（おそくとも本番に出ている日） | 前に要る Task |
|---|---|---|---|
| 1 | 段階2の表と設定・型 | 12/16（水） | — |
| 2 | 段階1の小さな持ち越し（試しの鍵・maxDuration・まとめた世帯・名義の打ち直し） | 12/22（火） | 1 |
| 3 | お金の画面と、止まった・失敗したメールの送り直し | 12/20（日）（12/21 の週のまとめのリンク先） | 1 |
| 4 | 週1回のまとめ | 12/20（日）の夜まで（12/21（月）朝8時20分に初回） | 1・3 |
| 5 | 毎朝の見回りの土台・①拾い直し・失敗の知らせ・7番 | 12/22（火） | 1 |
| 6 | カードの異議と返金の知らせ | 12/28（月） | 1・5 |
| 7 | 世帯の画面のお金のボタン（出演とりやめ・返金を記録・返す分を作る・待つ・延長） | 12/28（月） | 1・6 |
| 8 | マイページの「家族を足す」 | 12/22（火） | 1 |
| 9 | マイページの「全部やめる」と、文の切りかえ | 12/22（火） | 8 |
| 10 | （12/8 に段階1の Task 15 を外した時だけ）作品を足す・やめるを戻す | 12/22（火） | 9 |
| 11 | 申込の一覧の人ごと・作品ごとの見方・しぼりこみ・CSV | 12/29（火） | 1 |
| 12 | 金額を試す（料金の早見） | 12/29（火） | — |
| 13 | イントラの鍵とスタッフの画面 | 12/28（月） | 1 |
| 14 | イントラのページ | 12/28（月） | 13 |
| 15 | 人数と席の見込み・年齢別 | 1/8（金） | 1 |
| 16 | 催促の計算（純）`recitalRemind.ts` | 1/10（日） | 1 |
| 17 | 見回りの「イ」と②催促・取り込みが古い朝・止めた回を commit で出す | 1/14（木）の夜まで | 5・7・16 |
| 18 | 声かけの足し（催促の前の5つの晩・2/8〜2/10 の昼） | 1/14（木）18:59 まで | 16・17 |
| 19 | 迷っている作品の知らせと、2/1 の見送り | 1/23（土）（2/1 の見送りは 1/31（日）まで） | 16・17 |
| 20 | スタッフが代わりに申し込む | 1/22（金）（試しを 1/31 までに終える） | 8 |
| 21 | スクールの都合で作品をやめる・合同にする（返す分4番・入れ替え） | 1/29（金） | 7 |
| 22 | MOCCHIN の読み込み | 1/24（日）（まとめる作業は 1/25 の週） | 20 |
| 23 | 警告の残り（戻ってきたメールの印・送った数の印） | 1/31（日） | 4 |
| 24 | イントラへの自動メール（月曜の人数・期限の3日前と当日） | 1/25（月）（頼みごと2の期限 1/31 の3日前の 1/28） | 14 |
| 25 | 作る物と期限の一覧（資料34）と自動の確かめ | 1/31（日） | 4・15 |

- 作る順は表の上から（同じ日のタスクは、どちらからでもよい）。ただし同じファイルを触る組は、先のタスクのコミットのあとに次を始める：
  - `src/lib/recitalMail.ts`・`src/lib/recitalEmail.ts`：3 → 4 → 5 → 17 → 19 → 24
  - `src/app/api/cron/recital-morning/route.ts`：5 → 17 → 19
  - `src/app/staff/bw6/entries/[id]/page.tsx`・`actions.ts`：2 → 6 → 7 → 21
  - `src/lib/recitalEntryDb.ts`：8 → 9 → 20 → 21
  - `src/app/bw6/my/page.tsx`・`actions.ts`：8 → 9 → 10
  - `src/lib/recitalDb.ts`（`listAttention`）：5 → 7 → 17 → 23
  - `workers/boom-cron/index.js`：4 → 5 → 18（`wrangler deploy` は、それぞれのタスクの終わり）
- 締切から逆に見た道：催促の最初の 1/15（金）朝8時に、16・17 が本番に出ていて、1/14（木）の夜7時の声かけ（18）が出ていること。17 が 1/12（火）までに終わらないと分かった時点で止まって知らせる（その回は、出す人が手で「お支払いのご案内」を出す逃げ道は無い。日をずらす決定は TARO）。

## 作業場所

- 段階1と同じく、本体 `bw5-app` とは別の作業場所で作る：`git worktree add ../bw5-app-recital2 -b feat/bw6-recital-stage2 origin/main`。作業場所には `data/`（本体の `../bw5-app/data` へのリンク）と `.env.production.local`（本体の写し）を、出す人が用意する。どちらかが無ければ、作らずに止まって知らせる（鍵のファイルを自分で写さない）。
- 設計書と決まりの紙の控えを `.superpowers/sdd/2026-11-21-bw6-recital-stage2/ref/` に置く（git に入らない）。

## 手元の画面の確かめ（全部の「画面で見る」の段に効く）

段階1の計画の同じ節のとおり（M5 で。M1 では回さない）：

1. `TURSO_DATABASE_URL=file:./data/bw6_dev.db TURSO_AUTH_TOKEN= SKIP_DB_INIT=0 npm run dev`
2. 種は台帳SQLを流す：`20261114_recital_seed_test.sql` のあとに、この計画の `20261216_recital_stage2.sql`・`20261217_recital_stage2_seed_test.sql`（Task 13）を、段階1の計画の同じ節の node のひと行で流す。
3. 手元の `data/bw5.db` には `migrate.mjs` を流さない。

## 出す手順（本番の DB とコードを出す順）

1. Task 1 のコミットのあと、表を読むコードを push する前に：`node --env-file=.env.production.local scripts/migrate.mjs --dry-run` → 出るのが `20261216_recital_stage2.sql` の1本だけと見る（ほかが出たら止まって知らせる）→ `--dry-run` を外して流す → 表ができたことを読むだけで確かめる。流すのは 12/16（水）の朝。
2. Task 13 の種 `20261217_recital_stage2_seed_test.sql`（試しの発表会 `bw6-test` の頼みごと13個）と、本番の頼みごと `20261218_recital_asks_bw6.sql`（`bw6` の13個）は、同じ形（`--dry-run` → 外す）で流す。本番の頼みごとの期限は、TARO の T11 の返事（「作る前に止まって聞く物」3）の後。返事が無ければ設計書の案の日で流す。
3. コードは main に push → Vercel が自動で出す。出たあと、本番で `/bw6`・`/bw6/my`（試しの世帯）・`/staff/bw6` が開くことを見る。
4. `JOBS` を変えたタスク（4・5・18）は、アプリが出たあとに `cd workers/boom-cron && wrangler deploy --dry-run` → `wrangler deploy`。動作確認の画面（GET /）に足した行が出ることを見る。wrangler のログインが切れていたら止まって知らせる。
5. おかしい時：コードは Vercel の画面で前の版へ戻す → 表にはさわらない → 入った申込と入金は消さない。催促がおかしい時は、設定の画面の「催促を止める」（Task 17 の `remind_paused`）を押す。

---

## 基（base）表と設定 — Task 1〜2

### Task 1: 段階2の表と設定・型

要る日：12/16（水）（ほかの全部のタスクの前提）

**Files:**
- Create: `scripts/migrations/20261216_recital_stage2.sql`
- Create: `src/lib/db/recitalSchema2.ts`
- Modify: `src/lib/db/schema.ts`（import 1行と、`getSchemaStatements()` の配列の `...RECITAL_SCHEMA_STATEMENTS,` の次に `...RECITAL_STAGE2_SCHEMA_STATEMENTS,` を1行）
- Modify: `src/lib/recital.ts`（設定の型・初めの値・画面に出す鍵）
- Modify: `src/lib/recitalEmail.ts`（`MailKind` の名前を足すだけ。文は各タスク）
- Modify: `src/lib/recitalReset.ts`（試しのデータを消す表に新しい表を足す）
- Test: `src/lib/__tests__/recitalSchema2.test.ts`、`src/lib/__tests__/recital.test.ts`（足す）、`src/lib/__tests__/recitalReset.test.ts` が無ければ `recitalDb.test.ts` の `resetTestEvent` の試験に足す

**Interfaces:**
- Consumes：段階1の `RECITAL_SCHEMA_STATEMENTS`・`parseRecitalSettings`・`checkSettingValue`・`recitalResetStatements`
- Produces：
  - `export const RECITAL_STAGE2_SCHEMA_STATEMENTS: readonly string[]`（台帳SQLを `migrate.mjs` と同じ分け方で割った文と一字一句同じ）
  - 表3つ：`recital_asks`・`recital_ask_answers`・`recital_outputs`（下の SQL）
  - `RecitalSettings` に足す鍵：`staff_mail_to: string[]`・`remind_paused: boolean`・`seat_total`・`seat_blocked`・`seat_reserved`・`seat_invite`・`seat_tech`・`seat_cast`（6つとも `number | null`）
  - `MailKind` に足す名前（7つ）：`'pay_guide'`（お支払いのご案内 1/15）／`'maybe_notice'`（迷っている作品の知らせ）／`'pay_request'`（お支払いのお願い 2/1）／`'pay_remind'`（催促 回1〜3）／`'bank_unconfirmed'`（まだ確認できていません）／`'weekly_summary'`（週1回のまとめ）／`'patrol_failed'`（見回りが失敗した知らせ）。設計書 772行の14個と同じ数になる（段階1の7つ＋この7つ）。
  - `recital_imports.kind` の値に足す物（列は足さない。設計書 852行・3-5）：`'patrol'`（見回り）・`'mocchin'`（Task 22）。段階1の明細の束は `'statement'` のまま。
  - `recital_changes.action` の値に足す物（各タスクで使う。ここで一覧だけ決める）：`withdraw`・`withdraw_undo`・`refund_done`・`wait_set`・`wait_cleared`・`extend_set`・`person_added`・`all_out_family`・`passed_auto`・`works_drop`・`works_merge`・`staff_entry`・`mocchin_import`・`instructor_link`・`bank_name_retyped`・`dispute`
  - `recital_mail_log.dedupe_key` の形（各タスクで使う。ここで一覧だけ決める）：`pay_guide:<世帯id>`・`maybe_notice:<YYYY-MM-DD>:<世帯id>`・`pay_request:<世帯id>`・`pay_remind_<1|2|3>:<世帯id>`（設計書 774行の例）・`bank_wait:<世帯id>:<bank_told_at の JST 日付>`（設計書 774行）・`weekly_summary:<event_key>:<YYYY-MM-DD>`・`patrol_failed:<event_key>:<YYYY-MM-DD>`・`instructor_weekly:<link_id>:<YYYY-MM-DD>`・`instructor_due:<link_id>:<ask_key>:<YYYY-MM-DD>`

決めたこと：
- 表は設計書 3-5（821〜824行）の列のとおり。`recital_notices`・`recital_files` などほかの「あとの段階の表」は作らない（段階3）。
- 設定の初めの値：`staff_mail_to`＝空（設定の画面から入れる。空のあいだ、スタッフ宛のメールは `notifyTaro` だけに出す）、`remind_paused`＝`'0'`、席の6つ＝空（9章 T10・T12 の返事で入れる）。
- `staff_mail_to` はカンマで分けたメール（`normalizeEmail` で1つずつ確かめる。1つでも形がちがえば保存させない）。`remind_paused` は `'0'`/`'1'`。席は空か0以上の整数。
- 画面に出す鍵（`RECITAL_SETTING_KEYS_SHOWN`）に、この8つを足す。

- [ ] **Step 1: 失敗する試験を書く**（`src/lib/__tests__/recitalSchema2.test.ts`。段階1の `recitalSchema.test.ts` と同じ形）

```ts
// 台帳SQLだけで作ったDB（SKIP_DB_INIT=1）で、段階2の3表・索引・初めの値を確かめる
const LEDGER = 'scripts/migrations/20261216_recital_stage2.sql';
it('台帳SQLの文と RECITAL_STAGE2_SCHEMA_STATEMENTS が一字一句同じ', () => {
  expect(splitSql(readFileSync(LEDGER, 'utf8')).map(norm)).toEqual(RECITAL_STAGE2_SCHEMA_STATEMENTS.map(norm));
});
it('3表がある', async () => { /* sqlite_master → ['recital_ask_answers','recital_asks','recital_outputs'] がそろう */ });
it('索引', async () => {
  /* ux_recital_asks_key (event_key, ask_key)・ux_recital_ask_answers_target (ask_id, work_id, instructor_link_id)・
     ux_recital_outputs_key (event_key, output_key)・idx_recital_ask_answers_link (instructor_link_id) がある */
});
it('頼みごとの答えは同じ相手に2つ入らない', async () => { /* 同じ ask_id・instructor_link_id で2回 INSERT → UNIQUE で落ちる */ });
it('答えの status の初めの値は todo、outputs の status は waiting・version_no は 0', async () => { /* … */ });
```

SQL（`20261216_recital_stage2.sql`。この文のまま。`;` で文を分ける）：

```sql
CREATE TABLE IF NOT EXISTS recital_asks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  ask_no INTEGER NOT NULL,
  ask_key TEXT NOT NULL,
  target TEXT NOT NULL,
  title TEXT NOT NULL,
  why TEXT,
  due_offset_days INTEGER,
  due_on TEXT,
  due_note TEXT,
  tentative_ok INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1,
  help_text TEXT,
  stage INTEGER NOT NULL DEFAULT 2,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_asks_key ON recital_asks (event_key, ask_key);
CREATE TABLE IF NOT EXISTS recital_ask_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  ask_id INTEGER NOT NULL,
  work_id INTEGER,
  instructor_link_id INTEGER,
  status TEXT NOT NULL DEFAULT 'todo',
  submitted_at TEXT,
  checked_by TEXT,
  note TEXT,
  answer_json TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_ask_answers_target ON recital_ask_answers (ask_id, COALESCE(work_id, 0), COALESCE(instructor_link_id, 0));
CREATE INDEX IF NOT EXISTS idx_recital_ask_answers_link ON recital_ask_answers (instructor_link_id);
CREATE TABLE IF NOT EXISTS recital_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  output_key TEXT NOT NULL,
  doc_no INTEGER,
  title TEXT NOT NULL,
  reader TEXT,
  owner TEXT,
  mode TEXT NOT NULL,
  due_offset_days INTEGER,
  due_on TEXT,
  ready_rule TEXT NOT NULL DEFAULT 'always',
  nag_target TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  version_no INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT,
  confirmed_at TEXT,
  copies_rule TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_outputs_key ON recital_outputs (event_key, output_key)
```

列の値の言葉（コードの定数で持つ。CHECK は付けない）：`recital_asks.target`＝`work`／`instructor`。`recital_ask_answers.status`＝`todo`（まだ）／`draft`（下書き）／`submitted`（出した）／`checked`（確認ずみ）／`returned`（差し戻し）。`recital_outputs.mode`＝`auto`／`semi`／`manual`／`none`、`status`＝`waiting`（材料待ち）／`ready`（出せます）／`confirmed`（確定）／`done`（済み）。`due_note` と `ask_no`・`tentative_ok`・`stage` は、この計画で足した列（設計書 3-5 に無い。頼みごと3の「候補日が出てから1週間」の書き方と、番号・「仮でよい」・段階を持つため）。**この4列が要らないと設計の人が言えば、Step 3 の前に止まって直す。**

- [ ] **Step 2: 落ちることを確かめる** — Run: `npx vitest run src/lib/__tests__/recitalSchema2.test.ts` → FAIL（ファイルが無い）
- [ ] **Step 3: 台帳SQL・`recitalSchema2.ts`・`schema.ts` の1行を書く**
- [ ] **Step 4: 通ることを確かめる** — Run: `npx vitest run src/lib/__tests__/recitalSchema2.test.ts` → PASS
- [ ] **Step 5: 設定の試験を足す**（`recital.test.ts`）

```ts
it('段階2の設定の初めの値', () => {
  const s = parseRecitalSettings([]);
  expect(s.staff_mail_to).toEqual([]); expect(s.remind_paused).toBe(false); expect(s.seat_total).toBeNull();
});
it('staff_mail_to はカンマで分けて読む（空白・全角カンマも区切り）', () => {
  expect(parseRecitalSettings([{ key: 'staff_mail_to', value: 'a@example.com， b@example.com' }]).staff_mail_to).toEqual(['a@example.com', 'b@example.com']);
});
it('checkSettingValue：staff_mail_to の形・席は0以上の整数か空・remind_paused は0か1', () => {
  expect(checkSettingValue('staff_mail_to', 'a@example.com,xx')).not.toBeNull();
  expect(checkSettingValue('staff_mail_to', '')).toBeNull();
  expect(checkSettingValue('seat_total', '-1')).not.toBeNull();
  expect(checkSettingValue('seat_total', '')).toBeNull();
  expect(checkSettingValue('remind_paused', '2')).not.toBeNull();
});
it('画面に出す鍵に8つが入っている', () => { /* RECITAL_SETTING_KEYS_SHOWN が staff_mail_to・remind_paused・seat_* 6つを含む */ });
```

- [ ] **Step 6: 落ちることを確かめる** — Run: `npx vitest run src/lib/__tests__/recital.test.ts` → FAIL
- [ ] **Step 7: `recital.ts` を直す**（型・`RECITAL_SETTING_DEFAULTS`・`parseRecitalSettings`・`checkSettingValue`・`RECITAL_SETTING_KEYS_SHOWN`）。`recitalEmail.ts` の `MailKind` に7つを足す（`buildRecitalMail` は、まだその7つで呼ばれない。`switch` の網羅で型が通らなければ、7つの枝は `throw new Error('recital_mail:not_built')` にしておき、各タスクで置きかえる）。`recitalReset.ts` の表に `recital_ask_answers`・`recital_asks`・`recital_outputs` を足す（`resetTestEvent` は試しの発表会だけを消す決まりのまま）。
- [ ] **Step 8: 通ることを確かめる** — Run: `npx vitest run src/lib/__tests__/recital.test.ts` → PASS。Run: `npx vitest run src/lib/__tests__/recitalDb.test.ts` → PASS（`resetTestEvent` の数える表が3つ増えた期待に直す）
- [ ] **Step 9: 設定の画面を手元で見る**（M5・「手元の画面の確かめ」）：8つの欄が出る・`staff_mail_to` に形のちがう文字を入れると保存されない。
- [ ] **Step 10: コミット**

```bash
git add scripts/migrations/20261216_recital_stage2.sql src/lib/db/recitalSchema2.ts src/lib/db/schema.ts src/lib/recital.ts src/lib/recitalEmail.ts src/lib/recitalReset.ts src/lib/__tests__/recitalSchema2.test.ts src/lib/__tests__/recital.test.ts src/lib/__tests__/recitalDb.test.ts
git commit -m "$(cat <<'EOF'
feat(bw6): 段階2の表（頼みごと・答え・作る物の一覧）と設定

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 段階1の小さな持ち越し

要る日：12/22（火）

段階1の実装記録の持ち越しのうち、小さな物をまとめて直す（行き先の表は、この計画の終わり）。

**Files:**
- Modify: `src/app/bw6/my/page.tsx`（送り直しへのリンクに、試しの鍵 `pv` を付ける）
- Modify: `src/app/bw6/resend/page.tsx`（`export const maxDuration = 60`）
- Modify: `src/lib/recitalEntryDb.ts`（`changeHouseholdEmail`・`regenerateToken` は、`status <> 'active'` の世帯を `recital_entry:not_active` で拒む）
- Modify: `src/lib/recitalBankDb.ts`（`retypeBankRowName` を足す）・`src/app/staff/bw6/bank/actions.ts`（`retypeNameAction`）・`src/app/staff/bw6/bank/ReviewCards.tsx`（もどした行に名義の欄と「打ち直す」）
- Test: `src/lib/__tests__/recitalEntryDb.test.ts`・`src/lib/__tests__/recitalBankDb.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `restoreBankRow`・`listReviewRows`・`readRefFromDesc`・`changeHouseholdEmail`
- Produces：
  - `retypeBankRowName(rowId: number, nameRaw: string, staffName: string): Promise<void>`（`src/lib/recitalBankDb.ts`）
  - `ReviewRowView` に `humanRestored: boolean` を足す（「もとにもどす」でもどした行＝`decided_by` があり `state='new'` の行。画面は「手で打った行」と分けて「もどした行」と出す）

決めたこと（K214・段階1 Task 29 の確かめ待ち）：
- 名義を打ち直せるのは、もどした行（`humanRestored`）だけ。打ち直すのは `desc_raw` の名義の所だけで、頭の番号は今の `ref_read` のまま（打ち直しで番号は変えない）。`desc_norm` は `readRefFromDesc` で作り直す。金額・日付・残高は変えない。
- 変えた記録は `bank_name_retyped`（前後の名義は記録に入れない。`{ rowId }` だけ）。
- 打ち直した行も、自動では当てない（`decided_by` が残るので、段階1の決まりのまま）。候補の計算（`candidatesFor`）だけが新しい名義で動く。

- [ ] **Step 1: 試験を書く**

```ts
// recitalEntryDb.test.ts
it('まとめた世帯のメールを直す・鍵を作り直すのは拒む', async () => {
  /* seedHousehold → UPDATE status='merged' → changeHouseholdEmail(...) が recital_entry:not_active で投げる・regenerateToken も同じ */
});
// recitalBankDb.test.ts
it('もどした行だけ名義を打ち直せる。番号・金額は変わらず、候補が新しい名義で出る', async () => {
  /* 27 の束で「振込 ４８２７ ヤマダ」の行を入れて当てる → cancelBankPayment → restoreBankRow →
     listReviewRows の行は humanRestored=true → retypeBankRowName(rowId, 'ヤマダ ハナコ', 'TARO') →
     行の ref_read・amount は前と同じ・desc_norm に「ヤマダハナコ」・変えた記録 bank_name_retyped の after_json は {"rowId":…} だけ */
});
it('もどしていない行・手で打った行は打ち直せない', async () => { /* state='new' で decided_by が空 → recital_bank:not_restored */ });
```

- [ ] **Step 2: 落ちることを確かめる** — Run: `npx vitest run src/lib/__tests__/recitalEntryDb.test.ts` と `npx vitest run src/lib/__tests__/recitalBankDb.test.ts` → FAIL
- [ ] **Step 3: 作る**（上の Files のとおり。`retypeBankRowName` は `writeOrBusy` の中で行を読み直し、`humanRestored` でなければ `recital_bank:not_restored`）
- [ ] **Step 4: 通ることを確かめる** — 2本とも PASS
- [ ] **Step 5: 画面で見る**（M5）：試しの世帯のマイページの「URLを送り直す」リンクに `pv=` が付く／見てほしい入金で、もどした行に「もどした行」の印と名義の欄が出て、打ち直すと候補が変わる。
- [ ] **Step 6: コミット**（触ったファイルだけを add。文：`fix(bw6): 段階1の持ち越し（試しの鍵・maxDuration・まとめた世帯・名義の打ち直し）`）

---

## 見（watch）支払いを見守る物 — Task 3〜7

もと：設計書 4-4 のお金の画面（1992〜2005行）、5-6（2540〜3184行。見回り 2817〜2832・催促 2834〜2866・声かけ 2883〜2902）、5-7（3185〜3284行）、7-5（3897〜3998行）、7-7（4021〜4037行）、7-8（4282〜4446行）、決まりの紙 2-7・2-13・2-20〜2-24、K39・K48・K103・K111・K116・K119・K129・K132・K133・K152〜K160・K168・K187・K198・K206・K207・K211・K217・K219・K220・K227。

### Task 3: お金の画面と、止まった・失敗したメールの送り直し

要る日：12/20（日）（12/21 の週のまとめの「手で入れた入金」「返金の待ち」のリンク先）

**Files:**
- Create: `src/lib/recitalMoneyView.ts`（DB を読むだけ）
- Create: `src/app/staff/bw6/money/page.tsx`・`src/app/staff/bw6/money/actions.ts`
- Modify: `src/lib/recitalMail.ts`（`resendFailedMails` を足す）
- Modify: `src/app/staff/bw6/page.tsx`（下のボタンの並びに「お金」を足す）
- Test: `src/lib/__tests__/recitalMoneyView.test.ts`、`src/lib/__tests__/recitalMail.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `readMoneyByHousehold`・`listEntryRows`・`listReviewRows`・`countRecitalMailsToday`・`requireRecitalStaff`・`pickStaffEventKey`
- Produces：
  - `type MoneyBand = { charged: number; paidCard: number; paidBank: number; paidManual: number; remaining: number; remainingHouseholds: number; reviewRows: number; refundTodoCount: number; refundTodoAmount: number; cardFeeEstimate: number; countedAt: string }`
  - `readMoneyBand(eventKey: string, now?: Date): Promise<MoneyBand>`
  - `listManualMoneyRows(eventKey: string, sinceUtc: string | null): Promise<{ at: string; householdId: number; refCode: string; kind: 'cash' | 'adjust' | 'fee_class'; amount: number | null; actor: string }[]>`（K39。手で入れた入金＝`recital_payments.source='manual'` の現金と調整、手で変えた特別な料金＝`recital_changes.action` が段階1の `setFeeClass`・`addAdjustCharge` の記録の物。`sinceUtc` が null なら全部）
  - `listMailTrouble(eventKey: string): Promise<{ logId: number; householdId: number | null; refCode: string | null; kind: string; status: 'failed' | 'stuck'; at: string }[]>`（`failed`＝送れなかった行。`stuck`＝`status='waiting'` なのに `sent_at` が入ったまま30分たった行＝取ったあとに止まった行。段階1 Task 10 の持ち越し）
  - `resendFailedMails(logIds: number[], staffName: string, now?: Date): Promise<{ sent: number; failed: number; skipped: number }>`（`src/lib/recitalMail.ts`。行を `waiting`・`sent_at=NULL`・`error=NULL` に戻してから、同じ行を `deliver` に通す。1回 10 行まで。`dedupe_key` は変えない。取りやめ・送った行は skipped）

決めたこと：
- 画面の中身は設計書 1992〜2005行のとおり（帯＝請求の合計／入金の合計（カード・銀行振込・手で記録）／残りの合計／残りがある世帯の数／見てほしい入金 ◯件／返金の待ち ◯件・◯円／手数料の見込み（カードの分だけ）。その下に世帯ごとの行＝整理番号・連絡する人・合計・払った額・残り・状態。開くと請求の行と入金の行）。試しの世帯の数え方は段階1の `countRecitalPeople` と同じ（試しの発表会の画面では数える）。
- 手数料の見込みは、カードの入金の和 × 3.6%（円未満切り上げ）。率は定数 `CARD_FEE_RATE = 0.036`（Stripe の日本の標準の率。ちがえば止まって知らせる）。
- 画面の下に3つの欄：「この7日に手で入れた入金・手で変えた特別な料金」（K39。`?tab=manual` で全部）／「催促の記録」（Task 17 のあとは `pay_guide`・`pay_request`・`pay_remind`・`bank_unconfirmed`・`maybe_notice` の送った数を日ごとに。Task 17 の前は空の欄）／「届かなかった・止まったメール」（`listMailTrouble`。行ごとに選んで「送り直す」（2段階ボタン＋名前））。
- この画面だけのお金のボタンは作らない（押すのは世帯の画面。設計書 2003行）。

- [ ] **Step 1: 試験を書く**（`recitalMoneyView.test.ts`。`setupRecitalTestDb('money_view')`）

```ts
it('帯の数：請求・入金（払い方ごと）・残り・残りがある世帯・返金の待ち・手数料の見込み', async () => {
  // t-mv：世帯A 請求 32,500・カード 32,500／世帯B 請求 26,500・振込 20,000／世帯C 請求 8,000・現金 8,000・返す分 todo 3,000
  const b = await readMoneyBand('t-mv');
  expect(b).toMatchObject({ charged: 67000, paidCard: 32500, paidBank: 20000, paidManual: 8000, remaining: 9500 /* B 6,500 ＋ C 3,000（C は paid＝8,000−返す分 3,000＝5,000。moneySummary の式） */, remainingHouseholds: 2, refundTodoCount: 1, refundTodoAmount: 3000, cardFeeEstimate: 1170 });
});
it('まとめた世帯は帯にも行にも数えない', async () => { /* 世帯D を merged にする → remainingHouseholds が変わらない */ });
it('手で入れた入金と特別な料金の一覧：7日より前は出ない・名前は出ない', async () => { /* recordManualPayment と setFeeClass を、時計を変えて2回ずつ → sinceUtc で絞れる。行に contact の名前の列が無い */ });
it('止まったメール：waiting で sent_at が30分より前の行だけ stuck', async () => { /* 直に mail_log を入れる */ });
```

`remaining` の期待は `moneySummary`（`src/lib/recital.ts`。払った額＝入金の和−返す分 todo の和）で手計算した値。合わなければ止まって知らせる。

`recitalMail.test.ts`：

```ts
it('送り直し：failed の行を waiting に戻して送る・同じ dedupe_key のまま・sent の行は skipped', async () => { /* … */ });
it('1回 10 行まで（11行目は skipped）', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる** — Run: `npx vitest run src/lib/__tests__/recitalMoneyView.test.ts`・`npx vitest run src/lib/__tests__/recitalMail.test.ts` → FAIL
- [ ] **Step 3: `recitalMoneyView.ts` と `resendFailedMails` を作る**
- [ ] **Step 4: 通ることを確かめる** — 2本とも PASS
- [ ] **Step 5: 画面を作る**（`StaffPageHeader`・`requireRecitalStaff`・`?ev=`。スマホは1世帯1カード）。`resendMailsAction(ev, logIds, staffName)` は `requireRecitalStaff` のあと `resendFailedMails`。
- [ ] **Step 6: 画面で見る**（M5）：帯の数が申込の一覧の残りの列と合う・送り直しで行が sent になる
- [ ] **Step 7: コミット**（`feat(bw6): お金の画面と、届かなかったメールの送り直し`）

---

### Task 4: 週1回のまとめ（月曜の朝）

要る日：12/20（日）の夜までに本番と `JOBS`（12/21（月）8:20 に初回）

**Files:**
- Create: `src/lib/recitalSummary.ts`（純）
- Create: `src/lib/recitalSummaryDb.ts`（材料を読む）
- Create: `src/app/api/cron/recital-weekly/route.ts`
- Modify: `src/lib/recitalMail.ts`（スタッフ宛のメールを送る `sendStaffMail` を足す）
- Modify: `src/lib/recitalEmail.ts`（`weekly_summary` の文。`buildRecitalMail` ではなく `buildWeeklySummary` の返す文をそのまま使う）
- Modify: `workers/boom-cron/index.js`（`JOBS` に1行）
- Test: `src/lib/__tests__/recitalSummary.test.ts`、`src/lib/__tests__/recitalSummaryDb.test.ts`、`src/app/api/cron/recital-weekly/__tests__/route.test.ts`、`src/lib/__tests__/recitalMail.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `countRecitalPeople`・`listAttention`・`listReviewRows`・`listToldWaiting`、Task 3 の `readMoneyBand`・`listManualMoneyRows`、Task 1 の `staff_mail_to`
- Produces：
  - `type SummaryFacts = { dateJst: string; going: number; goal: number; paidPeople: number; unpaidPeople: number; attention: number; reviewMoney: number; newEntries: number; changes: number; manualRows: number; refundTodoCount: number; refundTodoAmount: number; auditDue: boolean; auditDone: boolean; overdueRefs: string[]; failedMails: number; unopenedHouseholds: number | null; rosterFixWarn: { on: string; count: number } | null; outputsLines: string[]; askLines: string[] }`
  - `buildWeeklySummary(f: SummaryFacts, urls: { home: string; bank: string; money: string; import: string }): { subject: string; text: string }`（純）
  - `isSummaryMorning(nowJst: string, s: RecitalSettings): boolean`（純。月曜・`entry_open_at` の日より後・`bank_close_on` 以前）
  - `getSummaryFacts(eventKey: string, now: Date): Promise<SummaryFacts>`
  - `sendStaffMail(x: { eventKey: string; kind: 'weekly_summary' | 'patrol_failed'; dedupeKey: string; subject: string; text: string }, now?: Date): Promise<{ status: 'sent' | 'failed' | 'duplicate' | 'no_address' }>`（`recital_mail_log` に相手の列3つとも空で1行。宛先は `staff_mail_to` の全部に1通ずつ。空なら `no_address` を返し、`notifyTaro` に同じ件名と本文を出す。試しの発表会では送らない＝`duplicate` でも `no_address` でもなく、呼ぶ側が試しを外す）
  - `JOBS` の label：`recital-weekly`（`{ at: '08:20', path: '/api/cron/recital-weekly', label: 'recital-weekly' }`。月曜かどうかはアプリが決める）

決めたこと：
- 文は設計書 4415〜4436行の見本の並び。そこに、7-5（3902行）と 7-7（4026行）にあって見本に無い行を、見本の並びの終わりに足す（設計書の中のずれ。「迷って仮に決めた所」2）：
  1. 「届かなかったメール ◯件」（この7日の `failed`。`cancelled` は数えない。0件の週は出さない）
  2. 1/25（月）の週だけ「メールもマイページも開いていない世帯 ◯件」（K116。`mail_opened_at` と `opened_at` が両方空の active の世帯）
  3. `roster_fix_on` の前の月曜だけ「期限を過ぎても未払いの世帯が、まだ ◯世帯。名簿を固める日は ◯月◯日（◯）です」（段階2では `roster_fix_on` が空なので出ない。式だけ作る）
  4. Task 25 ができてからの「今週、確定を押す物」「期限が近いのに材料が足りない物」（`outputsLines`。それまで空）
  5. 期限が近い頼みごとの文（`askLines`。Task 24 ができてから。無い週は見本どおり「今週、イントラに貼る文はありません。」）
  6. 終わりに「受信箱に、戻ってきたメールが無いか、見てください。」（7-7）
- 「見てほしい入金 ◯件」「手で入れた入金・手で変えた特別な料金 ◯件」は0件の週は出さない（見本の注）。「総点検がまだです。」は `bank_audit_on` 以後で `bank_audit_done_at` が空の週だけ（段階2では出ない。式だけ）。
- メールは毎週送る（0件の行だけ省く。「何もしなくてよい週」が分かるように）。名前・電話・メールは書かない。件数と整理番号だけ。各行の終わりにリンク（`STAFF_ORIGIN` の画面）。
- 「お支払いずみ ◯人 ／ まだ ◯人」と「出る人」は `countRecitalPeople` の数（最初の画面と同じ）。

- [ ] **Step 1: 純の試験を書く**（`recitalSummary.test.ts`）

```ts
const base: SummaryFacts = { dateJst: '2026-12-21', going: 42, goal: 150, paidPeople: 30, unpaidPeople: 12, attention: 3, reviewMoney: 2,
  newEntries: 18, changes: 4, manualRows: 1, refundTodoCount: 1, refundTodoAmount: 3000, auditDue: false, auditDone: false, overdueRefs: [],
  failedMails: 0, unopenedHouseholds: null, rosterFixWarn: null, outputsLines: [], askLines: [] };
const U = { home: 'https://app.example.com/staff/bw6', bank: 'https://app.example.com/staff/bw6/bank', money: 'https://app.example.com/staff/bw6/money', import: 'https://app.example.com/staff/bw6/bank/import' };
it('件名', () => { expect(buildWeeklySummary(base, U).subject).toBe('【BOOM】BW6 今週のまとめ（12月21日）'); });
it('見本の並び（12/21）', () => {
  expect(buildWeeklySummary(base, U).text).toBe([
    '出る人 42人（目標150）', 'お支払いずみ 30人 ／ まだ 12人', `見てほしいこと 3件　${U.home}`, `　見てほしい入金 2件　${U.bank}`,
    '', 'この7日の動き', '　申込 18件／変更 4件', `　手で入れた入金・手で変えた特別な料金 1件　${U.money}?tab=manual`,
    `返金の待ち　1件・3,000円　${U.money}`, '今週、イントラに貼る文はありません。', '', '受信箱に、戻ってきたメールが無いか、見てください。',
  ].join('\n'));
});
it('0件の行は出ない（見てほしい入金・手で入れた入金・返金の待ち・届かなかったメール）', () => { /* reviewMoney:0, manualRows:0, refundTodoCount:0 → その行が無い */ });
it('届かなかったメールがある週・1/25 の週の開いていない世帯', () => { /* failedMails:2 → '届かなかったメール 2件　…entries' の行／unopenedHouseholds:5 → 'メールもマイページも開いていない世帯 5件' */ });
it('名前やメールの形の文字が入らない', () => { /* text が /@|様/ を含まない */ });
it('isSummaryMorning：12/21（月）は true・12/14（月）は false（受付の前）・12/22（火）は false・4/5（月）は false（bank_close_on の後）', () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる** — Run: `npx vitest run src/lib/__tests__/recitalSummary.test.ts` → FAIL
- [ ] **Step 3: `recitalSummary.ts` を作る**
- [ ] **Step 4: 通ることを確かめる** → PASS
- [ ] **Step 5: 材料と送る口の試験を書く**（`recitalSummaryDb.test.ts`・`recitalMail.test.ts`）

```ts
it('この7日の申込＝applied_at が7日以内の active の世帯・変更＝family か staff の cast_set の記録のある世帯の数', async () => { /* … */ });
it('見てほしいこと＝listAttention の数・見てほしい入金＝4番の数', async () => { /* … */ });
it('sendStaffMail：staff_mail_to の2人に1通ずつ・記録は1行（相手の列は空）・同じ鍵の2回目は duplicate', async () => { /* nodemailer のにせ物 */ });
it('sendStaffMail：staff_mail_to が空なら no_address と notifyTaro に1回', async () => { /* vi.mock('@/lib/notify') */ });
```

- [ ] **Step 6: 落ちることを確かめる** → FAIL
- [ ] **Step 7: `getSummaryFacts`・`sendStaffMail` を作る**（`sendStaffMail` は `insertLog` と同じ一意の守り。失敗の文は段階1の `sendErrorText` で code だけ）
- [ ] **Step 8: 通ることを確かめる** → PASS
- [ ] **Step 9: 入口の試験を書く**（`recital-weekly/__tests__/route.test.ts`。段階1の `recital-bank-ask` の試験の形：`@/lib/db` の `getAll` をにせ物にする）

```ts
it('鍵が無ければ 401', async () => { /* … */ });
it('月曜の朝は試しでない発表会だけに1回送る（試しの発表会の行が返ってきても送らない）', async () => {
  vi.setSystemTime(new Date('2026-12-20T23:20:00Z')); // JST 12/21（月）8:20
  events([{ event_key: 'bw6', is_test: 0 }, { event_key: 'bw6-test', is_test: 1 }]);
  /* sendStaffMail が1回・dedupeKey 'weekly_summary:bw6:2026-12-21' */
});
it('火曜は送らない', async () => { /* … */ });
it('1つの発表会で throw しても 200（ログに名前を出さない）', async () => { /* … */ });
```

- [ ] **Step 10: 落ちることを確かめる** → FAIL
- [ ] **Step 11: 入口を作る**（形は `recital-bank-ask/route.ts` にそろえる。頭に「proxy の外。CRON_SECRET／CRON_SECRET_CF で認可」。返すのは `{ ok: true, sent: <数> }` だけ）
- [ ] **Step 12: 通ることを確かめる** → PASS
- [ ] **Step 13: `JOBS` に1行**（`// ── BW6 週1回のまとめ（月曜だけアプリが送る）。` のコメントをつけて `{ at: '08:20', path: '/api/cron/recital-weekly', label: 'recital-weekly' }`）
- [ ] **Step 14: 出す**：アプリを push（12/16〜12/20 のどこか。Task 1・3 と一緒でよい）→ `wrangler deploy --dry-run` → `wrangler deploy`。確かめ：`?run=recital-weekly`（鍵つき）を火曜に撃って `{"ok":true,"sent":0}`。`staff_mail_to` が空なら、TARO の「作る前に止まって聞く物」1 の答えを設定の画面に入れる（出す人が入れる。リポジトリに書かない）。
- [ ] **Step 15: コミット**（`feat(bw6): 週1回のまとめ（月曜の朝）`）

---

### Task 5: 毎朝の見回りの土台・①拾い直し・見回りが失敗した知らせ

要る日：12/22（火）（①は「支払いを開けたら、すぐ。おそくとも 12/22」。設計書 4781行・8-2）

**Files:**
- Create: `src/lib/recitalPatrol.ts`（純：見回りの記録の読み方・失敗の判定・文）
- Create: `src/lib/recitalPatrolDb.ts`（見回りの本体 `runPatrol`）
- Modify: `src/lib/recitalPayDb.ts`（`recheckCardCheckouts` を足す）
- Modify: `src/app/api/cron/recital-morning/route.ts`（`runPatrol` を呼ぶ。`?retry=1` でも、今日の見回りが `ok` で終わっていなければもう一度）
- Modify: `src/lib/recitalDb.ts`（`AttentionItem.no` に `6 | 7` を足す。7番を出す）
- Modify: `src/app/staff/bw6/bank/import/page.tsx`（束の一覧に `kind='statement'` の行だけを出す。見回りの行を出さない）
- Modify: `workers/boom-cron/index.js`（8:15〜21:00 の15分おきの待ちの出し）
- Test: `src/lib/__tests__/recitalPatrol.test.ts`、`src/lib/__tests__/recitalPatrolDb.test.ts`、`src/lib/__tests__/recitalPayDb.test.ts`（足す）、`src/app/api/cron/recital-morning/__tests__/route.test.ts`（直す）、`src/lib/__tests__/recitalStaffHome.test.ts`（7番）

**Interfaces:**
- Consumes：段階1の `syncCardCheckout` の中の流れ（`retrieveRecitalCheckout`・`recordCardPayment`）、`flushWaitingMails`、`notifyTaro`、Task 4 の `sendStaffMail`
- Produces：
  - `type PatrolStep = 'passed' | 'recheck' | 'flush' | 'unconfirmed' | 'remind'`（`passed`＝2/1 からの見送り・Task 19、`unconfirmed`＝イ・Task 17、`remind`＝②・Task 17。この Task では `recheck` と `flush` だけを動かし、ほかは呼ぶ所だけを空で置く）
  - `type PatrolResult = { date: string; recheck: 'ok' | 'failed' | 'skipped'; flushed: { sent: number; failed: number }; unconfirmed: number; reminded: number; skippedByRow7: number; stoppedBy: 'none' | 'recheck_failed' | 'stale' | 'night' | 'paused' }`
  - `runPatrol(eventKey: string, now: Date, opts?: { from: 'morning' | 'retry' | 'commit' }): Promise<PatrolResult>`（何度呼んでも同じ。今日の見回りの行を1つだけ持つ）
  - `readTodayPatrol(eventKey: string, now: Date): Promise<{ id: number; checkResult: string } | null>`
  - `recheckCardCheckouts(eventKey: string, now: Date): Promise<{ asked: number; recorded: number }>`（`src/lib/recitalPayDb.ts`。聞けなかった時は throw）
  - 見回りの行の形（`recital_imports`。列は足さない）：`kind='patrol'`・`imported_at`＝その日の最初の動き出し・`shot_on`＝JST の日付・`source`＝`'cron'`・`check_result`＝`'running'`→`'ok'`／`'ng:recheck'`／`'ok:stale'`（②とイを取り込みが古いため止めた）／`'ok:night'`（夜8時より後で②とイをとばした）・`read_rows`＝その朝に②で見た世帯の数・`inserted`＝②とイで積んだメールの数・`existing`＝もう送ってあった数・`rejected`＝7番（見てほしい入金に残っている）で止めた世帯の数（Task 17。見てほしいことの4番「入金が残っているため、催促を止めた世帯：◯」に使う）
  - `JOBS` に1行：`{ from: '08:15', to: '21:00', every: 15, path: '/api/cron/recital-morning?retry=1', label: 'recital-flush' }`

決めたこと：
- 順番は設計書 2817〜2832行のとおり：（2/1 から）見送り → ① → ア → イ → ②。①が失敗した朝は②を止める（アとイは止めない）。
- ①で聞くのは、`status='open'` の行と、`status='closed'` で `created_at` が48時間以内の行（こちらが閉じても Stripe の画面を切れなかった時に払われた分を拾うため。仮に決めた。「迷って仮に決めた所」3）。`expired`・`paid` の行は聞かない。記録は段階1の `recordCardPayment`（`source='stripe_recheck'`。同じ決済を2回記録しない守りはそのまま）。
- ①の「失敗」＝Stripe に聞けなかった（throw）行が1つでもある。60秒の中で終わらなかった時（`asked` の途中で時間切れ）も、行は `running` のまま残り、`?retry=1` が続きをやる（聞くのは何度でもよい）。
- 失敗の知らせ：`sendStaffMail({ kind: 'patrol_failed', dedupeKey: 'patrol_failed:<event>:<日付>' })`（文は設計書 4436〜4446行。催促の日の朝は「今朝の催促は、止まりました。」を足す＝Task 16 の `remindPlan` で今日が催促の日か見る。Task 16 の前は足さない）と `notifyTaro`（作る人への知らせ。題「今朝の見回りが失敗しました」・本文は発表会と日付だけ）。試しの発表会では出さない。
- 見てほしいことの7番（設計書 852行）：「今朝の見回りが失敗しました」（今日の行が `ng:recheck`、または 8:30 を過ぎて今日の行が無い・`running` のまま）と「入金の取り込みが止まっています」（今日の行が `ok:stale`）。試しの発表会でも出す（画面の確かめのため）。
- `?retry=1` の動き：まず待ちを出す（今までどおり）。今日の見回りの行が無い・`running`・`ng:recheck` なら、`runPatrol(…, { from: 'retry' })` をもう一度（夜8時まで）。

- [ ] **Step 1: 純の試験を書く**（`recitalPatrol.test.ts`）

```ts
it('patrolAttention：ng:recheck → 7番「今朝の見回りが失敗しました」・ok:stale → 7番「入金の取り込みが止まっています」・ok → なし', () => { /* … */ });
it('8:30 を過ぎて今日の行が無い・running のまま → 失敗と同じ7番、8:29 なら出さない', () => { /* … */ });
it('失敗の知らせの文（設計書 4436〜4446行）：催促の日は1行足す', () => {
  expect(patrolFailedMail({ remindDay: false, homeUrl: 'u' })).toEqual({ subject: '【BOOM】BW6 今朝の見回りが失敗しました', text: '今朝の見回り（カードの入金の拾い直し）が、失敗しました。\n何もしなくて大丈夫です。あしたも失敗したら、作る人が直します。\nu' });
  expect(patrolFailedMail({ remindDay: true, homeUrl: 'u' }).text).toContain('今朝の催促は、止まりました。\n何もしなくて大丈夫です。');
});
```

- [ ] **Step 2: 落ちることを確かめる** → FAIL
- [ ] **Step 3: `recitalPatrol.ts` を作る**（`patrolAttention(row: { checkResult: string } | null, nowJst: string): { label: string } | null`、`patrolFailedMail(x: { remindDay: boolean; homeUrl: string }): { subject: string; text: string }`）
- [ ] **Step 4: 通ることを確かめる** → PASS
- [ ] **Step 5: ①と見回りの本体の試験を書く**（`recitalPayDb.test.ts`・`recitalPatrolDb.test.ts`。Stripe は `vi.mock('@/lib/recitalStripe')` の `retrieveRecitalCheckout`）

```ts
it('recheck：open の行が払い済みなら stripe_recheck で1回だけ記録・完了のメール', async () => { /* … */ });
it('recheck：closed で48時間以内の行が払い済みなら記録・49時間前の closed は聞かない', async () => { /* … */ });
it('recheck：聞けなかった行があれば throw（ほかの行は先に記録ずみ）', async () => { /* … */ });
it('runPatrol：見回りの行が1つだけできる（2回呼んでも1行）・ok で終わる', async () => { /* … */ });
it('runPatrol：① が失敗 → ng:recheck・patrol_failed を1通（2回目は duplicate）・notifyTaro に1回・待ちのメールは出す', async () => { /* … */ });
it('runPatrol：試しの発表会では失敗の知らせを出さない', async () => { /* … */ });
```

- [ ] **Step 6: 落ちることを確かめる** → FAIL
- [ ] **Step 7: `recheckCardCheckouts`・`runPatrol`・`readTodayPatrol` を作る**（`runPatrol` の中の `passed`・`unconfirmed`・`remind` は、この Task では何もしない関数を呼ぶだけにする。Task 17・19 が中身を入れる）
- [ ] **Step 8: 通ることを確かめる** → PASS
- [ ] **Step 9: 入口の試験を直す**（`recital-morning/__tests__/route.test.ts`）：発表会ごとに `runPatrol` を呼ぶ（試しの発表会も）・1/4 の休み明けの声かけは今までどおり・`?retry=1` は今日の行が `ok` なら `runPatrol` を呼ばない・`ng:recheck` なら呼ぶ・1つの発表会で throw してもほかは続ける。
- [ ] **Step 10: 落ちることを確かめる → 入口を直す → 通ることを確かめる**
- [ ] **Step 11: 7番の試験を足す**（`recitalStaffHome.test.ts`）→ FAIL → `listAttention` に7番（`patrolAttention` を使う）→ PASS。束の一覧（`/staff/bw6/bank/import`）から `kind <> 'statement'` の行を外す。
- [ ] **Step 12: `JOBS` に1行**（`// ── BW6 待ちのメールを15分おきに出す（催促は待ちに積んでから出すため）。`）
- [ ] **Step 13: 出す**：push → `wrangler deploy`。確かめ：`?run=recital-flush`（鍵つき）で `{"ok":true,…}`。次の朝 8:00 のあと、本番の `recital_imports` に `kind='patrol'` の行が1つ（出す人が読むだけで見る）。
- [ ] **Step 14: コミット**（`feat(bw6): 毎朝の見回りの土台とカードの拾い直し`）

---

### Task 6: カードの異議と返金の知らせ

要る日：12/28（月）（設計書 4785行「12月中」）

**Files:**
- Modify: `src/lib/recitalStripe.ts`（`parseRecitalChargeEvent` を足す）
- Modify: `src/lib/recitalPayDb.ts`（`handleRecitalWebhook` に、印の無い `charge.*` を `stripe_pi_id` で発表会の入金に結ぶ枝。`applyRecitalDispute` を足す）
- Modify: `src/lib/recitalMoneyDb.ts`（`disputeOpen`・`systemWait` を足す）
- Modify: `src/app/staff/bw6/entries/[id]/page.tsx`（「入金が取り消された」の印）
- Test: `src/lib/__tests__/recitalStripe.test.ts`・`src/lib/__tests__/recitalPayDb.test.ts`・`src/lib/__tests__/recitalMoneyDb.test.ts`（足す）、`src/app/api/recital/stripe-test-webhook/__tests__/route.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `handleRecitalWebhook`・`insertPaymentTx`・`getRecitalSettings`・`tellTaro` の形
- Produces：
  - `parseRecitalChargeEvent(event: unknown): { eventId: string; type: string; livemode: boolean; piId: string; amount: number | null } | null`（`charge.` で始まる知らせで、`payment_intent` が取れる物だけ。異議の物は `data.object.payment_intent`、`amount` は異議の額）
  - `applyRecitalDispute(ev: ReturnType<typeof parseRecitalChargeEvent> & {}, paymentRow: { id: number; householdId: number; eventKey: string; amount: number }): Promise<'recorded' | 'duplicate' | 'acked'>`
  - `disputeOpen(payments: { amount: number; method: string; memo: string | null; id: number }[]): boolean`（純。`memo=MEMO_DISPUTE` のマイナスの行のあと、`memo=MEMO_REINSTATED` のプラスの行が無い）
  - `systemWait(x: { m: MoneySummary; refundTodo: number; payments: Parameters<typeof disputeOpen>[0] }): 'refund' | 'dispute' | null`（純。K220 の (ア)(イ)。(ア)＝`refundTodo > 0 && refundTodo >= m.remaining`）
  - 定数：`MEMO_DISPUTE = 'カードの異議で取り戻された'`・`MEMO_REINSTATED = 'カードの異議の分が戻った'`

決めたこと（設計書 2582・746・2000行、K103・K111・K129・K133・K206・K220）：
- 発表会の知らせかどうか：印（metadata）のある知らせは今までどおり。印の無い `charge.*` は、`payment_intent` の番号で `recital_payments.stripe_pi_id` を引き、見つかった時だけ発表会の知らせとして受ける（ほかの催しの流れへ渡さない＝段階1 Task 22 の「`bf_payments` に空の注文の行が入る」を止める）。見つからなければ今までどおり（ほかの催し）。
- マイナスの行を作るのは、お金が取り戻された知らせ `charge.dispute.funds_withdrawn` だけ（`insertPaymentTx`：`method='card'`・`amount`＝−異議の額・`source='stripe_webhook'`・`stripeEventId`＝知らせの番号・`memo=MEMO_DISPUTE`）。戻った知らせ `charge.dispute.funds_reinstated` はプラスの行（`memo=MEMO_REINSTATED`）。`charge.refunded`（Stripe の画面で人が返した）と、ほかの `charge.dispute.*` は受けるだけ（K206：人が返した分は「返金を記録」で入れる）。どの時も TARO に知らせる（題「カードの異議の知らせがありました」・本文は整理番号と知らせの番号だけ）。
- **作る前に確かめる（U38）**：Stripe の文書で、異議の知らせの種類の名前と、`data.object` に `payment_intent` が入ることを確かめる。ちがえば止まって知らせる。本番の受け口（Stripe の画面の webhook の設定）が `charge.dispute.funds_withdrawn`・`charge.dispute.funds_reinstated`・`charge.refunded` を受ける設定かを、出す人が Stripe の画面で見る（段階1 Task 22 の確かめ待ち）。受けていなければ、足すのは出す人（TARO のログインが要るなら「作る前に止まって聞く物」に入れて1回で頼む）。
- 試し・本番：知らせの `livemode` が、その発表会の `stripe_mode` とちがえば受けるだけ（段階1の K130 の守りと同じ）。
- 自動では取り下げない。催促は `systemWait` で止まる（Task 16 が使う）。世帯の画面に「入金が取り消された（カードの異議）」の印（`disputeOpen` が true のあいだ）。

- [ ] **Step 1: 試験を書く**

```ts
// recitalStripe.test.ts
it('charge.dispute.funds_withdrawn の知らせから pi と額を読む・印が無くても読む', () => { /* … */ });
it('charge. で始まらない・payment_intent が無い → null', () => { /* … */ });
// recitalPayDb.test.ts
it('印の無い異議の知らせ：発表会の入金に結べればマイナスの行を1つ（同じ知らせの2回目は duplicate）', async () => { /* … */ });
it('結べない pi は handled:false（ほかの催しの流れへ）', async () => { /* … */ });
it('funds_reinstated でプラスの行・charge.refunded では行を作らない', async () => { /* … */ });
it('stripe_mode が test の発表会に livemode=true の異議 → 受けるだけ', async () => { /* … */ });
// recitalMoneyDb.test.ts
it('disputeOpen：マイナスのあとに戻りがあれば false', () => { /* … */ });
it('systemWait：返す分 todo ≧ 残り → refund・異議 → dispute・両方なし → null・残り 0 で返す分 0 → null', () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる** → FAIL（3本）
- [ ] **Step 3: 作る**
- [ ] **Step 4: 通ることを確かめる** → PASS（3本と、試しの受け口の route の試験）
- [ ] **Step 5: 画面で見る**（M5）：異議の行のある試しの世帯の画面に印が出る
- [ ] **Step 6: コミット**（`feat(bw6): カードの異議の知らせ（マイナスの行と印）`）

---

### Task 7: 世帯の画面のお金のボタン（出演とりやめ・返金を記録・返す分を作る・この世帯は待つ・延長）

要る日：12/28（月）

**Files:**
- Create: `src/lib/recitalHouseholdOps.ts`
- Modify: `src/app/staff/bw6/entries/[id]/actions.ts`・`page.tsx`・`MoneyButtons.tsx`（ボタン）
- Modify: `src/lib/recitalDb.ts`（`listAttention` の6番の一部「待つの日を過ぎた」）
- Test: `src/lib/__tests__/recitalHouseholdOps.test.ts`、`src/lib/__tests__/recitalEntriesStaff.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `applyHouseholdEdits`（`cast_set`・`contact.pay_due_override`）・`createRefundTx`・`insertPaymentTx`・`cancelRefund`・`afterMoneyChanged`・`readHouseholdMoneyTx`、Task 6 の `systemWait`
- Produces（全部 `src/lib/recitalHouseholdOps.ts`）：
  - `withdrawPeople(householdId: number, personIds: number[], x: { reason: string; reasonKind: 'family' | 'unpaid' | 'other'; toldOn: string; staffName: string; dryRun?: boolean }): Promise<{ ok: true; totalBefore: number; totalAfter: number; paidKept: number; changeId: number | null } | { ok: false; code: 'unpaid_locked' | 'invalid' | 'not_active' }>`
  - `undoWithdraw(changeId: number, staffName: string): Promise<{ ok: true } | { ok: false; code: 'invalid' | 'already' }>`
  - `recordRefundDone(refundId: number, x: { paidOn: string; method: 'card' | 'bank' | 'cash' }, staffName: string): Promise<{ paymentId: number }>`
  - `createExceptionRefund(householdId: number, x: { amount: number; reason: string }, staffName: string): Promise<{ refundId: number }>`（6番。`createRefundTx` の `reasonNo: 6` を `withWriteTx` で包むだけ）
  - `setHouseholdWait(householdId: number, x: { until: string | null; reason: string }, staffName: string): Promise<void>`（`pay_due_override` に日を入れる／空にする。記録 `wait_set`／`wait_cleared`）
  - `setExtendUntil(householdId: number, x: { until: string | null; reason: string }, staffName: string): Promise<void>`（`extend_until`。JST `'YYYY-MM-DD HH:MM'`。記録 `extend_set`）
  - `waitState(h: { pay_due_override: string | null }, sys: 'refund' | 'dispute' | null, todayJst: string): 'manual' | 'manual_past' | 'refund' | 'dispute' | null`（純。`manual`＝今日 ≦ 待つの日）

決めたこと（設計書 1867・1897〜1904・3053・3062・3196・3208行、K48・K168・K187・K198・K206・K207・K217・K220）：
- 出演とりやめ：人ごとにも世帯ごとにも。理由と「家庭に連絡した日」（`toldOn`）が要る。中身は、その人の `in`・`maybe` の出演を全部 `out` にして（段階1の `applyHouseholdEdits` の `cast_set`、`by:'staff'`・`reason`・`receivedAt`＝`toldOn`）、`recital_casts.withdraw_reason` に理由を入れ、記録 `withdraw`（`after` に `{ personIds, castIds }`）。払った分は返さない（返す分を作らない。家庭の都合なので4番ではない。設計書 3196行）。押す前の文は2つ（設計書 1897行）：入金が無い「（名前）さんの出演を取りやめます。請求を消します。出演料はかかりません。」／入金がある「（名前）さんの出演を取りやめます。お支払いずみの ◯円は、返しません。」。
- `reasonKind='unpaid'`（未払い）は、`bank_audit_done_at` が入っていて、`listReviewRows` の closed でない行が0件の時だけ押せる（K168。段階2では押せない形のまま）。それ以外は `unpaid_locked`。
- 取りやめを戻す：`withdraw` の記録の `castIds` を、取りやめる前の状態（`before` に持つ `in`／`maybe`）に戻す（`applyHouseholdEdits` の `cast_set`）。記録 `withdraw_undo`。同じ記録を2回戻さない（`already`）。締切のあとでも戻せる（例外の印は段階1の決まりで付く）。
- 返金を記録：`todo` の返す分を1つ選び、日と返し方を入れる。`insertPaymentTx` でマイナスの行（`amount`＝−返す分の額・`method`＝返し方・`source='manual'`・`memo='返金'`）を入れ、返す分を `status='done'`・`payment_id`・`done_at` にする（同じ書き込み）。返す額は返す分の額そのまま（一部だけ返す形は作らない。ちがう額を返したら、返す分を取り消して作り直す。仮に決めた。「迷って仮に決めた所」4）。家庭の口座はアプリに入れない（K181）。メールは送らない。
- この世帯は待つ：日付（今日より後）と理由を1行。`pay_due_override` に入れる＝期限もその日にのびる（マイページ・メールの期限はその日。段階1の決まり）。「待つ」の印は `waitState`。待つの日を過ぎたら（`manual_past`）見てほしいことの6番「待つの日を過ぎた世帯：整理番号」に出す（設計書 620行。総点検のあとの6番の本体は段階3）。
- 延長：日時と理由。延長中はマイページが「受付中」と同じに動く（段階1の `canFamilyEdit` がもう読む）。
- ボタンは、まとめた世帯では出さない（段階1 Task 19 の裁定）。全部、2段階ボタン＋名前。

- [ ] **Step 1: 試験を書く**（`recitalHouseholdOps.test.ts`）

```ts
it('払う前のとりやめ：請求が消え合計0・返す分は作らない・withdraw_reason が入る・記録 withdraw', async () => { /* … */ });
it('払ったあとのとりやめ：合計は下がるが返す分は作らない・paidKept＝払った額', async () => { /* 32,500 払った1人を取りやめ → paidKept 32,500・refunds 0 行 */ });
it('理由が未払いは総点検の前は unpaid_locked', async () => { /* … */ });
it('取りやめを戻す：in と maybe が元どおり・合計も元どおり・2回目は already', async () => { /* … */ });
it('返金を記録：マイナスの行が1つ・返す分が done・payment_id が入る・同じ返す分の2回目は落ちる', async () => { /* … */ });
it('返す分を作る（6番）：お支払いずみの分をこえると over_overpaid', async () => { /* … */ });
it('待つ：pay_due_override に入る・空にもできる・記録 wait_set／wait_cleared', async () => { /* … */ });
it('waitState：今日 ≦ 日 → manual・過ぎた → manual_past・日なしで sys があれば sys', () => { /* … */ });
it('延長：extend_until が入り canFamilyEdit が締切のあとも true', async () => { /* … */ });
it('まとめた世帯は全部 not_active か throw', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる** → FAIL
- [ ] **Step 3: `recitalHouseholdOps.ts` を作る**（書き込みのあとは `afterMoneyChanged(id, 'total')`（とりやめ・戻す）か `'payment'`（返金を記録）。書き込みの中から呼ばない）
- [ ] **Step 4: 通ることを確かめる** → PASS
- [ ] **Step 5: 画面の試験を足す**（`recitalEntriesStaff.test.ts`：actions が `requireRecitalStaff` を呼ぶ・名前が `RECITAL_STAFF_NAMES` でなければ拒む）→ FAIL → actions とボタンを作る → PASS。6番の一部を `listAttention` に足す（試験は `recitalStaffHome.test.ts`）。
- [ ] **Step 6: 画面で見る**（M5）：押す前の文が2つの場合で出る・戻すが働く・待つの日がマイページの期限に出る
- [ ] **Step 7: コミット**（`feat(bw6): 世帯の画面の出演とりやめ・返金を記録・返す分を作る・待つ・延長`）

---

## 家（family）家庭の画面 — Task 8〜10

もと：設計書 4-2（1185〜1680行。家族を足す 1538行・全部やめる 1544・1550行・12/15 にまだ無い時の文 1253・1532行）、5-2（2251〜2293行）、5-5（2392〜2539行）、K11・K208・K221・K222。

### Task 8: マイページの「家族を足す」

要る日：12/22（火）（設計書 4781行。12/8 の判定で通っていれば、もっと早くてよい）

**Files:**
- Modify: `src/lib/recitalEntryDb.ts`（`HouseholdEdit` に `person_add` を足す。`submitEntry` の人を入れる所を `insertPersonTx` に切り出し、両方から呼ぶ）
- Modify: `src/lib/recitalFamilyDb.ts`（`previewFamilyAdd`・`applyFamilyAdd`）
- Create: `src/app/bw6/my/FamilyAddForm.tsx`（クライアント）
- Modify: `src/app/bw6/my/actions.ts`（`previewFamilyAddAction`・`saveFamilyAddAction`）・`src/app/bw6/my/page.tsx`（欄を置く）
- Modify: `src/lib/recitalMail.ts`（変更の控えの「足した人」の行。`change.lines` に1行足すだけ）
- Test: `src/lib/__tests__/recitalEntryDb.test.ts`・`src/lib/__tests__/recitalMyPageDb.test.ts`（足す）、`src/lib/__tests__/recitalEntryActions.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `applyHouseholdEdits`・`recomputeChargesTx`・`buildEntryFeePeople`・`samePersonIdx`（今は中だけの関数。`export` にする）・`matchMember`・`matchFeePreset`・`normalizeBirthday`・`requireHouseholdByToken`・`canFamilyEdit`
- Produces：
  - `HouseholdEdit` に `| { type: 'person_add'; person: Omit<EntryPersonInput, 'tempId' | 'isContact'> }`（家庭からは `cast_set` と `person_add` だけ通す）
  - `insertPersonTx(tx: Transaction, x: { eventKey: string; householdId: number; person: Omit<EntryPersonInput, 'tempId' | 'isContact'>; source: 'form' | 'family' | 'staff' | 'mocchin'; now: Date }): Promise<{ personId: number }>`（`recitalEntryDb.ts`。seq の採番・会員の照合・事前登録の照らし合わせ・出演の行。`submitEntry` が今やっている所と同じ中身）
  - `previewFamilyAdd(token: string, person: …, opts: { confirmSamePerson: boolean }): Promise<{ ok: true; totalBefore: number; totalAfter: number; remainingAfter: number } | { ok: false; code: 'closed' | 'same_person' | 'invalid' | 'max_works'; message: string; fieldErrors?: Record<string, string> }>`
  - `applyFamilyAdd(token: string, person: …, opts: { confirmSamePerson: boolean }): Promise<同じ型（ok の時は personId も）>`

決めたこと：
- 出す世帯：`canFamilyEdit` が true（1/31 23:59 まで。延長中も）で、`status='active'` の世帯。払ったあとの世帯にも出す（設計書に止める決まりが無い。払ったあとは差額が残りに出る。設計書 2549〜2554行）。
- 入れる物は申込フォームの画面2〜4と同じ（姓・名／セイ・メイ／生年月日／インスタ／作品の「出る・迷っている」／Tシャツ）。確かめも同じ関数で（全角の数字・ハイフンは半角と同じ。生年月日は今日より前。18歳より下の人を「連絡する人と同じ」にはできない＝足す人は連絡する人にならない。1人 `max_works_per_person` 作品まで。選べる作品はフォームと同じ `entry_mode='form'` かつ `status='open'`）。
- 同じ人（カナ＋生年月日がほかの世帯にいる）は、申込フォームと同じく確かめのチェック（`confirmSamePerson`）を求める。
- 流れは「えらぶ → 金額を見る（`previewFamilyAdd`＝`dryRun`）→ 決定」。決定は1回で、変更の控えのメール1通（段階1の `applyHouseholdEdits` の中の送り方）。二度押しは、画面でボタンを止めるのと、`applyFamilyAdd` の中で「同じ世帯に同じカナ＋生年月日の人がもういる」なら足さずに前の結果を返す（`replay`）の2つで守る。
- 1人目の選び直しは段階1の `recomputeChargesTx` がやる（例：兄2作品 32,500 に妹1作品を足すと 37,500、差額 5,000。設計書 2562行）。画面に「ご家族の中で、いちばんお得になる組み合わせで計算しています。」（設計書 2259行）。
- 記録は `person_added`（`after` に `{ personId, works: [workId…] }`。名前・生年月日は入れない）。
- 欄は「作品を足す・やめる」の下。見出し「ご家族を足す」。締切のあとは出さない。

- [ ] **Step 1: 試験を書く**

```ts
// recitalEntryDb.test.ts
it('person_add：人が1人増え、1人目が入れかわって合計 32,500 → 37,500、差額 5,000 が残りに出る（払ったあと）', async () => {
  /* seedRules・兄 2作品 in・32,500 払い済み → applyHouseholdEdits(hid, [{ type:'person_add', person: 妹1作品 }], { by:'family', actor:'family' })
     → totalBefore 32500・totalAfter 37500・remainingAfter 5000 */
});
it('person_add：全角の生年月日「２０１５－０４－０１」を半角と同じに読む', async () => { /* … */ });
it('person_add：生年月日が今日より後・作品 6つ・選べない作品は invalid／max_works', async () => { /* … */ });
it('submitEntry は insertPersonTx に切り出しても今の試験のまま通る', async () => { /* 既存の submitEntry の試験を流すだけ（このファイルの今の試験が全部 PASS） */ });
// recitalMyPageDb.test.ts
it('applyFamilyAdd：同じ人がほかの世帯にいれば same_person・確かめにチェックで通る', async () => { /* … */ });
it('applyFamilyAdd：同じ中身の2回目は1人しか増えない（replay）・控えのメールも1通', async () => { /* … */ });
it('applyFamilyAdd：締切のあとは closed・延長中は通る・まとめた世帯は invalid', async () => { /* … */ });
it('記録 person_added に名前と生年月日が入らない', async () => { /* after_json を読む */ });
```

- [ ] **Step 2: 落ちることを確かめる** → FAIL
- [ ] **Step 3: `insertPersonTx` を切り出す → `submitEntry` の今の試験が全部通ることを先に確かめる**（Run: `npx vitest run src/lib/__tests__/recitalEntryDb.test.ts`。切り出しだけで落ちたら、切り出しを直す）
- [ ] **Step 4: `person_add`・`previewFamilyAdd`・`applyFamilyAdd` を作る**
- [ ] **Step 5: 通ることを確かめる** → PASS（2本）
- [ ] **Step 6: actions と画面を作る**（`FamilyAddForm` は申込フォームの部品の見た目にそろえる。入力欄は全部 `RECITAL_INPUT_CLS`）。actions の試験（`recitalEntryActions.test.ts`）：鍵の形が違えば拒む・`previewFamilyAddAction` はメールを送らない。
- [ ] **Step 7: 画面で見る**（M5・375px）：足すと金額の前後が出る・決定で控えが1通・打った文字が見える
- [ ] **Step 8: コミット**（`feat(bw6): マイページの「家族を足す」`）

---

### Task 9: マイページの「全部やめる」と、文の切りかえ

要る日：12/22（火）（Task 8 と同じ push）

**Files:**
- Modify: `src/lib/recitalFamilyDb.ts`（`withdrawAllByFamily`）
- Modify: `src/app/bw6/my/actions.ts`・`page.tsx`
- Modify: `src/lib/recitalPublic.ts`（`FAMILY_ADD_LINE` の文を切りかえる）・`src/app/bw6/entry/EntryForm.tsx`・`src/app/bw6/guide/page.tsx`（その1行を使う所）
- Test: `src/lib/__tests__/recitalMyPageDb.test.ts`・`src/lib/__tests__/recitalPublic.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `applyHouseholdEdits`（`cast_set`）・`readHouseholdMoney`・`canFamilyEdit`
- Produces：
  - `withdrawAllByFamily(token: string, opts: { dryRun?: boolean }): Promise<{ ok: true; totalBefore: number; totalAfter: number } | { ok: false; code: 'paid' | 'closed' | 'invalid' | 'nothing' }>`
  - `FAMILY_ADD_LINE` の新しい文：`'ご家族を足したいときは、マイページの「ご家族を足す」からできます。1月31日（日）まで。'`（仮の文。「作る前に止まって聞く物」5）

決めたこと（設計書 1544・1550・2433・2604行、K11）：
- 出すのは、払った額が0の世帯（`m.paid <= 0`）だけ。払ったあとの世帯は、ボタンの代わりに「出演を全部やめるときは、公式LINEでお知らせください。」の1行。
- 中身は、世帯の全員の `in`・`maybe` の出演を `out` にする `cast_set` の束を1回の `applyHouseholdEdits`（`by:'family'`）で。行は消さない。合計は0、見え方は「出演なし」。変更の控えを1通。記録は段階1の `cast_set` の記録に加えて `all_out_family` を1行。
- 押す前の文：「全員の出演を取りやめます。Tシャツも取り消します。金額は0円になります。1月31日（日）までは、マイページから、もう一度足せます。」（設計書 1544行の人ごとの文を、全員の形にした。仮の文。「作る前に止まって聞く物」5）。2段階ボタン（`confirm()` は使わない）。
- 出演なしの世帯にも、1/31 までは「作品を足す」「家族を足す」を出す（設計書 1353行）。

- [ ] **Step 1: 試験を書く**

```ts
it('払う前の世帯：全員 out・合計0・見え方 none・控え1通・all_out_family の記録', async () => { /* … */ });
it('払ったあとの世帯は paid（何も変わらない）', async () => { /* … */ });
it('締切のあとは closed・出演が1つも無い世帯は nothing', async () => { /* … */ });
it('dryRun は書かずに合計だけ返す', async () => { /* … */ });
it('FAMILY_ADD_LINE は「12月22日（火）から」を含まない', () => { expect(FAMILY_ADD_LINE).not.toContain('12月22日'); });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**（2本）
- [ ] **Step 3: 画面で見る**（M5）：払う前の世帯にボタン、払った世帯に1行
- [ ] **Step 4: コミット**（`feat(bw6): マイページの「全部やめる」`）

---

### Task 10: （12/8 に段階1の Task 15 を外した時だけ）作品を足す・やめるを戻す

要る日：12/22（火）。**12/8 に Task 15 を出すと決まっていれば、このタスクは飛ばす**（実装記録に「飛ばした」と1行）。

段階1の実装記録：「12/8 に出さないと決めたら git revert 82d6bbec＋文3か所（`src/app/bw6/guide/page.tsx` 60行目・`src/app/bw6/entry/EntryForm.tsx` 432行目・`src/lib/recitalLineReplies.ts` 56行）」。

**Files:**
- Modify: 段階1の revert のコミットをもう一度 revert する（`git revert <revert のコミット>`）。文3か所と `src/lib/recitalMail.ts` の `MYPAGE_ITEMS_STAGE1`（`'お支払い、インスタ、作品を足す・やめる'`）をもとに戻す。
- Test: `src/lib/__tests__/recitalWorkEdit.test.ts`・`recitalWorkEditDb.test.ts`・`recitalMail.test.ts`（もとの試験がそのまま通る）

- [ ] **Step 1: revert のコミットを `git log --oneline --grep=revert -- src/app/bw6/my` で見つける**（見つからない・2つ以上なら止まって知らせる）
- [ ] **Step 2: `git revert --no-edit <番号>`** → ぶつかったら止まって知らせる（Task 8・9 と同じファイルなので、ぶつかったら Task 8・9 の形を残して手で合わせる前に知らせる）
- [ ] **Step 3: 試験を流す** — Run: 上の3本 → PASS
- [ ] **Step 4: 画面で見る**（M5）：マイページに「作品を足す・やめる」が出る
- [ ] **Step 5: コミット**（revert のコミット文のまま＋`Co-Authored-By`）

---

## 一（list）一覧・料金の早見・イントラ — Task 11〜14

### Task 11: 申込の一覧の人ごと・作品ごとの見方・しぼりこみ・CSV

要る日：12/29（火）（設計書 4788行「12月中」）

**Files:**
- Modify: `src/lib/recitalDb.ts`（`listPersonRows`・`listCastRows` を足す）
- Create: `src/lib/recitalCsv.ts`（純）
- Create: `src/app/staff/bw6/entries/csv/route.ts`（`withAuth`。CSV を返す）
- Modify: `src/app/staff/bw6/entries/page.tsx`（`?by=household|person|work` と、しぼりこみ）
- Test: `src/lib/__tests__/recitalCsv.test.ts`、`src/lib/__tests__/recitalEntriesStaff.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `listEntryRows`・`listWorks`・`schoolGrade`・`toCSV`（`src/lib/csvUtil.ts`）
- Produces：
  - `type PersonListRow = { personId: number; householdId: number; refCode: string; personCode: string /* 'P' + seq を3けた */; name: string; kana: string; grade: string; category: string; feeClass: string | null; inWorks: string[]; maybeWorks: string[]; tshirtSize: string | null; snsOk: boolean; photoOk: boolean; matchStatus: string | null; householdView: HouseholdView }`
  - `listPersonRows(eventKey: string): Promise<PersonListRow[]>`（active の世帯の active の人。学年は本番の日 `show_date` で）
  - `type CastListRow = { workId: number; workCode: string; title: string; personId: number; personCode: string; name: string; grade: string; status: 'in' | 'maybe'; paid: boolean; snsOk: boolean }`
  - `listCastRows(eventKey: string, workId?: number): Promise<CastListRow[]>`（作品が `dropped` でない・人と世帯が active。並びは作品の `sort_order` → `recital_casts.sort_order` → 学年 → カナ）
  - `entriesCsv(kind: 'household' | 'person' | 'cast', rows: EntryListRow[] | PersonListRow[] | CastListRow[]): string`（純。1行目は日本語の見出し。BOM 付き UTF-8 は route が付ける）

決めたこと（設計書 1852〜1854行。CSV の列は設計書に無いので、ここで決めた。「迷って仮に決めた所」5）：
- 見方は3つ：世帯ごと（今の一覧）／人ごと／作品ごと。しぼりこみは今の5つ（全部・仮受付・申込完了・追加分がお支払い待ち・出演なし）に、人ごとでは「特別な料金の人」「会員の確認待ち」、作品ごとでは作品を1つえらぶ、を足す。「期限を過ぎた」は総点検のあと（段階3）。
- CSV の列：世帯＝整理番号・連絡する人・人数・作品の数・合計・払った額・残り・状態・払い方・確認中。人＝P番号・整理番号・名前・カナ・学年・区分・特別な料金・出る作品・迷っている作品・Tシャツ・SNS・写真・会員の確認・世帯の状態。作品＝W番号・作品・P番号・名前・学年・出る／迷っている・世帯の支払い・SNS。**メール・電話・生年月日・インスタは CSV に入れない**（画面で見る。外へ出すファイルに個人の連絡先を載せない）。
- 作品ごとの見方の見出しに「SNS に出さない人がいる」の印（`sns_ok=0` の人がいる作品。作品の画面と同じ決まり）。
- CSV の route は `withAuth` で包み、`?ev=` を `pickStaffEventKey` で決める。ファイル名は `bw6_<kind>_<YYYYMMDD>.csv`（名前を入れない）。

- [ ] **Step 1: 試験を書く**（`recitalCsv.test.ts` と、`listPersonRows`・`listCastRows` の DB の試験を `recitalEntriesStaff.test.ts` に）

```ts
it('人の CSV の見出しと1行（メール・電話・生年月日・インスタの列が無い）', () => { /* … */ });
it('カンマ・改行・ダブルクォートを含む作品名を正しく囲む', () => { /* toCSV の決まり */ });
it('listCastRows：dropped の作品・out・passed・まとめた世帯の人は出ない・並び', async () => { /* … */ });
it('listPersonRows：学年は本番の日で（2015-04-01 生まれ → 本番 2027-04-11 で 小6）', async () => { /* schoolGrade の決まりの値に合わせる */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**
- [ ] **Step 3: 画面と route を作り、画面で見る**（M5）：3つの見方・CSV が Numbers／Excel で文字化けしない
- [ ] **Step 4: コミット**（`feat(bw6): 申込の一覧の人ごと・作品ごとの見方と CSV`）

---

### Task 12: 金額を試す（料金の早見）

要る日：12/29（火）（設計書 4790行「12月中。遅れても害は無い」）

**Files:**
- Create: `src/app/bw6/fee/FeeTry.tsx`（クライアント）・`src/app/bw6/fee/actions.ts`（`quoteTryAction`）
- Modify: `src/app/bw6/fee/page.tsx`（早見の表の下に置く）
- Test: `src/lib/__tests__/recitalFee.test.ts`（足す）・`src/lib/__tests__/recitalEntryActions.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `expectedCharges`・`pickFirstPerson`（`recitalFee.ts`）、`listFeeRules`
- Produces：`quoteTry(rules: FeeRule[], counts: number[]): { total: number; perPerson: { idx: number; amount: number; first: boolean }[] }`（純。`src/lib/recitalFee.ts`。人ごとの作品の数だけで計算する＝会員かどうか・特別な料金は見ない）・`quoteTryAction(eventKey: string, counts: number[]): Promise<ReturnType<typeof quoteTry> | { error: string }>`

決めたこと（設計書 1199・1207〜1208行）：家族それぞれの作品の数（0〜`max_works_per_person`）を入れると合計が出る。人は5人まで。「ご家族の中で、いちばんお得になる組み合わせで計算しています。」を出す。特別な料金は扱わない（「特別な料金の方は、お申し込みのあとの金額が正しい金額です。」の1行）。公開ページなので DB には料金の規則を読むだけ・書かない・回数制限は段階1の `RECITAL_RATE.precheck` と同じ仕組みで。

- [ ] **Step 1: 試験を書く**

```ts
it('1人 1〜5作品：26,500／32,500／35,500／38,500／41,500', () => { /* 設計書 1207行の5つ */ });
it('家族の例（seedRules の規則）：[1,1]→34,500・[2,1]→37,500（1人目は1作品の人）・[1,1,1]→42,500・[1,1,1,1]→50,500', () => { /* 設計書 1208行の4つ。組み合わせは規則から手で計算した物。設計書の例とちがう組み合わせだったら止まって知らせる */ });
it('0作品の人は数えない・6作品は error', () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**
- [ ] **Step 3: 画面で見る**（M5・375px）
- [ ] **Step 4: コミット**（`feat(bw6): 料金の早見に「金額を試す」`）

---

### Task 13: イントラの鍵とスタッフの画面

要る日：12/28（月）（Task 14 と同じ push）

**Files:**
- Create: `src/lib/recitalInstructor.ts`（純：URL・頼みごとの期限・並び）
- Create: `src/lib/recitalInstructorDb.ts`
- Create: `src/app/staff/bw6/instructors/page.tsx`・`actions.ts`
- Create: `scripts/migrations/20261217_recital_stage2_seed_test.sql`（`bw6-test` の頼みごと13個とイントラ2人分の鍵ではない行は入れない＝頼みごとだけ）
- Create: `scripts/migrations/20261218_recital_asks_bw6.sql`（`bw6` の頼みごと13個。出す手順2）
- Modify: `src/app/staff/bw6/page.tsx`（ボタンに「イントラ」）
- Test: `src/lib/__tests__/recitalInstructor.test.ts`・`src/lib/__tests__/recitalInstructorDb.test.ts`

**Interfaces:**
- Consumes：段階1の `recital_instructor_links`・`recital_work_instructors`・`listWorkPickOptions`、Task 1 の `recital_asks`・`recital_ask_answers`
- Produces：
  - `recitalInstructorUrl(token: string): string`（`${RECITAL_PUBLIC_ORIGIN}/bw6/i?t=<token>`）
  - `askDueOn(ask: { due_on: string | null; due_offset_days: number | null }, showDate: string): string | null`（純。`due_on` があればそれ、無ければ本番の日から `due_offset_days` 日前、両方無ければ null）
  - `type InstructorRow = { linkId: number | null; instructorId: number | null; displayName: string; linkKind: 'instructor' | 'guest' | 'club'; works: { workId: number; workCode: string; title: string }[]; lastOpenedAt: string | null; hasLink: boolean }`
  - `listInstructorRows(eventKey: string): Promise<InstructorRow[]>`（`recital_work_instructors` の担当（`instructor_id` があれば id で、無ければ `display_name` で1人にまとめる）と、今の鍵の行（`revoked_at IS NULL`）を合わせる）
  - `issueInstructorLink(eventKey: string, x: { instructorId: number | null; displayName: string; linkKind: 'instructor' | 'guest' | 'club' }, staffName: string): Promise<{ linkId: number; token: string }>`（もう生きている鍵があれば、それに `revoked_at` を入れてから新しい行。記録 `instructor_link`）
  - `revokeInstructorLink(linkId: number, staffName: string): Promise<void>`
  - `setAskAnswer(x: { askId: number; instructorLinkId: number | null; workId: number | null; status: 'todo' | 'submitted' | 'checked'; answer?: Record<string, string> | null }, staffName: string): Promise<void>`（スタッフが「すんだ」を付ける・頼みごと2のTシャツのサイズを入れる）
  - `pasteText3(name: string, url: string): string`（純。設計書 7-10 の文3。`（イントラの名前）`・`（イントラのページのURL）` を差し込む）

決めたこと（設計書 4-3（1681〜1784行）・1798行・7-10（4562〜4633行）、K6・K27・K41・K64・R-56）：
- 鍵は `randomBytes(32).toString('base64url')`（43文字）。`access_token` は台帳SQL・種・ログに書かない。作り直すと古い URL はすぐ使えなくなる（`revoked_at`）。
- スタッフの画面 `/staff/bw6/instructors`：担当ごとに1行（名前・担当の作品・鍵の有無・最後に開いた日時）。ボタン：「鍵を作る／作り直す」（2段階＋名前）・「止める」・「貼る文を写す」（文3。URL 入り。写すだけで送らない）・頼みごとの「すんだ」を付ける欄（頼みごと2はTシャツのサイズを選ぶ欄つき）。
- 頼みごとの13個は設計書 1719〜1734行の表のとおり（`ask_no`・`title`・`target`・期限・`tentative_ok`・`stage`）。期限：1＝`2026-12-07`、2＝`2027-01-31`、3＝空（`due_note`＝「リハの候補日が出てから1週間」）、4＝`2027-02-21`、5・6＝`2027-02-28`、7＝空（`due_note`＝「撮影日の1週間後」）、8＝`2027-03-07`、9＝`2027-03-14`、10＝`2027-03-21`、11＝`2027-03-28`、12＝`2027-03-10`、13＝`2027-02-21`。どれも案（T11 で TARO が決める。「作る前に止まって聞く物」3）。`ask_key` は `a01`〜`a13`。
- 段階2で答えを持つのは頼みごと1（すんだにするだけ）・2（Tシャツのサイズ）・3（すんだにするだけ）。4〜13 は期限と名前を出すだけ（段階3で入れる所を作る）。イントラが自分で入れる欄は作らない（ページにボタンは無い。設計書 1685〜1690行）。入れるのはスタッフ（「作る前に止まって聞く物」4）。

- [ ] **Step 1: 試験を書く**

```ts
it('recitalInstructorUrl の形', () => { expect(recitalInstructorUrl('abc')).toBe('https://event.boom-sendai.com/bw6/i?t=abc'); });
it('askDueOn：due_on 優先・offset は本番の日から・両方無ければ null', () => { /* … */ });
it('pasteText3：設計書 7-10 の文3のとおり（名前と URL が入る）', () => { /* 全文を expect に書く */ });
it('issueInstructorLink：43文字の鍵・2回目は前の行に revoked_at・生きている鍵は1つ', async () => { /* … */ });
it('listInstructorRows：同じ instructor_id の担当は1行にまとまる・id の無い外部の人は名前で1行', async () => { /* … */ });
it('setAskAnswer：同じ相手に2行できない（更新になる）・頼みごと2のサイズが answer_json に入る', async () => { /* … */ });
it('記録 instructor_link に鍵の文字が入らない', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**（2本）
- [ ] **Step 3: 種の台帳SQL2本を書く**（`recital_asks` に13行ずつ。`created_at` は固定の文字 `'2026-12-17T00:00:00.000Z'`。`20261218_recital_asks_bw6.sql` の期限は上の案。T11 の答えが来たら、流す前にこのファイルの日を直す）。`setupRecitalTestDb` は台帳を全部流すので、`recitalInstructorDb.test.ts` で `bw6-test` の頼みごとが13個あることも確かめる。
- [ ] **Step 4: スタッフの画面を作り、画面で見る**（M5）
- [ ] **Step 5: コミット**（`feat(bw6): イントラの鍵とスタッフの画面・頼みごと13個`）

---

### Task 14: イントラのページ `/bw6/i`

要る日：12/28（月）（設計書 4787行。間に合わないときは頼みごと1〜3の期限をその分うしろへ。裁定 R-132）

**Files:**
- Create: `src/app/bw6/i/page.tsx`（公開。頭に「⚠️ 公開ページ（認証なし）。理由：イントラ専用の鍵つき URL で開くため。合い言葉は無い（T8）。鍵が合わなければ何も出さない」）
- Modify: `src/lib/recitalInstructorDb.ts`（`loadInstructorPage`）
- Modify: `src/lib/recitalInstructor.ts`（`rosterOf`・`askListOf`・`passedNoticeOf`）
- Test: `src/lib/__tests__/recitalInstructor.test.ts`・`recitalInstructorDb.test.ts`（足す）

**Interfaces:**
- Consumes：Task 13 の物、段階1の `schoolGrade`・`isTokenShape`
- Produces：
  - `type InstructorPage = { name: string; works: { workCode: string; title: string; inCount: number; maybeCount: number; people: { name: string; grade: string; status: 'in' | 'maybe' }[] }[]; asks: { askNo: number; title: string; dueOn: string | null; dueNote: string | null; done: boolean; tentativeOk: boolean }[]; passedCount: number | null; firstOpen: boolean }`
  - `loadInstructorPage(token: string, now: Date): Promise<InstructorPage | null>`（鍵の形がちがう・無い・止めた鍵は null。開いたら `last_opened_at` を入れる。`firstOpen` は入れる前が空だったか）

決めたこと（設計書 1685〜1712行、K64）：
- 出す物は2つだけ：自分の作品の名簿（作品ごとに「出る ◯人／迷っている ◯人」、開くと名前と学年。並びは `recital_casts.sort_order` → 学年 → カナ）と、出す物と期限（13個。期限の近い順、すんだ物は「すんだ」へ下げる。期限が無い物は `due_note` を出す）。
- 見せない物：電話・メール・金額・入金・お支払いの状態・整理番号。名簿の人は「出る」「迷っている」で、お支払いの有無では分けない。出演とりやめ・見送りの人は出ない。名前は姓＋名（`display_name` があればそれ）。
- 文は設計書のまま：いちばん上「（イントラの名前）さんのページ」と「おつかれさまです。いまお願いしたいのは ◯つ です。」（◯＝期限が来ていて、すんでいない頼みごとの数。仮に決めた：設計書の「2つ」は数で変える。「迷って仮に決めた所」6）／名簿の上「出る ◯人／迷っている ◯人。1/31（日）までは、人数が動きます。」とその下の文（1705行）／いちばん下「現金は受け取らずに、公式LINEを案内してください。」／初めて開いた時だけの文（1712行）。
- 2/1〜2/7 だけ、名簿の上に「迷っていた ◯人が外れました」（`passed_auto` の記録の数。Task 19 の後に数が入る。R-50）。
- `noindex`・外へのリンクに元の URL を渡さない（`Referrer-Policy: no-referrer` を `metadata` か `<meta>` で）・生成り色の下地。ボタンは置かない。

- [ ] **Step 1: 試験を書く**

```ts
it('rosterOf：in と maybe だけ・out と passed とまとめた世帯の人は出ない・並び', () => { /* … */ });
it('askListOf：期限の近い順・すんだ物はうしろ・期限の無い物はその前', () => { /* … */ });
it('loadInstructorPage：止めた鍵は null・形のちがう鍵は DB を読まずに null', async () => { /* … */ });
it('loadInstructorPage：金額・電話・メール・整理番号の文字がどこにも入らない', async () => { /* JSON.stringify(page) が /円|@|090/ と ref_code を含まない */ });
it('最初に開いた時だけ firstOpen=true・last_opened_at が入る', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**
- [ ] **Step 3: ページを作り、画面で見る**（M5・375px）：止めた鍵で何も出ない・ページのソースに電話・メール・金額が無い
- [ ] **Step 4: 出す**：push（12/28 まで）。出す人がイントラ1人に先に見せて、分かりにくい所を聞く（設計書 5283行。TARO が見る2つの1つ）。
- [ ] **Step 5: コミット**（`feat(bw6): イントラのページ`）

---

## 月（january）1月に要る物 — Task 15〜25

### Task 15: 人数と席の見込み・年齢別

要る日：1/8（金）（設計書 5256・5281行。諸室の判断に使う）

**Files:**
- Create: `src/lib/recitalCounts.ts`（純）
- Modify: `src/lib/recitalDb.ts`（`loadCountsFacts`）
- Create: `src/app/staff/bw6/counts/page.tsx`
- Modify: `src/app/staff/bw6/page.tsx`（ボタンに「人数」）
- Test: `src/lib/__tests__/recitalCounts.test.ts`・`src/lib/__tests__/recitalDb.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `countRecitalPeople`・`listWorkCounts`・`schoolGrade`・`ageOn`、Task 1 の `seat_*`
- Produces：
  - `seatOutlook(s: Pick<RecitalSettings, 'seat_total' | 'seat_blocked' | 'seat_reserved' | 'seat_invite' | 'seat_tech' | 'seat_cast'>, going: number): { general: number; low: boolean } | null`（純。`seat_total` が空なら null。一般に売れる席＝総席−つぶす席−指定席−招待−テクニカル−出演者席（`seat_cast` が空なら「出る人」の数）。`low`＝一般の席が総席の1割より少ない）
  - `ageBuckets(people: { birthday: string | null; category: string }[], showDate: string): { label: string; count: number }[]`（純。学年ごと＝未就学・小1〜小6・中1〜中3・高1〜高3・大人・生年月日なし。本番の日で）
  - `loadCountsFacts(eventKey: string, now: Date): Promise<{ counts: PeopleCounts; byWork: { workCode: string; title: string; in: number; maybe: number }[]; ages: ReturnType<typeof ageBuckets>; seat: ReturnType<typeof seatOutlook>; countedAt: string }>`

決めたこと（設計書 5-9（3325〜3379行）・2358行）：数え方の名前は 5-9 のとおり。参加費なし・Tシャツ代だけの人は別の行（T10 まで）。MOCCHIN の分は舞台に出る人数に入れる（Task 22 のあと。今は0）。試しの世帯は本番の画面では数えない（段階1と同じ）。数えた日時を出す。席の見込みが少ない時の印はこの画面だけ（最初の画面とメールには出さない）。`low` の1割と、出演者席が空の時に「出る人」を使う決め方は仮（「迷って仮に決めた所」7）。

- [ ] **Step 1: 試験を書く**

```ts
it('seatOutlook：総席が空なら null', () => { /* … */ });
it('seatOutlook：1000−50−100−40−10−（出演者席が空なら出る人 120）＝680・low=false', () => { /* … */ });
it('seatOutlook：一般が総席の1割より少なければ low', () => { /* … */ });
it('ageBuckets：2020-05-01 生まれは本番 2027-04-11 で未就学・2015-04-01 は小6・生年月日なしは別', () => { /* schoolGrade の値に合わせる */ });
it('loadCountsFacts：dropped の作品・まとめた世帯は数えない', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**
- [ ] **Step 3: 画面を作り、画面で見る**（M5）
- [ ] **Step 4: コミット**（`feat(bw6): 人数と席の見込み・年齢別`）

---

### Task 16: 催促の計算（純）`recitalRemind.ts`

要る日：1/10（日）（Task 17・18・19 の前提）

**Files:**
- Create: `src/lib/recitalRemind.ts`
- Test: `src/lib/__tests__/recitalRemind.test.ts`

**Interfaces:**
- Consumes：段階1の `bankToldWaitDue`・`jstToMs`・`shiftDays`・`todayJst`、Task 6 の `systemWait` の返す値、段階1の `ReviewRowView`
- Produces：
  - `type RemindKind = 'pay_guide' | 'pay_request' | 'pay_remind' | 'maybe_notice'`
  - `remindPlan(s: Pick<RecitalSettings, 'pay_due' | 'change_close_at'>): { date: string; kind: RemindKind; round: 1 | 2 | 3 | null }[]`
  - `remindToday(s, todayJst: string): { kind: RemindKind; round: 1 | 2 | 3 | null }[]`
  - `remindEveDates(s): string[]`（次の朝に `pay_guide`・`pay_request`・`pay_remind` がある晩）
  - `noonAskDates(s): string[]`（`pay_due` の2日前〜当日）
  - `isStaleMorning(x: { lastOkImportedAtUtc: string | null; now: Date; s: RecitalSettings }): { stale: boolean; inWindow: boolean; notify: boolean }`
  - `type HouseholdRemindFacts = { householdId: number; status: string; view: HouseholdView; remaining: number; payDueOverride: string | null; sysWait: 'refund' | 'dispute' | null; bankToldAt: string | null; reviewHit: boolean; unconfirmedToday: boolean }`
  - `type SkipReason = 'merged' | 'none' | 'zero' | 'wait' | 'told' | 'review' | 'unconfirmed_today'`
  - `remindSkipReason(h: HouseholdRemindFacts, x: { kind: RemindKind; now: Date; s: RecitalSettings }): SkipReason | null`
  - `reviewHitsHousehold(rows: Pick<ReviewRowView, 'group' | 'candidates' | 'amount' | 'leftover' | 'isLeftover'>[], householdId: number, remaining: number): boolean`
  - `unconfirmedDue(x: { bankToldAt: string | null; bankToldAmount: number | null; remaining: number; paymentsAfterTold: number; reviewSameAmount: boolean; now: Date; s: RecitalSettings }): boolean`
  - `remindDedupeKey(kind: RemindKind | 'bank_unconfirmed', householdId: number, x: { round?: 1 | 2 | 3 | null; dateJst: string; bankToldDate?: string }): string`（Task 1 の鍵の形）
  - `PAY_GUIDE_DAYS_BEFORE_DUE = 26`

決めたこと（設計書 2834〜2866・2809〜2816行、K152〜K156・K211・K219・K220）：
- 日（設定から作る。`pay_due='2027-02-10'`・`change_close_at='2027-01-31 23:59'` で）：`pay_guide`＝`pay_due` の26日前（1/15）、`maybe_notice`＝締切の日の7日前・3日前・当日（1/24・1/28・1/31）、`pay_request`＝締切の次の日（2/1）、`pay_remind` 回1・2・3＝`pay_due` の5日前・前の日・当日（2/5・2/9・2/10）。日は変えない（TARO の決定）。設定から作るのは、BW7 で写す時に日だけ直せばよいようにするため。
- 送らない世帯（`pay_guide`・`pay_request`・`pay_remind` の3つに当てる。設計書 2844〜2851行の7つのうち、世帯ごとに見る5つと、この計画で足した2つ）：`merged`（まとめた世帯）／`none`（出演なし）／`zero`（残り0）／`wait`（`pay_due_override` が入っていて今日 ≦ その日、または `sysWait` がある＝K220）／`told`（`bank_told_at` があって `bankToldWaitDue` が false）／`review`（`reviewHit`）／`unconfirmed_today`（同じ朝に「イ」を出した。K153）。全部の世帯にかかる2つ（①の失敗・取り込みが古い朝）は、呼ぶ側（Task 17）が見る。
- `maybe_notice` は7つを当てない（設計書 2839行）。当てるのは `merged`・`none`（迷っている作品が無ければ送らない＝呼ぶ側が見る）だけ。
- 「追加分 ◯円」だけが残っている世帯（`view='complete_extra'`）にも送る（設計書 2854行。文が変わるのは Task 17）。
- 取り込みが古い朝（K155・K156）：今が JST 8:00 より前でも後でも、「今日の 8:00 の時点」で見る＝今日の 8:00 から `pay_remind_stop_hours` 時間前（前の日の 17:00）より後に合った束が無ければ `stale`。`inWindow`＝「払う」を開けた日の次の日 〜 `bank_audit_on` の日（2/12）。窓の外は `stale=false`。`notify`＝`stale` かつ今日が 12/31〜1/4 でない（休みの朝は TARO に知らせない。ただし「イ」は止める＝`stale` は true のまま）。
- 「イ」（`unconfirmedDue`）：4つ全部（設計書 2809〜2814行）＝印から3日（`bankToldWaitDue`）・取り込みが古い朝でない（呼ぶ側）・印のあとに入金の行が無い（`paymentsAfterTold === 0`）・見てほしい入金に印の金額と同じ決まっていない入金が無い（`reviewSameAmount=false`）。加えて、残り＞0、今日 ≦ `bank_audit_on`（2/13 からは出さない）。同じ印で1通（鍵 `bank_wait:<id>:<印の JST 日付>`）。
- `reviewHitsHousehold`（7番）：closed でない行で、候補にその世帯がある行、または行ののこり（`isLeftover` なら `leftover`、ちがえば `amount`）がその世帯の残りと同じ行が1つでもある。

- [ ] **Step 1: 試験を書く**（`recitalRemind.test.ts`）

```ts
const s = parseRecitalSettings([{ key: 'pay_open_at', value: '2026-12-15 12:00' }, { key: 'pay_ok_at', value: '2026-12-14 10:00' }]);
it('remindPlan：設定の初めの値で 1/15・1/24・1/28・1/31・2/1・2/5・2/9・2/10', () => {
  expect(remindPlan(s)).toEqual([
    { date: '2027-01-15', kind: 'pay_guide', round: null }, { date: '2027-01-24', kind: 'maybe_notice', round: null },
    { date: '2027-01-28', kind: 'maybe_notice', round: null }, { date: '2027-01-31', kind: 'maybe_notice', round: null },
    { date: '2027-02-01', kind: 'pay_request', round: null }, { date: '2027-02-05', kind: 'pay_remind', round: 1 },
    { date: '2027-02-09', kind: 'pay_remind', round: 2 }, { date: '2027-02-10', kind: 'pay_remind', round: 3 },
  ]);
});
it('remindEveDates：1/14・1/31・2/4・2/8・2/9／noonAskDates：2/8・2/9・2/10', () => { /* … */ });
it('isStaleMorning：前の日 17:01 の束 → stale=false・16:59 の束 → true・束なし → true', () => { /* now = JST 1/15 8:00 */ });
it('isStaleMorning：12/15（開けた日）と 2/13 は窓の外・1/2 は stale でも notify=false・1/5 は notify=true', () => { /* … */ });
it('remindSkipReason：7つの順（merged → none → zero → wait → told → review → unconfirmed_today）', () => { /* 1つずつ1件 */ });
it('told：2/5（金）10:00 に押した → 2/6・2/7 の朝は told・2/8 の朝は null', () => { /* … */ });
it('told：12/29 に押した → 12/30〜1/3 は数えない → 1/6 の朝に null（1/5 の朝は told）', () => { /* bankToldWaitDue の数え方 */ });
it('wait：pay_due_override=2027-02-20 → 2/10 は wait・2/21 は null／sysWait があれば wait', () => { /* … */ });
it('complete_extra（追加分だけ）にも送る', () => { /* view complete_extra・remaining 5000 → null */ });
it('maybe_notice には zero・told・review を当てない', () => { /* … */ });
it('unconfirmedDue：3日・入金なし・同じ金額の見てほしい入金なし・2/12 まで（2/13 は false）', () => { /* … */ });
it('reviewHitsHousehold：候補に世帯／のこりが残りと同じ／closed は数えない', () => { /* … */ });
it('remindDedupeKey の形', () => {
  expect(remindDedupeKey('pay_remind', 12, { round: 2, dateJst: '2027-02-09' })).toBe('pay_remind_2:12');
  expect(remindDedupeKey('maybe_notice', 12, { dateJst: '2027-01-24' })).toBe('maybe_notice:2027-01-24:12');
  expect(remindDedupeKey('bank_unconfirmed', 12, { dateJst: '2027-01-20', bankToldDate: '2027-01-15' })).toBe('bank_wait:12:2027-01-15');
});
```

- [ ] **Step 2: 落ちることを確かめる** → FAIL
- [ ] **Step 3: `recitalRemind.ts` を作る**
- [ ] **Step 4: 通ることを確かめる** → PASS
- [ ] **Step 5: コミット**（`feat(bw6): 催促の日と、送らない世帯の決まり（純）`）

---

### Task 17: 見回りの「イ」と②催促・取り込みが古い朝・止めた回を commit で出す

要る日：1/14（木）の夜まで（1/15（金）朝8時が最初の催促）。1/12（火）までに終わらないと分かったら止まって知らせる。

**Files:**
- Modify: `src/lib/recitalPatrolDb.ts`（`runPatrol` の `unconfirmed`・`remind` の中身・取り込みが古い朝・止めた知らせ）
- Create: `src/lib/recitalRemindDb.ts`（材料を読む・待ちに積む）
- Modify: `src/lib/recitalMail.ts`（`deliver` の直前の見直し・新しいメールの data）・`src/lib/recitalEmail.ts`（4つの文）
- Modify: `src/app/api/staff/recital/bank-rows/route.ts`（commit が合った時に、止めた回を出す）
- Modify: `src/lib/recitalDb.ts`（4番に「入金が残っているため、催促を止めた世帯：◯」）
- Modify: `src/app/staff/bw6/money/page.tsx`（催促の記録の欄）・`src/app/staff/bw6/settings/`（「催促を止める」＝`remind_paused` の2段階ボタン）
- Test: `src/lib/__tests__/recitalRemindDb.test.ts`・`src/lib/__tests__/recitalPatrolDb.test.ts`（足す）・`src/lib/__tests__/recitalEmail.test.ts`（足す）・`src/lib/__tests__/recitalMail.test.ts`（足す）・`src/app/api/staff/recital/bank-rows/__tests__/route.test.ts`（足す）

**Interfaces:**
- Consumes：Task 16 の全部、Task 5 の `runPatrol`・`readTodayPatrol`、Task 6 の `systemWait`、段階1の `listReviewRows`・`getBankAskFacts` の束の読み方、`sendRecitalMail`（`forceWait: true` で積む）・`flushWaitingMails`
- Produces：
  - `loadRemindFacts(eventKey: string, now: Date): Promise<{ s: RecitalSettings; households: (HouseholdRemindFacts & { bankToldAmount: number | null; paymentsAfterTold: number; reviewSameAmount: boolean })[]; lastOkImportedAtUtc: string | null }>`
  - `queueRemindMails(eventKey: string, now: Date, opts: { kinds: RemindKind[]; unconfirmed: boolean }): Promise<{ considered: number; queued: number; duplicate: number; skippedByReview: number; unconfirmedQueued: number }>`
  - `remindSkipNow(householdId: number, kind: MailKind, now: Date): Promise<SkipReason | 'not_due' | null>`（`deliver` が送る直前に呼ぶ。`bank_unconfirmed` は印が消えた・入金が入った・残り0 なら `not_due`）
  - `RecitalMailData` に足す欄：`remind?: { round: 1 | 2 | 3 | null; extraOnly: boolean; dueToday: boolean }`・`told?: { dateLabel: string; amount: number; receivedLabel: string }`・`passedWorks?: string[]`・`mocchinLine?: boolean`
  - 止めた知らせの文：`buildStaleNotice(x: { remindDay: boolean; startDate: string; url: string }): { subject: string; body: string }`（`src/lib/recitalAsk.ts` に足す。文は設計書 3973〜3985行。題の頭は `notifyTaro` の `subjectPrefix` が付ける）

決めたこと：
- `runPatrol` の②とイ：今日が `remindToday` の `pay_guide`・`pay_request`・`pay_remind` の日なら②、毎朝イ。止める決まりの順：`remind_paused`（スタッフの緊急の止め。この計画で足した。「迷って仮に決めた所」8）→ JST 20:00 より後（`ok:night`。K211 の夜8時の線。その回はとばす）→ ①の失敗（②だけ止める。`ng:recheck`）→ 取り込みが古い（②とイを止める。`ok:stale`。`notify` なら TARO に `buildStaleNotice` を1回。止めた物が1通以上あった朝だけ＝今日が②の日か、イの対象が1世帯以上）。
- 積み方：送る世帯ごとに `sendRecitalMail({ kind, householdId, dedupeKey: remindDedupeKey(…), forceWait: true })`（待ちの行を作るだけ）。そのあと同じ呼び出しの中で `flushWaitingMails(eventKey, now, 20)`。残りは 8:05・8:10・8:15 からの15分おきが出す。同じ朝のイと②は、イを先に積み、その世帯は②で `unconfirmed_today`。
- `deliver` の直前の見直し：`pay_guide`・`pay_request`・`pay_remind`・`bank_unconfirmed`・`maybe_notice` の行は、送る前に `remindSkipNow`。当たれば `status='cancelled'`・`error` に理由の言葉（`zero` など。名前は入れない）。
- 見回りの行の数（Task 5 の形）：`read_rows`＝②で見た世帯・`inserted`＝積んだ数（イも）・`existing`＝もう積んであった数・`rejected`＝`review` で止めた世帯の数。見てほしいことの4番に、今日が②の日で `rejected > 0` なら「入金が残っているため、催促を止めた世帯：◯」（設計書 2853行・K211）。
- 止めた回を commit で出す（K211）：束の入口（`bank-rows/route.ts`）で、`mode='commit'` の束が合って（`check.ok`）、今日の見回りの行が `ok:stale` で、今が JST 8:00〜20:00 なら、`runPatrol(eventKey, now, { from: 'commit' })` を呼ぶ（そのときは束が今日入ったので古くない）。呼ぶのは束の当て・メールのあと、残りの時間で。60秒が心配な時は `flushWaitingMails` の `limit` を、その束でその場で送った数を引いた残り（10 から）にする。残りは15分おきが出す。②とイの送らない世帯は、その時にもう一度見る（`queueRemindMails` がその時の材料で計算する）。
- 文（`buildRecitalMail` の新しい4つ。件名と本文は設計書の行のまま）：`bank_unconfirmed`＝4282〜4302行／`pay_guide`＝4313〜4334行（迷っている作品のある世帯に1行）／`pay_request`＝4360〜4387行（見送りになった作品の1行と MOCCHIN の1行。MOCCHIN の1行は Task 22 の印ができてから。それまで `mocchinLine` は false）／`pay_remind`＝4389〜4413行（回3と追加分だけの世帯は文を変える。期限は `pay_due_override` があればその日）。どれも振込先を書かない。「もうお済みでしたら、このメールはそのままにしてください。」を入れる（`bank_unconfirmed` は除く。設計書の文のとおり）。
- お金の画面の「催促の記録」：日ごと・メールの種類ごとに 送った／取りやめ／失敗 の数（名前は出さない）。
- 設定の画面に「催促を止める」（`remind_paused`。2段階ボタン＋名前。押している間、最初の画面に帯「催促を止めています」）。

- [ ] **Step 1: 文の試験を書く**（`recitalEmail.test.ts`）

```ts
it('pay_guide：件名・本文が設計書 4313〜4334行のとおり（迷っている作品のある世帯は1行足す）', () => { /* 全文を expect に */ });
it('pay_remind：回1・回3（今日）・追加分だけ・期限が pay_due_override の日', () => { /* … */ });
it('pay_request：見送りになった作品の1行', () => { /* … */ });
it('bank_unconfirmed：件名に整理番号が入らない・印の日と金額', () => { /* … */ });
it('どの文にも振込先（bankText）が入らない', () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 文を作る → 通ることを確かめる**
- [ ] **Step 3: 積むと見回りの試験を書く**（`recitalRemindDb.test.ts`・`recitalPatrolDb.test.ts`。時計は `vi.setSystemTime`）

```ts
it('1/15 8:00：残りのある世帯に pay_guide が待ちで積まれ、20通まで出る・残り0／出演なし／まとめた／待つ の世帯には積まない', async () => { /* … */ });
it('同じ朝に2回 runPatrol（8:00 と 8:05）→ 1世帯1通（duplicate）', async () => { /* … */ });
it('見てほしい入金に候補として残る世帯は積まず、見回りの行の rejected に数が入る・4番に出る', async () => { /* … */ });
it('①が失敗した朝：②は積まない・イは積む・ng:recheck', async () => { /* … */ });
it('取り込みが古い朝：②もイも積まない・ok:stale・TARO に1回（1/2 の朝は知らせない）', async () => { /* … */ });
it('remind_paused：②もイも積まない', async () => { /* … */ });
it('イ：3日たった印の世帯に bank_unconfirmed を1通・その朝の②はその世帯に積まない・次の朝はイも②も積まない（同じ印）', async () => { /* … */ });
// Review Focus 1
it('deliver の直前に残りが0なら取りやめ（積んだあとに入金が当たった）', async () => { /* 積む → insertPaymentTx で残り0 → flushWaitingMails → status cancelled・送らない */ });
// Review Focus 3
it('K211：ok:stale の朝、15:00 の commit で②が出る・同じ束の2回目の commit では出ない', async () => { /* … */ });
it('K211：20:01 の commit では出ない（ok:night）', async () => { /* … */ });
// Review Focus 4
it('試しの発表会の催促は test_mail_to へ・まとめた世帯には出ない', async () => { /* … */ });
```

- [ ] **Step 4: 落ちることを確かめる** → FAIL
- [ ] **Step 5: `loadRemindFacts`・`queueRemindMails`・`remindSkipNow`・`runPatrol` の中身・`deliver` の見直し・入口の K211 を作る**
- [ ] **Step 6: 通ることを確かめる** → PASS（5本：`recitalRemindDb`・`recitalPatrolDb`・`recitalMail`・`recitalEmail`・`bank-rows/route`）
- [ ] **Step 7: 通しの試し**（M5・手元の DB）：`bw6-test` に残りのある世帯3つ・残り0の世帯1つ・「振り込みました」の世帯1つを作り、時計を 1/15 8:00 にして `/api/cron/recital-morning` を撃つ（手元の鍵）→ 待ちが3つ・`test_mail_to` に3通・見回りの行が `ok`。結果を数だけ実装記録に書く。
- [ ] **Step 8: 出す**：1/12（火）までに push（最初の本番の②は 1/15）。出した日の夜から、本番の見回りの行が毎朝 `ok` か `ok:stale` で終わっているのを、出す人が 1/14 の朝まで毎朝見る。
- [ ] **Step 9: コミット**（`feat(bw6): 催促と「まだ確認できていません」・取り込みが古い朝の止め方`）

---

### Task 18: 声かけの足し（催促の前の5つの晩・2/8〜2/10 の昼）

要る日：1/14（木）18:59 まで（その晩が最初）

**Files:**
- Modify: `src/lib/recitalAsk.ts`（`shouldAskTaro`・`buildAskMessage`）
- Modify: `src/lib/recitalBankDb.ts`（`getBankAskFacts` に `okBatchSince17` を足す）
- Modify: `src/app/api/cron/recital-bank-ask/route.ts`（`slot=12:00` を受ける）
- Modify: `workers/boom-cron/index.js`（`{ at: '12:00', path: '/api/cron/recital-bank-ask?slot=12:00', label: 'recital-bank-ask-1200' }`）
- Test: `src/lib/__tests__/recitalAsk.test.ts`・`src/lib/__tests__/recitalBankDb.test.ts`（足す）・`src/app/api/cron/recital-bank-ask/__tests__/route.test.ts`（足す）

**Interfaces:**
- Consumes：Task 16 の `remindEveDates`・`noonAskDates`
- Produces：
  - `shouldAskTaro(x: { nowJst; slot; s; gate; okBatchToday: boolean; okBatchSince17: boolean })`（引数を1つ足す。今の呼び出しを全部直す）
  - `buildAskMessage(x: { …今の引数; eve?: boolean })`（`eve` で終わりの行を変える）
  - `getBankAskFacts` の返り値に `okBatchSince17: boolean`（今日の JST 17:00 より後に合った束が1つでもあるか）
  - `NOON_SLOT = '12:00'`

決めたこと（設計書 2883〜2902・3918〜3998行、K157・K211・K213）：
- 次の朝に催促がある晩（`remindEveDates`）の 19:00・20:30：「今日の合った束」ではなく「今日の 17:00 より後の合った束」が無ければ出す（17:00 より前に送った日でも、19:00 にもう一度来る）。見てほしい入金が残っていれば、終わりの行を「見てほしい入金が ◯件あります。あしたの催促の前に、片づけてください。」にする（URL は同じ行の終わり）。
- 2/8〜2/10 の 12:00（`noonAskDates`）：今日の合った束が無ければ出す（いつもの文）。
- `bank_ask_at` に無い時刻でも `12:00` は `noonAskDates` の日だけ受ける（`bank_ask_at` は夜の時刻の設定のまま）。
- 2/12 の総点検の文と、2/15 からの月曜は段階3（作らない）。今の「2/12 からは出さない」の決まりはそのまま。

- [ ] **Step 1: 試験を書く**

```ts
it('1/14 19:00：16:00 に合った束があっても出る・17:30 の束があれば出ない', () => { /* … */ });
it('1/13 19:00（晩でない日）：16:00 の束があれば出ない（今までどおり）', () => { /* … */ });
it('晩の文：見てほしい入金があれば終わりの行が変わる・0件ならいつもの文', () => {
  expect(buildAskMessage({ startDate: '2027-01-13', lastShotOn: '2027-01-13', reviewCount: 2, url: 'u', eve: true }).body.split('\n').at(-1)).toBe('見てほしい入金が 2件あります。あしたの催促の前に、片づけてください。　u');
});
it('12:00：2/8・2/9・2/10 だけ・束があれば出ない・2/7 は出ない', () => { /* … */ });
it('getBankAskFacts.okBatchSince17：16:59 の束は false・17:01 は true・manual は数えない', async () => { /* … */ });
it('route：slot=12:00 を受ける・試しの発表会には出さない', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**（3本）
- [ ] **Step 3: `JOBS` に1行 → 出す**：push → `wrangler deploy`（1/14 の昼まで）
- [ ] **Step 4: コミット**（`feat(bw6): 催促の前の晩と 2/8〜2/10 の昼の声かけ`）

---

### Task 19: 迷っている作品の知らせと、2/1 の見送り

要る日：1/23（土）（最初の知らせ 1/24 朝）。2/1 の見送りは 1/31（日）まで。

**Files:**
- Modify: `src/lib/recitalPatrolDb.ts`（`passed` と `maybe_notice`）
- Modify: `src/lib/recitalRemindDb.ts`（`queueMaybeNotices`・`applyPassedAuto`）
- Modify: `src/lib/recitalEmail.ts`・`src/lib/recitalMail.ts`（`maybe_notice` の文と data）
- Test: `src/lib/__tests__/recitalRemindDb.test.ts`・`recitalPatrolDb.test.ts`・`recitalEmail.test.ts`（足す）

**Interfaces:**
- Consumes：Task 16 の `remindToday`、段階1の `applyHouseholdEdits` を使わない（見送りは家庭の変更ではないので、直に書く。下）
- Produces：
  - `applyPassedAuto(eventKey: string, now: Date): Promise<{ households: number; casts: number }>`（2/1 の朝から毎朝。`change_close_at` を過ぎた `maybe` の出演を `passed` に。延長（`extend_until`）がある世帯は、延長の日時を過ぎた次の朝）
  - `queueMaybeNotices(eventKey: string, now: Date): Promise<{ queued: number; duplicate: number }>`
  - `RecitalMailData.maybeList?: string[]`（「（出る人の名前）：（作品の名前）」の行）

決めたこと（設計書 2514・2612〜2613・2826・4336〜4358行、K10・K219）：
- 見送り：見回りのいちばん初め（①の前）。`recital_casts.status` を `maybe` → `passed`、`decided_at` を入れる。メールは足さない（K219）。記録は世帯ごとに `passed_auto`（`after` に `{ castIds }`。設計書 757行の言葉「見送り（2/1（月）の朝の見回り）」を `reason` に）。お金は変わらない（迷っている出演は請求に入らない）が、念のため `recomputeChargesTx` を同じ書き込みで呼び、合計が変わった世帯だけ `afterMoneyChanged(id, 'total')`。スタッフは例外として「出る」に戻せる（段階1の「代わりに直す」で）。2/1 の `pay_request` の「見送りになった作品」の1行は、この記録から作る（同じ朝、②より前に見送りが済む順）。
- 迷っている作品の知らせ：1/24・1/28・1/31 の朝、`maybe` の出演がある active の世帯。①の失敗でも取り込みが古い朝でも止めない（設計書 2839行）。延長の世帯にも同じ文で送る（「作る前に止まって聞く物」6。答えが来るまでは送る）。鍵 `maybe_notice:<日付>:<世帯id>`。文は設計書 4336〜4358行。
- 迷っている作品の知らせも、`deliver` の直前に `maybe` がまだあるか見る（無ければ取りやめ）。

- [ ] **Step 1: 試験を書く**

```ts
it('2/1 8:00：maybe → passed・記録 passed_auto・メールは出ない・1/31 23:59 の朝（2/1 より前）は何もしない', async () => { /* … */ });
it('延長が 2/3 23:59 の世帯は 2/4 の朝に passed', async () => { /* … */ });
it('同じ朝に2回動いても記録は1つ', async () => { /* … */ });
it('1/24：maybe のある世帯に1通・出演なし・まとめた世帯には積まない・取り込みが古い朝でも積む', async () => { /* … */ });
it('maybe_notice の文：件名に整理番号・迷っている作品の行', () => { /* 設計書 4336〜4358行の全文 */ });
it('積んだあとに家庭が「出る」に決めた → deliver で取りやめ', async () => { /* … */ });
it('2/1 の pay_request に「（作品）は、決まらなかったので、入っていません。」の行', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**
- [ ] **Step 3: 通しの試し**（M5）：時計を 1/24 8:00・2/1 8:00 にして撃つ。数を実装記録に。
- [ ] **Step 4: コミット**（`feat(bw6): 迷っている作品の知らせと 2/1 の見送り`）

---

### Task 20: スタッフが代わりに申し込む

要る日：1/22（金）に本番。1/31（日）までに試しを終える（2/1 からの新しい世帯のただ1つの入口。設計書 4796・5254行、K74・K93、裁定 R-125・H8）

**Files:**
- Modify: `src/lib/recitalEntryDb.ts`（`submitEntryByStaff`）
- Create: `src/app/staff/bw6/entries/new/page.tsx`・`actions.ts`・`StaffEntryForm.tsx`
- Modify: `src/app/staff/bw6/entries/page.tsx`（「代わりに申し込む」のボタン）
- Test: `src/lib/__tests__/recitalEntryDb.test.ts`（足す）・`src/lib/__tests__/recitalEntriesStaff.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `submitEntry` の中身（確かめ・`buildEntryFeePeople`・`expectedCharges`・整理番号）、Task 8 の `insertPersonTx`
- Produces：`submitEntryByStaff(s: Omit<EntrySubmission, 'consentAccepted'> & { contact: EntrySubmission['contact'] & { email: string | null } }, x: { staffName: string; reason: string; receivedAt: string | null; consentChecked: boolean }, now?: Date): Promise<SubmitResult>`

決めたこと（設計書 608・612・1906・2385・2387行）：
- 受付の状態（締切のあと・止めている間）でも入れられる。ただし `suspended` の間は拒む（止めているのは、お金や文の事故の時なので）。
- 世帯の `source='staff'`。メールは空でもよい（空なら控えのメールは出さない。スタッフが紙かLINEでマイページのURLを渡す＝世帯の画面の「マイページのURLを写す」）。
- 同意：家庭の人に同意の文を見せて口で確かめた印（`consentChecked`）が要る。変えた記録 `staff_entry`（`reason`・`receivedAt`、締切のあとは `is_exception=1`）。
- 期限：2/10 を過ぎてから作った世帯は、`pay_due_override` に今日から7日後を入れる（仮に決めた。設計書 2387行は「日を入れる」だけ。「迷って仮に決めた所」9）。
- 作品は `entry_mode` が `form` と `staff` の物、`status` が `open`・`fixed` の物から選べる（スタッフしか入れられない作品のため）。
- できた世帯は、家庭がマイページから払える（作る人が確かめる。設計書 5285行）。
- 同じ電話・同じ人の確かめは、フォームと同じ（チェックで通す）。

- [ ] **Step 1: 試験を書く**

```ts
it('締切のあと（2/2）でも作れる・source=staff・is_exception=1・控えは出る', async () => { /* … */ });
it('メールが空でも作れる・控えのメールは出ない', async () => { /* … */ });
it('suspended の間は suspended で拒む', async () => { /* … */ });
it('2/11 に作った世帯の pay_due_override は 2/18', async () => { /* … */ });
it('同意の印が無ければ invalid', async () => { /* … */ });
it('できた世帯のマイページで payButtonState が show（支払いが開いている時）', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**
- [ ] **Step 3: 画面を作る**（申込フォームの欄の並びのまま。理由・家庭から聞いた日時・名前・同意を口で確かめた印）
- [ ] **Step 4: 画面で見る**（M5）：作った世帯のマイページを開き、カード（試しのモード）で払うところまで
- [ ] **Step 5: コミット**（`feat(bw6): スタッフが代わりに申し込む`）

---

### Task 21: スクールの都合で作品をやめる・合同にする（返す分4番・入れ替え）

要る日：1/29（金）（「先」の物。1/31 までに試しを終える）

**Files:**
- Modify: `src/lib/recitalEntryDb.ts`（`dropWork` の「払った世帯があれば断る」をやめ、返す分4番を作る。`mergeWork` を足す）
- Create: `src/lib/recitalWorkChange.ts`（純：返す額・家庭への一言）
- Modify: `src/app/staff/bw6/works/actions.ts`・`page.tsx`（取りやめの確かめに「払った世帯 ◯・返す分 ◯円」、合同の画面）
- Modify: `src/app/staff/bw6/entries/[id]/page.tsx`（返事待ちの返す分の横に「入れ替えにする」「返金にする」）
- Test: `src/lib/__tests__/recitalWorkChange.test.ts`・`src/lib/__tests__/recitalWorksStaff.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `refundForDecrease`・`createRefundTx`（`reasonNo: 4`・`waitingReply`）・`cancelRefund`・`recomputeChargesTx`・`dropWork`、Task 7 の `recordRefundDone`
- Produces：
  - `dropWork(workId, confirmCount, staffName)` の返り値を `{ ok: true; households: number; refunds: { householdId: number; amount: number }[] } | { ok: false; code: 'not_found' | 'count_changed'; count: number }` に変える（`paid_household` を無くす）
  - `mergeWork(fromWorkId: number, intoWorkId: number, confirmCount: number, staffName: string): Promise<{ ok: true; moved: number; doubled: { householdId: number; personId: number }[]; refunds: { householdId: number; amount: number }[] } | { ok: false; code: 'not_found' | 'count_changed' | 'same' }>`
  - `schoolDropNotice(x: { kind: 'drop' | 'merge'; works: string[]; paid: boolean }): string`（純。設計書 3487行と 7-9 の一言。貼る文として世帯の画面に出す）
  - `resolveWaitingRefund(refundId: number, choice: 'swap' | 'refund', staffName: string): Promise<void>`（入れ替え＝返す分を取り消す（`cancelRefund`、理由「入れ替えを選んだ」）。家庭が選んだ作品は、スタッフが「代わりに直す」で足す／返金＝`waiting_reply` を 0 にする（返すのは Task 7 の「返金を記録」））

決めたこと（設計書 1847〜1848・3480〜3488行、5-7、R-107、段階1 Task 17 の裁定「works_drop を足す」）：
- 取りやめ：作品を `dropped` にし、その作品に出る世帯の請求を作り直す（今までどおり）。合計が下がった払った世帯には、返す分4番（`refundForDecrease({ totalBefore, paid, totalAfter })` の額、0より大きい時だけ。`waitingReply: true`。理由「スクールの都合で作品がなくなった（W◯◯）」）を同じ書き込みで作る。記録 `works_drop`（`after` に `{ workId, households, refunds }`）。
- 合同：`from` の作品を `dropped`・`merged_into=into` にし、`from` の出演を `into` へ移す（同じ人がもう `into` に出ていれば、移さずに `out`＝両方に出ていた人は1作品へる）。そのあと請求を作り直し、合計が下がった払った世帯に返す分4番（`waitingReply: true`）。記録 `works_merge`。
- 途中の形は家庭に見せない（1回の書き込み）。途中でメールは出さない。家庭への一言（`schoolDropNotice`）は、世帯の画面の「貼る文を写す」で公式LINEに貼る（自動のメールは段階2では出さない。仮に決めた。「迷って仮に決めた所」10）。
- 返事待ちの返す分は見てほしいことの5番に出る（段階1のまま）。

- [ ] **Step 1: 試験を書く**

```ts
it('refundForDecrease を使った返す額：35,500 → 32,500 で 3,000（設計書 5-7 の例）', () => { /* … */ });
it('dropWork：払った世帯に返す分4番（waiting_reply=1）・払っていない世帯は請求だけ・記録 works_drop', async () => { /* … */ });
it('mergeWork：両方に出ていた人は1作品へる・移した人は into に in・返す分4番・from は dropped で merged_into', async () => { /* … */ });
it('mergeWork：同じ作品どうしは same・人数がちがえば count_changed', async () => { /* … */ });
it('resolveWaitingRefund：swap は返す分を取り消す・refund は waiting_reply を 0 に', async () => { /* … */ });
it('schoolDropNotice：払った世帯には「1作品分のご返金もえらべます」', () => { /* 設計書 3487行 */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**（`dropWork` の今の試験のうち `paid_household` の物は、この Task の決まりに直す）
- [ ] **Step 3: 画面を作り、画面で見る**（M5）
- [ ] **Step 4: コミット**（`feat(bw6): スクールの都合の取りやめ・合同と返す分4番`）

---

### Task 22: MOCCHIN の読み込み

要る日：1/24（日）（まとめる作業は 1/25（月）の週。T21・R-136）

**Files:**
- Create: `src/lib/recitalMocchin.ts`（純：候補の計算・名前の分け方）
- Create: `src/lib/recitalMocchinDb.ts`
- Create: `src/app/staff/bw6/mocchin/page.tsx`・`actions.ts`
- Modify: `src/lib/recitalMail.ts`（`mocchinLine` を、MOCCHIN の印のある世帯で true に）
- Modify: `src/app/bw6/my/page.tsx`（MOCCHIN にも出る人に「お支払いは MOCCHIN のページです」の1行）
- Test: `src/lib/__tests__/recitalMocchin.test.ts`・`src/lib/__tests__/recitalMocchinDb.test.ts`

**Interfaces:**
- Consumes：既存の表 `mocchin_entries`（`id`・`status`・`name`・`kana`・`phone`・`email`・`class_number`・`paid` ほか）、Task 8 の `insertPersonTx`、段階1の `normalizeKana`・`normalizePhone`・`normalizeEmail`
- Produces：
  - `mocchinCandidates(entry: { kana: string; phone: string; email: string }, people: { personId: number; kana: string; householdPhone: string; householdEmail: string | null }[]): number[]`（純。「カナ＋メール」か「カナ＋電話」が合う人）
  - `splitMocchinName(name: string): { last: string; first: string }`（純。空白で分ける。無ければ全部を姓）
  - `listMocchinRows(eventKey: string): Promise<{ entryId: number; done: boolean; candidates: { personId: number; refCode: string; name: string }[] }[]>`（読むのは `status='active'` の申込だけ。試しの申込（`staff_note` に「テスト」）は読まない＝仮。「作る前に止まって聞く物」7）
  - `importMocchinEntry(eventKey: string, entryId: number, choice: { samePersonId: number } | { newPerson: true }, staffName: string): Promise<{ personId: number; householdId: number }>`
  - `mocchinWorkId(eventKey: string, classNumber: string): Promise<number | null>`（MOCCHIN の番号に当たる作品。`fee_type='separate'` の作品の `work_code` か `title` で引く。決め方は「作る前に止まって聞く物」7）

決めたこと（設計書 900〜909・858・1522・3338・4386・5258行、T21）：
- 読むのは人と出演だけ。お金は読まない（請求の行は作らない。作品が `fee_type='separate'` なので、段階1の料金の計算にもともと入らない）。
- 自動では決めない。1件ずつ候補（`mocchinCandidates`）を出し、スタッフが「この人と同じ」か「新しい人」を選ぶ。同じ→その人に出演（`in`・`source='mocchin'`）を足し、`ext_ref` に `mocchin:<entryId>`。新しい人→人と世帯を作る（世帯 `source='mocchin'`、名前は `splitMocchinName`、生年月日は空、会員の照合は確認待ち＝見てほしいことの2番）。同じ `ext_ref` は2回足さない（一意の索引）。
- 取り込みの記録は `recital_imports` の `kind='mocchin'` の行（`read_rows`＝読んだ数・`inserted`・`existing`・`rejected`。4つが合わなければ入れない＝1件ずつの読み込みなので1件ごとに `read_rows=1`）。記録 `mocchin_import`（名前は入れない）。
- 印：「MOCCHIN にも出る世帯」＝`source='mocchin'` の出演がある世帯（列は持たず計算）。`pay_request`・`pay_remind` の「MOCCHIN のレッスン代とは、別のお支払いです。」はこの印で出す。8-7 の「MOCCHIN の未入金がある世帯」の印は、`mocchin_entries.paid` を読むかどうかの答え待ち（「作る前に止まって聞く物」7）。
- MOCCHIN だけの人のマイページで生年月日を聞く欄（T21）は、答え待ち（同じ7）。

- [ ] **Step 1: 試験を書く**

```ts
it('mocchinCandidates：カナ＋電話・カナ＋メールで合う・カナだけでは出ない・全角の電話も同じ', () => { /* … */ });
it('splitMocchinName：「山田 花子」→ 山田／花子・空白なし → 全部を姓', () => { /* … */ });
it('importMocchinEntry 同じ：出演が足され ext_ref が入る・請求は増えない・2回目は落ちる', async () => { /* … */ });
it('importMocchinEntry 新しい人：source=mocchin の世帯と人・生年月日は空・会員の照合は確認待ち', async () => { /* … */ });
it('取り消した申込（status が active でない）は一覧に出ない', async () => { /* … */ });
it('記録に名前・電話・メールが入らない', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**
- [ ] **Step 3: 画面を作り、画面で見る**（M5）
- [ ] **Step 4: コミット**（`feat(bw6): MOCCHIN の読み込み（人と出演だけ）`）

---

### Task 23: 警告の残り（戻ってきたメールの印・送った数の印）

要る日：1/31（日）（設計書 4792行「1月」）

**Files:**
- Modify: `src/lib/recitalDb.ts`（8番に `mail_bounced` を足す）
- Modify: `src/app/staff/bw6/entries/[id]/actions.ts`・`page.tsx`（「メールが戻ってきた」の印を付ける・外す）
- Modify: `src/app/staff/bw6/money/page.tsx`（今日の送った数と「上限に近いです」）
- Test: `src/lib/__tests__/recitalStaffHome.test.ts`・`recitalEntriesStaff.test.ts`（足す）

**Interfaces:**
- Consumes：段階1の `recital_households.mail_bounced`・`countRecitalMailsToday`
- Produces：`setMailBounced(householdId: number, bounced: boolean, staffName: string): Promise<void>`（記録はしない＝列の印だけ。仮）

決めたこと（設計書 3415〜3418・626行、7-7）：戻ってきたメールは、月曜のまとめを読む人が受信箱で見て、世帯の画面で印を付ける。印のある世帯は見てほしいことの8番「戻ってきたメール：整理番号」（今の「届かなかったメール」と同じ番号）。メールアドレスを直すと（段階1の `changeHouseholdEmail`）印は外れる。送った数の印は、お金の画面とスタッフの申込の一覧の上だけ（最初の画面には出さない）。「通っていないクラスの作品を選んだ人」は U4（予約のデータで出せるか）の答え待ちで、この計画では作らない（「作る前に止まって聞く物」8）。「席の見込みが少ない」は Task 15。

- [ ] **Step 1: 試験を書く → 落ちる → 作る → 通る**

```ts
it('mail_bounced=1 の active の世帯は8番「戻ってきたメール」', async () => { /* … */ });
it('changeHouseholdEmail で印が外れる', async () => { /* … */ });
```

- [ ] **Step 2: 画面で見る（M5）→ コミット**（`feat(bw6): 戻ってきたメールの印と送った数の印`）

---

### Task 24: イントラへの自動メール（月曜の人数・期限の3日前と当日）

要る日：1/25（月）（頼みごと2の期限 1/31 の3日前＝1/28 の朝に初回。月曜の人数は 1/25 から）

**Files:**
- Modify: `src/lib/recitalInstructorDb.ts`（`setInstructorEmail`・`queueInstructorMails`）
- Modify: `src/app/bw6/i/page.tsx`（初めて開いた時だけ、届け先のメールを聞く欄。入れなくても使える）
- Modify: `src/lib/recitalEmail.ts`・`src/lib/recitalMail.ts`（イントラ宛の2つの文。`recital_mail_log.instructor_link_id` に相手を入れる。`MailKind` に `'instructor_weekly'`・`'instructor_due'` を足す）
- Modify: `src/app/api/cron/recital-weekly/route.ts`（月曜に人数のメール）・`src/lib/recitalPatrolDb.ts`（毎朝、期限の3日前と当日）
- Modify: `src/lib/recitalSummaryDb.ts`（`askLines`：期限が近い週に、イントラ全体の LINE グループに貼る文）
- Test: `src/lib/__tests__/recitalInstructorDb.test.ts`・`recitalEmail.test.ts`・`recitalSummary.test.ts`（足す）

**Interfaces:**
- Consumes：Task 13・14 の物、Task 4 の `getSummaryFacts`
- Produces：
  - `setInstructorEmail(token: string, email: string | null): Promise<{ ok: boolean }>`（公開のページから呼ぶ Server Action の中身。鍵が生きている時だけ。回数制限は段階1の `RECITAL_RATE.resendEmail` と同じ形）
  - `queueInstructorMails(eventKey: string, now: Date, kind: 'instructor_weekly' | 'instructor_due'): Promise<{ queued: number }>`
  - `instructorAskLines(asks: { title: string; dueOn: string | null }[], todayJst: string): string[]`（純。今日から7日以内に期限が来る頼みごとを、7-10 の文5の形に。人の名前は出さない）

決めたこと（設計書 7-3（3851〜3876行）・7-10 の文5（1767行）、K125）：
- 届け先のメールは頼みごとにしない。初めて開いた時に1回だけ聞く（入れなくても使える。設計書 1737・1762行）。これがページの唯一の入力（「ボタンは無い」は名簿の確かめのボタンのこと。仮に読んだ。「迷って仮に決めた所」11）。
- 月曜の人数：自分の作品の「出る ◯人／迷っている ◯人」と先週からの増減（記録は `recital_mail_log` の行の数でなく、先週の送った時の数を `answer_json` に持たない＝増減は `recital_casts.applied_at`・`withdrawn_at` から7日で数える）。届け先のある人だけ。鍵 `instructor_weekly:<link>:<日付>`。
- 期限の3日前と当日の朝：まだ「すんだ」でない頼みごとの一覧を1通に（`instructor_due:<link>:<ask_key>:<日付>`）。期限の無い頼みごと（3・7）は出さない。
- 文は、この計画で書く（設計書に全文が無い。7-10 の書き方にそろえる。仮の文。「作る前に止まって聞く物」9）：
  - 件名 `【BOOM】BW6 今週の人数`／本文「（名前）さん　おつかれさまです。\n（作品の名前）　出る ◯人（先週から +◯）／迷っている ◯人\n…\nくわしくは、いつものページで。\n（ページのURL）」
  - 件名 `【BOOM】BW6 締切が近いお願い`／本文「（名前）さん　おつかれさまです。\n（頼みごと）（◯月◯日（◯）まで）\n…\n決まってる分だけでOKです。\n（ページのURL）」
- 週のまとめの `askLines`（Task 4）：期限が近い週は、7-10 の文5（例 1767行）の形の文を入れる。無い週は「今週、イントラに貼る文はありません。」。

- [ ] **Step 1: 試験を書く**

```ts
it('instructorAskLines：7日以内の頼みごとだけ・名前は出ない・文5の形', () => { /* … */ });
it('月曜の人数のメール：届け先のある人だけ・増減・同じ週の2回目は duplicate', async () => { /* … */ });
it('期限の3日前（1/28）と当日（1/31）に頼みごと2のメール・すんだの人には出ない', async () => { /* … */ });
it('setInstructorEmail：止めた鍵では ok:false・形のちがうメールは ok:false', async () => { /* … */ });
```

- [ ] **Step 2: 落ちることを確かめる → 作る → 通ることを確かめる**
- [ ] **Step 3: 画面で見る（M5）→ コミット**（`feat(bw6): イントラへの月曜の人数と締切のメール`）

---

### Task 25: 作る物と期限の一覧（資料34）と自動の確かめ

要る日：1/31（日）（設計書 5259行「次」。毎朝の見回りとは別の物）

**Files:**
- Create: `scripts/migrations/20261220_recital_outputs_seed.sql`（`bw6`・`bw6-test` の行。設計書 6-2（3566〜3635行）の52件＋資料53＋3-5 の4つ）
- Create: `src/lib/recitalOutputs.ts`（純：`ready_rule` の判定）
- Create: `src/lib/recitalOutputsDb.ts`
- Create: `src/app/staff/bw6/outputs/page.tsx`・`actions.ts`
- Modify: `src/lib/recitalSummaryDb.ts`（`outputsLines`）・`src/app/api/cron/recital-weekly/route.ts`（月曜に `refreshOutputs` を先に）
- Test: `src/lib/__tests__/recitalOutputs.test.ts`・`src/lib/__tests__/recitalOutputsDb.test.ts`

**Interfaces:**
- Consumes：Task 1 の `recital_outputs`、Task 15 の `loadCountsFacts`、段階1の数える関数
- Produces：
  - `type ReadyFacts = { worksListed: boolean; entryClosed: boolean; allMatched: boolean; allPaid: boolean; tshirtAllSet: boolean; tshirtSpecSet: boolean; namesConfirmed: boolean; [k: string]: boolean }`
  - `isReady(rule: string, f: ReadyFacts): boolean | null`（純。19個の条件（設計書 849〜853行）。段階2で数えられる物＝`always`・`works_listed`・`entry_closed`・`all_matched`・`all_paid`・`tshirt_all_set`・`tshirt_spec_set`・`names_confirmed`。ほかの11個（作品の情報・音源・写真・演目順・進行表・時間割・部屋・持ち場・ゲスト）は段階3の材料なので null＝「材料待ち」のまま）
  - `refreshOutputs(eventKey: string, now: Date): Promise<{ ready: number; waiting: number }>`（`waiting` の行で `isReady` が true の物を `ready` にする。`confirmed`・`done` は変えない）
  - `outputsSummaryLines(rows: { title: string; owner: string | null; status: string; dueOn: string | null }[], todayJst: string): string[]`（純。「今週、確定を押す物」（`ready` で期限が7日以内）と「期限が近いのに材料が足りない物と持ち主」（`waiting` で期限が14日以内））
  - `confirmOutput(id: number, staffName: string): Promise<void>`（「確定」を押す。`version_no` を1つ上げる）

決めたこと（設計書 2-3（201〜250行）・3-5（824・849〜853行）、R-9・R-20・K23）：
- 行の中身（`doc_no`・`title`・`reader`・`owner`・`mode`・`due_offset_days`・`ready_rule`）は設計書 6-2 の表から写す。期限は本番の日からの日数（`due_offset_days`）で持ち、決まったら入れ直すだけ。3-5 の4つ（Tシャツの受付・席の受付・打ち上げ・招待）は期限を空で入れる。表から写せない欄（読む人・持ち主が書いていない行）は空にして、写した数と空の数を実装記録に書く。**53件か57件かの数がちがったら止まって知らせる**（設計書の中で「53件」と「4つを足す」がある）。
- 足りない物の持ち主への催促（期限の7日前・3日前・当日・過ぎたあと）は、段階2では週のまとめの行だけ（スタッフ宛の自動メールは2つだけ。設計書 4794行）。持ち主がイントラの物は段階3（頼みごと4〜13 と一緒）。
- 画面 `/staff/bw6/outputs`：一覧（状態・期限・持ち主）と「確定」（2段階＋名前）。

- [ ] **Step 1: 試験を書く**

```ts
it('isReady：all_paid は残りのある世帯が0の時だけ・段階3の条件は null', () => { /* … */ });
it('refreshOutputs：waiting → ready だけ・confirmed は変えない', async () => { /* … */ });
it('outputsSummaryLines：今週確定を押す物・材料が足りない物と持ち主', () => { /* … */ });
it('種の行の数（bw6-test）が設計書 6-2 の数と同じ', async () => { /* 数は Step 3 で写した数 */ });
```

- [ ] **Step 2: 落ちることを確かめる → 純と DB を作る → 通ることを確かめる**
- [ ] **Step 3: 種の台帳SQLを書く**（設計書 6-2 を1行ずつ写す。`created_at` は固定の文字）。本番に流すのは出す手順1と同じ形で。
- [ ] **Step 4: 画面を作り、画面で見る（M5）→ コミット**（`feat(bw6): 作る物と期限の一覧（資料34）`）

---

## 作る前に止まって聞く物

作ることは止めない。TARO・KEIKO に頼む物は、まとめて1回で、押すボタンが1〜2個の形にして、秘書（M5 の「🗂秘書」）から頼む。答えが無い物は、下の「答えが無い時」のとおりに作る。

1. **週1回のまとめと「見回りが失敗した知らせ」の届け先**（Task 4。12/18（金）まで）
   月曜の朝のまとめのメールを、どのアドレスに送るか。TARO と KEIKO の2人（設計書 4063行）。アドレスはリポジトリに書けないので、設定の画面の `staff_mail_to` に入れる。
   - 案：TARO は今の通知の宛先（`notifyTaro` と同じ）、KEIKO はスクールの業務のメール。
   - 答えが無い時：届け先を空にしたまま、TARO の通知（Pushover とメール）だけに出す。
2. **「振り込みました」を押した家庭に催促しない3日と、夜8時の線**（Task 17。1/8（金）まで。決まっていることの確かめ）
   取り込みが古い朝（TARO のスクショが前の日の夕方5時より後に無い朝）は、その朝の催促を止め、夜8時までにスクショが入れば、その日のうちに出す。夜8時を過ぎたら、その回は出さずに次の催促の日へ回る（設計書 K211）。このため、1/15（金）の「お支払いのご案内」は、TARO が1/14（木）の夕方5時より後と 1/15（金）の夜8時までの両方で送れないと、出ないまま次（2/1）になる。2/10（水）の当日の催促も同じ。
   - 案：この決まりのまま（払った家庭に催促が行く方が困るため）。
   - 答えが無い時：この決まりのまま。
3. **イントラの頼みごとの期限（T11）**（Task 13。12/22（火）まで）
   イントラのページに出す13個の「出す物と期限」の日。設計書の案：1 作品の対象と仮の名前 12/7／2 自分のTシャツのサイズ 1/31／3 リハに出られる日 候補日が出てから1週間／4 正式な名前と読み 2/21（仮でよい）／5 曲名・仮の音源 2/28（仮でよい）／6 衣装 2/28（仮でよい）／7 集合写真 撮影日の1週間後／8 はじまり方・小道具など 3/7／9 照明の希望 3/14／10 紹介のひとこと 3/21／11 本番用の音源 3/28／12 宿泊と交通 3/10／13 自分の写真と読み 2/21（仮でよい）。
   - 案：このまま。
   - 答えが無い時：このまま本番に入れる（あとで直せる）。
4. **イントラのTシャツのサイズ（頼みごと2）をだれが入れるか**（Task 13。12/22（火）まで）
   設計書では、イントラのページにボタンを置かない（名簿の確かめのボタンを作らない）。サイズを聞く方法が決まっていない。
   - 案：スタッフ（KEIKO）が LINE で聞いて、スタッフの画面で入れる（イントラのページは見るだけ）。
   - 別の案：イントラのページに、サイズを選ぶ欄を1つだけ置く。
   - 答えが無い時：案（スタッフが入れる）。
5. **家庭の画面の新しい文3つ**（Task 9。12/18（金）まで）
   (a) 「全部やめる」の押す前の文「全員の出演を取りやめます。Tシャツも取り消します。金額は0円になります。1月31日（日）までは、マイページから、もう一度足せます。」 (b) 申込フォームなどの「ご家族を足したいときは、マイページの『ご家族を足す』からできます。1月31日（日）まで。」 (c) 「家族を足す」の欄の見出し「ご家族を足す」。
   - 案：このまま。答えが無い時：このまま。
6. **延長した世帯への「迷っている作品の知らせ」**（Task 19。1/20（水）まで）
   延長（その世帯だけ締切をのばす）を付けた世帯にも、1/31 の知らせ（「1月31日（日）までに」「2月1日（月）になると出ない扱い」の文）を送るか。設計書に書いてない。
   - 案：延長の世帯には送らない（文の日付が合わないため。延長はスタッフが個別に連絡している世帯）。
   - 答えが無い時：送らない。
7. **MOCCHIN の読み込みの3つ**（Task 22。1/15（金）まで）
   (a) 印は「MOCCHIN にも出る世帯」か「MOCCHIN の未入金がある世帯」か（設計書の中で2つの書き方がある。未入金を見るには MOCCHIN の入金の記録を読むことになる）。 (b) MOCCHIN だけの人に、マイページで生年月日を聞く欄を作るか（T21）。 (c) MOCCHIN の申込の「クラス番号」と、発表会の作品（別料金ナンバー）の対応のさせ方（作品の番号で決めるか、名前で決めるか）。テストの申込の見分け方も。
   - 案：(a) 「MOCCHIN にも出る世帯」だけ（お金は MOCCHIN のページで見る）。(b) 作る（マイページに1欄）。(c) 作品の画面で、別料金ナンバーの作品に MOCCHIN のクラス番号を1つ入れる。
   - 答えが無い時：(a) 案、(b) 作らずにスタッフが LINE で聞いて「代わりに直す」で入れる、(c) 作品の名前で引き、引けなければ読み込みの画面で作品を選ぶ。
8. **「通っていないクラスの作品を選んだ人」の印**（Task 23。作る人が調べる・U4）
   レッスンの予約のデータで、その人がそのクラスに通っているかを出せるか、作る人が本番の DB を読むだけで調べる。出せなければ、この印は作らない。TARO に聞くのは、出せる時に「出しますか」の1回だけ。
9. **イントラ宛の自動メールの文2つ**（Task 24。1/18（月）まで）
   月曜の人数のメールと、締切が近いお願いのメール（文は Task 24 の「決めたこと」）。設計書に全文が無いので、こちらで書いた。
   - 案：このまま。答えが無い時：このまま。
10. **金額の問い合わせの連打よけ**（段階1 Task 13 の「TARO に聞く点（急がない）」。Task 12 と一緒に）
    申込フォームの金額の問い合わせで、カナと生年月日を変えて何度も聞くと、特別な料金の人かどうかを推し量れる（設計 R-33 のとおりで、今は回数制限だけ）。「金額を試す」は特別な料金を見ないので、この心配は増えない。
    - 案：今の回数制限のまま（足さない）。答えが無い時：足さない。

---

## 段階1の持ち越しの行き先

段階1の実装記録の「持ち越し」「後の計画」「段階2」の行（数えた行は 26）。

| 段階1の行 | 行き先 |
|---|---|
| Task 9：22・27 で `afterMoneyChanged`／28 で取り消しの返す分／void・出金を見る | 段階1の中で済んだ（27・28 のコード） |
| Task 10：取ったあとに止まった行（waiting かつ sent_at あり）の見せ方 | **Task 3**（`listMailTrouble` の `stuck`） |
| Task 10：失敗した行の送り直し（waiting に戻して deliver） | **Task 3**（`resendFailedMails`） |
| Task 14：払う（21）ができたら「準備中」を切りかえる | 段階1の 21 で済んだ |
| Task 14：試しの世帯のマイページから送り直しへのリンクに試しの鍵が付かない | **Task 2** |
| Task 17：listWorkCounts を SQL 1本に | 段階1で済んだ |
| Task 17 の裁定：作品の取りやめを記録に残す（works_drop） | **Task 21** |
| Task 19：まとめた世帯の返す分の取り消し | 段階1の 28 で済んだ（拒む） |
| Task 21：払っている最中に閉じた行が払われた場合 | 段階1の 22 で済んだ。**Task 5** の①でも48時間の closed の行を聞く |
| Task 22：返金・異議の知らせが `bf_payments` に空の行を作る | **Task 6** |
| Task 22：本番の受け口が refund・dispute を受ける設定か（R25） | **Task 6**（出す人が Stripe の画面で見る） |
| Task 23：void・出金の行に当てるのを拒むか | 段階1の 28 で済んだ |
| Task 23：取り消した振込の行を「確認しました」から外す | 段階1の 28 で済んだ |
| Task 20：週1のまとめに特別な料金の変更を出す（K227・K39） | **Task 4**（`manualRows`）・**Task 3**（一覧） |
| Task 25：手順書の3つ（重ねて撮る・日付が読めない行・出金の説明） | 段階1の 30 で済んだ（ハブの `docs/bw6-bank-read.md`） |
| Task 26：27・28 の約束（二重当て・自分を入れない・全世帯を渡す） | 段階1の 27・28 で済んだ |
| Task 27：もとにもどした行を自動で当てない | 段階1の 28 で済んだ（`decided_by`） |
| Task 27：いつも失敗する行で束が全部 match_failed | 段階1の 28 で済んだ |
| Task 28：手元の SQLite の BUSY のあと接続が壊れる穴（db.ts の withWriteTx を使うほかのファイル） | 段階2では直さない。新しい書き込みの試験は1本ずつ順に書く（同時に書く試験は作らない）。本番の Turso には無い穴。直すなら db.ts の共通の所で、ほかの機能に響くので TARO の確かめが要る |
| Task 28：画面の bad_state の文 | 段階1の 29 で済んだ |
| Task 28：reviewCount は listReviewRows | 段階1の 24 で済んだ |
| Task 24：催促の前の5つの晩・2/8〜2/10 の昼の声かけ | **Task 18** |
| Task 24：総点検の文 | 段階3（2/12 の前まで） |
| Task 29：K214 名義を打ち直す欄／もどした行を手で打った行と分ける | **Task 2** |
| 最後の直し：resend の画面に maxDuration が無い | **Task 2** |
| 段階1の計画「段階2以降の計画へ回した物」の残り（見回り・催促・週1のまとめ・家族を足す・全部やめる・イントラ・MOCCHIN・異議・返金を記録・返す分を作る・出演とりやめ・待つ・お金の画面・名義を打ち直す欄） | Task 2〜9・13・14・16〜19・22（総点検・2/12 からの文・名義を消すスクリプトは段階3） |

拾って段階2のタスクにした物：11行（Task 2 に3・Task 3 に2・Task 4・Task 5・Task 6 に2・Task 18・Task 21）と、段階1の計画の「回した物」の一覧の1行。段階1の中で済んでいた物：12行（うち1行は Task 5 でも守りを足す）。段階3へ：1行（総点検の文）。直さない（理由つき）：1行（BUSY の穴）。このほか、段階1の minor の「`changeHouseholdEmail` がまとめた世帯を止めない」も Task 2 で拾った。

段階1の「12/8 に TARO が見る点」と「12/13 までの物」（本番の種・`JOBS` の deploy・Turso の同時の試験）は段階1の仕事なので、この計画には入れない。段階1の Task 15 を 12/8 に外した時だけ、この計画の Task 10 で戻す。

---

## 段階3へ回す物（2/1 から作る。この計画では作らない）

- 総点検：「入金の取り込み」の中のくらべる画面・`file_seen`・日付の直し・「総点検を済みにする」（2/12 の前まで）
- 2/12 の総点検の日の声かけの文・2/15 からの月曜の声かけ（3/31 まで）
- 期限を過ぎた世帯：2/11 からの家庭の画面の「お支払いの期限が過ぎました」の文の見直し・見てほしいことの6番の本体（総点検のあと）・しぼりこみ「期限を過ぎた」・期限を過ぎた世帯に貼る文・「振り込みましたのまま3日」の世帯に貼る文（2/13 から）・理由が「未払い」の出演とりやめを押せるようにする確かめ（Task 7 の門はもう作ってある）
- 週のまとめの「総点検がまだです」と「期限を過ぎても未払いの世帯」の行（式は Task 4 で作ってある。2/12 から出る）
- マイページのQR・家庭が自分でメールを直す・お知らせ（`recital_notices`）・作品ごとの LINE グループの URL をマイページに出す（8-7 の「後」。2月でよい）
- Tシャツの集計と注文書（資料43）・名簿を固める日まわり
- イントラの頼みごと4〜13 を入れる所・作品の情報・演目順・パンフと映像・チケットと席（`recital_ticket_*`・`recital_seats`）
- 振込の名義を消すスクリプト（連絡先を消す時期は TARO が本番のあとに決める）
- KEIKO への声かけと KEIKO がスクショを送る道（G-14 は「しない」に決まったので作らない）・銀行の知らせのメールを合図に使う形（U44）

---

## 迷って仮に決めた所

作る係は、ここに書いた形で作る。ちがうと分かったら、その時に直す（どれも家庭のお金の計算は変えない）。

1. **催促の日を設定から作る**（Task 16）：設計書は日を書いているだけだが、BW7 で写す時のために `pay_due` と `change_close_at` から計算した（1/15＝期限の26日前）。今の初めの値で設計書の日と全部一致することを試験で確かめる。
2. **週のまとめに、見本に無い行を足した**（Task 4）：設計書 7-5・7-7 にあって 7-8 の見本に無い行（届かなかったメール・1/25 の開いていない世帯・受信箱の1行など）を見本の終わりに足した。メールは0件の週も毎週送る。
3. **①の拾い直しで、閉じた行も48時間は聞く**（Task 5）：こちらで閉じても Stripe の画面を切れなかった時の取りこぼしを防ぐため。
4. **返金を記録は、返す分の額をそのまま**（Task 7）：一部だけ返す形は作らない。
5. **CSV の列**（Task 11）：設計書に無いので決めた。メール・電話・生年月日・インスタは入れない。
6. **イントラのページの「いまお願いしたいのは ◯つ です」**（Task 14）：設計書の「2つ」を、期限が来ていてすんでいない数で変える形にした。
7. **席の見込みの式**（Task 15）：出演者席が空なら「出る人」の数を引く。少ない印は総席の1割。
8. **「催促を止める」ボタン**（Task 17）：設計書に無い。催促がおかしい時に、コードを戻さずに止める道として足した（`remind_paused`）。
9. **2/11 より後にスタッフが作った世帯の期限は7日後**（Task 20）。
10. **スクールの都合の取りやめ・合同の家庭への一言は、自動のメールでなく貼る文**（Task 21）：段階2では自動で送らない。家庭ごとに返事（入れ替えか返金か）を聞くので、公式LINEで話す形にした。
11. **イントラのページの唯一の入力は届け先のメール**（Task 24）：設計書の「初めて開いた時に1回だけ聞く」に合わせた。
12. **12/30〜1/3 は push しない**（Global Constraints）：休みで見る人がいないため。
13. **表の4列（`ask_no`・`due_note`・`tentative_ok`・`stage`）を足した**（Task 1）：頼みごとの番号・期限の書き方・「仮でよい」・段階を持つため（設計書 3-5 の列に無い）。
