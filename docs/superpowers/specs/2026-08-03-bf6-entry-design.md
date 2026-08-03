# BOOMER'S FIGHT!!! vol.6 エントリー＆事前決済アプリ 実装設計

- 作成日: 2026-08-03(TAROヒアリングで項目確定済)
- 上位文書: `~/BOOM/BOOMERS_FIGHT_2026/エントリーアプリ_設計書_v2.md`(料金・定員・日割りの正本)
- ステータス: 確定(実装中)。受付開始 8/8(土)〜9/24(木)

## 1. 確定条件(v2から)

| 項目 | 内容 |
|---|---|
| バトル定員 | 初心者16 / 小中32 / 一般32(スタッフ画面から変更可) |
| バトル料金 | 1部門¥2,500・2部門¥4,000・3部門¥5,500(事前決済は一律−¥500) |
| 初心者部門資格 | 小学生(小1〜小6)かつバトル初出場のみ |
| 観覧 | 大人 事前¥2,000/当日¥2,500・小学生¥1,000・未就学児/出演者本人 無料 |
| 観覧上限 | 200(ホール定員) − 出演者数 − 販売済で自動締切 |
| 決済 | Stripe Checkout + Webhookが正本(金額はサーバ側で再計算) |
| ショーケース | スコープ外(item_typeに showcase/stream を予約のみ) |

## 2. フォーム項目(TARO確定 2026-08-03)

### 申込者(1決済単位・保護者可)

| 項目 | 必須 | 備考 |
|---|---|---|
| 申込者氏名 | ✅ | |
| 電話番号 | ✅ | 「必ず当日連絡が取れる番号」注記。**非公開・スタッフ画面のみ** |
| メールアドレス | ✅ | 完了メール(受付番号・内容・金額・自己確認URL)の宛先 |
| 決済方法 | ✅ | 事前カード決済(総額−¥500/人・デフォルト) / 当日会場払い |

### 出場者ごと(「+ 出場者を追加」できょうだい対応)

| 項目 | 必須 | 公開 | 備考 |
|---|---|---|---|
| 本名(カタカナ) | ✅ | ❌ | 当日受付照合・保護者対応用。スタッフのみ |
| ダンサーネーム | ✅ | ✅ | エントリーリスト・トーナメント表・MC用 |
| 呼び方(フリガナ) | ✅ | ❌ | MCの読み上げ用 |
| 学年区分 | ✅ | ❌ | 未就学〜大人のプルダウン。部門資格の自動チェックに使用 |
| エントリージャンル | 任意 | ✅ | 自由記入(HIPHOP/BREAK等) |
| REP(チーム名・地域等) | 任意 | ✅ | 自由記入 |
| Instagram(@付き) | 任意 | ❌ | 結果発表・レポートのタグ付け用。「なるべく入力」文言 |
| 出場部門(複数可) | ✅ | ✅ | 満枠部門はチェック不可。初心者部門は小1〜小6のみ+初出場チェック必須 |
| バトル初出場チェック | 条件 | ❌ | 初心者部門選択時に必須 |

### 観覧同時購入(フォーム末尾)

- 大人枚数・小学生枚数(未就学児は無料のため入力なし)
- 残数(200−出演者−販売済)を超える枚数は選択不可

## 3. 公開エントリーリスト(TARO要件 2026-08-03)

- 部門ごとのエントリー一覧を**誰でも見られる**。`/bf6` と `/bf6/entry` から導線
- 掲載項目: **ダンサーネーム・ジャンル・REP のみ**(+部門別の残枠)
- **本名・呼び方・電話・メール・Instagram・学年は絶対に載せない**
- 掲載タイミング = 枠カウントと同一基準:
  - 当日払い: 申込完了した瞬間(payment_status='cash_due')
  - 事前決済: Webhookで決済確認した瞬間(payment_status='paid')
- 実装: 公開クエリは公開列のみをSELECTする専用関数に限定(PII列を経由しない)

## 4. データ設計

`scripts/migrations/20260803_bf6_tables.sql`(+ `src/lib/db/schema.ts` 二重登録)

- `bf_orders` — 1決済単位。buyer_name / email / phone / pay_method('prepaid'|'onsite') /
  payment_status / amount_total / stripe_session_id / edit_token(UNIQUE) / expires_at
- `bf_order_items` — 明細。item_type('entry'|'ticket_adult'|'ticket_child'|'showcase'|'stream') /
  performer_name(本名・非公開) / dancer_name / dancer_kana / grade / genre / rep / instagram /
  is_first_battle / divisions(JSON) / qty / unit_amount
- `bf_payments` — Stripe Webhookの記録(正本)。stripe_event_id UNIQUE で冪等
- `bf_settings` — key-value(定員・料金・受付ON/OFF・ホール定員)。既定値は `src/lib/bf6.ts` の
  `DEFAULT_BF6_SETTINGS`

### payment_status の遷移

```
prepaid: pending --(Webhook checkout.session.completed)--> paid
         pending --(30分経過)--> expired(枠解放・リスト非掲載)
onsite:  cash_due(申込時に即確定・枠消費・リスト掲載)
共通:    paid/cash_due --(スタッフ操作)--> canceled / refunded
```

- 枠カウント・観覧販売済・エントリーリスト = `payment_status IN ('paid','cash_due')`
- 30分期限は読み取り時スイープ(既存 autoCancel 方式)で expired 化

## 5. 決済(Stripe Checkout + Webhook)

- 送信 → サーバ側で料金再計算(クライアント申告額は信用しない) → bf_orders(pending) 作成 →
  Checkout Session 生成(line_itemsもサーバ計算) → リダイレクト
- `/api/bf6/stripe-webhook` — 公開route(署名検証あり)。`checkout.session.completed` で
  bf_payments 記録 → 該当 order を paid 化 → 完了メール送信
- 完了画面 `/bf6/complete` は表示専用(決済確定はWebhookのみが正本)
- 金額ズレ検知: session.amount_total と orders.amount_total の不一致は `/staff/bf6/payments` に表示
- 環境変数: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`(TAROがVercelに直接登録。コードに書かない)

## 6. 画面構成

```
/bf6                    イベントTOP(公開。日時・会場・料金・部門・エントリーリスト導線)
 ├ /bf6/entry           バトルエントリー(複数人+観覧同時購入・料金自動計算)
 ├ /bf6/entries         公開エントリーリスト(部門別・ダンサーネーム/ジャンル/REP・残枠)
 ├ /bf6/ticket          観覧チケットのみ購入
 ├ /bf6/complete        完了画面(受付番号+自己確認リンク)
 └ /bf6/legal           特商法・返金ポリシー(文面は後で流し込み)

/staff/bf6              ダッシュボード(部門別残枠・入金済/未入金・観覧残・売上)
 ├ /staff/bf6/entries   エントリー一覧(本名・連絡先含む。検索・CSV・手動ステータス変更)
 ├ /staff/bf6/tickets   観覧一覧
 ├ /staff/bf6/payments  Stripe突合(bf_payments vs bf_orders のズレ検知)
 └ /staff/bf6/settings  定員・料金・受付ON/OFF編集
```

## 7. 規約準拠・PII

- 公開ページ/Server Actionは冒頭に「なぜ公開か」コメント(規約4.5)。スタッフ側は withAuth + proxy
- 本名・電話・メール・Instagramを返す公開GETは作らない(M22)。edit_tokenでの単件アクセスのみ
- 送信・編集は `checkRateLimit` でIP制限。氏名・連絡先はログ非出力
- 受付OFF(`bf_settings`)・締切(9/24)超過時は送信不可
- 新規ロジックはTDD(vitest)。route.ts を触ったら `next build` まで通す

## 8. UX細部

- 大人が自分でエントリーする場合: 出場者ブロックに「申込者本人と同じ」チェックで本名を自動転記
- 料金はチェックのたびに自動計算し特大表示(事前/当日を並記して−¥500を見せる)
- 完了画面+完了メールに自己確認URL(edit_token)。Phase 1では閲覧のみ(変更はLINE→スタッフ操作)

## 9. 受け入れ条件(Phase 1 = 8/8)

1. `/bf6/entry` で複数人+観覧同時購入を1決済で申し込める。料金がサーバ再計算と一致する
2. 初心者部門は小1〜小6+初出場チェックがないと選択不可。満枠部門は選択不可
3. 事前決済はWebhook受信で paid になり、完了メールが届く。30分未決済は expired で枠解放
4. `/bf6/entries` に確定エントリーがダンサーネーム/ジャンル/REPのみで部門別に自動掲載される
5. 観覧は「200−出演者−販売済」を超えて購入できない
6. `/staff/bf6` 配下(認証必須)で一覧・突合・設定編集ができる
7. PII(本名・電話・メール・IG)を返す公開APIが存在しない
