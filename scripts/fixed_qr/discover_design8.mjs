// scripts/fixed_qr/discover_design8.mjs
// (a) テーマ設定「カスタム」タブのtextarea全文を取得しキー構造を確認 (vars以外にcss/html/js相当のキーがないか)
// (b) 運営配下の未精査タブ(予約スケジュール/予約者リスト/入退館/メンバー/イベント/クラス/セグメント/シフト)を
//     ざっと巡回してCSS/デザイン系キーワードの有無だけ確認する (念のための網羅性確保)
// 保存・変更は一切しない。
import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const OUT_DIR = 'discover_out';
fs.mkdirSync(OUT_DIR, { recursive: true });

async function shot(page, name) {
  try { await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true }); } catch {}
}

const KEYWORDS = ['CSS', 'css', 'カスタム', 'custom', 'テーマ', 'theme', 'デザイン', 'design', 'バナー', 'banner'];
function grepKeywords(html) {
  const hits = {};
  for (const kw of KEYWORDS) {
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const m = html.match(re);
    if (m && m.length > 0) hits[kw] = m.length;
  }
  return hits;
}

console.log('=== discover_design8.mjs 開始 (保存しません) ===');
const { browser, page } = await launchAndLogin();

try {
  // (a) カスタムタブ全文
  await page.goto('https://boom-admin.hacomono.jp/#/system/themes/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1200);
  const tabSel = '.m_tab_vertical_container .left .inner .item a';
  const count = await page.locator(tabSel).count();
  for (let i = 0; i < count; i++) {
    const loc = page.locator(tabSel).nth(i);
    const label = (await loc.textContent()).trim();
    if (label === 'カスタム') {
      await loc.click();
      break;
    }
  }
  await page.waitForTimeout(1000);
  const fullValue = await page.evaluate(() => {
    const ta = document.querySelector('.m_tab_vertical_container .right textarea');
    return ta ? ta.value : null;
  });
  console.log(`\n--- カスタムタブ textarea 全文の長さ: ${fullValue ? fullValue.length : 'null'} ---`);
  if (fullValue) {
    fs.writeFileSync(`${OUT_DIR}/theme_custom_tab_full_value.json`, fullValue, 'utf-8');
    try {
      const parsed = JSON.parse(fullValue);
      console.log(`トップレベルキー: ${JSON.stringify(Object.keys(parsed))}`);
      if (parsed.vars) console.log(`vars内のキー数: ${Object.keys(parsed.vars).length}`);
    } catch (e) {
      console.log(`JSONパース失敗: ${e.message}`);
    }
  }

  // (b) 運営配下 未精査タブの巡回
  console.log('\n--- 運営配下タブの巡回 (キーワード確認) ---');
  await page.goto('https://boom-admin.hacomono.jp/#/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1000);
  // 運営タブをクリックしてリンク取得
  const iconTabs = page.locator('.l_sidebar .left ul li a');
  await iconTabs.nth(0).click(); // 運営
  await page.waitForTimeout(800);
  const opLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.l_sidebar .right a[href]')).map((a) => ({
      href: a.getAttribute('href'),
      text: (a.textContent || '').trim(),
    }))
  );
  console.log(`運営配下リンク: ${JSON.stringify(opLinks)}`);

  const results = {};
  for (const l of opLinks) {
    if (!l.href || !l.href.startsWith('#/')) continue;
    const url = `https://boom-admin.hacomono.jp/${l.href}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch (e) {
      console.log(`  ${l.text} goto失敗: ${e.message}`);
      continue;
    }
    await page.waitForTimeout(800);
    const html = await page.content();
    const hits = grepKeywords(html);
    results[l.text] = { href: l.href, hits };
    console.log(`  ${l.text} (${l.href}): ${JSON.stringify(hits)}`);
  }
  fs.writeFileSync(`${OUT_DIR}/operation_tabs_keyword_scan.json`, JSON.stringify(results, null, 2), 'utf-8');

  console.log('\n=== done (保存していません) ===');
} finally {
  await browser.close();
}
