// scripts/fixed_qr/discover_design6.mjs
// #/system/themes/ -> ホーム設定 の「アクションボタン」(体験/入会/予約/イベント)の
// 「URL: リンク先を変更する」チェックボックスをONにして、現れるURL入力欄のラベル/プレースホルダ/
// 注意書きを確認する。保存ボタンは絶対に押さない。チェックボックスの状態変更はDOM上のみで、
// 「保存する」を押さない限りHACOMONO側には反映されない(未保存離脱で破棄される)ため、調査目的で許容する。
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

console.log('=== discover_design6.mjs 開始 (保存ボタンは絶対に押しません) ===');
const { browser, page } = await launchAndLogin();

try {
  await page.goto('https://boom-admin.hacomono.jp/#/system/themes/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);

  const tabSel = '.m_tab_vertical_container .left .inner .item a';
  const count = await page.locator(tabSel).count();
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const loc = page.locator(tabSel).nth(i);
    const label = (await loc.textContent()).trim();
    if (label === 'ホーム設定') {
      await loc.click();
      clicked = true;
      break;
    }
  }
  console.log(`ホーム設定タブ クリック=${clicked}`);
  await page.waitForTimeout(1200);

  // 「リンク先を変更する」チェックボックスを全部ONにしてみる(保存はしない)
  const checkboxLabel = 'text=リンク先を変更する';
  const cbCount = await page.locator(checkboxLabel).count();
  console.log(`「リンク先を変更する」ラベル count=${cbCount}`);

  for (let i = 0; i < cbCount; i++) {
    // ラベルに対応するチェックボックスをクリック (ラベル自体がクリック可能なUIの場合が多い)
    const labelLoc = page.locator(checkboxLabel).nth(i);
    try {
      await labelLoc.click({ timeout: 3000 });
      await page.waitForTimeout(400);
    } catch (e) {
      console.log(`  [${i}] クリック失敗: ${e.message}`);
    }
  }

  await page.waitForTimeout(800);
  await shot(page, '50_home_action_buttons_url_expanded');
  await saveHtml(page, '50_home_action_buttons_url_expanded');

  // URL入力欄のラベル/プレースホルダ/ヘルプテキストを抽出
  const urlFieldsInfo = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
    return inputs
      .filter((el) => {
        const grp = el.closest('.f_formgroup, .form-content');
        return grp && grp.textContent.includes('URL');
      })
      .map((el) => ({
        placeholder: el.placeholder || '',
        value: el.value || '',
        name: el.name || '',
        ariaLabel: el.closest('[aria-label]')?.getAttribute('aria-label') || '',
      }));
  });
  console.log(`URL関連入力欄: ${JSON.stringify(urlFieldsInfo, null, 2)}`);
  fs.writeFileSync(`${OUT_DIR}/action_button_url_fields.json`, JSON.stringify(urlFieldsInfo, null, 2), 'utf-8');

  console.log('\n=== done (保存ボタンは押していません。ページを離脱するだけで変更は破棄されます) ===');
} finally {
  await browser.close();
}
