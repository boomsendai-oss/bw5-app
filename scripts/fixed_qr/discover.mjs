// scripts/fixed_qr/discover.mjs
// メンバー詳細→セキュリティタブのDOM調査 (ローカルdry-run)
// 絶対条件: HACOMONOに一切変更を加えない。「保存する」ボタンは押さない。
//
// 実行例:
//   cd scripts/fixed_qr
//   set -a; source /path/to/auto_sync/.env; set +a
//   MEMBER_ID=<調査対象のメンバーID> node discover.mjs
//
// 出力: scripts/fixed_qr/discover_out/ 以下にスクショ(PNG)とHTML
// コンソールにはPII(氏名・メール等)を一切出さない。

import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const MEMBER_ID = process.env.MEMBER_ID;
if (!MEMBER_ID) throw new Error('MEMBER_ID を指定してください (例: MEMBER_ID=13 node discover.mjs)');

const OUT_DIR = 'discover_out';
fs.mkdirSync(OUT_DIR, { recursive: true });

// 候補セレクタの一意性を記録する。保存ボタン等はここでcount()するだけでクリックはしない。
const selectorLog = [];
async function recordCount(page, label, selector) {
  let count = -1;
  let error = null;
  try {
    count = await page.locator(selector).count();
  } catch (e) {
    error = String(e && e.message ? e.message : e);
  }
  const entry = { label, selector, count, error };
  selectorLog.push(entry);
  console.log(`[selector] ${label}: "${selector}" => count=${count}${error ? ` error=${error}` : ''}`);
  return count;
}

async function saveHtml(page, name) {
  const html = await page.content();
  fs.writeFileSync(`${OUT_DIR}/${name}.html`, html, 'utf-8');
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
}

console.log('=== discover.mjs 開始 (保存ボタンは押しません) ===');
console.log(`MEMBER_ID=${MEMBER_ID}`);

const { browser, page } = await launchAndLogin();

try {
  // --- 1. メンバー詳細の直URL形式を試す ---
  // 注: #/operation/members/{id} は404。#/member/members/{id}/ が正しい形式 (要調査で判明)
  const detailUrl = `https://boom-admin.hacomono.jp/#/member/members/${MEMBER_ID}/`;
  console.log(`直URLで開く: ${detailUrl}`);
  await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, '01_member_detail');
  await saveHtml(page, '01_member_detail');
  console.log(`到達後のURL: ${page.url()}`);

  const notFoundLikely =
    page.url().includes('login') ||
    (await page.locator('text=見つかりません').count()) > 0 ||
    (await page.locator('text=404').count()) > 0 ||
    (await page.locator('text=エラー').count()) > 0;
  console.log(`直URL到達判定 (404/エラー/未検出っぽい兆候あり): ${notFoundLikely}`);

  if (notFoundLikely) {
    console.log('直URLでは404相当。運営メニュー→メンバー→検索の導線を試します。');

    // サイドバーの「メンバー」リンクをクリック
    const memberMenuCandidates = ['text=メンバー', 'a:has-text("メンバー")', 'nav >> text=メンバー'];
    let memberMenuClicked = false;
    for (const sel of memberMenuCandidates) {
      const count = await page.locator(sel).count();
      if (count >= 1) {
        console.log(`メンバーメニューをクリック: ${sel} (count=${count})`);
        await page.locator(sel).first().click();
        memberMenuClicked = true;
        break;
      }
    }
    console.log(`memberMenuClicked=${memberMenuClicked}`);
    await page.waitForTimeout(1500);
    await shot(page, '01b_member_list');
    await saveHtml(page, '01b_member_list');
    console.log(`メンバー一覧URL: ${page.url()}`);

    // 検索欄にMEMBER_IDを入れてみる
    const searchInputCandidates = [
      'input[type="text"]',
      'input[placeholder*="検索"]',
      'input[placeholder*="ID"]',
      'input[placeholder*="会員番号"]',
    ];
    let searched = false;
    for (const sel of searchInputCandidates) {
      const count = await page.locator(sel).count();
      await recordCount(page, 'memberSearchInput candidate', sel);
      if (count >= 1 && !searched) {
        console.log(`検索欄にMEMBER_IDを入力: ${sel}`);
        await page.locator(sel).first().fill(MEMBER_ID);
        await page.keyboard.press('Enter');
        searched = true;
      }
    }
    console.log(`searched=${searched}`);
    await page.waitForTimeout(2000);
    await shot(page, '01c_member_search_result');
    await saveHtml(page, '01c_member_search_result');

    if (searched) {
      // 検索結果の最初の行/リンクをクリックして詳細へ
      const resultRowCandidates = [
        `a[href="#/member/members/${MEMBER_ID}/"]`,
        'table tbody tr',
        '.member-list-row',
        'tbody tr a',
        'a[href*="member"]',
      ];
      let rowClicked = false;
      for (const sel of resultRowCandidates) {
        const count = await page.locator(sel).count();
        await recordCount(page, 'memberSearchResultRow candidate', sel);
        if (count >= 1 && !rowClicked) {
          console.log(`検索結果の最初の行をクリック: ${sel}`);
          await page.locator(sel).first().click();
          rowClicked = true;
        }
      }
      console.log(`rowClicked=${rowClicked}`);
      await page.waitForTimeout(2000);
      await shot(page, '01d_member_detail_via_search');
      await saveHtml(page, '01d_member_detail_via_search');
      console.log(`検索経由で到達したURL: ${page.url()}`);
    }
  }

  // --- 2. 「セキュリティ」タブのセレクタ候補を調べる ---
  const securityTabCandidates = [
    'text=セキュリティ',
    'a:has-text("セキュリティ")',
    '[role="tab"]:has-text("セキュリティ")',
    'li:has-text("セキュリティ")',
    '.tab:has-text("セキュリティ")',
  ];
  for (const sel of securityTabCandidates) {
    await recordCount(page, 'securityTab candidate', sel);
  }

  // 一番有望そうな候補(role=tab or a)をクリックしてみる。まずrole=tabを優先。
  let securityTabClicked = false;
  for (const sel of ['[role="tab"]:has-text("セキュリティ")', 'a:has-text("セキュリティ")', 'text=セキュリティ']) {
    const count = await page.locator(sel).count();
    if (count === 1) {
      console.log(`セキュリティタブをクリック: ${sel}`);
      await page.locator(sel).click();
      securityTabClicked = true;
      break;
    } else if (count > 1) {
      console.log(`セキュリティタブ候補が複数ヒット(${count}件)のためfirst()でクリック: ${sel}`);
      await page.locator(sel).first().click();
      securityTabClicked = true;
      break;
    }
  }
  console.log(`securityTabClicked=${securityTabClicked}`);

  await page.waitForTimeout(1500);
  await shot(page, '02_security_tab');
  await saveHtml(page, '02_security_tab');

  // --- 3. 「新規登録」ボタン(メンバーコード)のセレクタ候補 ---
  const newRegisterCandidates = [
    'button:has-text("新規登録")',
    'text=新規登録',
    'a:has-text("新規登録")',
    'button:has-text("登録")',
  ];
  for (const sel of newRegisterCandidates) {
    await recordCount(page, 'newRegisterButton candidate', sel);
  }

  // --- 6. 既に固定コード発行済みの場合の見分け方: 一覧のセクション見出しを調べる ---
  const existingCodeSectionCandidates = [
    'text=有効になったメンバーコード',
    'text=固定メンバーコード用',
    'text=メンバーコード',
    '.member-code-list',
    '[data-testid*="member-code"]',
  ];
  for (const sel of existingCodeSectionCandidates) {
    await recordCount(page, 'existingCodeSection candidate', sel);
  }

  // --- 7. QR表示要素の見当 (保存はしないので既存発行済みのQRがあれば拾えるかだけ確認) ---
  const qrCandidates = ['canvas', 'img[src*="qr" i]', 'svg', 'img[alt*="QR" i]'];
  for (const sel of qrCandidates) {
    await recordCount(page, 'qr element candidate', sel);
  }

  // --- 4/5. 新規登録ボタンをクリックしてダイアログを観察 (保存は絶対に押さない) ---
  let dialogOpened = false;
  for (const sel of ['button:has-text("新規登録")', 'text=新規登録']) {
    const count = await page.locator(sel).count();
    if (count >= 1) {
      console.log(`新規登録ボタンをクリック: ${sel} (count=${count})`);
      await page.locator(sel).first().click();
      dialogOpened = true;
      break;
    }
  }
  console.log(`dialogOpened=${dialogOpened}`);

  if (dialogOpened) {
    await page.waitForTimeout(1500);
    await shot(page, '03_new_code_dialog');
    await saveHtml(page, '03_new_code_dialog');

    // 「固定メンバーコード用」選択UIの候補 (ラジオ/セレクト/タブ)
    const fixedCodeUiCandidates = [
      'text=固定メンバーコード用',
      'input[type="radio"]',
      'select',
      '[role="radio"]',
      '[role="tab"]',
      'label:has-text("固定")',
    ];
    for (const sel of fixedCodeUiCandidates) {
      await recordCount(page, 'fixedCodeUI candidate', sel);
    }

    // 「保存する」ボタンの存在・一意性のみ確認。絶対にクリックしない。
    const saveButtonCandidates = ['button:has-text("保存する")', 'button:has-text("保存")', 'text=保存する'];
    for (const sel of saveButtonCandidates) {
      await recordCount(page, 'SAVE BUTTON (DO NOT CLICK) candidate', sel);
    }

    await shot(page, '04_new_code_dialog_before_close');
    await saveHtml(page, '04_new_code_dialog_before_close');

    // ダイアログを閉じる: Escapeキーを試し、ダメならキャンセル/閉じるボタンを試す。
    console.log('ダイアログを閉じます (Escapeキー)。保存ボタンはクリックしていません。');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    const stillOpen = (await page.locator('button:has-text("保存する")').count()) > 0;
    if (stillOpen) {
      // 判明した実装: これはモーダルではなく画面遷移(SPAルート)による作成フォーム。
      // Escapeでは閉じない。「戻る」リンクで戻る (保存は絶対にクリックしない)。
      console.log('Escapeでは閉じない実装(モーダルでなく画面遷移)。「戻る」リンクで戻ります。');
      for (const sel of ['a:has-text("戻る")', 'text=戻る', 'button:has-text("キャンセル")', 'button:has-text("閉じる")']) {
        const count = await page.locator(sel).count();
        if (count >= 1) {
          console.log(`戻る/閉じるをクリック: ${sel}`);
          await page.locator(sel).first().click();
          break;
        }
      }
      await page.waitForTimeout(800);
    }
    await shot(page, '05_after_close_dialog');
    await saveHtml(page, '05_after_close_dialog');
    console.log(`新規登録フォームを離脱後のURL: ${page.url()}`);
  }

  // --- 7(補足). 既に発行済みの固定メンバーコードがあれば、それを開いてQR表示要素を確認する ---
  // (保存は一切行わない。既存エントリの閲覧のみ)
  const existingFixedCodeLink = 'a:has-text("固定メンバーコード用")';
  const existingCount = await page.locator(existingFixedCodeLink).count();
  console.log(`既存の「固定メンバーコード用」エントリ数: ${existingCount}`);
  if (existingCount >= 1) {
    console.log('既存の固定メンバーコードエントリ(1件目)を開いて閲覧します(保存はしません)。');
    await page.locator(existingFixedCodeLink).first().click();
    await page.waitForTimeout(1500);
    await shot(page, '06_existing_code_view');
    await saveHtml(page, '06_existing_code_view');
    console.log(`既存コード閲覧URL: ${page.url()}`);

    const qrCandidatesExisting = ['canvas', 'img[src*="qr" i]', 'svg', 'img[alt*="QR" i]', 'img[alt*="qr" i]'];
    for (const sel of qrCandidatesExisting) {
      await recordCount(page, 'qr element (existing code view) candidate', sel);
    }
  }

  // --- 8. ML001 CSVの「メンバーID」列とURLのidの一致確認は discover.mjs 外(呼び出し側)で実施済み ---
  // (CSVから取得したIDをそのままMEMBER_IDとして渡し、直URLで到達できたかどうかで判定する)

  fs.writeFileSync(`${OUT_DIR}/selector_log.json`, JSON.stringify(selectorLog, null, 2), 'utf-8');

  console.log('=== done (保存は押していません) ===');
} finally {
  await browser.close();
}
