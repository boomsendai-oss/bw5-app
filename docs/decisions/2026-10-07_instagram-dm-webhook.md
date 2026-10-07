# Instagram DM の自動受信・自動返信(2026-10-07)

## 背景
唯愛 HOUSE WS(10/25)で外部(非会員)の申込窓口をインスタDMにも開く。TARO「DMを自動で検知して返信する仕組みを今日実装したい」。
これまでのMetaアプリ(BOOM Story Auto Post・Instagram App ID 1039461798599574)は投稿+インサイトの権限だけで、DMは扱っていなかった。

## 方式
- **Instagram API with Instagram Login の Messaging**(Facebookページ不要・既存アプリに権限を追加)
- 権限: `instagram_business_manage_messages` を `src/lib/instagram.ts` の SCOPES に追加 → `/staff/instagram` の「連携する」で再認可
- Webhook: Meta → `POST /api/instagram/webhook`(`X-Hub-Signature-256` を `INSTAGRAM_APP_SECRET` で検証)／検証は `GET` で `hub.verify_token`=`INSTAGRAM_WEBHOOK_VERIFY_TOKEN`
- 購読: ダッシュボードで messages フィールドを購読 + アプリから `POST /{ig-user-id}/subscribed_apps?subscribed_fields=messages`(スタッフ画面のボタン)
- アクセスレベル: Metaの文書では「自分が所有・管理するプロアカウントだけに使うアプリは標準アクセスで可、他社アカウントに使うなら高度なアクセス(アプリ審査)」。BOOM自身のアカウントなので審査なしで動く見込み。**Webhookを受けるにはアプリをLiveモードにする必要がある**(Development ではテスター以外の通知が来ない)。本物のお客さんからのDMで動くかは、役割のないアカウントからの実DMで確認してから頼る。

## 動き
1. 受信 → `ig_dm_messages` に保存(midで冪等) → `ig_dm_threads` を更新
2. `instagramDmRules.decideAutoReply` で判定: WS案内 / WS申込受付 / 体験案内 / 初回の受領文。1スレッド同種1回・24hで最大3通・本文なしは無視・2通目以降で当たらなければ返さない
3. 自動返信は定型文だけ。申込(ws_apply)・判定不能・送信失敗は `needs_reply` でTAROの返信待ち
4. 毎受信ごとに `notifyTaro`(メール。LINE push設定があればLINE)で本文と自動返信の有無を通知
5. 台帳・手動返信: `/staff/instagram/dm`(24時間ウィンドウ内のみAPIから送信可・送信前に確認ダイアログ)

## 運用
- 実残枠 = 15 − HACOMONO予約数 − DMで受け付けた人数(台帳のメモに人数を書く)
- WSが終わったら `instagramDmRules.WS_INFO.validUntil` が過ぎて ws 判定は自動で止まる。次のイベントは WS_INFO を書き換える
- 返信文は生徒向け告知のトーン(広告臭なし)。テストで記号を禁止している

## 関連
- 設計相談: boom-events-hub `data/唯愛_HOUSE_WS_20261025/外部申込_インスタDM自動応答_設計_20261007.md`
- 台帳SQL: `scripts/migrations/20261007_ig_dm.sql`

## 追記(2026-10-07 11:15・TARO指摘「自動だと知らせる・逃げ道を残す」)
- 全ての自動返信の末尾に「※この返信は自動送信です。内容はスタッフが後ほど確認し、必要があれば改めてお返事します。」を付ける(`AUTO_NOTE`・`renderTemplate`)
- **handoff**(スタッフ引き継ぎ)を新設: ①2通目以降で定型に当たらない ②同じ案内を繰り返し聞かれた ③「違う」「そうじゃなくて」「自動ですか」「担当者」など噛み合っていないサイン → 「ここから先はスタッフが確認して直接お返事します」を1回送り、**以後そのスレッドは自動返信しない**(人が返す)。状態は needs_reply
- お礼・相槌だけ(「ありがとうございます」等)には返さない(沈黙でよい)
- 案内の「お名前・人数」は「参加される方のお名前＋当日連絡のつく電話番号」に変更。キャンセル注意は案内と受付の両方に1行(条件「前日以降」は仮置き・TARO判断待ち)
- 費用: 自動返信にAIは使っていない(キーワード判定)。InstagramメッセージAPIは無料・Vercel/Gmailも無料枠＝1往復¥0
