// scripts/fixed_qr/discover_webhook.mjs
// 目的: HACOMONO管理画面に「Webhook(イベント通知)」または「API連携」機能があるかを
//   読み取り専用で調査する。アンケート回答時の即時通知(現状は15分おきのポーリング)の
//   代替手段になり得るかを判定するための事実収集のみ行う。
//
// 絶対条件:
//   - 設定変更・保存・申込・購入・トークン発行/失効は一切しない。閲覧とスクショのみ。
//   - 推測でURLを直接gotoしない。既知の安全なURL(#/system/配下・#/enquete/enquetes/10)を
//     起点に、画面上のメニュー/タブリンクのみを辿る。
//   - メンバー詳細・チェックイン履歴・予約者リスト等のPII画面に着いたら即離脱。
//   - このアプリのSPAは、どのページのDOMにも「システム通知(直近チェックイン)」パネルが
//     非表示状態で埋め込まれており、page.content()やinnerTextでPII(会員氏名)が
//     漏れることが判明している。そのため本スクリプトは生HTML保存を一切行わず、
//     スコープを絞ったテキスト抽出+PII行フィルタのみを出力する。
//
// 実行例:
//   cd scripts/fixed_qr
//   set -a; source /path/to/auto_sync/.env; set +a
//   node discover_webhook.mjs
//
// 出力: scripts/fixed_qr/discover_out/webhook_investigation/ (gitignore済み)

import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const OUT_DIR = 'discover_out/webhook_investigation';
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = 'https://boom-admin.hacomono.jp';
const SAFE_PREFIXES = [`${BASE}/#/system/`, `${BASE}/#/enquete/`, `${BASE}/#/analysis/`];

function isSafeUrl(url) {
  return SAFE_PREFIXES.some((p) => url.startsWith(p));
}

// PIIっぽい行(氏名+「さんが」「チェックイン」等)を除去した上でテキストを保存する。
const PII_LINE_PATTERNS = [
  /さんが.*(チェックイン|できませんでした)/,
  /チェックインしました/,
  /^\d{2}-\d{2} \d{2}:\d{2}$/, // 通知パネルの日時行
];
function filterPiiLines(lines) {
  return lines.filter((l) => !PII_LINE_PATTERNS.some((re) => re.test(l)));
}

async function extractScopedText(page, selector) {
  const raw = await page
    .locator(selector)
    .first()
    .innerText()
    .catch(() => '');
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return filterPiiLines(lines);
}

// 'text=' セレクタが取りこぼすヘッダー内のボタン/リンク(アイコン+テキスト構成)向けに、
// innerTextが完全一致する候補をbutton/a/[role="button"]から総当りで探す。
async function clickByExactText(page, label) {
  const candidates = page.locator('button, a, [role="button"]');
  const count = await candidates.count();
  for (let i = 0; i < count; i++) {
    const loc = candidates.nth(i);
    const text = (await loc.innerText().catch(() => '')).trim();
    if (text === label) {
      await loc.click();
      return true;
    }
  }
  return false;
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
  } catch (e) {
    console.log(`[shot] ${name} failed: ${e && e.message ? e.message : e}`);
  }
}

function saveText(name, lines) {
  fs.writeFileSync(`${OUT_DIR}/${name}.txt`, lines.join('\n'), 'utf-8');
}

function grepKeywords(lines, keywords) {
  const hits = [];
  for (const l of lines) {
    if (keywords.some((kw) => l.toLowerCase().includes(kw.toLowerCase()))) hits.push(l);
  }
  return hits;
}

const KEYWORDS = ['webhook', 'Webhook', 'API', 'ウェブフック', '外部連携', 'コールバック', 'callback'];

console.log('=== discover_webhook.mjs 開始 (読み取り専用: 設定変更・保存・発行は一切しません) ===');
const { browser, page } = await launchAndLogin();

const report = {};

try {
  // ============================================================
  // 1. 「システム」配下「ログ」グループの「トークン」ページ (#/system/tokens/)
  //    判明済み: このページは会員のセッション/認証トークン一覧(氏名+トークン値の表)であり、
  //    PIIそのもの。発行/失効ボタンは押さない上に、HTML保存・スクショ・本文抽出も一切行わず、
  //    タブ見出し(カテゴリ名)だけを見て即離脱する(事故防止ルール準拠)。
  // ============================================================
  console.log('\n--- 1. トークンページ (#/system/tokens/) [PII含むため見出しのみ確認し即離脱] ---');
  await page.goto(`${BASE}/#/system/tokens/`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (!isSafeUrl(page.url())) {
    console.log(`[中断] 想定外URL: ${page.url()}`);
  } else {
    console.log(`到達URL: ${page.url()}`);
    console.log('判明: 会員の認証/セッショントークン一覧(氏名+トークン値のテーブル)。PIIのため保存・スクショはしない。');
    console.log('外部API向けのアクセストークン発行UIではない(タブ: メンバーサイト/管理サイト/仮登録/メールアドレス変更/メールアドレス確認/パスワードリセット/削除)。');
    report.tokens_page = {
      url: page.url(),
      note: 'PII(会員氏名+トークン値)を含むページのため内容は保存していない。会員ログイン/仮登録/PWリセット等のセッショントークン一覧であり、外部API/Webhook用のトークン発行機能ではないと判断。',
      keywordHits: [],
    };
  }

  // ============================================================
  // 2. アドオン一覧の全項目名+説明文 (Webhook/API系アドオンの有無を再確認。申込ボタンは押さない)
  // ============================================================
  console.log('\n--- 2. アドオン一覧 (#/system/addons/) ---');
  await page.goto(`${BASE}/#/system/addons/`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (isSafeUrl(page.url())) {
    await shot(page, '02_system_addons');
    const bodyLines = await extractScopedText(page, 'body');
    saveText('02_system_addons', bodyLines);
    const hits = grepKeywords(bodyLines, KEYWORDS);
    console.log(`アドオン一覧 行数: ${bodyLines.length}`);
    console.log(`キーワードヒット: ${JSON.stringify(hits)}`);
    report.addons_page = { url: page.url(), keywordHits: hits, bodyPreview: bodyLines.slice(0, 60) };
  }

  // ============================================================
  // 3. SSO / 決済代行サービス (念のためAPI/Webhook記載の有無だけ再確認)
  // ============================================================
  for (const [name, path] of [
    ['sso_config', '#/system/sso-config/'],
    ['payment_agent', '#/system/payment-agent/'],
    ['features', '#/system/features/'],
  ]) {
    console.log(`\n--- 3. ${name} (${path}) ---`);
    await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(1200);
    if (!isSafeUrl(page.url())) continue;
    const bodyLines = await extractScopedText(page, 'body');
    const hits = grepKeywords(bodyLines, KEYWORDS);
    console.log(`キーワードヒット: ${JSON.stringify(hits)}`);
    report[`${name}_page`] = { url: page.url(), keywordHits: hits };
  }

  // ============================================================
  // 4. アンケート設定タブの「通知メール」設定を再確認 (チェックボックスはクリックしない・閲覧のみ)
  // ============================================================
  console.log('\n--- 4. アンケート設定タブ (#/enquete/enquetes/10) 「通知メール」設定 ---');
  await page.goto(`${BASE}/#/enquete/enquetes/10`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  // 「アンケート設定」タブをクリック(結果/回答一覧タブではなく設定タブに留まる)
  const settingsTabSel = 'a:has-text("アンケート設定"), [role="tab"]:has-text("アンケート設定")';
  const settingsTabCount = await page.locator(settingsTabSel).count();
  console.log(`アンケート設定タブ candidate count=${settingsTabCount}`);
  if (settingsTabCount >= 1) {
    await page.locator(settingsTabSel).first().click();
    await page.waitForTimeout(1200);
  }
  if (isSafeUrl(page.url())) {
    // 回答一覧を含まない「基本設定」カード部分だけをスコープしてPIIを避ける
    const formSel = 'form, .m_form, main';
    const bodyLines = await extractScopedText(page, formSel);
    saveText('03_enquete_settings_tab', bodyLines);
    await shot(page, '03_enquete_settings_tab');
    const notifIdx = bodyLines.findIndex((l) => l.includes('通知メール'));
    const notifContext = notifIdx >= 0 ? bodyLines.slice(Math.max(0, notifIdx - 1), notifIdx + 3) : [];
    console.log(`「通知メール」設定の周辺テキスト: ${JSON.stringify(notifContext)}`);
    report.enquete_settings_tab = { url: page.url(), notifContext };
  }

  // ============================================================
  // 5. ヘルプメニュー / アップデート情報 に API・Webhook の記載がないか
  //    (実行結果: いずれもヘッダーのドロップダウンで、クリックしてもURLは変化しない。
  //     「アップデート情報」はクリックできたがボディにキーワードヒットなし。
  //     「ヘルプ」はbutton/a/[role="button"]候補内に完全一致要素が見つからずクリック不可だった。
  //     ヘッダーの「？ヘルプ」はスクショで視認できる限り外部サポートサイトへのドロップダウンと見られる)
  // ============================================================
  console.log('\n--- 5. ヘルプメニュー ---');
  await page.goto(`${BASE}/#/system/addons/`, { waitUntil: 'networkidle', timeout: 60_000 }); // 既知の安全画面に戻ってからメニュー操作
  await page.waitForTimeout(1000);
  const helpClicked = await clickByExactText(page, 'ヘルプ');
  console.log(`ヘルプメニュー クリック=${helpClicked}`);
  if (helpClicked) {
    await page.waitForTimeout(1500);
    if (isSafeUrl(page.url()) || page.url().includes('boom-admin.hacomono.jp')) {
      const bodyLines = await extractScopedText(page, 'body');
      const hits = grepKeywords(bodyLines, KEYWORDS);
      console.log(`ヘルプ画面 到達URL: ${page.url()}`);
      console.log(`キーワードヒット: ${JSON.stringify(hits)}`);
      saveText('04_help_menu', bodyLines.slice(0, 100));
      await shot(page, '04_help_menu');
      report.help_menu = { url: page.url(), keywordHits: hits };
    } else {
      console.log(`[中断] ヘルプが想定外の外部ドメインへ遷移: ${page.url()}`);
      report.help_menu = { url: page.url(), note: 'external domain, not investigated further (read-only policy)' };
    }
  }

  console.log('\n--- 5b. アップデート情報 ---');
  await page.goto(`${BASE}/#/system/addons/`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1000);
  const updateClicked = await clickByExactText(page, 'アップデート情報');
  console.log(`アップデート情報 クリック=${updateClicked}`);
  if (updateClicked) {
    await page.waitForTimeout(1500);
    const bodyLines = await extractScopedText(page, 'body');
    const hits = grepKeywords(bodyLines, KEYWORDS);
    console.log(`アップデート情報 到達URL: ${page.url()}`);
    console.log(`キーワードヒット: ${JSON.stringify(hits)}`);
    saveText('05_update_info', bodyLines.slice(0, 150));
    await shot(page, '05_update_info');
    report.update_info = { url: page.url(), keywordHits: hits };
  }

  fs.writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n=== done (設定変更・保存・トークン発行・申込は一切行っていません) ===');
} finally {
  await browser.close();
}
