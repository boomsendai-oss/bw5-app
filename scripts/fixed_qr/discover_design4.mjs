// scripts/fixed_qr/discover_design4.mjs
// #/system/themes/ の「マイページ画面設定」タブで発見した、各メッセージ入力欄の
// 「テキスト」/「CSS」切替タブの実体を調査する。CSSタブの中身(エディタ種別・プレースホルダ・
// 既存値の有無・注意書き)を確認する。保存ボタンは押さない。
import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const OUT_DIR = 'discover_out';
fs.mkdirSync(OUT_DIR, { recursive: true });

async function saveHtml(page, name) {
  fs.writeFileSync(`${OUT_DIR}/${name}.html`, await page.content(), 'utf-8');
}
async function shot(page, name, opts = {}) {
  try {
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: !opts.viewportOnly });
  } catch (e) {
    console.log(`[shot] ${name} failed: ${e.message}`);
  }
}

console.log('=== discover_design4.mjs 開始 (保存ボタンは押しません) ===');
const { browser, page } = await launchAndLogin();

try {
  await page.goto('https://boom-admin.hacomono.jp/#/system/themes/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);

  // 「マイページ画面設定」タブへ
  const tabSel = '.m_tab_vertical_container .left .inner .item a';
  const count = await page.locator(tabSel).count();
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const loc = page.locator(tabSel).nth(i);
    const label = (await loc.textContent()).trim();
    if (label === 'マイページ画面設定') {
      await loc.click();
      clicked = true;
      break;
    }
  }
  console.log(`マイページ画面設定タブ クリック=${clicked}`);
  await page.waitForTimeout(1200);

  // 「テキスト」/「CSS」の切替タブ (labelは f_formgroup 内に複数存在) を広めに探す
  const cssTabSel = 'a:has-text("CSS"), [role="tab"]:has-text("CSS"), .item:has-text("CSS") a, li:has-text("CSS") a';
  const cssTabCount = await page.locator(cssTabSel).count();
  console.log(`CSS切替タブ候補 count=${cssTabCount}`);

  // より正確に: テキスト/CSSのタブは兄弟関係にある小さなタブUI。DOM構造を調べて共通クラスを取得。
  const tabStructure = await page.evaluate(() => {
    const cssAnchors = Array.from(document.querySelectorAll('a')).filter((a) => a.textContent.trim() === 'CSS');
    return cssAnchors.map((a) => ({
      outerHTML: a.outerHTML,
      parentClass: a.parentElement ? a.parentElement.className : '',
      grandParentClass: a.parentElement && a.parentElement.parentElement ? a.parentElement.parentElement.className : '',
    }));
  });
  console.log(`CSSタブDOM構造 (先頭3件): ${JSON.stringify(tabStructure.slice(0, 3), null, 2)}`);
  fs.writeFileSync(`${OUT_DIR}/css_tab_dom_structure.json`, JSON.stringify(tabStructure, null, 2), 'utf-8');

  // 最初の「CSS」タブをクリックしてみる (1つ目のメッセージ欄=プラン新規契約画面の規約同意メッセージ)
  const firstCssTab = page.locator('a:has-text("CSS")').first();
  const firstCssCount = await page.locator('a:has-text("CSS")').count();
  console.log(`"CSS"テキスト一致 a要素 count=${firstCssCount}`);
  if (firstCssCount >= 1) {
    await firstCssTab.click();
    await page.waitForTimeout(800);
    await shot(page, '30_first_css_tab_clicked');
    await saveHtml(page, '30_first_css_tab_clicked');

    // クリック後、直近のtextarea/エディタの内容とプレースホルダを取得
    const nearInfo = await page.evaluate(() => {
      // CSSというテキストを含むactiveな要素の近くのtextareaを探す
      const activeCss = Array.from(document.querySelectorAll('a, [role="tab"]')).find(
        (el) => el.textContent.trim() === 'CSS' && (el.className.includes('active') || el.className.includes('current') || (el.parentElement && el.parentElement.className.includes('current')))
      );
      let container = activeCss;
      for (let i = 0; i < 6 && container; i++) {
        container = container.parentElement;
        const ta = container ? container.querySelector('textarea') : null;
        if (ta) {
          return {
            found_at_depth: i,
            placeholder: ta.placeholder || '',
            value: ta.value || '',
            classList: ta.className,
          };
        }
      }
      return null;
    });
    console.log(`CSSタブ直近のtextarea情報: ${JSON.stringify(nearInfo, null, 2)}`);
    fs.writeFileSync(`${OUT_DIR}/css_tab_textarea_info.json`, JSON.stringify(nearInfo, null, 2), 'utf-8');
  }

  // 画面上部(スクロール位置0)でのビューポートスクショも撮る (該当欄が見えるように少しスクロール)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot(page, '31_top_after_css_click', { viewportOnly: true });

  console.log('\n=== done (保存ボタンは押していません) ===');
} finally {
  await browser.close();
}
