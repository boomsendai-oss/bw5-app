// scripts/fixed_qr/discover_design7.mjs
// 「サイドバー設定」「ヘッダー設定」「下部ナビゲーション設定」の「リンク設定」機能で
// 選択可能な「タイプ」の全選択肢(内部リンク/外部リンク/ログイン等)を確認する。閲覧のみ。保存しない。
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

console.log('=== discover_design7.mjs 開始 (保存しません) ===');
const { browser, page } = await launchAndLogin();

try {
  await page.goto('https://boom-admin.hacomono.jp/#/system/themes/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);

  const tabSel = '.m_tab_vertical_container .left .inner .item a';

  for (const targetLabel of ['ヘッダー設定', '下部ナビゲーション設定', 'サイドバー設定', 'フッター設定']) {
    const count = await page.locator(tabSel).count();
    let clicked = false;
    for (let i = 0; i < count; i++) {
      const loc = page.locator(tabSel).nth(i);
      const label = (await loc.textContent()).trim();
      if (label === targetLabel) {
        await loc.click();
        clicked = true;
        break;
      }
    }
    console.log(`\n--- ${targetLabel} クリック=${clicked} ---`);
    await page.waitForTimeout(1000);

    // 「タイプ」ラベルを持つselect要素を探し、その選択肢を列挙
    const typeSelects = await page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('.f_formgroup, [aria-label]'));
      const results = [];
      // ページ内の全selectを対象に、直近のラベルが「タイプ」のものを拾う
      document.querySelectorAll('select').forEach((sel) => {
        const label = sel.closest('.f_formgroup')?.querySelector('label')?.textContent?.trim() || '';
        const optTexts = Array.from(sel.options).map((o) => o.textContent.trim());
        results.push({ label, options: optTexts });
      });
      return results;
    });
    console.log(`select一覧: ${JSON.stringify(typeSelects, null, 2)}`);

    // カスタムドロップダウン(select要素でない、クリック式)の場合に備え、「タイプ」直後のドロップダウンをクリックしてみる
    const typeDropdown = page.locator('text=タイプ').first();
    const typeDropdownCount = await page.locator('text=タイプ').count();
    console.log(`"タイプ"ラベル count=${typeDropdownCount}`);

    await shot(page, `60_${targetLabel}_before_dropdown`);
    await saveHtml(page, `60_${targetLabel.replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠]/g, '_')}`);

    fs.writeFileSync(`${OUT_DIR}/type_select_${targetLabel.replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠]/g, '_')}.json`, JSON.stringify(typeSelects, null, 2), 'utf-8');
  }

  console.log('\n=== done (保存していません) ===');
} finally {
  await browser.close();
}
