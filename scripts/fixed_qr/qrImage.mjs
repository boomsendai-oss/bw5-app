// scripts/fixed_qr/qrImage.mjs
// 固定QR画像に会員名を焼き込む (WS U 追加改修 2026-07-20)
// 兄弟がいると同じ見た目のQRが複数届き区別できないため、QR画像自体に会員名を合成する。
// 2026-07-21: 写真フォルダ一覧で「BOOMのチェックイン画像」と一目で分かるよう左上にBOOMロゴを追加。
//
// 実装方針: Playwrightの新規ページに白背景カードのHTMLをレンダリングし、
// カード要素を screenshot() してPNG Bufferとして返す。
// 印刷にも耐える画質にするため deviceScaleFactor:2 の専用contextを都度作る。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FONT_STACK =
  '"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';

// BOOMロゴ(透過PNG)をリポジトリ同梱ファイルから読み、data URIとして埋め込む。
// GitHub Actions(クラウド)でも動くよう ~/BOOM 等のローカルパスに依存しない。
const LOGO_PATH = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'boom_logo.png');
let LOGO_DATA_URI = null;
try {
  LOGO_DATA_URI = `data:image/png;base64,${readFileSync(LOGO_PATH).toString('base64')}`;
} catch {
  LOGO_DATA_URI = null; // ロゴが読めなくてもQR自体は出す(ロゴなしで続行)
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(qrDataUri, memberName) {
  const safeName = escapeHtml(memberName || 'メンバー');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
  }
  #card {
    width: 700px;
    box-sizing: border-box;
    background: #ffffff;
    padding: 32px 40px 56px;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: ${FONT_STACK};
  }
  /* ロゴはQRの上の独立した行に左寄せで置く(QRに重ねない=位置検出マーカーを潰さない) */
  #logo {
    align-self: flex-start;
    width: 160px;
    height: auto;
    margin-bottom: 20px;
  }
  #qr {
    width: 480px;
    height: 480px;
    display: block;
  }
  #name {
    margin-top: 32px;
    font-size: 30px;
    font-weight: 700;
    color: #111111;
    text-align: center;
    line-height: 1.4;
    word-break: break-word;
    max-width: 100%;
  }
  #label {
    margin-top: 12px;
    font-size: 14px;
    color: #666666;
    text-align: center;
  }
</style>
</head>
<body>
  <div id="card">
    ${LOGO_DATA_URI ? `<img id="logo" src="${LOGO_DATA_URI}" />` : ''}
    <img id="qr" src="${qrDataUri}" />
    <div id="name">${safeName} さん</div>
    <div id="label">BOOM チェックイン用</div>
  </div>
</body>
</html>`;
}

// context: launchAndLogin()が返すPlaywright BrowserContext (ログイン済みのもので構わない。
// このcontextからbrowser()経由で高解像度用の別contextを作るだけで、ログインセッションは使わない)
// qrPngBuffer: Buffer (元のQR PNG)
// memberName: string
// 戻り値: Buffer (会員名を焼き込んだPNG)
export async function composeQrWithName(context, qrPngBuffer, memberName) {
  const browser = context.browser();
  if (!browser) {
    throw new Error('composeQrWithName: context.browser() が取得できません');
  }
  const hiResContext = await browser.newContext({ deviceScaleFactor: 2 });
  try {
    const page = await hiResContext.newPage();
    try {
      const qrDataUri = `data:image/png;base64,${qrPngBuffer.toString('base64')}`;
      const html = buildHtml(qrDataUri, memberName);
      await page.setContent(html, { waitUntil: 'load' });
      const card = page.locator('#card');
      await card.waitFor({ state: 'visible' });
      const png = await card.screenshot({ type: 'png' });
      return png;
    } finally {
      await page.close();
    }
  } finally {
    await hiResContext.close();
  }
}
