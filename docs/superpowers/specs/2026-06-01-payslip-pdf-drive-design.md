# 給与明細PDF生成 + Google Drive自動配布 設計書

作成日: 2026-06-01
対象: BOOMアプリ `/staff/payroll`（月次給与計算）

## 目的

月次給与の計算結果から、各インストラクターの「BOOM レッスン実績表」PDFを**アプリ本番URL（Vercel）上で**生成・プレビュー・各自のGoogle Driveフォルダへ配布できるようにする。間違いがあった人だけ直して再アップ・旧PDF削除も画面から完結させる。

## 背景・現状

- 給与計算エンジン・画面（計算実行/調整/確定/振込CSV）は完成済み。
- PDF生成＋Driveアップは「ローカルのMacスクリプト（Chrome headless + rclone）」で動く試作のみ存在。本番アプリには未統合。
- ブランドデザイン確定済（ロゴ・ネイビー/ティール/ベージュ・ネイビー帯の合計ボックス・フッターメッセージ）。テンプレHTMLは `/tmp/payslip/gen_payslip.js` にある。
- 全インストラクター（5月給与対象8名）のDriveフォルダURLは `instructors.payslip_folder_url` / `shared_folder_url` に登録済み。

## 採用方式

**案A-1（完全Vercel統合）**。PDF生成はVercelサーバー上でpuppeteer-core + @sparticuz/chromium。Drive配置はGoogle Drive API（OAuthリフレッシュトークン方式、スコープ `drive.file`）。

## コンポーネント

### 1. PDF生成ライブラリ `src/lib/payslip.ts`
- 既存テンプレHTMLをTS移植（`buildPayslipHtml(data)`）。曜日は `Intl.DateTimeFormat('Asia/Tokyo')` でJST固定算出（暗算禁止ルール遵守、Vercelに`date`コマンドが無い問題も回避）。
- ロゴは `src/assets/boom_logo.png` をビルド同梱し base64 埋め込み（起動時1回キャッシュ）。
- 環境分岐: Vercel本番=@sparticuz/chromium、ローカルMac=システムChrome（`process.env.VERCEL`で判定）。
- `renderPayslipPdf(data): Promise<Buffer>`（1人分）を基本に使う。

### 2. Drive連携 `src/lib/drive.ts`
- `googleapis`。env: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN`。
- `uploadPdfToFolder(folderId, filename, buf): {fileId}` … 常に新規作成、fileIdをDBに保存。
- `updatePdf(fileId, buf)` / `deleteFile(fileId)` … 自前管理IDで更新・削除。
- スコープ `drive.file` で十分（自分がアップしたファイルのみ操作。横断検索は不要な設計）。

### 3. DBマイグレーション
`scripts/migrations/20260601_payslip_drive.sql`:
- `payroll_runs` に `drive_file_id TEXT`（アップ済みPDFのDrive上ID）、`payslip_uploaded_at TEXT` を追加。
- 既存の `pdf_url` 列はDriveのwebViewLink保存に流用（任意）。

### 4. API ルート（すべて `runtime='nodejs'` `dynamic='force-dynamic'`）
- `GET /api/staff/payroll/[id]/pdf` … PDFをinline/attachmentで返す（プレビュー・DL）。`maxDuration=60`。
- `POST /api/staff/payroll/[id]/payslip/upload` … 1人分を生成→Driveへ。既存`drive_file_id`があれば update、なければ create。結果のfileId/webViewLinkをDBへ保存。
- `DELETE /api/staff/payroll/[id]/payslip` … `drive_file_id`のファイルをDrive削除し、DBの該当列をクリア。
- 一括は専用APIを作らず、**UIが対象者ぶん個別uploadAPIを順次（直列）呼ぶ**。Hobby(10秒)でも各リクエストがコールドスタート込み5秒程度で収まり安全。進捗も1人ずつ反映できる。

### 5. UI（`/staff/payroll` ページに追加）
- 各行に「👁 プレビュー」「⬆ アップロード（アップ済みなら『再アップ』）」「🗑 削除」。
- 上部に「⬆ 全員アップロード」。押すと対象者を直列にuploadAPIへ。各人の成否をトースト/行バッジで表示。
- アップ済み行は緑バッジ＋Driveリンク（webViewLink）表示。
- プレビューは新規タブでPDFを開く（GET /pdf）。

## データフロー（個別アップ）
1. UI「アップロード」→ `POST /api/staff/payroll/{id}/payslip/upload`
2. API: run/lines/adjustments をDB取得 → `renderPayslipPdf` でPDF Buffer
3. instructorのフォルダID解決（payslip_folder_url優先、なければshared_folder_url）
4. `drive_file_id` あり→`updatePdf`、なし→`uploadPdfToFolder`
5. fileId / webViewLink / uploaded_at をpayroll_runsに保存 → UIへ返却

## エラー処理
- フォルダID未解決の講師はその人だけ失敗扱い、他は継続。理由を返す。
- Drive env未設定なら明示エラー（500 + メッセージ）。
- 一括は1人失敗しても止めず、最後に「成功N / 失敗M（誰）」を表示。

## 前提（TARO側の一度きりセットアップ）
- Google Cloud: プロジェクト作成→Drive API有効化→OAuth同意画面（**本番公開必須**。テスト状態だとrefresh_token 7日失効）→デスクトップ型OAuthクライアント作成。
- ローカルスクリプト `get-token.js` で refresh_token 取得。
- Vercel環境変数に CLIENT_ID/SECRET/REFRESH_TOKEN 登録→再デプロイ。

## 段階デプロイ計画
1. 依存追加（puppeteer-core/@sparticuz/chromium/googleapis）+ next.config（serverExternalPackages）+ ロゴ配置 + payslip.ts。デプロイし `GET /pdf` でSAYUKIのPDFがVercelで生成できるか検証（Drive不要）。
2. Driveセットアップ（TARO）+ drive.ts + マイグレーション + upload/delete API。
3. UIボタン群追加。
4. 5月分で全員アップロードの実地テスト。

## テスト/検証
- 各段階でVercelデプロイ後に実機確認（PDF生成→プレビュー→個別アップ→Drive目視→再アップで上書き→削除）。
- 固定給(KEIKO)と時給(SAYUKI)の両パターンでPDF崩れなし確認。

## 非対象（YAGNI）
- 講師本人画面からのDL（既存 `/instructor/payroll` があるので今回は触らない）。
- 給与の自動メール通知。
- 一括ZIP DL。
