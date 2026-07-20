// scripts/fixed_qr/discover_design3.mjs
// #/system/themes/ (テーマ設定) 配下の縦タブ (サイト設定/ヘッダー設定/.../マイページ画面設定/.../カスタム 等)
// を全てクリックして内容を確認する。特に「マイページ画面設定」「カスタム」「カラー設定」を重点調査。
// TAROの記憶「マイページのデザインをCSSでいじれる余地があった気がする」の裏取り本命。
//
// 絶対条件: 保存ボタンは押さない。閲覧・スクショのみ。フォーム入力欄のラベル/プレースホルダ/注意書きを原文取得する。
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

console.log('=== discover_design3.mjs 開始 (保存ボタンは押しません) ===');
const { browser, page } = await launchAndLogin();

const report = {};

try {
  await page.goto('https://boom-admin.hacomono.jp/#/system/themes/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);

  const tabSel = '.m_tab_vertical_container .left .inner .item a';
  const tabCount = await page.locator(tabSel).count();
  console.log(`テーマ設定の縦タブ数: ${tabCount}`);

  for (let i = 0; i < tabCount; i++) {
    // 毎回セレクタを取り直す (DOM再描画対策)
    const loc = page.locator(tabSel).nth(i);
    const label = (await loc.textContent()).trim();
    console.log(`\n--- [${i}] "${label}" をクリック ---`);
    try {
      await loc.click({ timeout: 5000 });
    } catch (e) {
      console.log(`  クリック失敗: ${e.message}`);
      continue;
    }
    await page.waitForTimeout(1000);

    const safeName = label.replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠]/g, '_');
    await shot(page, `20_${String(i).padStart(2, '0')}_${safeName}`);
    await saveHtml(page, `20_${String(i).padStart(2, '0')}_${safeName}`);

    // 右側の設定パネル内の フォーム構造 (ラベル/プレースホルダ/注意書き/textarea等) を抽出
    const formInfo = await page.evaluate(() => {
      const panel = document.querySelector('.m_tab_vertical_container .right') || document.body;
      const labels = Array.from(panel.querySelectorAll('label, .label, dt, th')).map((el) => el.textContent.trim()).filter(Boolean);
      const textareas = Array.from(panel.querySelectorAll('textarea')).map((el) => ({
        placeholder: el.placeholder || '',
        name: el.name || '',
        value_length: (el.value || '').length,
      }));
      const codeInputs = Array.from(panel.querySelectorAll('.CodeMirror, .monaco-editor, [class*="code-editor" i], [class*="ace_editor" i]')).map(
        (el) => el.className
      );
      const helpTexts = Array.from(panel.querySelectorAll('[class*="help" i], [class*="caption" i], [class*="note" i], [class*="hint" i], [class*="description" i]'))
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      const inputsCount = panel.querySelectorAll('input').length;
      const selectsCount = panel.querySelectorAll('select').length;
      return { labels, textareas, codeInputs, helpTexts, inputsCount, selectsCount, textareaCount: textareas.length };
    });
    report[label] = formInfo;
    console.log(`  labels(先頭10件): ${JSON.stringify(formInfo.labels.slice(0, 10))}`);
    console.log(`  textarea数: ${formInfo.textareaCount}  codeEditor候補: ${JSON.stringify(formInfo.codeInputs)}`);
    if (formInfo.helpTexts.length) console.log(`  helpTexts: ${JSON.stringify(formInfo.helpTexts)}`);
  }

  fs.writeFileSync(`${OUT_DIR}/theme_tabs_report.json`, JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n=== done (保存ボタンは押していません) ===');
} finally {
  await browser.close();
}
