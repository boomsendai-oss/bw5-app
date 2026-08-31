@AGENTS.md

# BOOMアプリ 開発ガイドライン (Claude Code向け)

## 位置づけ

このリポジトリは **BOOMアプリ** (旧 BW5アプリ)。
BOOMダンススクールの常設運営機能 + 各イベント機能を統合したNext.jsアプリ。

- リポジトリ名 `bw5-app`・本番URL `bw5-app.vercel.app` は当面変更しない (お客さん影響回避)
- 内部ドキュメント・コミットメッセージ・新規コードコメントでは「BOOMアプリ」と呼ぶ

## カスタムNext.js の注意

`AGENTS.md` 参照。**訓練データの Next.js API を盲信しない**。
新しいページ・API ルートを書く前に `node_modules/next/dist/docs/` を読むこと。

## 新機能追加時の規約

### 1. スタッフ画面は `/staff/*` に統一
- ❌ `/admin/*`, `/manage/*` 等を新設しない
- ✅ 新画面は `src/app/staff/<name>/page.tsx`

### 2. 認証は `src/lib/eventAuth.ts` を流用
- パスワード認証は既存実装を使う
- 独自セッション管理を作らない
- 認証パスワード: `boom2026` (env: `EVENT_PASSWORD`)

### 3. DB アクセスは `src/lib/db.ts` 経由
- Turso (libSQL) クライアントは1ファイルに集約
- 直接 `createClient` を呼ばない

### 4. テーマカラー = BOOMブランド3色（スタッフ画面）/ オレンジ（BW5イベントページ）
- **スタッフ画面(`/staff/*`)**: ブランドパレットを使う — `brand-*`(ティール#00A090系・操作色/アクセント)・`navy-*`(#101040系・ヘッダー/見出し)・`sand-*`(ベージュ#E0D0C0系・淡い背景)。定義は `globals.css` の `@theme`。shadcnトークンは `.staff-theme` で上書き済み
- **`orange-*` をスタッフ画面で新規使用しない**（2026-07-10リブランド済）
- BW5イベントページ(写真/動画DL・一般向け)はオレンジのまま（イベント色として維持）

### 4.5 新規 API route は認可必須（M27・Phase 3で追加）

**新しく `route.ts` を作るときは、次のどちらかを必ず満たすこと。**

1. `withAuth` で包む（`src/lib/eventAuth.ts`）
   ```ts
   export const GET = withAuth(async (req) => { ... });
   ```
2. 認証をかけない場合は、**「なぜ公開なのか」をファイル冒頭にコメントで書く**
   ```ts
   // ⚠️ 公開API(認証なし)。理由: BW5来場者向け公開ページ xxx が叩くため。
   ```

理由: 各routeの冒頭に `isAuthorized` を書く方式は**書き忘れが検出できず**、実際に
無認証で個人情報・決済情報が露出していた（監査2026-07-06のC系）。

- **matcher反転（原則すべて認証）は採らない**。`/api/vote`・`/api/photo`・
  `/api/video-preorder` 等の公開APIが実在し、反転すると即座に顧客側の障害になる
- スタッフ専用だが `/staff` 配下でない経路は `src/proxy.ts` の matcher に追加する
  （`/admin`・`/api/admin` はM24で追加済み）
- 認証が要る画面のUIガードを **クライアント側だけ**で書かない（`sessionStorage` フラグ等）。
  DevToolsで1行実行すれば突破できるため、サーバ側（proxy or route）で必ず弾く

### 5. スキーマ変更はマイグレーション
- `scripts/migrations/YYYYMMDD_<name>.sql` を追加
- 既存テーブルの破壊的変更は事前にTAROに確認

### 6. 新規ページは Server Actions 優先
- 新しく作るページでは API route (`/api/...`) より Server Actions を優先する
- 既存ページの API route は動いているのでわざわざ書き換えない
- 参考: `node_modules/next/dist/docs/` の Server Actions ガイド

### 7. KPI画面は `/staff/insights` に一本化
- `/staff/dashboard` は `/staff/insights` へリダイレクト（旧URL互換）
- KPIの表示は自動集計データをメインとし、手動入力は補助
- 手動入力フォーム: `/staff/insights/input`

### 8. 個人情報の取扱
- HACOMONO/Lstep の生CSV は `data/raw/` に置く (gitignore済)
- ログに電話番号・メアド・氏名を出力しない
- 詳細: `BOOM_Master_template/05_運営/SOP/セキュリティ対策ガイド.md`

### 9. スタッフ画面のヘッダーは `StaffPageHeader` を使う
- 新しい `/staff/*` ページのタイトルバーは必ず共有 `@/components/StaffPageHeader` を使う（自前で `<h1>`/`<header>` を組まない）
- props: `title` / `description?` / `backHref?`(親ページへ「← 戻る」) / `backLabel?` / `rightExtra?`(右側の操作ボタン)
- ホームへの導線はレイアウト側(サイドバー/モバイルバー)に集約済み。ヘッダーにホームリンクを置かない
- ドリルダウンの子ページは `backHref` で親ページを指定する
- 全幅の兄弟として置き、`max-w-*`/`p-*` コンテナの中に入れない。色はブランド(navyタイトル/sand境界/teal操作)

### 10. 会員のInstagramハンドルは `boom_members` の3枠が正本

**参照先はここだけ。** 他のテーブルから引かないこと。

```sql
COALESCE(NULLIF(trim(m.instagram_handle), ''),          -- 本人
         NULLIF(trim(m.instagram_handle_mother), ''),   -- 母
         NULLIF(trim(m.instagram_handle_father), ''))   -- 父
```

優先度は **本人 > 母 > 父**（純関数は `pickMentionHandle()` / `src/lib/instagramCollect.ts`）。

- ❌ **`instagram_handle` だけを見ない**。母・父しか登録が無い会員が丸ごと漏れる
- ❌ **`instagram_entries` を参照先にしない**。あれは収集フォームの**受信箱(生ログ)**。
  フォームを通していない会員（発表会名簿からの移行分）は行が無いので構造的に漏れる
- ❌ **`performers.instagram_handle` / `handle_mother` / `handle_father` を見ない**。
  会員分は 2026-08-17 に `boom_members` へ移した。残っているのは**非会員の出演者**のみ
  （外部ゲストは会員でないため `boom_members` に置き場が無い）

**レッスンの受講者からメンション先を引く経路**:
`hacomono_reservations`（lesson_date + status='チェックイン'）→ `boom_member_id` → 上記3枠。

**迷ったら実データで決着させる**（意見をすり合わせない）:

```
node scripts/verify_ig_handle_sources.mjs [YYYY-MM-DD]
```

読み方のA/B比較を出力する。2026-08-18にこの食い違いで実害
（3/21 多賀城HOUSEのCAST候補が5人→3人に欠けた）が出たため用意した。

### 11. 入力欄は文字色+背景色を必ず明示する【事故】

**このアプリは body の文字色が白**(BW5オレンジテーマ)で、Tailwind preflight により
input/textarea が body の色を**継承**する。ページ側で背景だけ白にすると
**白文字×白背景=打った文字が見えない**事故になる。

- ✅ 入力欄には必ず `text-slate-900 bg-white`(等)を**セットで**明示。placeholderも `placeholder:text-slate-400`
- ✅ フォームを実装したら**実際に文字を入力して見えるか確認**してから納品
  (Playwrightで `getComputedStyle(input).color` 実測が確実。ライト/ダーク両モード)
- 実例: 七ヶ浜アンケート(2026-08-31)で回答者全員が名前を見えないまま入力していた。
  お客さんからの報告で発覚(2026-08-31 TARO「二度と同じミスをしないで」)。同型の事故が過去にも複数回

## ディレクトリ構成 (要点)

```
src/
  app/
    page.tsx          # トップ
    photo/            # BW5写真DL
    video/            # BW5動画DL
    event/bw5/        # BW5専用
    staff/            # 運営向け (要認証)
      members/
      operations/
      schedule/
      insights/        # KPI・分析 (旧 dashboard を統合)
      events/
  lib/
    eventAuth.ts      # 認証
    db.ts             # Turso クライアント
scripts/
  daily_sync.py       # HACOMONO/Lstep CSV 自動DL
  migrations/         # スキーマ変更
```

## デプロイ

- Vercel 自動デプロイ (main ブランチ push)
- 環境変数: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `EVENT_PASSWORD`

## お金関連の禁止事項

- 決済リンクの本番公開・広告予算変更・SaaS有料化は**Claudeが勝手にやらない**
- 必ずTAROに確認してから
- 詳細: `BOOM_Master_template/INDEX.md` §大原則
