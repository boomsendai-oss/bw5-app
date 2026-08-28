# アンケート基盤（surveyエンジン）設計書

- 日付: 2026-08-28
- 担当: アンケート基盤セッション（STATE.md WS AO）
- 承認: TARO（設計壁打ち 2026-08-28。方式=自前・設問8問・記名コピー確定）

## 目的

1. **第1弾**: 七ヶ浜のレッスン増設判断のためのニーズ調査（保護者から増設要望あり）。
   「どの曜日・時間帯・ジャンルに何人来るか」を集計して増設案を出す。
2. **基盤**: テーマを変えて同じフォーマットでアンケートを量産できる仕組み。
   第2弾以降は**スタッフ画面から作るだけでコード変更ゼロ**。
3. **会員DB紐付け**: 回答に書かれた生徒名を `boom_members` に照合し、
   「誰がどんな意見か」を会員データとして蓄積。会員起点のクエリ
   （例: 水曜18時台OKの会員一覧）を可能にする。

## 方式（決定済）

bw5-app内に自前実装。既存の「公開フォーム＋スタッフ集計＋設定画面」の型
（/entry 太白まつり・/ig Instagram収集・/merch/tshirt 注文）の一般化。
HACOMONOアンケート（会員ログイン必須・量産不可）とLstepフォーム（API無し・毎回手作業）は不採用。

## データモデル（台帳SQL + migrate.mjs で追加）

### surveys
| 列 | 型 | 備考 |
|---|---|---|
| id | INTEGER PK | |
| slug | TEXT UNIQUE NOT NULL | 公開URL用ランダム短ID（連番にしない=推測列挙防止） |
| title | TEXT NOT NULL | |
| intro | TEXT | フォーム冒頭の説明文 |
| audience | TEXT NOT NULL DEFAULT 'member' | 'member' / 'public' / 'both' |
| name_note | TEXT | 名前欄の下に出す案内文（下記コピー既定） |
| status | TEXT NOT NULL DEFAULT 'draft' | 'draft' / 'open' / 'closed' |
| opens_at | TEXT | 回答受付開始日時（JST・任意）。未設定=open化した時点から |
| closes_at | TEXT | 回答受付終了日時（JST・任意）。未設定=closedにするまで |
| created_at / opened_at / closed_at | TEXT | |

status遷移は draft→open→closed のみ（validate.tsの既存パターン踏襲）。
draft中のみ設問編集可。open後は文言修正のみ許可（選択肢の削除は不可＝回答整合性維持）。

**回答期間（TARO要望 2026-08-28）**: 「いつからいつまで」をアンケートごとに設定可能。
実効状態は純関数 `effectiveState(survey, now)` でリクエスト時に導出（cron不要）:
- status='open' かつ opens_at前 → `scheduled`（公開ページは「受付開始前」＋開始日時表示・送信不可）
- status='open' かつ 期間内 → `accepting`（回答可）
- status='open' かつ closes_at超過 → `expired`（「受付終了」表示・送信不可。サーバ側Actionでも拒否）
- status='closed' → 常に受付終了（期限より手動closeが優先）
期限判定はJST基準（既存dateJst利用）。締切はサーバ側で必ず再判定する（画面表示だけで守らない）。

### survey_questions
| 列 | 型 | 備考 |
|---|---|---|
| id | INTEGER PK | |
| survey_id | INTEGER NOT NULL | |
| sort_order | INTEGER NOT NULL | |
| question_key | TEXT NOT NULL | survey内ユニーク（集計・会員起点クエリのキー） |
| label | TEXT NOT NULL | |
| qtype | TEXT NOT NULL | 'single' / 'multi' / 'text' |
| required | INTEGER NOT NULL DEFAULT 0 | |
| options_json | TEXT | choice系のみ。[{key,label}] |
| allow_other | INTEGER NOT NULL DEFAULT 0 | 「その他（自由記入）」枠を付ける |

### survey_responses
| 列 | 型 | 備考 |
|---|---|---|
| id | INTEGER PK | |
| survey_id | INTEGER NOT NULL | |
| respondent_name | TEXT | 回答者記入の生徒名（任意・きょうだい連名可） |
| boom_member_id | INTEGER | 紐付け確定後に設定（複数名記入時は代表1名+残りはメモ運用） |
| match_status | TEXT NOT NULL DEFAULT 'none' | 'none'(無記名) / 'auto' / 'pending' / 'confirmed' / 'unmatched' |
| match_candidates_json | TEXT | pending時の候補（member id配列） |
| submitted_at | TEXT NOT NULL | |

### survey_answers
| 列 | 型 | 備考 |
|---|---|---|
| id | INTEGER PK | |
| response_id | INTEGER NOT NULL | |
| question_id | INTEGER NOT NULL | |
| option_key | TEXT | 選択式: 選択肢1つにつき1行 |
| text_value | TEXT | 自由記入 / その他の記入内容 |

## 画面・ルート

### 公開側 `/survey/[slug]`
- 認証なし公開ページ（route/action冒頭に公開理由コメント必須・CLAUDE.md §4.5）
- open状態のみ表示。draft/closedは「受付終了」表示
- 送信はServer Action（新規ページはServer Actions優先・CLAUDE.md §6）
- `checkRateLimit`（既存eventAuth.ts）でIP単位の送信制限
- 回答の読み出しは一切公開しない（名簿列挙GET禁止）
- 送信後: お礼画面

### スタッフ側 `/staff/surveys`（withAuth・StaffPageHeader・ブランド3色）
- 一覧＋新規作成（タイトル・説明・対象・**回答期間(opens_at/closes_at・任意)**・設問ビルダー: single/multi/text、選択肢編集、その他枠ON/OFF）
- 発行（open化）でURL表示＝LINE配信に貼るだけ。一覧に実効状態（受付前/受付中/期限切れ/終了）と期間を表示
- `/staff/surveys/[id]`: 集計画面
  - 設問ごとの件数バー＋**クロス集計**（第1弾の本体: 曜日×時間帯×温度感）
  - 回答一覧（記名・紐付け状態つき）
  - **紐付け承認キュー**: pending回答に候補会員を提示→ワンタップ確定/手動検索/紐付けなし
  - CSVエクスポート（withAuth route）
- 会員詳細画面に「アンケート回答」履歴セクションを追加

## 会員照合（マッチング）

- 純関数 `src/lib/surveyMatch.ts`（vitest対象）
- 正規化: trim・全半角統一・スペース除去・カナ正規化
- 照合先: `boom_members`（status='active'優先）の `full_name` / `full_name_kana` / `rep_name`（保護者名で書かれるケース）
- 判定:
  - 正規化後に**一意に完全一致** → match_status='auto'（自動紐付け）
  - 複数候補・部分一致のみ → 'pending'（承認キューへ。linkSuggest.tsの確信度降格の思想を踏襲）
  - 候補ゼロ → 'unmatched'（スタッフが手動紐付け可能）
- 全自動にしない理由: 誤紐付けは「別の家庭の意見が会員記録に載る」事故で、検出が難しいため

## PII・セキュリティ

- ログに氏名・連絡先を出さない（既存規約）
- 回答データの読み出しはすべてwithAuth配下
- slugは推測不能なランダム値・回答IDの連番列挙APIを作らない
- 台帳SQLは行内コメント禁止（migrate.mjs制約）
- 本番否定テストは存在しないid(999999)で・deploy success確認後

## 第1弾コンテンツ（コードでなくスタッフ画面から投入）

- タイトル: 七ヶ浜クラス増設アンケート（文言は配信文面と合わせて最終化）
- 対象: member
- 名前欄コピー（確定）:
  > お名前の記入は任意です。ご記入いただけると、より詳細に現状を把握できるので、ご意向に沿ったクラスを作りやすくなります。
- 設問8問:
  1. 生徒のお名前（text・任意・きょうだい連名可）
  2. 学年（multi）: 未就学／小1-2／小3-4／小5-6／中学生以上／大人
  3. 現在通っているクラス（multi）: 金曜18:30入門／金曜19:30初級／七ヶ浜以外のBOOMクラス
  4. 増えるなら通いやすい曜日（multi）: 月〜日
  5. 通いやすい時間帯（multi）: 平日16時台／17時台／18時台／19時台／土日午前／土日午後
  6. 増やしてほしいジャンル・レベル（multi＋その他自由記入）: HIPHOP／ガールズHIPHOP／HOUSE／ストリートジャズ／フリースタイル／入門クラス／その他（POP・LOCKなど）
  7. 希望に合うクラスができたら（single）: 必ず通いたい／たぶん通う／わからない
  8. ご要望・ひとこと（text・任意）
- 会場設問（国際村/アクアスタジオ）は不要とTARO判断（七ヶ浜地域前提・車社会）

## 集計と増設判断（運用）

- 回収後、Q4×Q5×Q7のクロスで「必ず＋たぶん」の人数を曜日×時間帯マスに集計
- 最多マス＋Q6のジャンル分布から増設案を提示（会場空き・講師都合はTARO確認）
- 結果解釈までこのセッションの仕事

## テスト方針

- TDD。純関数（設問バリデーション・回答バリデーション・照合・集計）をvitestで先行
- `npm run build` 通過後にmainへ。git addはパス指定のみ

## スコープ外（YAGNI）

- 回答の編集トークン（アンケートは1回送信きり・修正は再送信でよい）
- 一般向け(audience='public')の連絡先欄の作り込み → 第2弾で必要になった時
- LINEログイン連携・回答者の自動識別
- グラフ画像の自動生成
