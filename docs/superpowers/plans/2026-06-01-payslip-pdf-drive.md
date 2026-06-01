# 給与明細PDF生成 + Drive配布 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 給与画面から各講師の実績表PDFを生成・プレビュー・各自Driveフォルダへ配布（個別/一括/再アップ/削除）できるようにする。

**Architecture:** Vercel(Node runtime)でpuppeteer-core+@sparticuz/chromiumでPDF生成、googleapis(リフレッシュトークン/`drive.file`)でDrive配置。fileIdをpayroll_runsに保存し再アップ・削除に使う。一括はUIが個別APIを直列に呼ぶ。

**Tech Stack:** Next.js 16.2.3 (App Router, custom), TypeScript, Turso(libSQL), puppeteer-core@^24, @sparticuz/chromium@^133, googleapis, Vercel.

**注意:** このNextはカスタム版。テストフレームワーク未導入のため、各タスクの検証は「デプロイ後の実機確認(curl/ブラウザ)」で行う。日付＋曜日は暗算せずDate/Intl由来で出す(メモリルール)。

---

## ファイル構成

- 作成 `src/lib/payslip.ts` — PDF生成(HTMLテンプレ移植+puppeteer起動)
- 作成 `src/lib/drive.ts` — Google Drive upload/update/delete
- 作成 `src/assets/boom_logo.png` — ロゴ(ビルド同梱)
- 作成 `scripts/migrations/20260601_payslip_drive.sql` — payroll_runs列追加
- 作成 `src/app/api/staff/payroll/[id]/pdf/route.ts` — PDFプレビュー/DL
- 作成 `src/app/api/staff/payroll/[id]/payslip/upload/route.ts` — 個別アップ
- 作成 `src/app/api/staff/payroll/[id]/payslip/route.ts` — DELETE(削除)
- 修正 `next.config.ts` — serverExternalPackages追記
- 修正 `src/app/staff/payroll/page.tsx` — UIボタン群
- 修正 `src/app/api/staff/payroll/route.ts` — 一覧に drive_file_id 等を含める

---

### Task 1: 依存追加 + next.config + ロゴ配置

**Files:**
- Modify: `package.json`（npm install）
- Modify: `next.config.ts`
- Create: `src/assets/boom_logo.png`

- [ ] **Step 1: 依存インストール**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app
npm install puppeteer-core@^24 @sparticuz/chromium@^133 googleapis
```
Expected: 3パッケージが dependencies に追加される。

- [ ] **Step 2: ロゴをリポジトリへ配置**

Run:
```bash
mkdir -p src/assets && cp "/Users/kimurashintarou/BOOM/ロゴ・ブランド素材/boom_logo.png" src/assets/boom_logo.png && ls -la src/assets/boom_logo.png
```
Expected: `src/assets/boom_logo.png` が存在（約数MB）。

- [ ] **Step 3: next.config.ts に serverExternalPackages を追記**

`next.config.ts` の `const nextConfig: NextConfig = {` 直後に1行追加:
```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // Allow LAN dev access ...(既存はそのまま)
```

- [ ] **Step 4: ビルド確認**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: エラーなし（出力空）。

- [ ] **Step 5: コミット**

```bash
git add package.json package-lock.json next.config.ts src/assets/boom_logo.png
git commit -m "chore(payslip): PDF/Drive依存追加 + ロゴ配置 + serverExternalPackages"
```

---

### Task 2: PDF生成ライブラリ `src/lib/payslip.ts`

**Files:**
- Create: `src/lib/payslip.ts`

- [ ] **Step 1: payslip.ts を作成（エージェント雛形をそのまま採用）**

`src/lib/payslip.ts` に以下を記述（型・weekdayJa(JST固定)・buildPayslipHtml・launchBrowser(環境分岐)・renderPayslipPdf・payslipFilename）:

```typescript
// src/lib/payslip.ts
// 給与明細(レッスン実績表)PDFをサーバーサイド生成する。
import fs from "node:fs";
import path from "node:path";
import type { Browser } from "puppeteer-core";

export interface PayslipRun {
  id: number;
  name: string;
  year_month: string;
  payment_date: string | null;
  total_lesson_amount: number;
  total_transit_amount: number;
  total_adjustment_amount: number;
  total_amount: number;
}
export interface PayslipLine {
  lesson_date: string;
  class_name: string | null;
  lesson_rate: number | null;
  transit_fee: number | null;
}
export interface PayslipAdjustment {
  adjustment_type: string;
  amount: number;
  description: string;
}
export interface PayslipData {
  run: PayslipRun;
  lines: PayslipLine[];
  adjustments: PayslipAdjustment[];
}

const WD = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function weekdayJa(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return "";
  const wdName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(d);
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return WD[map[wdName] ?? 0];
}

const yen = (n: number | null | undefined): string =>
  "¥" + Number(n || 0).toLocaleString("ja-JP");

const esc = (s: unknown): string =>
  (s ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

let logoSrcCache: string | null = null;
function getLogoSrc(): string {
  if (logoSrcCache !== null) return logoSrcCache;
  const logoPath = path.join(process.cwd(), "src", "assets", "boom_logo.png");
  try {
    const b64 = fs.readFileSync(logoPath).toString("base64");
    logoSrcCache = `data:image/png;base64,${b64}`;
  } catch {
    logoSrcCache = "";
  }
  return logoSrcCache;
}

export function buildPayslipHtml(data: PayslipData): string {
  const { run, lines, adjustments } = data;
  const [yy, mmRaw] = run.year_month.split("-");
  const mm = mmRaw ?? "";
  const isFixed = run.total_lesson_amount > 0 && lines.length === 0;
  const logoSrc = getLogoSrc();

  let rowsHtml = "";
  for (const l of lines) {
    const md = l.lesson_date.slice(5).replace("-", "/");
    const wd = weekdayJa(l.lesson_date);
    const sum = (l.lesson_rate || 0) + (l.transit_fee || 0);
    rowsHtml +=
      `<tr><td>${md}</td><td>${wd}</td><td>${esc(l.class_name)}</td>` +
      `<td class="num">${yen(l.lesson_rate)}</td>` +
      `<td class="num">${l.transit_fee ? yen(l.transit_fee) : "—"}</td>` +
      `<td class="num">—</td>` +
      `<td class="num">${yen(sum)}</td></tr>\n`;
  }
  for (const a of adjustments) {
    rowsHtml +=
      `<tr><td>—</td><td>—</td><td>${esc(a.description)}</td>` +
      `<td class="num">—</td><td class="num">—</td>` +
      `<td class="num">${yen(a.amount)}</td>` +
      `<td class="num">${yen(a.amount)}</td></tr>\n`;
  }
  if (isFixed) {
    rowsHtml =
      `<tr><td>—</td><td>—</td><td>月額固定給</td>` +
      `<td class="num">${yen(run.total_lesson_amount)}</td>` +
      `<td class="num">—</td><td class="num">—</td>` +
      `<td class="num">${yen(run.total_lesson_amount)}</td></tr>\n`;
  }

  const NAVY = "#141b4f", TEAL = "#0ba29a", BEIGE = "#e4d2c2", BEIGE_L = "#f3ece4";
  const logoTag = logoSrc ? `<img src="${logoSrc}" alt="BOOM">` : "";

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><style>
  @page{size:A4;margin:16mm}*{box-sizing:border-box}
  body{font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif;color:#1f2433;font-size:12px}
  .top{display:flex;align-items:center;gap:14px;border-bottom:3px solid ${NAVY};padding-bottom:10px;margin-bottom:16px}
  .top img{height:60px;width:auto;border-radius:6px}
  .titlebox h1{font-size:19px;margin:0 0 2px;color:${NAVY};letter-spacing:1px}
  .titlebox .sub{color:#7a766f;font-size:11px;margin:0}
  .hdr{border:1px solid ${BEIGE};border-radius:8px;padding:12px 16px;margin-bottom:16px;background:${BEIGE_L}}
  .hdr table{width:100%;border:none}.hdr td{border:none;padding:4px 0;font-size:13px}
  .hdr .label{color:#7a766f;width:140px}
  .paybox{display:flex;align-items:center;justify-content:space-between;margin:14px 0 16px;padding:13px 20px;background:${TEAL};border-radius:8px}
  .paybox .plabel{color:#eafaf8;font-size:14px;font-weight:600}
  .paybox .total{font-size:30px;font-weight:800;color:#fff;letter-spacing:0.5px;line-height:1}
  table.detail{width:100%;border-collapse:collapse;margin-top:6px}
  table.detail th,table.detail td{border:1px solid #d8d2ca;padding:7px 9px;font-size:11.5px}
  table.detail th{background:${NAVY};color:#fff;font-weight:600}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  table.detail tbody tr:nth-child(even){background:${BEIGE_L}}
  table.detail tfoot td{font-weight:bold;background:${BEIGE};color:${NAVY}}
  .msg{margin-top:22px;padding:12px 16px;background:${BEIGE_L};border-left:4px solid ${TEAL};border-radius:4px;font-size:12px;color:${NAVY};line-height:1.7}
  .issuer{text-align:right;margin-top:20px;font-size:12px;color:#333}
  </style></head><body>
  <div class="top">
    ${logoTag}
    <div class="titlebox">
      <h1>BOOM レッスン実績表</h1>
      <p class="sub">BOOM｜契約インストラクター用</p>
    </div>
  </div>
  <div class="hdr"><table>
    <tr><td class="label">インストラクター名</td><td><strong>${esc(run.name)} 様</strong></td></tr>
    <tr><td class="label">対象月</td><td>${yy}年 ${Number(mm)}月</td></tr>
    <tr><td class="label">振込予定日</td><td>${run.payment_date || "—"}</td></tr>
  </table></div>
  <div class="paybox"><span class="plabel">お支払合計金額</span><span class="total">${yen(run.total_amount)}</span></div>
  <table class="detail">
    <thead><tr><th>日付</th><th>曜日</th><th>クラス名</th><th>レッスン稼働費</th><th>交通費</th><th>調整金額</th><th>合計金額</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot><tr><td colspan="3">合計</td><td class="num">${yen(run.total_lesson_amount)}</td><td class="num">${yen(run.total_transit_amount)}</td><td class="num">${yen(run.total_adjustment_amount)}</td><td class="num">${yen(run.total_amount)}</td></tr></tfoot>
  </table>
  <div class="msg">先月もありがとうございました。今月も引き続きどうぞよろしくお願いいたします。</div>
  <p class="issuer">発行元：BOOM 代表　木村慎大郎</p>
  </body></html>`;
}

export function payslipFilename(run: PayslipRun): string {
  const [yy, mm] = run.year_month.split("-");
  return `BOOM_${yy}_${Number(mm)}月_各講師明細_${run.name}`;
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    const chromiumMod = await import("@sparticuz/chromium");
    const chromium = chromiumMod.default ?? chromiumMod;
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    }) as unknown as Promise<Browser>;
  }
  const localChrome =
    process.env.LOCAL_CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return puppeteer.launch({
    executablePath: localChrome,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  }) as unknown as Promise<Browser>;
}

async function htmlToPdfBuffer(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function renderPayslipPdf(data: PayslipData): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    return await htmlToPdfBuffer(browser, buildPayslipHtml(data));
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit 2>&1 | grep -i payslip; echo "done"`
Expected: payslip関連のエラーなし。

- [ ] **Step 3: ローカルでPDF生成スモークテスト（SAYUKI相当のダミーデータ）**

Run:
```bash
node --input-type=module -e "
import('./src/lib/payslip.ts').catch(async()=>{
  // tsはnodeで直接実行できないため、tsx代替がなければこのステップはスキップしデプロイ検証で代替
  console.log('SKIP: ローカルts実行不可。Task6のデプロイ検証で確認する');
});
" 2>&1 | head -3 || echo "SKIP: デプロイ検証で確認"
```
Expected: tsを直接実行できなければスキップ可（Vercelデプロイ後のTask6で実機検証する）。

- [ ] **Step 4: コミット**

```bash
git add src/lib/payslip.ts
git commit -m "feat(payslip): PDF生成ライブラリ(HTMLテンプレ+puppeteer)"
```

---

### Task 3: PDFプレビューAPI `GET /api/staff/payroll/[id]/pdf`

**Files:**
- Create: `src/app/api/staff/payroll/[id]/pdf/route.ts`

- [ ] **Step 1: route.ts 作成**

```typescript
// src/app/api/staff/payroll/[id]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getOne, getAll } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/eventAuth";
import { renderPayslipPdf, payslipFilename, type PayslipData } from "@/lib/payslip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const run = await getOne(
    `SELECT pr.*, i.name AS instructor_name
       FROM payroll_runs pr LEFT JOIN instructors i ON i.id = pr.instructor_id
      WHERE pr.id = ?`,
    [runId]
  );
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const lines = await getAll(
    `SELECT lesson_date, class_name, lesson_rate, transit_fee
       FROM payroll_lines WHERE payroll_run_id = ? ORDER BY lesson_date`,
    [runId]
  );
  const adjustments = await getAll(
    `SELECT adjustment_type, amount, description
       FROM payroll_adjustments WHERE payroll_run_id = ? ORDER BY created_at`,
    [runId]
  );

  const data: PayslipData = {
    run: { ...(run as Record<string, unknown>), name: (run as { instructor_name: string }).instructor_name } as PayslipData["run"],
    lines: lines as PayslipData["lines"],
    adjustments: adjustments as PayslipData["adjustments"],
  };

  const pdf = await renderPayslipPdf(data);
  const filename = payslipFilename(data.run);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}.pdf`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit 2>&1 | grep -iE "pdf/route|payslip"; echo done`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add "src/app/api/staff/payroll/[id]/pdf/route.ts"
git commit -m "feat(payslip): PDFプレビュー/DL API"
```

---

### Task 4: デプロイして PDF生成を本番検証（Drive不要の中間チェックポイント）

**Files:** なし（デプロイ・検証）

- [ ] **Step 1: 本番デプロイ**

Run: `npx vercel --prod --yes 2>&1 | tail -5`
Expected: エラーなくデプロイ完了。

- [ ] **Step 2: SAYUKIのrun idを取得**

Run:
```bash
set -a && source .env.production.local && set +a && node -e "
const { createClient } = require('@libsql/client');
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
(async()=>{const r=await c.execute(\"SELECT pr.id FROM payroll_runs pr LEFT JOIN instructors i ON i.id=pr.instructor_id WHERE pr.year_month='2026-05' AND i.name='SAYUKI'\");console.log('SAYUKI run id=',r.rows[0].id);})();
"
```
Expected: `SAYUKI run id= 12` のように出る。

- [ ] **Step 3: 本番でPDF生成確認（認証Cookie必要なため、ブラウザでTAROが確認）**

TAROに依頼: ブラウザでBOOMアプリにログイン後、`https://bw5-app.vercel.app/api/staff/payroll/<上のid>/pdf` を開く。
Expected: SAYUKIの実績表PDFがブラウザに表示される（ロゴ・ティール帯・明細）。**Vercelでpuppeteerが動くことの確証**。表示されなければ Vercel Function Logs を確認（chromium起動エラー等）。

- [ ] **Step 4: 確認OKを待つ（チェックポイント）**

TAROのOK後に次へ進む。NGならログを見て修正（多くは @sparticuz/chromium バージョン不整合 or serverExternalPackages 漏れ）。

---

### Task 5: DBマイグレーション（drive_file_id列追加）

**Files:**
- Create: `scripts/migrations/20260601_payslip_drive.sql`

- [ ] **Step 1: マイグレーションSQL作成**

```sql
-- scripts/migrations/20260601_payslip_drive.sql
ALTER TABLE payroll_runs ADD COLUMN drive_file_id TEXT;
ALTER TABLE payroll_runs ADD COLUMN payslip_uploaded_at TEXT;
```

- [ ] **Step 2: 本番DBへ適用**

Run:
```bash
set -a && source .env.production.local && set +a && node -e "
const { createClient } = require('@libsql/client');
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
(async()=>{
  for (const sql of ['ALTER TABLE payroll_runs ADD COLUMN drive_file_id TEXT','ALTER TABLE payroll_runs ADD COLUMN payslip_uploaded_at TEXT']) {
    try { await c.execute(sql); console.log('OK:',sql); } catch(e){ console.log('SKIP(既存?):',e.message); }
  }
  const r=await c.execute('PRAGMA table_info(payroll_runs)'); console.log(r.rows.map(x=>x.name).join(', '));
})();
"
```
Expected: 列一覧に `drive_file_id, payslip_uploaded_at` が含まれる。

- [ ] **Step 3: コミット**

```bash
git add scripts/migrations/20260601_payslip_drive.sql
git commit -m "feat(payslip): payroll_runsにdrive_file_id/payslip_uploaded_at追加"
```

---

### Task 6: Drive連携ライブラリ `src/lib/drive.ts`

**Files:**
- Create: `src/lib/drive.ts`

- [ ] **Step 1: drive.ts 作成（エージェント雛形採用）**

```typescript
// src/lib/drive.ts — Node.js runtime 専用
import { google, drive_v3 } from "googleapis";
import { Readable } from "node:stream";

function getDriveClient(): drive_v3.Drive {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Drive の環境変数が未設定です (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN)");
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

function bufferToStream(buf: Buffer): Readable {
  return Readable.from(buf);
}

export async function uploadPdfToFolder(folderId: string, filename: string, pdfBuffer: Buffer): Promise<{ fileId: string; webViewLink: string | null }> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: "application/pdf", body: bufferToStream(pdfBuffer) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = res.data.id;
  if (!fileId) throw new Error("アップロード成功だが fileId が取得できませんでした");
  return { fileId, webViewLink: res.data.webViewLink ?? null };
}

export async function updatePdf(fileId: string, pdfBuffer: Buffer): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    media: { mimeType: "application/pdf", body: bufferToStream(pdfBuffer) },
    supportsAllDrives: true,
  });
}

export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit 2>&1 | grep -i drive; echo done`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add src/lib/drive.ts
git commit -m "feat(payslip): Google Drive連携(upload/update/delete)"
```

---

### Task 7: TARO向けDrive認証セットアップ（チェックポイント・人手）

**Files:** なし（TAROのGoogle/Vercel操作）

- [ ] **Step 1: TAROがGoogle Cloud設定**

別途渡すセットアップ手順書（プロジェクト作成→Drive API有効化→OAuth同意画面**本番公開**→デスクトップ型OAuthクライアント作成→client_id/secret取得）を実施。

- [ ] **Step 2: リフレッシュトークン取得**

`~/boom-drive-token/get-token.js`（client_id/secret書き換え）をローカル実行 → refresh_token取得。

- [ ] **Step 3: Vercel環境変数登録**

Vercel→Settings→Environment Variables に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` を追加（Production含む）→ 保存。

- [ ] **Step 4: 環境変数反映のため再デプロイ**

Run: `npx vercel --prod --yes 2>&1 | tail -3`
Expected: 完了。これでDrive APIが本番で動く状態。

---

### Task 8: 個別アップロードAPI + 削除API

**Files:**
- Create: `src/app/api/staff/payroll/[id]/payslip/upload/route.ts`
- Create: `src/app/api/staff/payroll/[id]/payslip/route.ts`

- [ ] **Step 1: 共通のデータ取得ヘルパは置かず、uploadに直接実装**

`src/app/api/staff/payroll/[id]/payslip/upload/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getOne, getAll, execute } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/eventAuth";
import { renderPayslipPdf, payslipFilename, type PayslipData } from "@/lib/payslip";
import { uploadPdfToFolder, updatePdf } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function folderIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/folders\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const run = await getOne(
    `SELECT pr.*, i.name AS instructor_name, i.payslip_folder_url, i.shared_folder_url
       FROM payroll_runs pr LEFT JOIN instructors i ON i.id = pr.instructor_id
      WHERE pr.id = ?`,
    [runId]
  ) as (Record<string, unknown> & { instructor_name: string; payslip_folder_url: string | null; shared_folder_url: string | null; drive_file_id: string | null }) | null;
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const folderId = folderIdFromUrl(run.payslip_folder_url) ?? folderIdFromUrl(run.shared_folder_url);
  if (!folderId) return NextResponse.json({ error: "フォルダURL未設定" }, { status: 400 });

  const lines = await getAll(
    `SELECT lesson_date, class_name, lesson_rate, transit_fee FROM payroll_lines WHERE payroll_run_id = ? ORDER BY lesson_date`,
    [runId]
  );
  const adjustments = await getAll(
    `SELECT adjustment_type, amount, description FROM payroll_adjustments WHERE payroll_run_id = ? ORDER BY created_at`,
    [runId]
  );
  const data: PayslipData = {
    run: { ...run, name: run.instructor_name } as PayslipData["run"],
    lines: lines as PayslipData["lines"],
    adjustments: adjustments as PayslipData["adjustments"],
  };

  const pdf = await renderPayslipPdf(data);
  const filename = payslipFilename(data.run) + ".pdf";

  try {
    let fileId = run.drive_file_id;
    let webViewLink: string | null = null;
    if (fileId) {
      await updatePdf(fileId, pdf);
    } else {
      const r = await uploadPdfToFolder(folderId, filename, pdf);
      fileId = r.fileId;
      webViewLink = r.webViewLink;
    }
    await execute(
      `UPDATE payroll_runs SET drive_file_id = ?, payslip_uploaded_at = CURRENT_TIMESTAMP, pdf_url = COALESCE(?, pdf_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [fileId, webViewLink, runId]
    );
    return NextResponse.json({ ok: true, fileId, webViewLink });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 2: 削除API作成**

`src/app/api/staff/payroll/[id]/payslip/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getOne, execute } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/eventAuth";
import { deleteFile } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const run = await getOne(`SELECT drive_file_id FROM payroll_runs WHERE id = ?`, [runId]) as { drive_file_id: string | null } | null;
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!run.drive_file_id) return NextResponse.json({ error: "アップ済みPDFがありません" }, { status: 400 });

  try {
    await deleteFile(run.drive_file_id);
  } catch (e) {
    // Drive側で既に消えていてもDBはクリアする
    const msg = e instanceof Error ? e.message : String(e);
    if (!/404|not found|File not found/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }
  await execute(
    `UPDATE payroll_runs SET drive_file_id = NULL, payslip_uploaded_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [runId]
  );
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit 2>&1 | grep -iE "payslip"; echo done`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add "src/app/api/staff/payroll/[id]/payslip"
git commit -m "feat(payslip): 個別アップロード/削除API"
```

---

### Task 9: 一覧APIに drive_file_id 等を含める

**Files:**
- Modify: `src/app/api/staff/payroll/route.ts`

- [ ] **Step 1: GETのSELECTに列追加**

`src/app/api/staff/payroll/route.ts` の `year_month` 指定時のクエリ（`SELECT pr.*, i.name AS instructor_name, ...`）に既に `pr.*` が含まれていれば drive_file_id/payslip_uploaded_at は自動で入る。`pr.*` でない場合は明示追加。確認:

Run: `grep -n "SELECT pr" src/app/api/staff/payroll/route.ts`
Expected: `pr.*` が使われていれば修正不要。使われていなければ `pr.drive_file_id, pr.payslip_uploaded_at, pr.pdf_url` を追加。

- [ ] **Step 2: pr.* 使用なら本タスクはスキップしコミット不要。明示追加した場合のみコミット**

```bash
git add src/app/api/staff/payroll/route.ts
git commit -m "feat(payslip): 給与一覧にDriveアップ状態を含める"
```

---

### Task 10: UIボタン群（プレビュー/個別アップ/削除/全員アップ）

**Files:**
- Modify: `src/app/staff/payroll/page.tsx`

- [ ] **Step 1: PayrollRun型に列追加**

`src/app/staff/payroll/page.tsx` の `type PayrollRun` に追記:
```ts
  drive_file_id: string | null;
  payslip_uploaded_at: string | null;
```
(既存の `pdf_url` 等の並びの末尾に追加)

- [ ] **Step 2: アップ/削除のハンドラ関数を追加**

`load` 関数の近く（`calculate` の下あたり）に追加:
```tsx
  const [rowBusy, setRowBusy] = useState<Record<number, string>>({});

  const uploadOne = async (runId: number): Promise<boolean> => {
    setRowBusy(s => ({ ...s, [runId]: "up" }));
    try {
      const res = await fetch(`/api/staff/payroll/${runId}/payslip/upload`, { method: "POST", credentials: "include" });
      if (!res.ok) { const t = await res.text(); throw new Error(t); }
      return true;
    } catch (e) {
      setErr(`アップロード失敗(run ${runId}): ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setRowBusy(s => { const n = { ...s }; delete n[runId]; return n; });
    }
  };

  const deleteOne = async (runId: number) => {
    if (!confirm("Driveの明細PDFを削除しますか?")) return;
    setRowBusy(s => ({ ...s, [runId]: "del" }));
    try {
      const res = await fetch(`/api/staff/payroll/${runId}/payslip`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      setErr(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRowBusy(s => { const n = { ...s }; delete n[runId]; return n; });
      await load(ym);
    }
  };

  const uploadAll = async () => {
    if (!confirm(`${runs.length}名分の明細をDriveへアップロードします。よろしいですか?`)) return;
    setBusy(true);
    let ok = 0, ng = 0;
    for (const r of runs) {
      const success = await uploadOne(r.id);
      success ? ok++ : ng++;
    }
    setBusy(false);
    await load(ym);
    alert(`アップロード完了: 成功 ${ok} / 失敗 ${ng}`);
  };
```
(注: 既存の `setErr` `setBusy` `busy` `ym` `runs` `load` を流用)

- [ ] **Step 3: ヘッダのボタン群に「全員アップ」追加**

既存の振込CSVボタンの並び（`<a ...振込CSV...>`の近く）に追加:
```tsx
            <button onClick={uploadAll} disabled={busy || runs.length === 0}
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
              ⬆ 全員アップ
            </button>
```

- [ ] **Step 4: 各行に操作ボタンを追加**

テーブルの各行 `runs.map(r => ...)` の「操作」セル（現状 `詳細 →` がある `<td>`）を以下に差し替え:
```tsx
                    <td className="px-3 py-2 text-center text-xs whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <a href={`/api/staff/payroll/${r.id}/pdf`} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline mr-2">👁</a>
                      <button onClick={() => uploadOne(r.id).then(() => load(ym))} disabled={!!rowBusy[r.id]}
                        className="text-emerald-700 hover:underline mr-2 disabled:opacity-40">
                        {r.drive_file_id ? "再アップ" : "⬆アップ"}
                      </button>
                      {r.drive_file_id && (
                        <>
                          {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:underline mr-2">📁</a>}
                          <button onClick={() => deleteOne(r.id)} disabled={!!rowBusy[r.id]}
                            className="text-red-600 hover:underline disabled:opacity-40">🗑</button>
                        </>
                      )}
                    </td>
```

- [ ] **Step 5: アップ済みバッジを状態セルに追加（任意・状態列の隣）**

既存の状態バッジ `<td>` 内、ステータス表示の後に追加:
```tsx
                      {r.payslip_uploaded_at && <span className="ml-1 text-[9px] px-1 bg-emerald-100 text-emerald-700 rounded">配布済</span>}
```

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit 2>&1 | grep -i "payroll/page"; echo done`
Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add src/app/staff/payroll/page.tsx
git commit -m "feat(payslip): 給与画面にプレビュー/アップ/削除/全員アップUIを追加"
```

---

### Task 11: デプロイ + 5月分 実地テスト（最終チェックポイント）

**Files:** なし（デプロイ・検証）

- [ ] **Step 1: 本番デプロイ**

Run: `npx vercel --prod --yes 2>&1 | tail -5`
Expected: 完了。

- [ ] **Step 2: TARO実地確認（順に）**

ブラウザで `/staff/payroll`（2026-05）を開き:
1. 「👁」でSAYUKIのPDFプレビューが出る
2. SAYUKI行「⬆アップ」→ 成功 → 「配布済」バッジ + 「📁」リンク → DriveのSAYUKIフォルダにPDFが入っている
3. 同じ行「再アップ」→ 上書きされる（Drive上でファイルが重複しない）
4. 「🗑」→ Driveから消える、バッジも消える
5. 「⬆ 全員アップ」→ 8名全員が各自フォルダに配布、「成功8/失敗0」

Expected: すべてOK。NGがあればそのAPIのVercelログを確認。

- [ ] **Step 3: 完了**

全部OKなら本機能完成。インストラクターへの給与明細配布が画面から完結する。

---

## Self-Review 結果

- **Spec coverage:** payslip.ts(Task2)/drive.ts(Task6)/migration(Task5)/pdf API(Task3)/upload・delete API(Task8)/一括=UI直列(Task10)/UI(Task10)/Drive認証(Task7)/段階デプロイ(Task4,11) — spec全項目をタスク化済み。
- **Placeholder scan:** 各コードステップに完全なコードを記載。曖昧表現なし。
- **Type consistency:** `PayslipData`/`renderPayslipPdf`/`payslipFilename`/`uploadPdfToFolder`/`updatePdf`/`deleteFile`/`drive_file_id`/`payslip_uploaded_at` は全タスクで名称一致。
- **Note:** テスト基盤がない既存方針に合わせ、自動テストの代わりにデプロイ実機検証をチェックポイント化(Task4,11)。
