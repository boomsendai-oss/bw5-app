// scripts/fixed_qr/discover_design2.mjs
// discover_design.mjs の続き。サイドバーは「運営/請求/売上/マスタ/システム/ログ」の
// アイコンタブ(クリックで右側にサブメニューが展開される。hrefはクリック後にDOMへ現れる)構造だと判明したため、
// 各アイコンタブを順にクリックしてサブメニューのhref一覧を確実に収集し、
// マスタ/システム配下の未調査ページを巡回してCSS/HTML/JS/デザイン系キーワードを探す。
//
// 絶対条件: 設定変更・保存は一切しない。閲覧とスクショのみ。
import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const OUT_DIR = 'discover_out';
fs.mkdirSync(OUT_DIR, { recursive: true });

const KEYWORDS = ['CSS', 'css', 'カスタム', 'custom', 'スクリプト', 'HTML', 'テーマ', 'theme', 'デザイン', 'design', 'バナー', 'banner', 'ロゴ', 'logo'];

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
function grepKeywords(html) {
  const hits = {};
  for (const kw of KEYWORDS) {
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const m = html.match(re);
    if (m && m.length > 0) hits[kw] = m.length;
  }
  return hits;
}
function extractSnippets(html, keyword, radius = 80, max = 5) {
  const out = [];
  let idx = 0;
  while (out.length < max) {
    const found = html.indexOf(keyword, idx);
    if (found === -1) break;
    const start = Math.max(0, found - radius);
    const end = Math.min(html.length, found + keyword.length + radius);
    out.push(html.slice(start, end).replace(/\s+/g, ' '));
    idx = found + keyword.length;
  }
  return out;
}

console.log('=== discover_design2.mjs 開始 (保存/公開設定は一切変更しません) ===');
const { browser, page } = await launchAndLogin();

const allTabLinks = {};
const visited = [];

try {
  await page.goto('https://boom-admin.hacomono.jp/#/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);

  // 左アイコンタブ (.l_sidebar .left ul li a) を順にクリックして .right 側のリンクを収集
  const tabCount = await page.locator('.l_sidebar .left ul li a').count();
  console.log(`アイコンタブ数: ${tabCount}`);
  for (let i = 0; i < tabCount; i++) {
    const tabLoc = page.locator('.l_sidebar .left ul li a').nth(i);
    const label = (await tabLoc.textContent()).trim().replace(/\s+/g, '');
    console.log(`\n--- タブ[${i}] "${label}" をクリック ---`);
    try {
      await tabLoc.click({ timeout: 5000 });
    } catch (e) {
      console.log(`  クリック失敗: ${e.message}`);
      continue;
    }
    await page.waitForTimeout(1000);
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.l_sidebar .right a[href]')).map((a) => ({
        href: a.getAttribute('href'),
        text: (a.textContent || '').trim().replace(/\s+/g, ' '),
      }));
    });
    allTabLinks[label] = links;
    console.log(`  サブメニュー ${links.length}件:`);
    for (const l of links) console.log(`    ${l.href}  "${l.text}"`);
    await shot(page, `10_tab_${i}_${label}`);
  }
  fs.writeFileSync(`${OUT_DIR}/sidebar_tab_links.json`, JSON.stringify(allTabLinks, null, 2), 'utf-8');

  // マスタ・システムタブの全サブメニューを巡回 (前回済みのsystem/settings/*は除外可だが念のため含める)
  const targetTabs = ['マスタ', 'システム'];
  const candidateHrefs = [];
  for (const tab of targetTabs) {
    for (const l of allTabLinks[tab] || []) {
      if (l.href && l.href.startsWith('#/')) candidateHrefs.push({ tab, ...l });
    }
  }
  console.log(`\n巡回対象 (マスタ+システム) 件数: ${candidateHrefs.length}`);

  let n = 1;
  for (const { tab, href, text } of candidateHrefs) {
    const url = `https://boom-admin.hacomono.jp/${href}`;
    const safeName = `${tab}_${href}`.replace(/[^a-zA-Z0-9]/g, '_');
    console.log(`\n[${n}] tab=${tab} "${text}" -> ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    } catch (e) {
      console.log(`  goto失敗: ${e.message}`);
      n++;
      continue;
    }
    await page.waitForTimeout(1200);

    // タブ/アコーディオンがあれば全部開く (詳細設定等)
    for (const label of ['詳細設定', 'もっと見る', '詳細']) {
      const loc = page.locator(`text=${label}`);
      const c = await loc.count();
      if (c >= 1 && c <= 5) {
        try {
          await loc.first().click({ timeout: 1500 });
          await page.waitForTimeout(400);
        } catch {}
      }
    }

    await shot(page, `11_${String(n).padStart(2, '0')}_${safeName}`);
    await saveHtml(page, `11_${String(n).padStart(2, '0')}_${safeName}`);
    const html = await page.content();
    const hits = grepKeywords(html);
    visited.push({ tab, href, text, finalUrl: page.url(), keywordHits: hits });
    console.log(`  到達URL: ${page.url()}`);
    console.log(`  keyword hits: ${JSON.stringify(hits)}`);

    for (const kw of ['CSS', 'カスタム', 'custom', 'スクリプト', 'テーマ', 'デザイン', 'design', 'バナー', 'banner', 'ロゴ', 'logo', 'HTML']) {
      if (hits[kw]) {
        const snippets = extractSnippets(html, kw);
        fs.writeFileSync(
          `${OUT_DIR}/snippets2_${safeName}_${kw.replace(/[^a-zA-Z0-9]/g, '')}.json`,
          JSON.stringify(snippets, null, 2),
          'utf-8'
        );
      }
    }
    n++;
  }

  fs.writeFileSync(`${OUT_DIR}/design_investigation_report2.json`, JSON.stringify({ allTabLinks, visited }, null, 2), 'utf-8');
  console.log('\n=== done (設定変更/保存/公開切替は一切行っていません) ===');
} finally {
  await browser.close();
}
