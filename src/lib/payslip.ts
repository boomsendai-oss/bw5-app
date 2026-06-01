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
