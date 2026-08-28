# アンケート基盤（surveyエンジン）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーマを変えて量産できるアンケート基盤（公開フォーム＋スタッフ集計＋会員DB紐付け＋回答期間設定）を bw5-app に実装し、第1弾「七ヶ浜クラス増設」を発行可能にする。

**Architecture:** 既存の「公開フォーム＋スタッフ画面」型（/ig・/entry）の一般化。アンケート定義はDB（surveys/survey_questions）、回答は survey_responses/survey_answers。名前照合は純関数 surveyMatch で auto/pending/unmatched を判定し、pending はスタッフ承認キュー。実効受付状態は effectiveState(survey, now) でリクエスト時導出（cron不要）。

**Tech Stack:** Next.js(カスタム版・node_modules/next/dist/docs 必読) / Turso(libSQL) / Server Actions / vitest / 台帳SQL+migrate.mjs

**仕様書:** `docs/superpowers/specs/2026-08-28-survey-engine-design.md`

**共通規約（全タスク）:**
- DBは `@/lib/db` の getAll/getOne/execute/withWriteTx のみ（createClient直呼び禁止）
- 公開action/routeは冒頭に「⚠️ 公開…理由:」コメント（/ig/actions.ts と同型）
- 日時: 判定は `todayJst`/JST基準、記録は `nowUtcIso`。曜日を出すときは `weekdayJst`
- ログ・エラーメッセージに氏名を出さない
- 台帳SQLは**行内コメント禁止**
- git add はパス指定のみ（`git add -A` 禁止）
- コミットは日本語・既存トーン（例: `アンケート基盤: ...`）

---

### Task 1: DBスキーマ（台帳SQL + schema.ts）

**Files:**
- Create: `scripts/migrations/20260828_surveys.sql`
- Modify: `src/lib/db/schema.ts`（boom_members 定義の後ろに4テーブル追加）

- [ ] **Step 1: 台帳SQLを書く**（行内コメント禁止・IF NOT EXISTS で冪等）

```sql
CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  intro TEXT,
  audience TEXT NOT NULL DEFAULT 'member',
  name_note TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  opens_at TEXT,
  closes_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  opened_at TEXT,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS survey_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id),
  sort_order INTEGER NOT NULL,
  question_key TEXT NOT NULL,
  label TEXT NOT NULL,
  qtype TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  allow_other INTEGER NOT NULL DEFAULT 0,
  UNIQUE(survey_id, question_key)
);
CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id),
  respondent_name TEXT,
  boom_member_id INTEGER,
  match_status TEXT NOT NULL DEFAULT 'none',
  match_candidates_json TEXT,
  submitted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS survey_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER NOT NULL REFERENCES survey_responses(id),
  question_id INTEGER NOT NULL REFERENCES survey_questions(id),
  option_key TEXT,
  text_value TEXT
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions(survey_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_member ON survey_responses(boom_member_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_response ON survey_answers(response_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_question ON survey_answers(question_id, option_key);
```

- [ ] **Step 2: schema.ts に同じCREATE文を追加**（ローカルfile DBの初期化用。本番はSKIP_DB_INIT=1なので台帳が正）
- [ ] **Step 3: ローカルで `node scripts/migrate.mjs --dry-run` → 未適用1件表示 → 適用 → 再dry-runで0件**
- [ ] **Step 4: commit**（`git add scripts/migrations/20260828_surveys.sql src/lib/db/schema.ts`）

※ 本番Tursoへの適用は Task 9（デプロイ直前）で env付き `node scripts/migrate.mjs`。

### Task 2: 純関数 `src/lib/survey.ts`（TDD）

**Files:**
- Create: `src/lib/survey.ts`
- Test: `src/lib/survey.test.ts`（既存テストの置き場・命名は近隣に合わせる）

内容（すべて先にテストを書く）:
- 型: `SurveyRow`, `QuestionDef {id?, questionKey, label, qtype:'single'|'multi'|'text', required, options:{key,label}[], allowOther}`, `EffectiveState = 'draft'|'scheduled'|'accepting'|'expired'|'closed'`
- `effectiveState(survey:{status,opens_at,closes_at}, now:Date): EffectiveState`
  - テストケース: draft→draft / open+期間未設定→accepting / open+opens_at未来→scheduled / open+closes_at過去→expired / open+期間内→accepting / closed+期間内でも→closed / 境界(opens_at ちょうど=accepting, closes_at ちょうど=accepting・1秒後=expired)。opens_at/closes_at は `'YYYY-MM-DDTHH:mm'`(JST)で保存し、比較はJST変換で行う
- `validateSurveyDefinition(input): ValidatedSurvey | string`（タイトル必須・設問1問以上・question_key重複・choice系はoptions必須・optionsのkey重複・qtype不正・opens_at>closes_at逆転を弾く。文字数上限 title 100/label 200/option 100）
- `validateResponseInput(questions: QuestionDef[], payload): ValidatedResponse | string`
  - payload形: `{ name?: string, answers: { [questionKey]: { optionKeys?: string[], otherText?: string, text?: string } } }`
  - required未回答・存在しないquestionKey・存在しないoptionKey・singleに複数・text 2000字超・name 100字超・allowOther=0なのにotherText を弾く。回答は正規化して返す
- `generateSurveySlug(): string`（`crypto.randomBytes` 16hex・推測不能）
- `aggregateAnswers(questions, answerRows: {question_id, option_key, text_value, response_id}[]): PerQuestionAgg[]`（選択肢ごとの件数＋自由記入一覧）
- `crossTab(answerRows, qA_id, qB_id, filter?: {questionId, optionKeys})`: 曜日×時間帯マス（response_id で結合し、filterはQ7温度感の絞り込み用）
  - テスト: 2回答で曜日×時間帯の件数が正しく出る/filterで「わからない」を除外できる

- [ ] Step 1: `src/lib/survey.test.ts` を書く（上記ケース網羅・最低20ケース）
- [ ] Step 2: `npx vitest run src/lib/survey.test.ts` → 全FAIL確認
- [ ] Step 3: `src/lib/survey.ts` 実装
- [ ] Step 4: vitest 緑
- [ ] Step 5: commit（テスト+実装をパス指定）

### Task 3: 会員照合 `src/lib/surveyMatch.ts`（TDD）

**Files:**
- Create: `src/lib/surveyMatch.ts` / Test: `src/lib/surveyMatch.test.ts`

- `normalizeName(s): string` … trim・全半角統一(NFKC)・スペース(半角/全角)除去・カタカナ→ひらがな寄せはしない(カナ列と別々に比較)
- `matchMember(rawName, members: {id, full_name, full_name_kana, rep_name, status}[]): MatchResult`
  - `MatchResult = { status:'auto', memberId } | { status:'pending', candidateIds:number[] } | { status:'unmatched' }`
  - 判定: ①full_name完全一致(正規化後)が**activeで一意**→auto ②full_name_kana一意→auto ③rep_name一致(保護者名で記入)は**一意でもpending**（本人名でない=取り違え余地）④複数一致→pending(候補列挙) ⑤部分一致(片方がもう片方を含む・2文字以上)→pending ⑥なし→unmatched
  - きょうだい連名（「、」「・」「と」区切りで複数名らしき入力）→ 先頭1名で照合し、必ずpending（自動確定しない）
  - テスト: 各分岐＋「山田　太郎」(全角スペース)＝「山田太郎」/退会者(status='withdrawn')同名がいても active一意ならauto/active+withdrawnの2件一致はpending
- [ ] Steps: テスト→FAIL→実装→緑→commit（Task 2と同手順）

### Task 4: DBアクセス層 `src/lib/surveyDb.ts`

**Files:**
- Create: `src/lib/surveyDb.ts`（`@/lib/db` 経由のみ・ロジックは持たずTask 2/3の純関数を呼ぶ）

関数（instagramCollectDb.ts の造りを踏襲）:
- `createSurvey(def: ValidatedSurvey): Promise<number>` / `updateSurvey(id, def)`（draft時のみ設問全置換、open後はtitle/intro/name_note/期間のみ）
- `listSurveys()` / `getSurveyById(id)` / `getSurveyBySlug(slug)`（questions込み）
- `setSurveyStatus(id, next)`（draft→open→closed のみ許可・opened_at/closed_at記録）
- `submitResponse(surveyId, validated: ValidatedResponse): Promise<void>` … withWriteTx で responses+answers を原子挿入。名前があれば active会員ロード→`matchMember`→match_status/boom_member_id/candidates保存
- `listResponses(surveyId)`（回答+紐付け状態） / `loadAnswerRows(surveyId)`（集計用）
- `listPendingMatches(surveyId)` / `resolveMatch(responseId, memberId | null)`（null=紐付けなし確定。member詳細用の逆引き `listMemberSurveyAnswers(boomMemberId)` も）
- [ ] 実装 → `npx tsc --noEmit` → commit

### Task 5: 公開フォーム `/survey/[slug]`

**Files:**
- Create: `src/app/survey/[slug]/page.tsx`（Server Component: slug解決→effectiveState分岐→フォーム描画 or 受付前/終了メッセージ）
- Create: `src/app/survey/[slug]/actions.ts`（'use server'）
- Create: `src/app/survey/[slug]/SurveyForm.tsx`（'use client' フォーム本体）

actions.ts（/ig/actions.ts と同型）:
- 冒頭に公開理由コメント
- `submit(slug, payload)`: レート制限 `checkRateLimit('survey:'+ip, 20, 3600)` → getSurveyBySlug → `effectiveState !== 'accepting'` なら拒否（**サーバ側で期限再判定**）→ validateResponseInput → submitResponse → `{ok:true}`
- 回答の読み出しactionは作らない（名簿列挙禁止）
- UI: モバイル前提・BOOMブランド3色・qtype別入力（radio/checkbox/textarea）・「その他」チェックで自由記入展開・送信後お礼画面。名前欄下に name_note 表示
- [ ] 実装 → ローカル `npm run dev` で表示・送信・期限外拒否を手動確認 → commit

### Task 6: スタッフ画面 `/staff/surveys`

**Files:**
- Create: `src/app/staff/surveys/page.tsx`（一覧: タイトル/実効状態バッジ/期間/回答数/公開URLコピー）
- Create: `src/app/staff/surveys/new/page.tsx` + `SurveyBuilder.tsx`（client・設問ビルダー: 追加/削除/並べ替え/qtype切替/選択肢編集/その他ON/OFF・期間picker）
- Create: `src/app/staff/surveys/[id]/page.tsx`（詳細: 発行/締切ボタン・集計・回答一覧・紐付けキュー・CSVリンク・編集）
- Create: `src/app/staff/surveys/actions.ts`（'use server'・冒頭で `isAuthorizedServer()` 確認→不可なら throw。/staff配下だがactionにも防御を書く）
- Modify: スタッフ側ナビ（`src/app/staff/layout.tsx` か `_components` のメニュー定義に「アンケート」追加・既存の並びに合わせる）

- 集計表示: `aggregateAnswers` の件数バー＋**クロス集計カード**（設問2つ+絞り込み設問を選ぶ汎用UI。既定で曜日×時間帯×温度感）
- 紐付けキュー: pending回答に候補会員（名前・会員番号）ボタン→ `resolveMatch`。unmatchedには会員検索(名前部分一致・スタッフ画面内なのでOK)
- StaffPageHeader使用・ブランド3色・orange禁止
- [ ] 実装 → dev で作成→発行→公開フォーム回答→集計反映→紐付け確定 の一連を手動確認 → commit

### Task 7: CSVエクスポート

**Files:**
- Create: `src/app/api/staff/surveys/[id]/export/route.ts`（`withAuth`・既存 `src/app/api/staff/events/[id]/signups/export/route.ts` の造りを踏襲）

- 列: 回答ID/送信日時/記入名/紐付け会員番号/紐付け状態/設問ごとに1列（multiは「;」結合・その他は「その他:テキスト」）
- [ ] 実装 → 認証なしcurlで401・認証ありで200を確認 → commit

### Task 8: 会員詳細に回答履歴

**Files:**
- Modify: `src/app/staff/members/[id]/page.tsx`（実パスは実装時に確認。会員詳細に「アンケート回答」セクション: アンケート名/送信日/回答サマリ）

- `listMemberSurveyAnswers(boomMemberId)` を表示するだけの読み取り追加
- [ ] 実装 → dev確認 → commit

### Task 9: 検証・デプロイ・第1弾投入

- [ ] `npx vitest run` 全緑 / `npx tsc --noEmit` / `npm run build`（heap 8GB: `NODE_OPTIONS=--max-old-space-size=8192`）
- [ ] 本番Tursoへ台帳適用: env付き `node scripts/migrate.mjs`（適用前に `--dry-run`）
- [ ] main へ push → Vercel deploy success 確認
- [ ] 本番煙テスト: `/staff/surveys` 307(未認証)・存在しないslugの `/survey/xxx` が404/終了表示・**否定テストは存在しないid(999999)のみ**
- [ ] 第1弾「七ヶ浜」をスタッフ画面から作成（仕様書の8問・名前欄コピー確定版・期間はTARO確認後に設定）→ draft のままURLをTAROに共有
- [ ] STATE.md WS AO更新＋進行中ボード更新→commit&push
- [ ] 配信文面ドラフト作成（一斉配信は直前TARO最終確認が必須なので送信はしない）

## Self-Review結果

- 仕様カバレッジ: データモデル→T1 / 純関数・期限→T2 / 照合→T3 / DB層→T4 / 公開→T5 / スタッフ+承認キュー+クロス集計→T6 / CSV→T7 / 会員詳細→T8 / 第1弾+運用→T9。漏れなし
- 期限のサーバ側再判定はT5 actionsに明記（画面表示だけで守らない）
- 型名整合: ValidatedSurvey/ValidatedResponse/MatchResult をT2/T3で定義しT4以降が参照
