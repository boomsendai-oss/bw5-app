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
