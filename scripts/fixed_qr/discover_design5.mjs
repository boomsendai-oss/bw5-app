// scripts/fixed_qr/discover_design5.mjs
// 「利用可能な HTML タグ」ヘルプページ (#/app/html-tag) の内容を確認する (閲覧のみ)。
// マイページのメッセージ欄に挿入できるHTMLタグの範囲を特定する目的。
import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const OUT_DIR = 'discover_out';
fs.mkdirSync(OUT_DIR, { recursive: true });

async function saveHtml(page, name) {
  fs.writeFileSync(`${OUT_DIR}/${name}.html`, await page.content(), 'utf-8');
}
async function shot(page, name) {
  try {
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
  } catch (e) {
    console.log(`[shot] ${name} failed: ${e.message}`);
  }
}

console.log('=== discover_design5.mjs 開始 (閲覧のみ) ===');
const { browser, page } = await launchAndLogin();

try {
  await page.goto('https://boom-admin.hacomono.jp/#/app/html-tag', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, '40_html_tag_help');
  await saveHtml(page, '40_html_tag_help');
  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`${OUT_DIR}/html_tag_help_text.txt`, text, 'utf-8');
  console.log(text.slice(0, 3000));
  console.log('\n=== done ===');
} finally {
  await browser.close();
}
