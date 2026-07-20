// scripts/fixed_qr/discover_design.mjs
// マイページ(会員サイト)へのカスタムCSS/HTML/JS埋め込み欄の有無を調査する。
// TAROの記憶「マイページのデザインをCSSでいじれる余地があった気がする」の裏取り。
//
// 絶対条件: HACOMONO管理画面の設定変更・保存は一切行わない。閲覧とスクショのみ。
// フォームは開いてよいが、保存/実行/公開系ボタンは押さない。
//
// 実行例:
//   cd scripts/fixed_qr
//   set -a; source /path/to/auto_sync/.env; set +a
//   node discover_design.mjs
//
// 出力: scripts/fixed_qr/discover_out/ (gitignore済み・PIIはレポートに書かない)

import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const OUT_DIR = 'discover_out';
fs.mkdirSync(OUT_DIR, { recursive: true });

const KEYWORDS = [
  'CSS', 'css', 'カスタム', 'custom', 'スクリプト', 'script', 'HTML',
  'テーマ', 'theme', 'デザイン', 'design', 'バナー', 'banner', 'ロゴ', 'logo',
];

async function saveHtml(page, name) {
  fs.writeFileSync(`${OUT_DIR}/${name}.html`, await page.content(), 'utf-8');
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
  } catch (e) {
    console.log(`[shot] ${name} failed: ${e && e.message ? e.message : e}`);
  }
}

function grepKeywords(html) {
  const hits = {};
  for (const kw of KEYWORDS) {
    // 出現回数のみ数える (前後文脈は別途スニペット抽出で確認)
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const m = html.match(re);
    if (m && m.length > 0) hits[kw] = m.length;
  }
  return hits;
}

// キーワード周辺のテキストスニペットを抽出 (ラベル・注意書きの原文確認用)
function extractSnippets(html, keyword, radius = 60) {
  const snippets = [];
  let idx = 0;
  const lower = html;
  while (snippets.length < 5) {
    const found = lower.indexOf(keyword, idx);
    if (found === -1) break;
    const start = Math.max(0, found - radius);
    const end = Math.min(lower.length, found + keyword.length + radius);
    let snip = lower.slice(start, end).replace(/\s+/g, ' ');
    snippets.push(snip);
    idx = found + keyword.length;
  }
  return snippets;
}

console.log('=== discover_design.mjs 開始 (保存/公開設定は一切変更しません) ===');

const { browser, page } = await launchAndLogin();

const report = {
  sidebarLinks: [],
  visitedPages: [],
  keywordHitSummary: {},
  widgetTypeOptions: null,
  memberSiteTop: null,
};

try {
  // ============================================================
  // 0. ダッシュボードでサイドバーの全メニューを抽出 (href + ラベル)
  // ============================================================
  console.log('\n--- 0. ダッシュボードのサイドバー全メニュー抽出 ---');
  await page.goto('https://boom-admin.hacomono.jp/#/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2000);
  await shot(page, '00_dashboard');
  await saveHtml(page, '00_dashboard');

  // サイドバーらしき領域のリンクを広めに拾う (nav, aside, .sidebar, .menu 等の候補を横断)
  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors
      .map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim() }))
      .filter((l) => l.href && l.href.startsWith('#/'));
  });
  // 重複除去
  const seen = new Set();
  const uniqueLinks = [];
  for (const l of links) {
    const key = `${l.href}|${l.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueLinks.push(l);
  }
  report.sidebarLinks = uniqueLinks;
  fs.writeFileSync(`${OUT_DIR}/sidebar_links.json`, JSON.stringify(uniqueLinks, null, 2), 'utf-8');
  console.log(`サイドバー(表示中)リンク数: ${uniqueLinks.length}`);
  for (const l of uniqueLinks) console.log(`  ${l.href}  "${l.text}"`);

  // サイドバーの大分類(システム/マスタ/運営 等)を展開してサブメニューを出す必要がある場合に備え、
  // 折りたたみメニューらしきものをクリックして展開を試みる (アコーディオン想定)。
  console.log('\n--- 0b. サイドバーの折りたたみメニューを展開してリンクを再抽出 ---');
  const menuHeaderCandidates = ['システム', 'マスタ', '運営', 'メンバー', 'ウィジェット', 'アンケート', 'お知らせ', '予約', '決済'];
  for (const label of menuHeaderCandidates) {
    const loc = page.locator(`text=${label}`).first();
    const count = await page.locator(`text=${label}`).count();
    if (count >= 1) {
      try {
        await loc.click({ timeout: 3000 });
        await page.waitForTimeout(500);
      } catch (e) {
        // クリック不可(リンクとして直接遷移する等)は無視
      }
    }
  }
  await page.waitForTimeout(1000);
  const links2 = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors
      .map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim() }))
      .filter((l) => l.href && l.href.startsWith('#/'));
  });
  for (const l of links2) {
    const key = `${l.href}|${l.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueLinks.push(l);
  }
  report.sidebarLinks = uniqueLinks;
  fs.writeFileSync(`${OUT_DIR}/sidebar_links.json`, JSON.stringify(uniqueLinks, null, 2), 'utf-8');
  await shot(page, '00b_dashboard_expanded');
  await saveHtml(page, '00b_dashboard_expanded');
  console.log(`展開後リンク数(累計): ${uniqueLinks.length}`);
  for (const l of uniqueLinks) console.log(`  ${l.href}  "${l.text}"`);

  // ============================================================
  // 1. system/master/operation 配下 + settings下部・詳細設定リンクを虱潰しに巡回
  // ============================================================
  console.log('\n--- 1. system/master/operation 配下ページを巡回 ---');

  // まず既知の settings タブ(前回調査済み)は再訪して「下部・アコーディオン・詳細設定リンク」を重点確認
  const settingsTabs = ['registration-contract', 'reservation', 'access-checkin', 'purchase', 'mail', 'security', 'others'];
  const candidateHrefs = new Set();
  for (const tab of settingsTabs) candidateHrefs.add(`#/system/settings/${tab}`);

  // サイドバーから拾った system/master/operation 配下の href も候補に追加
  for (const l of uniqueLinks) {
    if (/^#\/(system|master|operation)\//.test(l.href)) {
      candidateHrefs.add(l.href);
    }
  }

  console.log(`巡回候補URL数: ${candidateHrefs.size}`);
  console.log(JSON.stringify([...candidateHrefs], null, 2));

  let pageNo = 1;
  for (const href of candidateHrefs) {
    const url = `https://boom-admin.hacomono.jp/${href}`;
    const safeName = href.replace(/[^a-zA-Z0-9]/g, '_');
    console.log(`\n[${pageNo}] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    } catch (e) {
      console.log(`  goto失敗: ${e.message}`);
      pageNo++;
      continue;
    }
    await page.waitForTimeout(1200);

    // アコーディオン/「詳細設定」リンクらしきものを展開してからHTML取得
    const expandCandidates = ['詳細設定', 'もっと見る', '詳細', 'アコーディオン', '+', '展開'];
    for (const label of expandCandidates) {
      const loc = page.locator(`text=${label}`);
      const c = await loc.count();
      if (c >= 1 && c <= 5) {
        try {
          await loc.first().click({ timeout: 1500 });
          await page.waitForTimeout(400);
        } catch {}
      }
    }

    await shot(page, `01_${String(pageNo).padStart(2, '0')}_${safeName}`);
    await saveHtml(page, `01_${String(pageNo).padStart(2, '0')}_${safeName}`);
    const html = await page.content();
    const hits = grepKeywords(html);
    report.keywordHitSummary[href] = hits;
    report.visitedPages.push({ href, finalUrl: page.url(), keywordHits: hits });
    console.log(`  到達URL: ${page.url()}`);
    console.log(`  keyword hits: ${JSON.stringify(hits)}`);

    // ヒットがあれば周辺スニペットを保存 (CSS/カスタム/デザイン系を優先)
    const priorityKw = ['CSS', 'カスタム', 'custom', 'スクリプト', 'テーマ', 'デザイン', 'design', 'バナー', 'banner', 'ロゴ', 'logo'];
    for (const kw of priorityKw) {
      if (hits[kw]) {
        const snippets = extractSnippets(html, kw);
        if (snippets.length > 0) {
          fs.writeFileSync(
            `${OUT_DIR}/snippets_${safeName}_${kw.replace(/[^a-zA-Z0-9]/g, '')}.json`,
            JSON.stringify(snippets, null, 2),
            'utf-8'
          );
          console.log(`  [snippet] "${kw}" 周辺テキスト(先頭1件): ${snippets[0]}`);
        }
      }
    }
    pageNo++;
  }

  // ============================================================
  // 2. ウィジェット新規作成フォームでタイプ選択肢を確認 (保存はしない)
  // ============================================================
  console.log('\n--- 2. ウィジェット新規作成フォームのタイプ選択肢確認 ---');
  await page.goto('https://boom-admin.hacomono.jp/#/widget/widgets/register', {
    waitUntil: 'networkidle',
    timeout: 60_000,
  }).catch((e) => console.log(`widget register goto失敗: ${e.message}`));
  await page.waitForTimeout(1500);
  await shot(page, '02_widget_register_form');
  await saveHtml(page, '02_widget_register_form');

  // select/radio/tabなど「タイプ選択」らしきUIを広く収集
  const selectOptions = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('select').forEach((sel, i) => {
      const opts = Array.from(sel.options).map((o) => o.textContent.trim());
      results.push({ kind: 'select', index: i, options: opts });
    });
    document.querySelectorAll('[role="radio"], input[type="radio"]').forEach((el, i) => {
      const label = el.closest('label')?.textContent?.trim() || el.getAttribute('aria-label') || el.value || '';
      results.push({ kind: 'radio', index: i, label });
    });
    document.querySelectorAll('[role="tab"]').forEach((el, i) => {
      results.push({ kind: 'tab', index: i, label: el.textContent.trim() });
    });
    return results;
  });
  report.widgetTypeOptions = selectOptions;
  fs.writeFileSync(`${OUT_DIR}/widget_type_options.json`, JSON.stringify(selectOptions, null, 2), 'utf-8');
  console.log(`ウィジェットタイプ選択肢候補: ${JSON.stringify(selectOptions, null, 2)}`);

  // ============================================================
  // 3. 会員サイト(マイページ)トップの実物確認
  // ============================================================
  console.log('\n--- 3. マイページ(会員サイト)トップの実物確認 ---');
  try {
    await page.goto('https://boom.hacomono.jp/', { waitUntil: 'networkidle', timeout: 45_000 });
  } catch (e) {
    console.log(`会員サイトgoto失敗(タイムアウト等): ${e.message}`);
  }
  await page.waitForTimeout(2500);
  await shot(page, '03_member_site_top');
  await saveHtml(page, '03_member_site_top');
  console.log(`到達URL: ${page.url()}`);

  const isLoginPage = (await page.locator('input[type="password"]').count()) > 0;
  console.log(`ログイン画面が表示されたか: ${isLoginPage}`);

  if (!isLoginPage) {
    // 見出し・ラベル・バナーらしき画像/リンクを列挙 (PIIなし。UI構造のみ)
    const structure = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map((h) => h.textContent.trim()).filter(Boolean);
      const images = Array.from(document.querySelectorAll('img')).map((img) => ({
        alt: img.alt || '',
        src: (img.src || '').slice(0, 120),
        linked: !!img.closest('a'),
      }));
      const navTexts = Array.from(document.querySelectorAll('nav a, [class*="menu" i] a')).map((a) => a.textContent.trim()).filter(Boolean);
      return { headings, images, navTexts };
    });
    report.memberSiteTop = structure;
    fs.writeFileSync(`${OUT_DIR}/member_site_top_structure.json`, JSON.stringify(structure, null, 2), 'utf-8');
    console.log(`見出し: ${JSON.stringify(structure.headings)}`);
    console.log(`画像枠(alt/リンク有無): ${JSON.stringify(structure.images)}`);
    console.log(`ナビ/メニューテキスト: ${JSON.stringify(structure.navTexts)}`);
  } else {
    report.memberSiteTop = { note: 'ログイン画面が表示され、管理者セッションのままでは会員トップに到達できなかった' };
  }

  fs.writeFileSync(`${OUT_DIR}/design_investigation_report.json`, JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n=== done (設定変更/保存/公開切替は一切行っていません) ===');
} finally {
  await browser.close();
}
