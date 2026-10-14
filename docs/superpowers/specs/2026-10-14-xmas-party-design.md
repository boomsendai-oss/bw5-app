# クリスマスパーティー2026 申込・出演エントリー 設計書

- 作成: 2026-10-14 / WS AT / TARO承認済み(2026-10-14 チャットで設計OK)
- 開催: 2026-12-19(土) 11:30〜16:30(予定) / SPACE ZERO(会場費 ¥90,000+税=¥99,000)
- 方針: BF6(`bf_*` テーブル・`/bf6`)には一切相乗りしない。**イベントキー(`event_key`)で切り替えられる汎用の「パーティー申込」**として新設し、今年は `event_key = 'xmas2026'`。来年は設定行を足すだけで使い回す。

## 1. 決定事項(TAROと合意済み)

| 項目 | 決定 |
|---|---|
| 参加費 | 前売 ¥2,000 / 当日 ¥2,500。子ども・大人の区別なし。**未就学児は無料(人数だけ聞く)** |
| 1ドリンク ¥600 | 会場キャッシャーが別に受け取る。アプリでは表記のみ |
| 申込の単位 | 代表者(名前・ふりがな・メール・電話)＋人数(小学生以上/未就学児)＋BOOM会員かどうか |
| 支払い | カード事前決済(Stripe) か 当日現金(会場キャッシャー) を選べる |
| 前売締切 | 2026-12-16(水) 20:00。カードと当日現金予約は**別々の締切キー**で持つ(同値で開始) |
| 返金 | ページ表記は「原則返金不可」。スタッフが個別に取消/返金済みにできる(返金操作はStripe管理画面で手作業) |
| 出演エントリー | チーム名・ジャンル・代表者(名前/ふりがな/メール/電話)・メンバー全員の名前(2人以上) |
| 出演の金額 | メンバー1人あたり 出演料 ¥2,000 ＋ 参加費 ¥2,000 = ¥4,000 をエントリーでまとめて払う。出演者はパーティー申込不要(付き添いの保護者はパーティー申込で別途) |
| 出演の支払い | カード か 当日現金 |
| 先着 | **8チームで自動受付終了・キャンセル待ちなし**(上限はスタッフ設定で変更可) |
| エントリー締切 | 2026-12-01(火) 23:59 |
| 音源 | エントリー後の控えページからアップロード。締切 2026-12-12(土) 23:59。差し替え可 |
| 公開 | パーティー申込とエントリーは**スタッフが設定した日時に同時に公開** |
| 当日受付 | 会場キャッシャーが**印刷した紙の名簿**で確認。アプリでの当日チェックインは作らない |
| 現金の精算 | キャッシャーが当日現金を受け取り、会場費と相殺して差額をBOOMと精算 |
| 見た目 | 告知画像A案のレトロコミック調(古紙色＋赤緑) |

設計上の追加(TARO未確認・軽微): **代表者のふりがな(ひらがな)を必須**にする。紙の名簿を50音順に並べ、キャッシャーが名前を探しやすくするため。

## 2. 画面

### 一般向け(認証なし・ファイル冒頭に公開理由を明記)
- `/xmas` … 告知画像・開催情報・企画・「参加申込」「出演エントリー」ボタン。公開前は「◯月◯日◯時 受付開始」を表示
- `/xmas/ticket` … パーティー申込フォーム
- `/xmas/entry` … 出演エントリーフォーム(残りチーム数を表示)
- `/xmas/my?t=<token>` … 申込の控え。カード未払いなら決済ボタン、当日現金なら支払額。エントリーは音源アップロード欄

### スタッフ向け(`/staff/xmas/*`・proxy＋`isAuthorizedServer()`)
- `/staff/xmas` … 申込とエントリーの一覧・件数・人数。取消/返金済み・メモ・音源のダウンロード
- `/staff/xmas/settings` … 公開日時・各締切・料金・チーム上限・緊急停止
- `/staff/xmas/roster` … 印刷用の名簿(ふりがなの50音順)
- `/staff/xmas/settlement` … 当日の現金精算と収支(収支台帳 `event_ledger` に `event_key='xmas2026'` で記録)

ヘッダーは `StaffPageHeader`、色はブランド3色(navy/teal/sand)。一般向けページはレトロコミック調(赤 #d4302a・緑 #2f8a3e・古紙 #f7ecd0・墨 #1a1410)。入力欄は文字色と背景色を必ずセットで指定する(規約11)。

## 3. データ(マイグレーション `scripts/migrations/20261014_party_tables.sql` ＋ `schema.ts`)

```
party_orders
  id, event_key, kind('ticket'|'entry'),
  buyer_name, buyer_kana, email, phone, is_member(0/1),
  people_count(小学生以上・ticketのみ), infant_count(ticketのみ),
  team_name, genre, member_count(entryのみ),
  pay_method('card'|'cash'), status('pending'|'paid'|'cash_due'|'expired'|'canceled'|'refunded'),
  unit_price(申込時の単価スナップショット), amount_total,
  stripe_session_id, edit_token UNIQUE, expires_at,
  audio_url, audio_filename, audio_uploaded_at,
  staff_note, created_at, updated_at
party_entry_members  id, order_id, name, sort_order
party_payments       id, stripe_event_id UNIQUE, event_type, stripe_session_id, payment_intent_id, order_id, amount, payload, created_at
party_settings       event_key, key, value, updated_at  (PK: event_key+key)
```

- 「枠を使っている」= `paid`・`cash_due`・期限内の`pending`。`pending`は30分で`expired`(読む前にsweep)
- 先着の判定と作成は1つの書き込みトランザクションで行う(同時送信で9チーム目が入らないように)

## 4. 金額と締切(純関数 `src/lib/party.ts`・vitest対象)

- `ticketTotal(people, s)` = people × 前売単価。未就学児は0円
- `entryTotal(members, s)` = members × (出演料 + 参加費)
- **説明文に金額を直書きしない**。ページ・メール・名簿の金額はすべてこの関数と設定値から出す(BF6で表示¥2,000・請求¥2,500になった事故の対策)
- 受付の開閉は商品ごとに別の関数: `ticketCardOpen` / `ticketCashOpen` / `entryOpen`(公開日時・締切・緊急停止・上限)。1本のゲートにまとめない(BF6で配信チケットが観覧の締切に巻き込まれた事故の対策)
- 日時はすべてJSTで比較する

## 5. 決済

- Stripe Checkout(BF6と同じREST方式。既存の `createBf6CheckoutSession` / `verifyStripeSignature` を流用)。明細はDB保存済みの注文から組み立て、クライアントの申告額は使わない
- `metadata[party_order_id]` を付け、既存Webhook `/api/bf6/stripe-webhook` に**Tシャツと同じ方式で相乗り**(Stripe側の追加設定なし)。BF6の判定より前に振り分ける
- 冪等: `party_payments.stripe_event_id UNIQUE`。`pending`/`expired` → `paid`。金額不一致でも`paid`にしてログに残す

## 6. メール(`src/lib/partyEmail.ts`)

- 当日現金: 申込直後に送る(支払額とキャッシャーで払う旨)
- カード: Webhookで`paid`になった時に送る
- 件名【BOOMクリスマスパーティー2026】。控えページのURL、日時・会場、1ドリンク¥600は会場で別途、原則返金不可、問い合わせは公式LINE
- エントリーは音源の提出方法と締切を書く

## 7. 音源アップロード

- 既存の Vercel Blob(`@vercel/blob` 2.3.3)をクライアント直接アップロードで使う(関数の本文サイズ上限4.5MBを超えるため)
- `/api/xmas/audio-upload`(公開route。理由をコメント): edit_token が有効なエントリー(`paid`/`cash_due`)・締切前・音声ファイル・50MBまでのときだけアップロード用トークンを発行
- アップロード後に Server Action で注文に URL を保存(URLが自分のBlobストアのものか検証)。差し替えたら上書き
- スタッフ一覧から再生・ダウンロード

## 8. 当日と精算

- 名簿(印刷): 50音順。代表者名・人数(小学生以上/未就学児)・会員か・状態(支払済み/当日 ¥◯)・出演チーム名とメンバー・チェック欄。取消・期限切れは載せない
- 精算画面:
  - 「キャッシャーに入るはずの現金」= `cash_due` の合計(名簿から自動)
  - 入力: 当日券の人数・キャッシャーが受け取った現金の実額・**入力者の名前(必須)**
  - 表示: 当日券の見込み額(人数×当日単価)との差、会場費¥99,000との相殺結果(BOOMが受け取る/払う額)
  - 保存すると `event_ledger` に記録(売上・会場費)。プレゼント約¥50,000などの支出も同じ台帳で手入力
- 物販: `/staff/kiosk` で販売枠を1行作る(コード変更なし)

## 9. テストデータのリセット

`scripts/party_reset_testdata.mjs <event_key>`: 引数なし・`--dry-run`は件数表示のみ。`--yes`で決済記録→メンバー→申込の順に削除(BF6のリセット事故の教訓。状態を戻さず控えだけ消すことをしない)。

## 10. テスト

- vitest: 金額計算・締切/公開/上限の判定(JST境界)・入力検証・Webhookイベントの判別・名簿の並び・精算計算・メール文面
- `next build` まで通す(route.tsを触るため)
- 本番前にプレビューで フォーム入力→当日現金申込→控え→スタッフ一覧→名簿印刷 を通し、入力欄の文字色を実測

## 11. 作らないもの

iPadセルフ受付・リストバンド・LED/抽選演出・当日チェックイン・キャンセル待ち・申込者自身による取消
