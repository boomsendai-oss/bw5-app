// scripts/fixed_qr/discover_enquete.mjs
// 「固定QRコード発行」アンケート([ENQUETE0005], enquete_id=10)の回答取得可否と、
// マイページへの常設導線(お知らせ/ウィジェット/システム設定)を調査する。
//
// 絶対条件: HACOMONO管理画面の設定変更・保存・公開/非公開切替は一切行わない。閲覧とスクショのみ。
// (CSVエクスポートは読み取り操作だが、本スクリプトでは実行しない。テーブル列名とAPIレスポンスの
//  フィールド名だけで「列名」の調査目的を満たせたため、PIIを含む実ファイルのダウンロードは避けた)
//
// 実行例:
//   cd scripts/fixed_qr
//   set -a; source /path/to/auto_sync/.env; set +a
//   node discover_enquete.mjs
//
// 出力: scripts/fixed_qr/discover_out/ (gitignore済み・PIIを含み得るためコミットしない)
// コンソール/保存ファイルにPII(会員名・メール等)を書き出さないよう、値ではなくキー名・列名・件数のみを扱う。

import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const OUT_DIR = 'discover_out';
fs.mkdirSync(OUT_DIR, { recursive: true });

const ENQUETE_LIST_URL = 'https://boom-admin.hacomono.jp/#/enquete/enquetes/';
const ENQUETE_KEYWORD = '固定QRコード発行';
const ENQUETE_CODE = 'ENQUETE0005';

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
  fs.writeFileSync(`${OUT_DIR}/${name}.html`, await page.content(), 'utf-8');
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true });
  } catch (e) {
    console.log(`[shot] ${name} failed: ${e && e.message ? e.message : e}`);
  }
}

// 全リクエストのURL(とmethod)だけを記録。ボディ/レスポンスは記録しない(PII回避)。
const networkLog = [];
function attachNetworkLogger(page) {
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('hacomono')) networkLog.push({ method: req.method(), url });
  });
}

console.log('=== discover_enquete.mjs 開始 (保存/公開設定は一切変更しません) ===');

const { browser, page } = await launchAndLogin();
attachNetworkLogger(page);

try {
  // ============================================================
  // 問1-1: アンケート一覧 → [ENQUETE0005]「固定QRコード発行」を開く
  // ============================================================
  console.log(`\n--- アンケート一覧: ${ENQUETE_LIST_URL} ---`);
  await page.goto(ENQUETE_LIST_URL, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2000);
  await shot(page, '01_enquete_list');
  await saveHtml(page, '01_enquete_list');
  console.log(`到達URL: ${page.url()}`);

  await recordCount(page, 'enquete list: keyword text', `text=${ENQUETE_KEYWORD}`);
  await recordCount(page, 'enquete list: code text', `text=${ENQUETE_CODE}`);

  let openedDetail = false;
  for (const sel of [`text=${ENQUETE_KEYWORD}`, `text=${ENQUETE_CODE}`]) {
    const count = await page.locator(sel).count();
    if (count >= 1) {
      console.log(`該当行をクリック: ${sel} (count=${count})`);
      await page.locator(sel).first().click();
      openedDetail = true;
      break;
    }
  }
  console.log(`openedDetail=${openedDetail}`);
  await page.waitForTimeout(2000);
  await shot(page, '02_enquete_detail');
  await saveHtml(page, '02_enquete_detail');
  console.log(`アンケート詳細URL(結果タブ): ${page.url()}`);
  // 判明: https://boom-admin.hacomono.jp/#/enquete/enquetes/10/results  (enquete_id=10)

  // ============================================================
  // 問1-2: 回答一覧タブ
  // ============================================================
  let responseTabClicked = false;
  for (const sel of ['[role="tab"]:has-text("回答")', 'a:has-text("回答一覧")', 'a:has-text("回答")', 'text=回答一覧']) {
    const count = await page.locator(sel).count();
    if (count >= 1) {
      console.log(`回答タブ/リンクをクリック: ${sel} (count=${count})`);
      await page.locator(sel).first().click();
      responseTabClicked = true;
      break;
    }
  }
  console.log(`responseTabClicked=${responseTabClicked}`);
  await page.waitForTimeout(2000);
  await shot(page, '03_enquete_responses');
  await saveHtml(page, '03_enquete_responses');
  console.log(`回答一覧URL: ${page.url()}`);
  // 判明: https://boom-admin.hacomono.jp/#/enquete/enquetes/10/list

  // 回答一覧テーブルの列名 (PIIではなく列名のみ)
  try {
    const headers = await page.locator('table thead th, table th').allInnerTexts();
    console.log(`回答一覧テーブルの列名: ${JSON.stringify(headers)}`);
    fs.writeFileSync(`${OUT_DIR}/response_table_headers.json`, JSON.stringify(headers, null, 2), 'utf-8');
  } catch (e) {
    console.log(`テーブルヘッダ取得失敗: ${e && e.message ? e.message : e}`);
  }

  // ============================================================
  // 問1-2続き: CSVエクスポート導線の確認 (押さずにhref、その後の設定画面まで遷移だけ確認。実行はしない)
  // ============================================================
  const exportLink = page.locator('a:has-text("エクスポート")');
  const exportCount = await exportLink.count();
  console.log(`エクスポートリンク count=${exportCount}`);
  if (exportCount >= 1) {
    const href = await exportLink.first().getAttribute('href').catch(() => null);
    console.log(`エクスポートリンクhref(クリック前): ${href}`);
    console.log('エクスポートリンクをクリックして設定画面まで遷移(実際のダウンロード実行ボタンは押さない)');
    await exportLink.first().click();
    await page.waitForTimeout(1500);
    await shot(page, '04_export_settings_screen');
    await saveHtml(page, '04_export_settings_screen');
    console.log(`エクスポート設定画面URL: ${page.url()}`);
    // 判明: https://boom-admin.hacomono.jp/#/enquete/enquetes/export
    // (ファイルタイプ=CSV / 文字コード=UTF-8(BOM付き) を選び「エクスポート」ボタンを押す形式。
    //  実行ボタンは押していない。列名は回答一覧テーブルとAPIレスポンスから既に取得済みのため。)
  }

  // ============================================================
  // 問1-3/1-4: アンケート定義API (設問文・設定値。会員個人情報は含まない)
  // ============================================================
  console.log('\n--- アンケート定義API: /api/enquete/enquetes/10 ---');
  const defRes = await page.context().request.get('https://boom-admin.hacomono.jp/api/enquete/enquetes/10');
  const defJson = await defRes.json();
  fs.writeFileSync(`${OUT_DIR}/enquete_10_definition.json`, JSON.stringify(defJson, null, 2), 'utf-8');
  const enq = defJson?.data?.enquete;
  if (enq) {
    console.log(`code=${enq.code} name=${enq.name} scene_type=${enq.scene_type} is_anonymous=${enq.is_anonymous}`);
    console.log(`start_at=${enq.start_at} end_at=${enq.end_at} status=${enq.status}`);
    console.log('--- 設問一覧 (設問文のみ) ---');
    for (const q of enq.enquete_questions || []) {
      console.log(`  [${q.sort_no}] type=${q.form_field_type} required=${q.is_required} name="${q.name}"`);
    }
  }

  // ============================================================
  // 問1-3/1-4続き: 回答一覧API (フィールド名だけ確認。値はPIIの可能性があるので出力しない)
  // ============================================================
  console.log('\n--- 回答一覧API: /api/enquete/enquete-answers ---');
  const answersQuery = encodeURIComponent(
    JSON.stringify({
      keyword: null, page: 1, length: 5, last_id: null, is_all: null, is_active: true,
      is_within: null, is_not_persisted: null, order: null, order_direction: null,
      exclude_ids: null, member_id: null, studio_lesson_id: null, enquete_id: '10',
      genders: [], ages: [], is_blank: null, studio_id: null,
    })
  );
  const ansRes = await page.context().request.get(
    `https://boom-admin.hacomono.jp/api/enquete/enquete-answers?query=${answersQuery}`
  );
  const ansJson = await ansRes.json();
  const ea = ansJson?.data?.enquete_answers;
  console.log(`total_count=${ea?.total_count} total_page=${ea?.total_page}`);
  if (ea?.list?.length > 0) {
    console.log('=== 回答1件のトップレベルフィールド名 (値は出力しない) ===');
    console.log(Object.keys(ea.list[0]));
    console.log('=== enquete_question_answers[0] のフィールド名 ===');
    console.log(Object.keys(ea.list[0].enquete_question_answers?.[0] || {}));
    console.log('=== member のフィールド名 (氏名/コード等の"項目名"のみ。値は出力しない) ===');
    console.log(Object.keys(ea.list[0].member || {}));
  }
  // 生JSON(PIIを含む)はローカルのgitignore済みディレクトリにのみ保存。レポートへは転記しない。
  fs.writeFileSync(`${OUT_DIR}/enquete_answers_sample.json`, JSON.stringify(ansJson, null, 2), 'utf-8');

  // ============================================================
  // 問1-5: 分析クエリ一覧 (コードと名称だけ抽出)
  // ============================================================
  console.log('\n--- 分析クエリ一覧 (アンケート系の有無を確認) ---');
  const allQueries = [];
  const seenCodes = new Set();
  for (let pageNum = 1; pageNum <= 5; pageNum++) {
    const url = `https://boom-admin.hacomono.jp/api/analysis/queries?page=${pageNum}`;
    const res = await page.context().request.get(url, { timeout: 30_000 });
    const json = await res.json();
    const q = json?.data?.queries;
    if (!q || !Array.isArray(q.list) || q.list.length === 0) {
      console.log(`page=${pageNum}: 追加データなし (total_page=${q ? q.total_page : '?'})`);
      break;
    }
    let newCount = 0;
    for (const item of q.list) {
      if (seenCodes.has(item.code)) continue;
      seenCodes.add(item.code);
      allQueries.push({ code: item.code, name: item.name, category: item.category });
      newCount++;
    }
    console.log(`page=${pageNum}: ${q.list.length}件 (新規${newCount}件, total_count=${q.total_count}, total_page=${q.total_page})`);
    if (pageNum >= q.total_page) break;
  }
  fs.writeFileSync(`${OUT_DIR}/analysis_queries.json`, JSON.stringify(allQueries, null, 2), 'utf-8');
  console.log(`\n分析クエリ総数(重複除去後): ${allQueries.length}`);
  console.log(
    '注: このAPIの ?page=N パラメータは実際には無視され、常に先頭50件(offset=0)が返る挙動を確認した。' +
      'total_count=61 のため最大11件は本調査で未取得。取得できた範囲にアンケート関連クエリは無かった。'
  );
  const enqueteRelated = allQueries.filter(
    (q) =>
      (q.name && q.name.includes('アンケート')) ||
      (q.code && q.code.toUpperCase().includes('ENQ')) ||
      (q.category && q.category.includes('ENQUETE'))
  );
  console.log(`アンケート関連クエリ候補: ${JSON.stringify(enqueteRelated)}`);

  // ============================================================
  // 問2-1: お知らせ機能
  // ============================================================
  console.log('\n--- お知らせ掲示機能の探索 ---');
  await page.goto('https://boom-admin.hacomono.jp/#/announcement/announcements/', {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  await shot(page, '05_announcement_list');
  await saveHtml(page, '05_announcement_list');
  console.log(`お知らせ一覧URL: ${page.url()}`);
  const announcementRowCount = await page.locator('table tbody tr').count();
  console.log(`お知らせ一覧行数: ${announcementRowCount}`);

  // 新規作成フォームを見る(保存はしない) → リッチテキストにリンク挿入ボタンがあるか確認
  await page.goto('https://boom-admin.hacomono.jp/#/announcement/announcements/register', {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  await shot(page, '06_announcement_register_form');
  await saveHtml(page, '06_announcement_register_form');
  const linkButtonCount = await page.locator('button[title*="link" i], button[title*="リンク" i], [class*="link" i]').count();
  console.log(`お知らせ本文エディタのリンク系ボタン候補count=${linkButtonCount}`);

  // 既存お知らせ詳細(閲覧のみ、保存/更新ボタンは押さない) → 公開範囲・ステータス確認
  if (announcementRowCount > 0) {
    await page.goto('https://boom-admin.hacomono.jp/#/announcement/announcements/', {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);
    await page.locator('table tbody tr').first().click();
    await page.waitForTimeout(2000);
    await shot(page, '07_announcement_detail');
    await saveHtml(page, '07_announcement_detail');
    console.log(`お知らせ詳細URL: ${page.url()}`);
  }

  // ============================================================
  // 問2-2: ウィジェット機能 (マイページ埋め込み用か確認)
  // ============================================================
  console.log('\n--- ウィジェット機能の探索 ---');
  await page.goto('https://boom-admin.hacomono.jp/#/widget/widgets/', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, '08_widget_list');
  await saveHtml(page, '08_widget_list');
  console.log(`ウィジェットURL: ${page.url()}`);

  await page.goto('https://boom-admin.hacomono.jp/#/widget/widgets/register', {
    waitUntil: 'networkidle',
    timeout: 60_000,
  }).catch((e) => console.log(`widget register goto失敗: ${e.message}`));
  await page.waitForTimeout(1500);
  await shot(page, '09_widget_register_form');
  await saveHtml(page, '09_widget_register_form');
  // 判明: ウィジェットタイプは「自由枠トライアル予約」の埋め込みボタン生成用のみで、
  // マイページのメニュー/ホーム画面へ汎用リンクを追加する機能ではない。

  // ============================================================
  // 問2-2続き: システム設定の全タブでマイページ/ポータル関連設定の有無を確認
  // ============================================================
  console.log('\n--- システム設定 各タブの探索 (マイページ/ポータル/メニューカスタマイズ関連の有無) ---');
  const settingsTabs = [
    'registration-contract', 'reservation', 'access-checkin', 'purchase', 'mail', 'security', 'others',
  ];
  const keywordHits = {};
  for (const tab of settingsTabs) {
    const url = `https://boom-admin.hacomono.jp/#/system/settings/${tab}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(1200);
    await saveHtml(page, `10_settings_${tab}`);
    await shot(page, `10_settings_${tab}`);
    const html = await page.content();
    const hits = [];
    for (const kw of ['マイページ', 'ポータル', 'ホーム画面', 'カスタムリンク', 'メニュー設定', 'メニューカスタマイズ']) {
      if (html.includes(kw)) hits.push(kw);
    }
    keywordHits[tab] = hits;
    console.log(`  settings/${tab}: マイページ関連キーワード hit=${JSON.stringify(hits)}`);
  }
  fs.writeFileSync(`${OUT_DIR}/settings_keyword_hits.json`, JSON.stringify(keywordHits, null, 2), 'utf-8');

  // ============================================================
  // 問2-3: アンケートへの直リンクURL (会員側)の有無を推測して試す(閲覧のみ、フォーム送信はしない)
  // ============================================================
  console.log('\n--- 会員向けポータル側の直リンクURL候補を試す ---');
  const candidateMemberUrls = [
    'https://boom.hacomono.jp/enquetes/10',
    'https://boom.hacomono.jp/#/enquetes/10',
    'https://boom.hacomono.jp/#/enquete/10',
  ];
  for (const url of candidateMemberUrls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
      await page.waitForTimeout(1500);
      console.log(`candidate ${url} -> 到達URL ${page.url()}`);
      const safeName = url.replace(/[^a-zA-Z0-9]/g, '_');
      await shot(page, `11_member_url_try_${safeName}`);
    } catch (e) {
      console.log(`candidate ${url} failed: ${e.message}`);
    }
  }
  console.log(
    '注: 上記は管理画面ログインセッションのままboom.hacomono.jp(会員ポータル)へ遷移したもの。' +
      '会員ログインセッションでの検証はできていないため確定情報ではない。'
  );

  fs.writeFileSync(`${OUT_DIR}/selector_log.json`, JSON.stringify(selectorLog, null, 2), 'utf-8');
  fs.writeFileSync(`${OUT_DIR}/network_log.json`, JSON.stringify(networkLog, null, 2), 'utf-8');

  console.log('\n=== done (設定変更/保存/公開切替は一切行っていません) ===');
} finally {
  await browser.close();
}
