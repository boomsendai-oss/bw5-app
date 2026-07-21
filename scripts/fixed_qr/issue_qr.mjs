// scripts/fixed_qr/issue_qr.mjs
// 固定QR自動発行 (WS U): アンケート回答者を特定→固定コード発行→QR画像→bw5-appへPOST
//
// トリガー: 「新規入会者全員」ではなく、HACOMONOアンケート [ENQUETE0005]「固定QRコード発行」
// (enquete_id既定10) への会員自身の回答を起点にする。理由: 固定QRは希望者のみに発行するため、
// 入会日basisの全員一律発行は過剰配布になる (旧QR_CUTOFF方式は廃止)。
//
// 環境変数:
//   HACOMONO_USERNAME / HACOMONO_PASSWORD / APP_ADMIN_PASSWORD (必須)
//   ENQUETE_ID     アンケートID (既定 '10' = [ENQUETE0005]「固定QRコード発行」)
//   ANSWER_CUTOFF  この日時(ISO8601, 例 '2026-07-20T00:00:00+09:00')以降に回答した会員のみ対象
//                  (既定 '2026-07-20T00:00:00+09:00'。稼働開始前の既存回答への誤送信を防ぐ安全弁)
//   MAX_PER_RUN    1回の実行で処理する最大人数 (既定 10・安全弁)
//   DRY_RUN=1      発行・POSTをせず対象一覧の件数だけ出して終了
//   APP_BASE_URL   bw5-app のベースURL (既定 'https://bw5-app.vercel.app'・ローカル検証用に上書き可)
//   ONLY_MEMBER_ID 指定時は手動モードになり、アンケート回答の有無を問わずそのメンバーIDだけを対象にする
//                  (LINE等アンケート外で依頼が来た時に即対応するための経路)
//   FORCE_ISSUE=1  E2Eテスト専用。既存コードがあっても強制的に新規発行する (ONLY_MEMBER_ID併用必須)
//   CODE_NAME      E2Eテスト用。新規発行時のコード名称を上書きする (既定 '固定メンバーコード用')
//   REUSE_CODE_NAME E2Eテスト専用。新規発行せず、指定名称の既存コードを再利用してメール送信のみ行う
//                  (ONLY_MEMBER_ID併用必須。TAROのHACOMONOアカウントにテストコードを増やさないため)
//
// 本番稼働中: .github/workflows/fixed-qr.yml が15分おきに実行する。
// 実行するとHACOMONOに固定コードが発行され、会員へ実際にメールが送信される。
//
// ログにPIIは出さない (メンバーIDと件数・statusのみ。氏名・メールアドレスは出力しない)。
import { launchAndLogin, downloadMl001Csv, fetchEnqueteAnswers } from './hacomono.mjs';
import { parseCsv, toDicts } from './csv.mjs';
import { composeQrWithName } from './qrImage.mjs';

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(`必須環境変数が未設定です: ${missing.join(', ')}`);
  }
}
requireEnv(['HACOMONO_USERNAME', 'HACOMONO_PASSWORD', 'APP_ADMIN_PASSWORD']);

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://bw5-app.vercel.app';
const ENQUETE_ID = process.env.ENQUETE_ID || '10'; // [ENQUETE0005]「固定QRコード発行」
// 稼働開始日時: これ以降にアンケート回答した会員のみ対象 (過去の既対応分への誤送信を防ぐ安全弁)
const ANSWER_CUTOFF = process.env.ANSWER_CUTOFF || '2026-07-20T00:00:00+09:00';
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 10); // 安全弁: 1回の実行で処理する最大人数
const DRY = process.env.DRY_RUN === '1';
const ONLY_MEMBER_ID = process.env.ONLY_MEMBER_ID || null; // E2Eテスト用: 単一メンバーに限定するガード

// ⚠️E2Eテスト専用の逃がし口。既に有効な固定コードを持つ会員でも強制的に新規発行する。
// 本番cron(.github/workflows/fixed-qr.yml)では絶対に設定しないこと(コード増殖・二重送信の原因になる)。
// 事故防止のため ONLY_MEMBER_ID との併用を必須にしている(全員に対する強制発行は不可能)。
const FORCE_ISSUE = process.env.FORCE_ISSUE === '1';
// テスト用コードを既存の「固定メンバーコード用」と区別するための名称上書き
const CODE_NAME = process.env.CODE_NAME || null;
if (FORCE_ISSUE && !ONLY_MEMBER_ID) {
  throw new Error('FORCE_ISSUE=1 は ONLY_MEMBER_ID と併用必須です (全員への強制発行は禁止)');
}

// ⚠️E2Eテスト専用の逃がし口(その2)。TAROのHACOMONOアカウントにテストコードを増やしたくないため、
// 新規発行をせず「既存の指定名称のコード」を再利用してメールだけ送り直す。
// 事故防止のため ONLY_MEMBER_ID との併用を必須にしている(FORCE_ISSUEと同様のガード)。
const REUSE_CODE_NAME = process.env.REUSE_CODE_NAME || null;
if (REUSE_CODE_NAME && !ONLY_MEMBER_ID) {
  throw new Error('REUSE_CODE_NAME は ONLY_MEMBER_ID と併用必須です (全員への適用は禁止)');
}

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
//   QRは https://boom-admin.hacomono.jp/api/member/members/{id}/keys/{keyId}/qr?size=NNN を直DL
//   (06_existing_code_view.html の <img src="https://boom-admin.hacomono.jp/api/member/members/13/keys/155/qr?size=400"> で確認済み。
//   size=600に変更済み: 印刷品質向上のため)
const SELECTORS = {
  memberDetailUrl: (id) => `https://boom-admin.hacomono.jp/#/member/members/${id}/`,
  securityKeysUrl: (id) => `https://boom-admin.hacomono.jp/#/member/members/${id}/security/keys/`,
  securityTab: 'a:has-text("セキュリティ")',
  newRegisterLink: 'a:has-text("新規登録")',
  // 有効な「固定メンバーコード用」行 (無効行や「有効期限」列と混同しないよう badge のクラスで判定)
  activeExistingFixedCodeRow: 'tr:has(a:has-text("固定メンバーコード用")):has(span.m_badge.success)',
  // 上の行の中のリンク (href から keyId を取り、既存コードを再利用するため)
  activeExistingFixedCodeLink:
    'tr:has(a:has-text("固定メンバーコード用")):has(span.m_badge.success) a:has-text("固定メンバーコード用")',
  nameInputGroup: '[aria-label="名称"] input[type="text"]',
  saveButton: 'button:has-text("保存する")',
  defaultCodeName: '固定メンバーコード用',
  // REUSE_CODE_NAME用: コード一覧から指定名称のリンク行を探す (完全一致。部分一致だと
  // 「固定メンバーコード用」等の類似名を誤って拾う事故につながるため)
  codeLinkByExactName: (name) => `tr a:text-is("${name}")`,
  // QRダウンロードサイズは印刷品質のため600 (元400)
  qrImageUrl: (memberId, keyId) =>
    `https://boom-admin.hacomono.jp/api/member/members/${memberId}/keys/${keyId}/qr?size=600`,
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

// keyId確定後、QR PNGをAPIから直DLする (新規発行/再利用の両方から呼ぶ共通処理)
async function downloadQrPng(context, memberId, keyId) {
  const qrUrl = SELECTORS.qrImageUrl(memberId, keyId);
  const res = await context.request.get(qrUrl, { timeout: 30_000 });
  if (res.status() !== 200) {
    throw new Error(`QRダウンロード失敗: HTTP ${res.status()}`);
  }
  const contentType = res.headers()['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('image/png')) {
    throw new Error(`QRダウンロードのcontent-typeが不正です: ${contentType || '(none)'}`);
  }
  return Buffer.from(await res.body());
}

// 新規登録→(名称確認)→保存する→保存後URLからkeyId取得→QR PNGをAPIから直DL
async function issueNewFixedCode(context, page, memberId) {
  await page.locator(SELECTORS.newRegisterLink).click();
  await page.waitForTimeout(1500); // SPAのルート遷移 (モーダルではない)

  // 既存値の有無を条件分岐せず常に明示fillする(品質レビュー指摘: 既存値検知の前提を排除し、
  // 「デフォルト値が入っているはず」という仮定が崩れた場合の名称増殖/空欄事故の根を断つ)
  await page.locator(SELECTORS.nameInputGroup).fill(CODE_NAME || SELECTORS.defaultCodeName);

  await page.locator(SELECTORS.saveButton).click();
  await page.waitForTimeout(1500);

  const match = page.url().match(/security\/keys\/(\d+)(?:[/?#]|$)/);
  if (!match) {
    throw new Error(`保存後のURLからkeyIdを取得できませんでした (url=${page.url()})`);
  }
  const keyId = match[1];
  const png = await downloadQrPng(context, memberId, keyId);
  return { keyId, png };
}

// REUSE_CODE_NAME用: コード一覧から指定名称のリンク行を探しhrefからkeyIdを取り、QRをDLする。
// 新規発行は行わない(TAROのHACOMONOアカウントにテストコードを増やさないため)
async function reuseFixedCodeByName(context, page, memberId, codeName) {
  const link = page.locator(SELECTORS.codeLinkByExactName(codeName)).first();
  const count = await page.locator(SELECTORS.codeLinkByExactName(codeName)).count();
  if (count === 0) {
    throw new Error(`REUSE_CODE_NAME="${codeName}" に一致するコードが見つかりませんでした`);
  }
  const href = await link.getAttribute('href');
  const match = (href || '').match(/security\/keys\/(\d+)(?:[/?#]|$)/);
  if (!match) {
    throw new Error(`REUSE_CODE_NAME="${codeName}" のリンクからkeyIdを取得できませんでした (href=${href})`);
  }
  const keyId = match[1];
  const png = await downloadQrPng(context, memberId, keyId);
  return { keyId, png };
}

// per-member処理の入り口 (TARO確定要件 2026-07-21: 再申請が来たら新しいコードを作らず、
// 既にある固定コードのQRをそのまま再送する。新規作成すると後から出てきた古い紙が別物になり
// 混乱するため)。
// gotoSecurityKeys後、有効な既存コード(activeExistingFixedCodeRow)が1件以上あればそれを再利用し、
// 無ければ新規発行する。skipped_existing分岐は廃止(再利用して送るため)。
async function resolveKeyId(context, page, memberId) {
  await gotoSecurityKeys(page, memberId);

  // ⚠️E2Eテスト専用の逃がし口 (呼び出し元でONLY_MEMBER_ID必須ガード済み)
  if (REUSE_CODE_NAME) {
    const result = await reuseFixedCodeByName(context, page, memberId, REUSE_CODE_NAME);
    console.log(`member ${memberId}: 既存コード再利用(REUSE_CODE_NAME)`);
    return result;
  }

  if (!FORCE_ISSUE) {
    const existingLinks = page.locator(SELECTORS.activeExistingFixedCodeLink);
    const count = await existingLinks.count();
    if (count > 0) {
      // 複数あれば先頭(最初に見つかった有効な固定コード)を使う
      const href = await existingLinks.first().getAttribute('href');
      const match = (href || '').match(/security\/keys\/(\d+)(?:[/?#]|$)/);
      if (!match) {
        throw new Error(`既存コード行のhrefからkeyIdを取得できませんでした (href=${href})`);
      }
      const keyId = match[1];
      const png = await downloadQrPng(context, memberId, keyId);
      console.log(`member ${memberId}: 既存コード再利用`);
      return { keyId, png };
    }
  }

  const result = await issueNewFixedCode(context, page, memberId);
  console.log(`member ${memberId}: 新規発行`);
  return result;
}

const { browser, context, page } = await launchAndLogin();
console.log('login ok');

try {
  // CSV行長ガード: ヘッダーと列数が一致しない行は列ズレのおそれがあるため除外する
  // (toDictsに渡すと値が隣の列にずれ、宛先が別人にシフトして誤送信する事故につながるため・品質レビュー指摘)
  const rawRows = parseCsv(await downloadMl001Csv(context));
  const [hdr, ...dataRows] = rawRows;
  const validRows = dataRows.filter((r) => r.length === hdr.length);
  const skippedCount = dataRows.length - validRows.length;
  if (skippedCount > 0) {
    console.log(`column-mismatch skipped: ${skippedCount}行`); // PIIは出さない(件数のみ)
  }
  const members = toDicts([hdr, ...validRows]);
  const memberById = new Map(members.filter((m) => m['メンバーID']).map((m) => [m['メンバーID'], m]));
  const { issued } = await appGet('/api/staff/qr-issues');
  // dedup(再送判定)は台帳の last_answered_at ベース。台帳に無い/nullなら「超えている」扱い
  const lastAnsweredAtByMember = new Map(issued.map((x) => [x.hacomono_member_id, x.last_answered_at || null]));

  // 対象メンバーの決定: ONLY_MEMBER_ID指定時は手動モード(アンケート回答を問わない・dedup無し)、
  // 未指定ならアンケートモード(ANSWER_CUTOFF以降 かつ 台帳より新しい回答者のみ=再送対応)
  // targetMembers: [{ id, lastAnsweredAt }] (lastAnsweredAtはPOSTで台帳に記録する値)
  let mode, targetMembers;
  if (ONLY_MEMBER_ID) {
    mode = 'manual';
    // その会員の最新アンケート回答があればそのanswered_at、無ければ現在時刻を台帳に記録する
    let lastAnsweredAt = new Date().toISOString();
    try {
      const answers = await fetchEnqueteAnswers(context, ENQUETE_ID);
      const mine = answers.filter((a) => String(a.member_id) === ONLY_MEMBER_ID);
      if (mine.length > 0) {
        mine.sort((a, b) => new Date(b.answered_at).getTime() - new Date(a.answered_at).getTime());
        lastAnsweredAt = mine[0].answered_at;
      }
    } catch (e) {
      console.log(`warn: ONLY_MEMBER_ID用のアンケート取得に失敗、現在時刻を使用します (${e.message})`); // PIIなし
    }
    targetMembers = [{ id: ONLY_MEMBER_ID, lastAnsweredAt }];
  } else {
    mode = 'enquete';
    const cutoffMs = new Date(ANSWER_CUTOFF).getTime();
    if (Number.isNaN(cutoffMs)) {
      throw new Error(`ANSWER_CUTOFFのパースに失敗しました: ${ANSWER_CUTOFF}`);
    }
    const answers = await fetchEnqueteAnswers(context, ENQUETE_ID);
    // answered_atはISO8601(+09:00)。タイムゾーン表記揺れで壊れる文字列比較ではなく数値比較する。
    // 会員ごとの「最新回答」(answered_at最大)だけを見る(MULTIPLE回答=再申請は新レコードのため)
    const latestByMember = new Map(); // member_id -> { answeredAt, ms }
    for (const a of answers) {
      const answeredMs = new Date(a.answered_at).getTime();
      if (Number.isNaN(answeredMs)) {
        console.log(`warn: answered_atのパースに失敗、安全側でスキップ (id=${a.id})`); // PIIなし
        continue;
      }
      const key = String(a.member_id);
      const cur = latestByMember.get(key);
      if (!cur || answeredMs > cur.ms) latestByMember.set(key, { answeredAt: a.answered_at, ms: answeredMs });
    }
    targetMembers = [];
    for (const [id, { answeredAt, ms }] of latestByMember) {
      if (ms < cutoffMs) continue; // 稼働開始前の回答は対象外
      const ledgerRaw = lastAnsweredAtByMember.get(id);
      const ledgerMs = ledgerRaw ? new Date(ledgerRaw).getTime() : NaN;
      // 台帳のlast_answered_atが無い(NaN)か、今回の回答の方が新しければ対象(初回送信 or 再申請)。
      // 同じ回答のまま次のcronが回った場合(ms <= ledgerMs)はスキップ=再送しない
      if (!Number.isNaN(ledgerMs) && ms <= ledgerMs) continue;
      targetMembers.push({ id, lastAnsweredAt: answeredAt });
    }
  }

  const pending = targetMembers
    .filter(({ id }) => {
      if (!memberById.has(id)) {
        console.log(`member ${id}: ML001に見つからずスキップ`); // PIIなし(退会等でML001に居ないケース)
        return false;
      }
      return true;
    })
    .slice(0, MAX_PER_RUN)
    .map(({ id, lastAnsweredAt }) => ({ m: memberById.get(id), lastAnsweredAt }));
  console.log(`pending: ${pending.length}名 (mode=${mode}, cutoff=${mode === 'enquete' ? ANSWER_CUTOFF : 'n/a'})`);

  if (DRY) {
    console.log('DRY_RUN: 終了');
    await browser.close();
    process.exit(0);
  }

  let okCount = 0, failCount = 0;
  for (const { m, lastAnsweredAt } of pending) {
    const id = m['メンバーID'];
    try {
      // 既に有効な固定コードがあればそれを再利用し(新規発行しない)、無ければ新規発行する
      // (TARO確定要件 2026-07-21: 再申請=既存QR再送。skipped_existing分岐は廃止)
      const { png: rawPng } = await resolveKeyId(context, page, id);

      // QR画像に会員名を焼き込む(兄弟の取り違え防止)。合成に失敗しても元QRはそのまま送る
      // (ラベルが無くてもQR自体は届く方が良い。品質レビュー指摘: PIIはログに出さない)
      let png = rawPng;
      try {
        png = await composeQrWithName(context, rawPng, m['氏名'] || '');
      } catch {
        console.log(`member ${id}: qr label skipped`);
      }

      const form = new FormData();
      form.set('hacomono_member_id', id);
      form.set('member_name', m['氏名'] || '');
      form.set('email', m['メールアドレス'] || '');
      form.set('rep_email', m['代表メールアドレス'] || '');
      form.set('last_answered_at', lastAnsweredAt || '');
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
  // 部分失敗でも非ゼロexit (GH Actionsで失敗が赤く見えるように・品質レビュー指摘)
  if (failCount > 0) process.exit(1);
} catch (e) {
  await browser.close();
  throw e;
}
