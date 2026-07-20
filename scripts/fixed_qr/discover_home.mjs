// scripts/fixed_qr/discover_home.mjs
// 目的: HACOMONO管理画面「テーマ→ホーム設定」を読み取り専用で詳細調査し、
//   会員マイページのホーム画面に「固定QRコード発行」への常設リンクを追加できるか判定する。
// 絶対条件: 設定変更・保存・実行ボタンは一切押さない。クリックするのは縦タブのナビゲーションのみ。
//   チェックボックス/トグル等の「設定値」を変更するクリックは行わない(前回スクリプトdiscover_design6.mjsは
//   調査目的でチェックボックスをクリックしていたが、今回はより厳格な指示のため踏襲しない)。
// 事故防止: URLは直接gotoせず、必ず「#/system/themes/」起点で画面上のタブリンクのみを辿る。
//   万一メンバー情報/チェックイン履歴等の画面に着いたら、即座に離脱しHTML保存もスクショもしない。
import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const OUT_DIR = 'discover_out';
fs.mkdirSync(OUT_DIR, { recursive: true });

const SAFE_URL_PREFIX = 'https://boom-admin.hacomono.jp/#/system/themes/';

function isSafeUrl(url) {
  return url.startsWith(SAFE_URL_PREFIX) || url === 'https://boom-admin.hacomono.jp/#/system/themes';
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
  } catch (e) {
    console.log(`[shot] ${name} failed: ${e.message}`);
  }
}
async function saveHtml(page, name) {
  fs.writeFileSync(`${OUT_DIR}/${name}.html`, await page.content(), 'utf-8');
}

function grepLabelsAroundKeywords(html, keywords) {
  const hits = {};
  for (const kw of keywords) {
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = [...html.matchAll(re)];
    hits[kw] = matches.length;
  }
  return hits;
}

async function clickVerticalTab(page, label) {
  const tabSel = '.m_tab_vertical_container .left .inner .item a';
  const count = await page.locator(tabSel).count();
  for (let i = 0; i < count; i++) {
    const loc = page.locator(tabSel).nth(i);
    const text = (await loc.textContent()).trim();
    if (text === label) {
      await loc.click();
      return true;
    }
  }
  return false;
}

console.log('=== discover_home.mjs 開始 (読み取り専用: 設定変更/保存/実行ボタンは一切押しません) ===');
const { browser, page } = await launchAndLogin();

try {
  // --- Step 0: テーマ画面トップへ (安全な既知URL) ---
  await page.goto(SAFE_URL_PREFIX, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1200);
  if (!isSafeUrl(page.url())) {
    console.log(`[中断] 想定外のURLに遷移しました: ${page.url()} → 離脱します`);
    await browser.close();
    process.exit(1);
  }

  // --- Step 1: 「ホーム設定」タブをクリック ---
  const clickedHome = await clickVerticalTab(page, 'ホーム設定');
  console.log(`「ホーム設定」タブ クリック=${clickedHome}`);
  await page.waitForTimeout(1200);

  if (!isSafeUrl(page.url())) {
    console.log(`[中断] 想定外のURLに遷移しました: ${page.url()} → 離脱します`);
    await browser.close();
    process.exit(1);
  }

  await shot(page, 'home_01_full');
  await saveHtml(page, 'home_01_full');

  // セクション見出し(ラベル)を機械的に抽出。トグル/チェックボックスは一切クリックしない。
  const homeStructure = await page.evaluate(() => {
    const right = document.querySelector('.m_tab_vertical_container .right');
    if (!right) return null;
    const labelEls = Array.from(right.querySelectorAll('label, .f_formgroup .label, .m_section .header, h3, h4'));
    const labels = labelEls.map((el) => (el.textContent || '').trim()).filter((t) => t.length > 0 && t.length < 60);
    const buttons = Array.from(right.querySelectorAll('button, a')).map((el) => (el.textContent || '').trim()).filter((t) => t);
    const inputsCount = right.querySelectorAll('input').length;
    const textareaCount = right.querySelectorAll('textarea').length;
    const checkboxCount = right.querySelectorAll('input[type="checkbox"]').length;
    return { labels, buttons, inputsCount, textareaCount, checkboxCount };
  });
  console.log('\n--- ホーム設定タブ 構造 ---');
  console.log(JSON.stringify(homeStructure, null, 2));
  fs.writeFileSync(`${OUT_DIR}/home_structure.json`, JSON.stringify(homeStructure, null, 2), 'utf-8');

  // 「+追加」等、項目を増やせるボタンが無いかをボタン文言から確認
  const addButtons = (homeStructure?.buttons || []).filter((b) => /追加|＋|\+/.test(b));
  console.log(`\n「追加」系ボタン候補: ${JSON.stringify(addButtons)}`);

  // キーワードgrep (HTML全文に対して)
  const html = await page.content();
  const keywordHits = grepLabelsAroundKeywords(html, ['追加', 'リンク', 'URL', 'メッセージ', 'お知らせ', 'ボタン', '表示', 'セクション']);
  console.log(`\n--- キーワード出現回数 ---\n${JSON.stringify(keywordHits, null, 2)}`);
  fs.writeFileSync(`${OUT_DIR}/home_keyword_hits.json`, JSON.stringify(keywordHits, null, 2), 'utf-8');

  // --- Step 2: 「カスタム」タブでJSON構造を確認 (home関連キーのみ抽出) ---
  const clickedCustom = await clickVerticalTab(page, 'カスタム');
  console.log(`\n「カスタム」タブ クリック=${clickedCustom}`);
  await page.waitForTimeout(1000);
  if (!isSafeUrl(page.url())) {
    console.log(`[中断] 想定外のURLに遷移しました: ${page.url()} → 離脱します`);
    await browser.close();
    process.exit(1);
  }
  const customValue = await page.evaluate(() => {
    const ta = document.querySelector('.m_tab_vertical_container .right textarea');
    return ta ? ta.value : null;
  });
  if (customValue) {
    fs.writeFileSync(`${OUT_DIR}/theme_custom.json`, customValue, 'utf-8');
    try {
      const parsed = JSON.parse(customValue);
      const homeKey = parsed?.theme?.home ?? null;
      console.log(`\n--- theme.home (JSON構造、PII含まず設定値のみ) ---`);
      console.log(JSON.stringify(homeKey, null, 2));
      fs.writeFileSync(`${OUT_DIR}/theme_home_key.json`, JSON.stringify(homeKey, null, 2), 'utf-8');
    } catch (e) {
      console.log(`カスタムJSONパース失敗: ${e.message}`);
    }
  } else {
    console.log('カスタムタブのtextarea値が取得できませんでした');
  }

  // --- Step 3: 「文言設定」タブの行内容 (項目名のみ; ホーム関連の自由文言欄が無いか) ---
  const clickedWording = await clickVerticalTab(page, '文言設定');
  console.log(`\n「文言設定」タブ クリック=${clickedWording}`);
  await page.waitForTimeout(1000);
  if (!isSafeUrl(page.url())) {
    console.log(`[中断] 想定外のURLに遷移しました: ${page.url()} → 離脱します`);
    await browser.close();
    process.exit(1);
  }
  const wordingRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.m_tab_vertical_container .right table tr, .m_tab_vertical_container .right .m_table tr'));
    return rows.map((tr) => Array.from(tr.querySelectorAll('td, th')).map((c) => (c.textContent || '').trim())).filter((r) => r.length > 0);
  });
  console.log(`\n--- 文言設定 行数: ${wordingRows.length} ---`);
  const wordingHomeRelated = wordingRows.filter((r) => r.some((c) => /ホーム|home|お知らせ|announcement/i.test(c)));
  console.log(`ホーム関連らしき行: ${JSON.stringify(wordingHomeRelated, null, 2)}`);
  fs.writeFileSync(`${OUT_DIR}/wording_rows.json`, JSON.stringify(wordingRows, null, 2), 'utf-8');

  // --- Step 4: 「変数設定」タブの行内容 (キー名のみ) ---
  const clickedVars = await clickVerticalTab(page, '変数設定');
  console.log(`\n「変数設定」タブ クリック=${clickedVars}`);
  await page.waitForTimeout(1000);
  if (!isSafeUrl(page.url())) {
    console.log(`[中断] 想定外のURLに遷移しました: ${page.url()} → 離脱します`);
    await browser.close();
    process.exit(1);
  }
  const varRows = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.m_tab_vertical_container .right table tr, .m_tab_vertical_container .right .m_table tr'));
    return rows.map((tr) => Array.from(tr.querySelectorAll('td, th')).map((c) => (c.textContent || '').trim())).filter((r) => r.length > 0);
  });
  console.log(`\n--- 変数設定 行数: ${varRows.length} ---`);
  const varsHomeRelated = varRows.filter((r) => r.some((c) => /ホーム|home|お知らせ|announcement/i.test(c)));
  console.log(`ホーム関連らしき行: ${JSON.stringify(varsHomeRelated, null, 2)}`);
  fs.writeFileSync(`${OUT_DIR}/vars_rows.json`, JSON.stringify(varRows, null, 2), 'utf-8');

  // 最後にホーム設定タブへ戻ってスクショ(離脱時の状態確認用、変更なし)
  await clickVerticalTab(page, 'ホーム設定');
  await page.waitForTimeout(800);
  await shot(page, 'home_02_final_state');

  console.log('\n=== done (閲覧のみ。設定変更・保存は一切行っていません) ===');
} catch (e) {
  console.log(`[エラー] ${e.message}`);
  throw e;
} finally {
  await browser.close();
}
