# 無人物販kiosk 設計書（2026-08-25）

イベント会場にiPad＋商品を置き、お客さんがセルフで決済して商品を持っていく仕組み。
初陣 = 2026-09-26(土) BOOMER'S FIGHT!!! vol.6。

決済フロー・匿名運用・在庫管理・販売会単位の商品差し替えはTARO承認済み（2026-08-25）。
本書は「既存テーブルを使うか新設か」の調査結果と、実装の詳細設計。

## 1. 既存テーブル調査の結論 = **新設**（kiosk_* 系）

`merchandise` / `merch_orders` / `merch_variants` はBW5発表会（2026-05-05）の
**Square決済＋取り置き方式**に密結合しており、流用しない。理由:

| 論点 | 既存の実態 | kioskの要件 |
|---|---|---|
| 購入者情報 | `merch_orders.buyer_name` **NOT NULL** | 完全匿名（名前を取らない） |
| 決済 | Square（`square_payment_id`・status体系が `pending_cash`/`awaiting_payment`） | Stripe Checkout + 現金 |
| 自動キャンセル | `src/lib/autoCancel.ts` にBW5当日の日時が**ハードコード** | 販売会ごとに可変・QR放置5分で解放 |
| 販売会の概念 | なし（商品はグローバル1セット） | イベントごとに商品・価格・在庫を差し替え |
| 集計 | `kpiMetrics.ts`・`/staff/insights` が**BW5売上として集計中** | 触ると過去KPIが変わるリスク |

既存3テーブルは**一切変更しない**（BW5の売上記録として凍結）。
ただし過去の教訓は最初から組み込む:
- **P4教訓**: 注文明細に**注文時点の単価をスナップショット保存**（現在価格を遡って掛けない）
- **BF6のStripeパターン**: 金額サーバ再計算・Webhook署名検証・`stripe_event_id` UNIQUE冪等化・pending仮押さえ+sweep

## 2. 新テーブル（台帳SQL `scripts/migrations/20260825_kiosk_tables.sql` + `migrate.mjs`）

```sql
CREATE TABLE IF NOT EXISTS kiosk_sales (          -- 販売会（イベント単位）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,              -- iPadに出る販売会は同時に1つ（activeを立てたら他を下ろす運用をAPI側で保証）
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kiosk_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,                         -- 税込・JPY
  image_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,               -- バリエーションなし商品の在庫
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS kiosk_product_variants ( -- サイズ等（任意。あれば在庫はこちらが正）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  label TEXT NOT NULL,                            -- 例: 'M' 'L' 'XL'
  stock INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kiosk_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  payment_method TEXT NOT NULL,                   -- 'stripe' | 'cash'
  status TEXT NOT NULL DEFAULT 'pending',         -- pending(QR表示中=仮押さえ) | paid | expired | voided(スタッフ取消)
  amount_total INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',            -- pendingの仮押さえ期限(作成+5分)
  amount_mismatch INTEGER NOT NULL DEFAULT 0,     -- Webhook金額とズレたらフラグ(スタッフ画面で警告)
  paid_after_expired INTEGER NOT NULL DEFAULT 0,  -- 期限切れ後の入金(在庫マイナスの可能性・要スタッフ確認)
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kiosk_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  variant_id INTEGER,
  product_name TEXT NOT NULL,                     -- スナップショット(商品改名で過去売上が変わらない)
  variant_label TEXT NOT NULL DEFAULT '',
  unit_price INTEGER NOT NULL,                    -- スナップショット(P4教訓)
  qty INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS kiosk_payments (       -- Webhook冪等化(bf_payments踏襲)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  amount INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
```

インデックス: `kiosk_orders(stripe_session_id)` / `kiosk_orders(status)` /
`kiosk_products(sale_id)` / `kiosk_order_items(order_id)` / `kiosk_payments(stripe_session_id)`。

⚠️ 台帳SQLに行内コメントは書かない（上のコメントは設計書用。実SQLからは除く）。

### 在庫モデル（BF6のpending方式を踏襲）

- **実在庫 `stock` を減らすのは決済確定時のみ**（Webhook paid化 / 現金ボタン確定）
- 販売可能数 = `stock − Σ(pending注文のqty)`（仮押さえはpending注文の存在で表現。二重減算しない）
- 読み取り系の入口で毎回sweep: `expires_at < now` のpendingを `expired` 化して仮押さえ解放
- **期限切れ後の入金**（QR放置→リセット後にお客さんが支払った場合）: Webhookは入金事実を優先して
  `paid` に戻し在庫を減らす（マイナス許容）＋ `paid_after_expired=1`。スタッフ画面で警告表示→補正

## 3. 決済フロー

### 3.1 Stripe（カード/PayPay/Apple Pay/Google Pay/Link）

```
iPad /kiosk: カート確定
→ POST /api/kiosk/checkout  { items: [{product_id, variant_id?, qty}] }
   - active販売会の商品か検証・金額はサーバ側でDB価格から再計算（クライアント申告額は使わない）
   - 在庫チェック（販売可能数）→ pending注文作成（expires_at = +5分）
   - Stripe Checkout Session作成（REST・bf6Stripe.tsパターン流用）
     - metadata[kiosk_order_id]=<id> / client_reference_id
     - success_url = /kiosk/done?order=<id>（スマホ側に「お支払い完了。iPadをご覧ください」）
     - payment_method_typesは指定しない（ダッシュボード設定に追従＝PayPay/Apple Pay/Google Payが自動で出る）
     - expires_at はStripe仕様で最短30分のため指定せず、こちらの5分仮押さえ+能動expireで制御
   ← { order_id, checkout_url }
→ iPadがcheckout_urlをQR表示（qrcodeライブラリでクライアント生成）
→ iPadは GET /api/kiosk/order/[id]/status を2.5秒間隔でポーリング（SSEは使わない。Vercel関数の
   実行時間とiPad Safariの安定性を考えポーリングが堅い）
→ Webhookで paid 化 → ポーリングが検知 → 「お支払い確認できました！商品をお持ちください🙌」→ 8秒で先頭画面へ
```

- **QR放置タイムアウト**: QR表示から5分でiPadが自動リセット＋`POST /api/kiosk/order/[id]/cancel`
  → サーバはStripeの `POST /v1/checkout/sessions/:id/expire` を呼びセッションを失効・注文expired化。
  expire API失敗時もローカルはexpired化（遅れて入金されたら3.1末尾のpaid_after_expiredで回収）
- **QR多重読み**: 同一Checkout Sessionは1回しか完了できない（Stripe側で保証）。2人目は支払い済み画面になる
- **Webhook**: 新エンドポイント `/api/kiosk/stripe-webhook`（専用署名secret `STRIPE_KIOSK_WEBHOOK_SECRET`）。
  署名検証→`kiosk_payments`にINSERT OR IGNORE（冪等）→`checkout.session.completed`で注文paid化＋在庫実減。
  金額不一致はpaidにした上で`amount_mismatch=1`（入金事実優先・BF6踏襲）
- **BF6 Webhookとの共存**: StripeはアカウントのイベントをBF6用エンドポイントにも送るため、
  BF6側ハンドラに「`metadata.kiosk_order_id`があるイベントはignored」の小改修を入れる（ログノイズ防止。
  逆にkiosk側もBF6のイベント=`metadata.order_id`のみのものはignored）

### 3.2 現金

```
カート画面「現金で支払いました」→ 確認ダイアログ（合計金額を大きく表示・「貯金箱に入れましたか？」）
→ POST /api/kiosk/cash → status='paid'・payment_method='cash' で即確定＋在庫減
→ 完了画面 → 自動リセット
```
- 誤操作対策: 確認ダイアログ必須＋スタッフ画面から取消（`voided`化・在庫戻し・理由メモ）

### 3.3 オフライン縮退

- iPad側でfetch失敗/`navigator.onLine=false`を検知 → 全画面「ただいまオンライン決済がご利用いただけません。
  現金で貯金箱にお願いします🙏」表示。オフライン中の現金売上はローカル記録しない（MVP割り切り）。
  復帰後にスタッフ画面で在庫補正＋現金注文の手動起票で辻褄を合わせる

## 4. 画面構成

### /kiosk（公開・iPad向け・ガイドアクセスでロック）
1. **アトラクト画面**: active販売会の商品写真スライドショー＋「タップしてスタート」
2. **カタログ**: 大きな商品カード（写真・名前・価格・残りわずか/売り切れ表示）。タップでカゴへ
   （バリエーションあり商品はサイズ選択シートを挟む）
3. **カゴ**: 数量±・合計・「QRコードで支払う」/「現金で支払いました」
4. **QR画面**: 大きなQR＋「スマホのカメラで読み取ってお支払いください」＋残り時間表示＋やめるボタン
5. **完了画面**: 「お支払い確認できました！商品をお持ちください🙌」
- 無操作90秒でアトラクトへ自動リセット（カゴ破棄）
- フッターに `/kiosk/legal` リンク（小さく）

公開APIの悪用対策: 1注文あたり合計数量上限（10個）・pendingは5分sweepで自然回復するため
在庫枯らし攻撃は5分しか効かない。IPレート制限はMVPでは見送り。

### /kiosk/legal（公開）
`/bf6/legal` を物販向けに書き換え: 現物商品・その場渡し・支払時期=購入時・
返品は「不良品のみ交換対応（現場スタッフまたはメールへ）」等。

### /staff/kiosk（認証: withAuth・proxy配下・StaffPageHeader使用・ブランド3色）
- 販売会の作成/切替（activeは常に1つ）
- 商品CRUD（写真は既存 `/api/upload` 流用・バリエーション管理）
- 売上ダッシュボード: 合計・決済方法別・商品別・注文一覧（時刻/明細/状態）
- 注文取消（現金の誤タップ・返金対応時）: voided化＋在庫戻し
- 在庫補正（±・理由メモ）・警告表示（amount_mismatch / paid_after_expired / 在庫マイナス）
- CSV出力（注文明細）

## 5. 実装メモ

- Stripe連携はBF6の設計をkiosk用に流用: `src/lib/kioskStripe.ts`（署名検証はbf6Stripe.tsの
  `verifyStripeSignature`をそのままimport）・DB層 `src/lib/kioskDb.ts`・TDD（bf6Stripe.test.tsに倣う）
- 依存追加: `qrcode`（クライアントQR生成・軽量）のみ
- env追加: `STRIPE_KIOSK_WEBHOOK_SECRET`（webhook endpoint自体はStripe APIで作成可）
- Webhook以外の新規routeは原則Server Actions優先だが、iPadのポーリング/checkoutは公開API route
  （冒頭に公開理由コメント必須）
- 会場はSSM専門学校9Fホール。**iPadは会場Wi-Fiかテザリング必須**（通し試験の確認項目）

## 6. 成果物リスト

1. 台帳SQL＋migrate.mjs適用
2. `/kiosk` 一式（アトラクト/カタログ/カゴ/QR/完了/オフライン縮退）
3. `/api/kiosk/*`（checkout/status/cancel/cash/stripe-webhook）＋BF6 webhook小改修
4. `/staff/kiosk` 一式
5. `/kiosk/legal`
6. ガイドアクセス設定手順書（`docs/kiosk_ipad_guide.md`・TARO向け）

## 7. マイルストーン（曜日はdate検証済み）

| 期日 | 内容 |
|---|---|
| 9/1(火)〜9/5(土) | スキーマ＋Checkout QR疎通（テストモード） |
| 9/7(月)〜9/11(金) | kiosk UI＋スタッフ画面 |
| 9/14(月)〜9/18(金) | 本番テスト決済（¥100→即返金・TARO承認後）＋iPad実機通し |
| 9/19(土) or 9/20(日) | レッスン会場で1日ミニ運用テスト（TAROと日程確定） |
| 9/26(土) | BF6本番 |

## 8. TARO側タスク

1. 🔴 StripeダッシュボードでPayPay利用申請（審査あり・今週中: 設定→決済手段）
2. 同画面でApple Pay / Google Pay有効化（審査なし・即時）
3. 商品ラインナップ決定（黒×黒Tシャツ¥3,500は確定候補）
4. iPad実機の用意（スタンド購入は任意）
