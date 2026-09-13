// Googleのループバック方式のログイン(state + PKCE S256・127.0.0.1で待ち受け)。
// 鍵の登録(scripts/inbox_alert_setup.mjs)と、件名を取るためのローカル保存(scripts/inbox_alert_report.mjs)で共有する。
// 読み取り専用以外の権限が混ざっていたり、別のアカウントでログインされた時は例外にする(呼び出し側は何も保存しない)。
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
/** Googleのログインと「許可」を待つ上限 */
const LOGIN_TIMEOUT_MS = 9 * 60 * 1000;

function waitForCode(server, redirect, state) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('9分以内にGoogleから戻りませんでした。登録していません'));
    }, LOGIN_TIMEOUT_MS);
    server.on('request', (req, res) => {
      const u = new URL(req.url ?? '/', redirect);
      // このフローで発行した state を持たない要求(favicon や、よそからの送り込み)は無視する
      if (u.pathname !== '/' || u.searchParams.get('state') !== state) {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = u.searchParams.get('code');
      const error = u.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(code ? '完了しました。このタブは閉じて大丈夫です。' : '許可されませんでした。');
      clearTimeout(timer);
      server.close();
      if (code) resolve(code);
      else reject(new Error(`Googleで許可されませんでした: ${error}`));
    });
  });
}

/**
 * ブラウザでGoogleにログインさせ、読み取り専用の refresh_token を取る。
 * client は { id, secret }、expect はログインしてほしいメールアドレス
 */
export async function loopbackLogin({ client, expect, scope = GMAIL_READONLY_SCOPE }) {
  // 認可コードの送り込み・横取りを防ぐため state と PKCE(S256) を使い、このMacの中だけで待ち受ける
  const state = randomBytes(16).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirect,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    login_hint: expect,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  console.log(`ブラウザで ${expect} としてログインし、「許可」を押してください（最大9分待ちます）。\n開かない場合は次のURLを開く:\n${authUrl}`);
  spawn('open', [authUrl], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  const code = await waitForCode(server, redirect, state);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tok = await tokenRes.json();
  if (!tok.refresh_token) throw new Error(`refresh_token が返りませんでした: ${tok.error ?? tokenRes.status}`);
  const scopes = String(tok.scope ?? '').split(' ').filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== scope) {
    throw new Error(
      `読み取り専用以外の権限が含まれています（${tok.scope}）。登録していません。` +
        '同じOAuthクライアントで以前に広い権限を許可したアカウントでは、Googleが権限をまとめて返すことがあります。' +
        'その場合はアラート専用のOAuthクライアントを分け、client と gmail の両方に --keys でその JSON を渡してください',
    );
  }

  const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  const profile = await profileRes.json();
  if (!profileRes.ok) {
    throw new Error(`Gmailのプロフィールを取得できませんでした（${profile.error?.message ?? profileRes.status}）。登録していません`);
  }
  if (String(profile.emailAddress ?? '').toLowerCase() !== expect.toLowerCase()) {
    throw new Error(`別のアカウント（${profile.emailAddress}）でログインされました。登録していません`);
  }
  return { refreshToken: tok.refresh_token, email: profile.emailAddress };
}
