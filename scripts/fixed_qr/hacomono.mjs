// scripts/fixed_qr/hacomono.mjs
// HACOMONO管理へのログインとML001 CSV直エクスポート (daily_sync.pyで実証済みの方式の移植)
import { chromium } from 'playwright';

const LOGIN_URL = 'https://boom-admin.hacomono.jp/';

export async function launchAndLogin() {
  if (!process.env.HACOMONO_USERNAME || !process.env.HACOMONO_PASSWORD) {
    throw new Error('HACOMONO_USERNAME/HACOMONO_PASSWORD が未設定です (GitHub Secrets/環境変数を確認)');
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('input[type="text"]', { timeout: 30_000 });
  await page.fill('input[type="text"]', process.env.HACOMONO_USERNAME);
  await page.fill('input[type="password"]', process.env.HACOMONO_PASSWORD);
  await page.click('button[type="submit"], button:has-text("ログイン")');
  // ログイン後はダッシュボードへ遷移する。メニューが出るまで待つ
  try {
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
  } catch {
    // 稀にnetworkidleに到達しないことがある(daily_sync.py実績)。固定waitで補う
    await page.waitForTimeout(5000);
  }
  if (page.url().includes('login') || (await page.locator('input[type="password"]').count()) > 0) {
    throw new Error('HACOMONO login failed (still on login form)');
  }
  return { browser, context, page };
}

// ML001(全メンバー) CSV直エクスポート。query id=7 (auto_sync/hacomono_query_ids.txt)
export async function downloadMl001Csv(context) {
  const query = encodeURIComponent(JSON.stringify({ id: 7, payload: { studio_id: 1 } }));
  const url = `https://boom-admin.hacomono.jp/api/analysis/queries/export?query=${query}&file_type=csv&encoding=BOM--UTF-8`;
  const res = await context.request.get(url, { timeout: 120_000 });
  if (res.status() !== 200) throw new Error(`ML001 export failed: HTTP ${res.status()}`);
  // セッション切れ等でHTTP 200のままログインページ(HTML)が返る偽陽性を弾く。
  // 本文はログに出さず、種別情報のみでエラー化する。
  const contentType = res.headers()['content-type'] || '';
  if (!contentType.toLowerCase().includes('csv')) {
    throw new Error(`ML001 export failed: unexpected content-type=${contentType || '(none)'}`);
  }
  const body = await res.body();
  const text = body.toString('utf-8').replace(/^﻿/, '');
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error(`ML001 export: ${lines.length} lines (期待: ヘッダー+会員行)`);
  if (!lines[0].includes('メンバーID')) {
    throw new Error('ML001 export failed: header row missing expected column (メンバーID)');
  }
  return text;
}
