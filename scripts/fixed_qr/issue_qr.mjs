// scripts/fixed_qr/issue_qr.mjs
// 固定QR自動発行 (WS U): ML001から新規入会者を特定→固定コード発行→QR画像→bw5-appへPOST
//
// 環境変数:
//   HACOMONO_USERNAME / HACOMONO_PASSWORD / APP_ADMIN_PASSWORD (必須)
//   QR_CUTOFF     稼働開始日 (既定 '2026-07-21')。これ以降の入会者のみ対象
//   MAX_PER_RUN   1回の実行で処理する最大人数 (既定 10・安全弁)
//   DRY_RUN=1     発行・POSTをせず対象一覧の件数だけ出して終了
//   APP_BASE_URL  bw5-app のベースURL (既定 'https://bw5-app.vercel.app'・ローカル検証用に上書き可)
//   ONLY_MEMBER_ID 指定時はそのメンバーIDだけを対象にする (E2Eテスト用ガード)
//
// ⚠️ 絶対条件: DRY_RUN以外の実行はこのタスクでは行わない (本物の発行・メール送信は後続ゲートB)。
// 発行部分 (保存クリック以降) は Task 5 (discover.mjs) の調査結果 (scripts/fixed_qr/discover_out/) で
// 確定したセレクタに基づいて書いているが、このタスクでは実行されない。
//
// ログにPIIは出さない (メンバーIDと件数・statusのみ。氏名・メールアドレスは出力しない)。
import { launchAndLogin, downloadMl001Csv } from './hacomono.mjs';
import { parseCsv, toDicts } from './csv.mjs';

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(`必須環境変数が未設定です: ${missing.join(', ')}`);
  }
}
requireEnv(['HACOMONO_USERNAME', 'HACOMONO_PASSWORD', 'APP_ADMIN_PASSWORD']);

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://bw5-app.vercel.app';
const CUTOFF = process.env.QR_CUTOFF || '2026-07-21'; // 稼働開始日: これ以降の入会者のみ対象
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 10); // 安全弁: 1回の実行で処理する最大人数
const DRY = process.env.DRY_RUN === '1';
const ONLY_MEMBER_ID = process.env.ONLY_MEMBER_ID || null; // E2Eテスト用: 単一メンバーに限定するガード

// Task 5 (discover.mjs・scripts/fixed_qr/discover_out/) の調査で確定したセレクタ。
// - メンバー詳細: #/operation/members/{id} は404。#/member/members/{id}/ が正 (確認済み)
// - セキュリティタブのリンク先href = #/member/members/{id}/security/keys/ (02_security_tab.html で確認)。
//   直gotoは未検証のため、到達判定に失敗したら詳細ページ→タブクリックにフォールバックする
// - 「新規登録」は<a>タグ (button:has-text("新規登録")は0件・a:has-text("新規登録")は1件)
// - 既存コード一覧の行は <tr><td><span class="m_badge sm success"><span>有効</span></span></td>
//   <td><a href="#/member/members/{id}/security/keys/{keyId}">固定メンバーコード用</a></td>...</tr>
//   (無効時は class="m_badge sm muted"・テキスト"無効"。"無効"は"有効"を部分文字列として含まないので安全)
// - 新規登録フォームの「名称」入力は aria-label="名称" のグループ内の input[type="text"] (確認済み。
//   デフォルト値"固定メンバーコード用"が入っている前提。空なら明示的に入力する)
// - 保存ボタン: button:has-text("保存する") (count=1・<button type="submit" class="m_button success">)
// - 保存後のURLは #/member/members/{id}/security/keys/{keyId} になる。そこからkeyIdを取得し
//   QRは https://boom-admin.hacomono.jp/api/member/members/{id}/keys/{keyId}/qr?size=400 を直DL
//   (06_existing_code_view.html の <img src="https://boom-admin.hacomono.jp/api/member/members/13/keys/155/qr?size=400"> で確認済み)
const SELECTORS = {
  memberDetailUrl: (id) => `https://boom-admin.hacomono.jp/#/member/members/${id}/`,
  securityKeysUrl: (id) => `https://boom-admin.hacomono.jp/#/member/members/${id}/security/keys/`,
  securityTab: 'a:has-text("セキュリティ")',
  newRegisterLink: 'a:has-text("新規登録")',
  // 有効な「固定メンバーコード用」行 (無効行や「有効期限」列と混同しないよう badge のクラスで判定)
  activeExistingFixedCodeRow: 'tr:has(a:has-text("固定メンバーコード用")):has(span.m_badge.success)',
  nameInputGroup: '[aria-label="名称"] input[type="text"]',
  saveButton: 'button:has-text("保存する")',
  defaultCodeName: '固定メンバーコード用',
  qrImageUrl: (memberId, keyId) =>
    `https://boom-admin.hacomono.jp/api/member/members/${memberId}/keys/${keyId}/qr?size=400`,
};

async function appGet(path) {
  const r = await fetch(`${APP_BASE_URL}${path}`, {
    headers: { 'x-admin-password': process.env.APP_ADMIN_PASSWORD },
  });
  if (!r.ok) throw new Error(`GET ${path}: HTTP ${r.status}`);
  return r.json();
}

async function appPostForm(path, form) {
  const r = await fetch(`${APP_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'x-admin-password': process.env.APP_ADMIN_PASSWORD },
    body: form,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`POST ${path}: HTTP ${r.status} ${JSON.stringify(body)}`);
  return body;
}

// メンバー詳細のセキュリティ→メンバーコード一覧へ遷移する。
// 直gotoで一覧が開けたか (「新規登録」リンクが見える) を確認し、ダメなら詳細ページ経由にフォールバックする。
async function gotoSecurityKeys(page, memberId) {
  await page.goto(SELECTORS.securityKeysUrl(memberId), { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  const ready = (await page.locator(SELECTORS.newRegisterLink).count()) >= 1;
  if (ready) return;

  // 直gotoで開けなかった場合: 詳細ページ→「セキュリティ」タブをクリック (Task5確定のフォールバック経路)
  await page.goto(SELECTORS.memberDetailUrl(memberId), { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.locator(SELECTORS.securityTab).click();
  await page.waitForTimeout(1500);
  const readyAfterFallback = (await page.locator(SELECTORS.newRegisterLink).count()) >= 1;
  if (!readyAfterFallback) {
    throw new Error('セキュリティ→メンバーコード一覧に到達できませんでした');
  }
}

// 新規登録→(名称確認)→保存する→保存後URLからkeyId取得→QR PNGをAPIから直DL
async function issueNewFixedCode(context, page, memberId) {
  await page.locator(SELECTORS.newRegisterLink).click();
  await page.waitForTimeout(1500); // SPAのルート遷移 (モーダルではない)

  const nameInput = page.locator(SELECTORS.nameInputGroup);
  const currentName = await nameInput.inputValue();
  if (!currentName) {
    await nameInput.fill(SELECTORS.defaultCodeName);
  }

  await page.locator(SELECTORS.saveButton).click();
  await page.waitForTimeout(1500);

  const match = page.url().match(/security\/keys\/(\d+)(?:[/?#]|$)/);
  if (!match) {
    throw new Error(`保存後のURLからkeyIdを取得できませんでした (url=${page.url()})`);
  }
  const keyId = match[1];

  const qrUrl = SELECTORS.qrImageUrl(memberId, keyId);
  const res = await context.request.get(qrUrl, { timeout: 30_000 });
  if (res.status() !== 200) {
    throw new Error(`QRダウンロード失敗: HTTP ${res.status()}`);
  }
  const contentType = res.headers()['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('image/png')) {
    throw new Error(`QRダウンロードのcontent-typeが不正です: ${contentType || '(none)'}`);
  }
  const png = Buffer.from(await res.body());
  return { keyId, png };
}

const { browser, context, page } = await launchAndLogin();
console.log('login ok');

try {
  const members = toDicts(parseCsv(await downloadMl001Csv(context)));
  const { issued } = await appGet('/api/staff/qr-issues');
  const done = new Set(issued.map((x) => x.hacomono_member_id));

  // ML001の「入会日時」は 'YYYY/MM/DD HH:MM:SS' (スラッシュ区切り)。CUTOFF('YYYY-MM-DD')と
  // 文字列比較するには区切り文字を揃える必要がある(揃えないと '/' > '-' の順序でズレる)
  const pending = members
    .filter((m) => (m['入会日時'] || '').slice(0, 10).replace(/\//g, '-') >= CUTOFF)
    .filter((m) => m['メンバーID'] && !done.has(m['メンバーID']))
    .filter((m) => !ONLY_MEMBER_ID || m['メンバーID'] === ONLY_MEMBER_ID)
    .slice(0, MAX_PER_RUN);
  console.log(`pending: ${pending.length}名 (cutoff=${CUTOFF})`);

  if (DRY) {
    console.log('DRY_RUN: 終了');
    await browser.close();
    process.exit(0);
  }

  let okCount = 0, failCount = 0;
  for (const m of pending) {
    const id = m['メンバーID'];
    try {
      await gotoSecurityKeys(page, id);

      // 既に有効な「固定メンバーコード用」がある(TARO手動発行済み) → 記録だけして送らない
      const activeExistingCount = await page.locator(SELECTORS.activeExistingFixedCodeRow).count();
      if (activeExistingCount > 0) {
        const form = new FormData();
        form.set('hacomono_member_id', id);
        form.set('action', 'skipped_existing');
        await appPostForm('/api/staff/qr-issues', form);
        console.log(`member ${id}: skipped_existing`);
        okCount++;
        continue;
      }

      const { png } = await issueNewFixedCode(context, page, id);

      const form = new FormData();
      form.set('hacomono_member_id', id);
      form.set('member_name', m['氏名'] || '');
      form.set('email', m['メールアドレス'] || '');
      form.set('rep_email', m['代表メールアドレス'] || '');
      form.set('action', 'send');
      form.set('qr', new Blob([png], { type: 'image/png' }), 'qr.png');
      const res = await appPostForm('/api/staff/qr-issues', form);
      console.log(`member ${id}: ${res.status}`); // 氏名・アドレスはログに出さない
      okCount++;
    } catch (e) {
      failCount++;
      console.error(`member ${id}: FAILED ${e.message}`); // 失敗は台帳未記録→翌朝自動リトライ
    }
  }
  console.log(`done: ok=${okCount} fail=${failCount}`);
  await browser.close();
  if (failCount > 0 && okCount === 0) process.exit(1);
} catch (e) {
  await browser.close();
  throw e;
}
