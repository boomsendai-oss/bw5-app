# クリスマスパーティー2026 申込・出演エントリー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/xmas` にパーティー申込(前売カード/当日現金)と出演チームエントリー(先着・音源アップロード)を作り、`/staff/xmas` で一覧・設定・名簿印刷・精算を行えるようにする。

**Architecture:** 純関数(`src/lib/party.ts`)に金額・締切・検証・名簿/精算計算を集め vitest で固める。DB層(`src/lib/partyDb.ts`)は `src/lib/db.ts` 経由で `party_*` テーブルを読み書きし、先着判定はトランザクション内。決済は BF6 の REST Stripe ヘルパを流用し、既存 Webhook に `metadata[party_order_id]` で相乗りする。

**Tech Stack:** Next.js 16.2 (App Router・Server Actions)・Turso/libSQL・Stripe Checkout(REST)・Vercel Blob client upload・vitest・Tailwind v4

設計書: `docs/superpowers/specs/2026-10-14-xmas-party-design.md`

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `scripts/migrations/20261014_party_tables.sql` | 4テーブル(本番適用用) |
| `src/lib/db/schema.ts` | 同じ4テーブル(ローカルfile DB用) |
| `src/lib/party.ts` | 純関数: 型・既定設定・設定の解釈・金額・受付判定(JST)・入力検証・名簿の並び・精算計算・受付番号 |
| `src/lib/partyDb.ts` | DB: 設定の読み書き・sweep・使用数・申込作成(Tx)・token読込・一覧・状態変更・Stripeセッション保存・Webhook適用・音源保存 |
| `src/lib/partyStripe.ts` | 明細・Checkoutパラメータ(metadata[party_order_id])・Webhookイベント判別 |
| `src/lib/partyEmail.ts` | 控えメール(純関数で文面＋送信) |
| `src/app/api/bf6/stripe-webhook/route.ts` | party 分岐を追加(BF6より前) |
| `src/app/xmas/*` | 公開ページ(layout・トップ・ticket・entry・my・actions・ui) |
| `src/app/api/xmas/audio-upload/route.ts` | Blob クライアントアップロードのトークン発行(公開・edit_token検証) |
| `src/app/staff/xmas/*` | スタッフ画面(一覧・設定・名簿・精算・actions) |
| `scripts/party_reset_testdata.mjs` | テストデータ削除(既定は件数表示のみ) |
| `src/lib/__tests__/party*.test.ts` | vitest |

## Task 1: 純関数 `party.ts`(TDD)
- [ ] テストを書く `src/lib/__tests__/party.test.ts`:
  - `resolvePartySettings({})` が既定値(open_at空=未公開, presale 2000, door 2500, performerFee 2000, teamCap 8, 各締切)を返す・不正値は既定に戻る
  - `ticketTotal(3, s)=6000`・`entryTotal(4, s)=16000`(4×(2000+2000))
  - `isOpenAt(now, openAt)`/`isBeforeDeadline(now, deadline)` を JST 文字列 `2026-12-16T20:00` 境界で(19:59:59 JST=受付中、20:00:00 JST=締切)
  - `ticketCardState` / `ticketCashState` / `entryState` が 'before' | 'open' | 'closed' | 'full' | 'suspended' を個別に返す(カード締切だけ過ぎても現金は open)
  - `validateTicketInput`: 名前/ふりがな(ひらがな以外NG)/メール/電話(数字10-11桁)/人数1-20/未就学児0-10/会員選択/支払方法
  - `validateEntryInput`: チーム名・ジャンル・メンバー2-20人・各名前空NG
  - `sortRosterByKana` が50音順
  - `calcSettlement({expectedCash, walkinCount, actualCash, doorPrice, venueFee})` → 当日券見込み・期待総額・差額・会場費相殺後(BOOM受取+/支払-)
  - `formatPartyReceiptNo(7)='X26-007'`
- [ ] 実装 → `npx vitest run src/lib/__tests__/party.test.ts` 緑 → commit

## Task 2: スキーマ
- [ ] `scripts/migrations/20261014_party_tables.sql` と `schema.ts` に `party_orders`/`party_entry_members`/`party_payments`/`party_settings`＋index(event_key,status / stripe_session_id / edit_token UNIQUE)
- [ ] ローカル file DB で `npx tsx -e` による initDb 確認 → commit

## Task 3: `partyStripe.ts` と Webhook 分岐(TDD)
- [ ] テスト: `buildPartyLineItems`(ticket=参加費×人数、entry=出演料×人数と参加費×人数の2行)、`buildPartyCheckoutParams` が `metadata[party_order_id]`・`client_reference_id=party-<id>` を積み `metadata[order_id]` を積まない、`parsePartyWebhookEvent` が party_order_id の無いイベントで null
- [ ] `partyDb.applyPartyWebhookEvent`(冪等・pending/expired→paid・金額不一致フラグ)
- [ ] route に BF6 判定より前の party 分岐を追加。paid 時 `sendPartyOrderEmail` → commit

## Task 4: `partyDb.ts`
- [ ] 設定 get/set(event_key単位)・`sweepExpiredPartyOrders`・`countHoldingTeams`・`createPartyOrder`(Tx内で entry の上限再判定)・`loadPartyOrderByToken`・`listPartyOrdersStaff`・`setPartyOrderStatusStaff`(canceled/refunded/戻す)・`savePartyStripeSession`・`savePartyAudio`・`setPartyStaffNote`
- [ ] tsc 通過 → commit

## Task 5: メール `partyEmail.ts`(TDD)
- [ ] テスト: 当日現金=「当日キャッシャーで ¥X」/カード=「お支払い済み」、エントリーは音源締切と控えURL、1ドリンク¥600・原則返金不可・公式LINE を含む、金額は注文の amount_total 由来
- [ ] 実装 → commit

## Task 6: 公開ページ `/xmas`
- [ ] `layout.tsx`(metadata・古紙色の下地)・`ui.tsx`(レトロコミックの部品)・`page.tsx`(告知画像 `public/xmas/flyer.png`・開催情報・受付状態)
- [ ] `actions.ts`('use server'・公開理由コメント・IPレート制限): `getXmasContext` / `submitXmasTicket` / `submitXmasEntry` / `startXmasCheckout` / `saveXmasAudio`
- [ ] `ticket/` `entry/` フォーム(クライアント・入力欄に `text-[#1a1410] bg-white placeholder:text-neutral-400`)・合計は `ticketTotal`/`entryTotal` を設定値から表示
- [ ] `my/page.tsx`(token 1件のみ)＋決済ボタン＋音源アップロード(`@vercel/blob/client` upload)
- [ ] `api/xmas/audio-upload/route.ts`(handleUpload・onBeforeGenerateToken で token/締切/状態/拡張子/50MB 検証)
- [ ] commit

## Task 7: スタッフ画面 `/staff/xmas`
- [ ] `actions.ts`(requireStaff): 設定保存・状態変更・メモ・精算保存(入力者名必須→event_ledger に income/cost を upsert)
- [ ] `page.tsx` 一覧/件数・`settings/`・`roster/`(印刷CSS)・`settlement/`
- [ ] commit

## Task 8: リセットスクリプト・検証
- [ ] `scripts/party_reset_testdata.mjs`
- [ ] `npx vitest run`・`npx tsc --noEmit`・`npm run build`
- [ ] プレビューで /xmas と /staff/xmas を実操作(当日現金申込→控え→一覧→名簿)・入力欄の文字色を実測
- [ ] commit → main へ push(本番デプロイ)→ 本番DBへ `node scripts/migrate.mjs` → 設定(公開日時は空=未公開のまま)
