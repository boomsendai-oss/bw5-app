# 要対応メール通知（受信箱アラート）設計

- 日付: 2026-09-11
- 状態: TAROレビュー待ち
- 置き場: BOOMアプリ（`bw5-app`）＋ Cloudflare Worker `workers/boom-cron`

## 1. 目的

Claudeの自動化で通知メールが増え、新規の問い合わせや仕事依頼が埋もれて返信が遅れるリスクがある。
3つのGmailを監視し、**人が対応すべきメールが来たときだけ、確実に気づける通知**を出す。

## 2. 決定事項（2026-09-11 TARO合意）

| 項目 | 決定 |
|---|---|
| 監視対象 | boom.sendai@gmail.com / nitro.ash.designworks@gmail.com / taro.bsb@gmail.com の3つ |
| 分け方 | 全部拾ったうえで3段階に分ける（下表） |
| 通知経路 | Pushover（iPhoneの通知専用アプリ）。アカウントごとに名前とアイコンを分ける |
| 動かす場所 | クラウド（Cloudflare Worker が起動 → BOOMアプリが判定 → Pushover） |
| 判定 | ルールで宣伝を除いたあと、AI（Claude Opus 5）が判定する |
| 誤判定の方針 | 迷ったら鳴らす（見逃しより鳴らしすぎを許容）。基準はあとから一言で直せる |
| 未対応の管理 | 返信する、またはGmailでアーカイブすると消える。それまで毎朝のまとめに残る |

| 段階 | 届け方 | 対象 |
|---|---|---|
| すぐ鳴らす | Pushoverへ即時 | 新しい問い合わせ・依頼／やり取り中の相手の返信／期限が近いお金・契約 |
| 朝のまとめ | 毎朝8:00のまとめ1通に載せる | Claude自動化の失敗警報／期限の遠いお金・契約 |
| 件数だけ | まとめに件数だけ出す | 宣伝・メルマガ・利用明細 |

## 3. 実測データ（設計の根拠）

直近30日（2026-09-11にGmail APIで集計。迷惑メールフォルダはAPI既定で対象外）:

| | 受信 | 宣伝/SNS分類 | 配信停止リンク付き | 自動送信(noreply等) | 人が書いた風 |
|---|---|---|---|---|---|
| boom | 490 | 139 | 113 | 77 | 161（うち銀行通知104・Amazon30） |
| nitroash | 90 | 51 | 18 | 5 | 16（うちUP-T 15） |

- 「🚨緊急」ラベルの未読21件は、同期失敗などのシステム警報とhacomonoの宣伝で、**お客さんの問い合わせは0件**だった
- 業務の相談メール（提携・活動拠点の相談）が2通、ラベルなしで受信箱に埋もれていた
- 自動送信の中にも気づくべきものがある: hacomono「プラン契約完了｜公式LINEよりメッセージ送付をお願いします」、Lステップ通知、Stripe決済、Anthropicクレジット、Vercel失敗通知 → **自動送信はルールで捨てず、AIに軽く読ませる**
- HPからの問い合わせ経路は公式LINEと `mailto:boom.sendai@gmail.com` のみ（フォームなし）。formrunからは宣伝のみ（180日で本物の通知0件）

## 4. 全体の流れ

```
Cloudflare Worker boom-cron（毎分起動）
  ├─ 5分おき → POST /api/cron/inbox-alert          （x-cron-secret）
  └─ 08:00   → POST /api/cron/inbox-alert-digest   （x-cron-secret）

/api/cron/inbox-alert（アカウントごと）
  1. Gmail から前回以降の新着を取得（読み取り専用）
  2. ルールで3つの読み方に振り分け（count_only / ai_light / ai_full）
  3. ai_* は Claude Opus 5 で判定 → 段階（now / digest / count）＋種類＋要約
  4. now は Pushover へ即時送信
  5. DBに「メールID・段階・種類・通知時刻」だけ記録（件名・本文は保存しない）
  6. 未対応（now）を再確認し、返信済み・アーカイブ済みを閉じる

/api/cron/inbox-alert-digest（毎朝8:00）
  未対応一覧（件名はGmailから取り直す）＋朝のまとめ対象＋件数＋稼働状況 → Pushover 1通
```

## 5. コンポーネント

| ファイル | 役割 | 依存 |
|---|---|---|
| `src/lib/inboxAlert/accounts.ts` | 3アカウントの設定（キー名・表示名・Pushoverトークン）を環境変数から組み立てる | env |
| `src/lib/inboxAlert/gmail.ts` | トークン更新・新着一覧・メタデータ/本文取得・スレッドの返信有無・INBOXラベル有無 | Gmail API |
| `src/lib/inboxAlert/prefilter.ts` | **純関数**。ラベルとヘッダーから読み方を決める | なし |
| `src/lib/inboxAlert/criteria.md` | 判定基準（日本語）。TAROの「これは通知いらない」はここを直す | なし |
| `src/lib/inboxAlert/classify.ts` | Claude Opus 5 で判定し、構造化出力で結果を返す。失敗時はルール判定に切り替える | Anthropic SDK |
| `src/lib/inboxAlert/pushover.ts` | 通知の組み立て（**純関数**）と送信 | Pushover API |
| `src/lib/inboxAlert/digest.ts` | 朝のまとめの組み立て（**純関数**・1024字制限で「ほかN件」に畳む） | なし |
| `src/lib/inboxAlert/db.ts` | 状態テーブルの読み書き（`src/lib/db.ts` 経由） | Turso |
| `src/app/api/cron/inbox-alert/route.ts` | 5分おきの本処理（`maxDuration=60`、45秒で打ち切り残りは次回） | 上記 |
| `src/app/api/cron/inbox-alert-digest/route.ts` | 朝のまとめ | 上記 |
| `workers/boom-cron/index.js` | 「N分おき」の仕事を追加（今の時刻表は `HH:MM` 一致のみ） | — |

### 5.1 読み方の振り分け（prefilter）

| 読み方 | 条件 | AIに渡す内容 |
|---|---|---|
| `count_only` | Gmailの分類が宣伝（CATEGORY_PROMOTIONS）またはSNS（CATEGORY_SOCIAL） | なし（件数だけ数える） |
| `ai_light` | 配信停止リンク（List-Unsubscribe）あり / Precedence: bulk・list / Auto-Submitted / noreply系の差出人 / 登録済みの自動送信元（銀行・Amazon） | 差出人・件名・本文冒頭500字 |
| `ai_full` | 上記以外（人が書いた風） | 差出人・件名・本文冒頭3,000字 |

送信済み・チャット・迷惑メール・ゴミ箱は対象外。
「登録済みの自動送信元」は `prefilter.ts` 内の定数（初期値: `bank.gmo-aozora.com` / `mail.gmo-aozora.com` / `amazon.co.jp`）で持ち、増減はコード修正で行う。

### 5.2 AI判定（classify）

- モデル: `claude-opus-5`、`output_config.effort: "low"`、構造化出力（`output_config.format`）
- 判定基準 `criteria.md` はシステムプロンプトに入れてプロンプトキャッシュを効かせる
- 出力スキーマ:
  - `tier`: `now` | `digest` | `count`
  - `kind`: `new_inquiry`（新規の問い合わせ・依頼） | `reply`（やり取り中の返信） | `money_deadline`（期限が近いお金・契約） | `automation_failure`（自動化の失敗） | `money_later`（期限の遠いお金・契約） | `other`
  - `summary`: 60字以内の日本語要約（顧客の実名は入れない）
- 基準には「迷ったら `now`」を明記する
- 期限の「近い／遠い」の境目は7日（期限が7日以内なら `money_deadline`）
- 本文はプロンプトに渡すだけで、ログにもDBにも残さない
- Anthropic SDK の対応状況を実装計画で確認し、Opus 5 の拒否時フォールバック（`fallbacks: "default"`）を付ける

### 5.3 通知の中身（Pushover）

- 送り主（アプリ）はアカウントごとに3つ: 「BOOM」「NITRO ASH」「個人」。名前とアイコンで区別する
- タイトル: `【新規の問い合わせ】` / `【返信】` / `【期限あり】` ＋ 件名（250字以内）
- 本文: 差出人（表示名。無ければドメイン）＋要約
- リンク: そのメールをGmailで開くURL（iPhoneでGmailアプリに渡るかは実機で確認する）
- 優先度: 通常（0）。深夜の扱いやおやすみモードを突破する設定（1）・確認するまで鳴らし続ける設定（2）は、運用してから必要ならTAROと決める

例:

```
BOOM
【新規の問い合わせ】体験レッスンの相談
差出人: 個人のGmail
要約: 小学生の子の体験を土曜に希望
```

### 5.4 朝のまとめ（毎朝8:00・Pushover 1通）

```
朝のまとめ 9/12
■未対応 2件
・BOOM【新規】体験レッスンの相談（昨日12:10）
・個人【返信】見積の件（9/10）
■自動化の失敗 1件
・BOOM 日次同期が失敗しました
■期限の遠いお金 0件
■件数 宣伝31 / 自動通知48（AI判定できず0）
■稼働 3アカウントとも正常（最終確認 7:55）
```

- 未対応の件名は、まとめを作る時にGmailから取り直す（DBに件名を持たない）
- 1024字を超える分は「ほかN件」に畳む
- 未対応は、返信かアーカイブで消えるまで毎朝載り続ける（自動では消さない）

## 6. データ（Turso・マイグレーション `20260911_inbox_alert.sql`）

**件名・差出人・本文は保存しない。** 保存するのは次の2テーブルだけ。

- `inbox_alert_state`: `account`（PK） / `last_checked_ms` / `last_success_at` / `last_error` / `consecutive_errors`
- `inbox_alert_items`: `account` + `message_id`（PK） / `thread_id` / `received_ms` / `read_mode` / `tier` / `kind` / `notified_at` / `resolved_at` / `resolved_reason`（`replied` | `archived`） / `created_at`
  - 同じメールを二度通知しないための記録を兼ねる
  - 60日を過ぎた行は、朝のまとめ処理の中で削除する

本番は `SKIP_DB_INIT=1` のため、台帳SQLと `scripts/migrate.mjs` で適用する（台帳SQLは行内コメント禁止）。

## 7. 新着の取り方と未対応の判定

- 新着: `messages.list` を `after:<前回確認時刻−10分>`（`-in:sent -in:chats`、受信トレイ外も含む）で取り、`inbox_alert_items` で重複を除く
- 初回: その時点までのメールは既読扱いで記録し、通知しない
- 返信済み: 同じスレッドに、そのメールより新しい「送信済み」ラベルのメッセージがある
- アーカイブ済み: そのメールに INBOX ラベルが無い
- 再確認の対象: `tier=now` かつ未解決のもの（毎回、最大20件）

## 8. 認証情報

- クラウドには**読み取り専用（`gmail.readonly`）の新しい鍵**を置く。今ある鍵（`gmail.modify`＝送信・削除も可）はクラウドに置かない
- OAuthクライアントは boom所有の `gmail-mcp-504722`（本番公開済み・外部）を3アカウント共通で使う。同意画面に「未確認のアプリ」と表示されるが、進めてよい
- 鍵の発行: ローカルの補助スクリプトでTAROがGoogleログインを3回行う。発行した鍵はチャットに出さず、スクリプトから直接Vercelの環境変数に登録する
- Vercel環境変数（新規）: `GMAIL_ALERT_CLIENT_ID` / `GMAIL_ALERT_CLIENT_SECRET` / `GMAIL_ALERT_REFRESH_TOKEN_BOOM` / `_NITROASH` / `_TARO` / `PUSHOVER_USER_KEY` / `PUSHOVER_TOKEN_BOOM` / `_NITROASH` / `_TARO`
- 既存を流用: `ANTHROPIC_API_KEY` / `CRON_SECRET_CF`
- Gitにも STATE.md にも鍵を書かない

## 9. 止まったときの備え

| 事態 | 動き |
|---|---|
| AIが使えない（クレジット切れ・障害） | `ai_full` は「【AI判定できず】」を付けて即時通知、`ai_light` は朝のまとめへ。まとめに件数を出す |
| Gmailの鍵が失効（invalid_grant） | Pushoverで「○○の連携が切れました」を即時（同じアカウントは1日1回まで） |
| 連続失敗（`consecutive_errors` が6回＝約30分） | Pushoverで「受信箱アラートが止まっています」 |
| Pushoverへの送信失敗 | `notified_at` を空のまま残し、次回に再送 |
| 仕組みごと止まる（Worker/Vercel） | 朝のまとめが届かない＝止まっている合図（TAROに周知） |

## 10. 既存の仕組みとの関係

- scheduled task `gmail-urgent-line-notify`（🚨緊急の未読を自分宛メールで通知）: 本番が1週間安定したら、TAROに確認してから停止する
- `gmail_watch.py` / launchd `com.boom.gmailwatch.bunsugi`: 触らない
- Gmailのフィルタ・ラベル: 触らない（読み取り専用なので変更できない）

## 11. 費用（見込み）

- AI判定: 月約950〜1,500円（前提: 月390通、本文を読むメールは3,000トークン・件名だけのメールは700トークン、返答300トークン、Opus 5の料金 入力$5/出力$25 per 1M、1ドル150円。個人Gmailは未計測）
- Pushover: iPhone用 $4.99 買い切り（30日無料）
- Cloudflare Worker / Vercel: 追加費用なし（既存の枠内）
- 本番1週目に実際の使用量を計測してTAROへ報告する

## 12. テスト

- 単体テスト（vitest）: prefilter の振り分け / 判定結果→通知の組み立て / まとめの整形（1024字の畳み） / 返信・アーカイブの判定 / AI失敗時の切り替え
- 事前検証（通知は送らない）: 過去30日の実メールでローカルに dry-run し、「すぐ鳴らす」になったメールの件数と一覧を画面上でTAROと確認する（件名は保存しない）。**AI費用が1回で約950〜1,500円（ほぼ1ヶ月分）かかるので、実行前にTAROの了承を取る**
- 本番の段階投入: `INBOX_ALERT_DRY_RUN=1`（通知を送らず件数だけ記録）で1日動かす → 解除 → TARO自身が各アドレスへテストメールを送り、5分以内に鳴るか確認

## 13. TAROにお願いすること

1. iPhoneにPushoverを入れてアカウントを作る（ユーザーキーの受け渡し方法はその時に案内する）
2. Googleログイン3回（BOOM / NITRO ASH / 個人。読み取り専用の許可）
3. 別件: NITRO ASH の Cloudflare アカウントの未払い $6.60 を 9/29 までに支払う（未払いだと有料機能が止まる。BOOMのR2・boom-cronとは別アカウント）

## 14. やらないこと

- メールの返信・送信・ラベル変更（読み取り専用）
- LINEでの通知
- 件名・差出人・本文のDB保存やログ出力
