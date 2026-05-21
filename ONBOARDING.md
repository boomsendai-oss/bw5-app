# BOOM PM セッション オンボーディング (KEIKO / 運営チーム向け)

このドキュメントは、TARO が運用している「プロジェクトマネージャー (PM) セッション」と同等のクオリティで Claude Code を使うための前提・運用条件をまとめたものです。KEIKO の Claude Code でこれを読み込めば、同じ土台で作業できます。

---

## 0. 最初に読むべきもの
- このリポジトリ直下の **`CLAUDE.md`** / **`AGENTS.md`** (開発規約・Next.js注意点)。Claude Code は起動時にこれらを自動で読みます。
- 認証情報・パスワード類は **TARO に確認** (このドキュメントには載せません)。

---

## 1. 事業背景
- **BOOM** = 仙台のダンススクール。代表 TARO、運営マネージャー KEIKO。
- 目標: **日本一のダンススクール**。経営の全数字を可視化し、判断に活かす方針。
- フェーズ感: 「防御フェーズ(運営基盤の整備)」をほぼ着地 → 「攻撃フェーズ(集客・成長)」へ。

## 2. このアプリ (BW5アプリ / BOOMアプリ)
- リポジトリ: `bw5-app` (本番 `bw5-app.vercel.app`)。**リポジトリ名・URLは変更しない**(顧客影響回避)。
- 技術: Next.js 16系(カスタム) / Turso(libSQL) / Vercel / Vercel Blob。テーマカラー **オレンジ**。
- スタッフ画面は `/staff/*` に統一。認証は `src/lib/eventAuth.ts` 流用。DBアクセスは `src/lib/db.ts` 経由。
- **訓練データのNext.js APIを盲信しない** — 新規ページ/API前に `node_modules/next/dist/docs/` を読む(AGENTS.md)。

### 主要なスタッフ機能 (構築済み)
- `/staff` ハブ / `/staff/insights` 経営インサイト(KPI自動集計+トレンド) / `/staff/payroll` 月次給与 / `/staff/studio-billing` スタジオ料 / `/staff/expenses` 経費 / `/staff/cancel-requests` 休講申請承認 / `/staff/masters` マスター(スタジオ/インストラクター/レッスン) / `/staff/schedule/calendar` レッスンカレンダー / `/staff/schedule/sync` カレンダー連携ハブ / `/instructor` インストラクター専用ポータル。

## 3. 外部サービス・連携
- **HACOMONO** (会員予約・課金。CSVインポート/エクスポートで連携。API無し)
- **Lstep + LINE公式** (体験予約・友だち管理。予約枠のGカレ連携で休講同期可)
- **GMO青空ネット銀行** (個人事業主口座。取引CSVを経費に取込)
- **Googleカレンダー** (BW5のICS購読で自動同期)
- **Google Drive** (写真共有・各種資料。rclone remote `boom_drive:` で操作可。5TBアカウント)

## 4. PMセッションの運用スタイル (重要)
このセッションの「同じクオリティ」の核は以下:

### (a) 並列エージェントでガンガン処理
- 独立した作業は **複数の Agent を並列(background)で発射**して同時進行。
- 各エージェントは `isolation: "worktree"` で隔離。タスクは自己完結のbrief(ファイルパス・完了条件・制約)を渡す。
- 完了通知が来たら結果を要約してTAROに報告。バグ修正・UI改善・調査などを並列で回す。

### (b) サイドバー連携 (ブラウザ操作の委譲)
- TARO は普段 Mac の Claude Code と会話し、**ブラウザ操作だけサイドバーの Claude (Chrome拡張) に委譲**。
- そのための「サイドバー指示書」を `/sidebar-orchestrator` スキルで生成(日本語・構造化・安全装置つき)。
- 顧客影響のある操作は「検証で一旦停止 → TARO確認 → 本実行」の段階を必ず入れる。

### (c) TARO は音声入力 (Aqua Voice)
- 誤字・固有名詞の誤変換が頻発(例: 「稽古」=KEIKO、「箱物」=HACOMONO、「ブーン」=BOOM)。
- **文字通りでなく文脈で意図を汲む**。誤字の指摘は不要。判断つかない時のみ確認。

### (d) 自律的に進める
- 「進められるところは承認なしで進めてOK」が基本スタンス(大規模・顧客影響・お金が絡む時のみ確認)。
- TS厳格 / ESLintクリーン / デプロイ確認まで各タスクで完結させる。

## 5. デプロイ運用
- 本番デプロイ: `npx vercel --prod --yes` (※GitHub自動デプロイ連携が未設定のため、現状は手動デプロイ)。
- スキーマ変更は `scripts/migrations/YYYYMMDD_*.sql` を追加 + `src/lib/db.ts` の initDb に `CREATE TABLE IF NOT EXISTS` を追記(冪等)。

## 6. お金関連の禁止事項
- 決済リンクの本番公開・広告予算変更・SaaS有料化は **Claudeが勝手にやらない**。必ずTAROに確認。
- ログに個人情報(電話・メール・氏名)を出さない。

## 7. データ取込の運用フロー
- HACOMONO/GMO銀行/Lstep等のCSVは、サイドバーDL → `~/Downloads/sidebar/`(自動仕分け済) → BW5の各取込ボタン or API。
- 経費は recurring_expenses に「摘要マッチパターン」を登録すると、銀行CSV取込時に自動で経費確定。
- KPIは「アクティブLINE友だち(ブロック除外)」「退会率(プラン会員)」「体験CVR(2週間以内入会)」等を主指標に。

---

## 使い方 (KEIKO)
1. このリポジトリ(or 関連リポジトリ)を Claude Code で開く → CLAUDE.md / AGENTS.md / このONBOARDING.md が前提になる。
2. ブラウザ操作が必要なら `/sidebar-orchestrator` スキルで指示書生成 → サイドバーへ。
3. 大きめの作業は「並列エージェントで進めて」と頼めば、Claude が複数タスクを同時に処理する。
4. 不明点・認証情報は TARO に確認。
