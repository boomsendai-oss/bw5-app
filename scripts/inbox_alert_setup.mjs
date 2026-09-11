#!/usr/bin/env node
// 受信箱アラートの鍵を Vercel 本番の環境変数に登録する補助スクリプト。
// 鍵の値は画面にもファイルにも出さない(Gitにも STATE.md にも書かない)。
//
// 使い方(Vercel のリンク情報 .vercel/project.json があるリポジトリで実行する。無ければログインや入力の前に止まる):
//   node scripts/inbox_alert_setup.mjs client [--keys <JSONのパス>]
//       OAuthクライアントを GMAIL_ALERT_CLIENT_ID / GMAIL_ALERT_CLIENT_SECRET に登録する。
//       --keys を省くと boom所有のクライアント(~/.gmail-mcp/gcp-oauth.keys.json)を使う。
//       --keys にはGoogle Cloudでダウンロードした JSON({"installed":{...}} か {"web":{...}})を渡す(先頭の ~ は展開する)
//   node scripts/inbox_alert_setup.mjs gmail <boom|nitroash|taro> --expect <メールアドレス> [--keys <JSONのパス>]
//       ブラウザでGoogleにログイン(読み取り専用の許可)し、ログインしたアドレスが --expect と
//       一致した時だけ GMAIL_ALERT_REFRESH_TOKEN_<BOOM|NITROASH|TARO> に登録する(ログインを待つのは最大9分)。
//       client で --keys を使った時は、gmail にも同じ --keys を渡す(別のクライアントで取った鍵は、登録したクライアントでは使えない)
//   client と gmail は、使うOAuthクライアントの JSON のパスと client_id の末尾6文字を表示する(取り違えに気づくため。シークレットは出さない)
//   node scripts/inbox_alert_setup.mjs set <PUSHOVER_USER_KEY|PUSHOVER_TOKEN_BOOM|PUSHOVER_TOKEN_NITROASH|PUSHOVER_TOKEN_TARO>
//       値を貼り付けて登録する(入力は画面に表示しない)。TAROが自分のターミナルで実行する
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

const SUFFIX = { boom: 'BOOM', nitroash: 'NITROASH', taro: 'TARO' };
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const SETTABLE = ['PUSHOVER_USER_KEY', 'PUSHOVER_TOKEN_BOOM', 'PUSHOVER_TOKEN_NITROASH', 'PUSHOVER_TOKEN_TARO'];
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** --keys を省いた時に使う、boom所有のOAuthクライアント */
const DEFAULT_KEYS = join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');
/** Googleのログインと「許可」を待つ上限 */
const LOGIN_TIMEOUT_MS = 9 * 60 * 1000;
/** 挙動を確かめた版に固定する(値を標準入力で受け取り、--force で上書き、-y で確認を省く) */
const VERCEL = 'vercel@53.1.0';

function usage() {
  console.error([
    '使い方:',
    '  node scripts/inbox_alert_setup.mjs client [--keys <JSONのパス>]',
    '  node scripts/inbox_alert_setup.mjs gmail <boom|nitroash|taro> --expect <メールアドレス> [--keys <JSONのパス>]',
    `  node scripts/inbox_alert_setup.mjs set <${SETTABLE.join('|')}>`,
    '',
    '  --keys: Google Cloudでダウンロードした OAuthクライアントの JSON。省くと ~/.gmail-mcp/gcp-oauth.keys.json',
    '          client で --keys を使った時は、gmail にも同じ --keys を渡してください',
  ].join('\n'));
  process.exit(2);
}

/** Vercel のリンク先が bw5-app であることを、ログインや入力の前に確かめる(登録できないのにログインだけさせない) */
function assertVercelLinked() {
  const p = join(REPO_ROOT, '.vercel', 'project.json');
  if (!existsSync(p)) {
    throw new Error(`${p} がありません。Vercel にリンク済みの bw5-app で実行してください(登録していません)`);
  }
  const { projectName } = JSON.parse(readFileSync(p, 'utf8'));
  if (projectName !== 'bw5-app') {
    throw new Error(`Vercel のリンク先が bw5-app ではありません(${projectName})。登録していません`);
  }
}

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * OAuthクライアントのIDとシークレットを JSON から読む。
 * エラーの文言にファイルの中身を入れない(JSONの読み取りエラーはシークレットの一部を含むことがあるため)
 */
function oauthClient(keysPath) {
  const p = keysPath ? resolve(expandHome(keysPath)) : DEFAULT_KEYS;
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (e) {
    throw new Error(`OAuthクライアントの JSON を読めません（${p}・${e.code ?? 'エラー'}）。パスを確かめてください。登録していません`);
  }
  let keys;
  try {
    keys = JSON.parse(raw);
  } catch {
    throw new Error(`OAuthクライアントの JSON の形が壊れています（${p}）。Google Cloudでダウンロードした JSON を指定してください。登録していません`);
  }
  const c = keys?.installed ?? keys?.web;
  if (!c || typeof c.client_id !== 'string' || !c.client_id || typeof c.client_secret !== 'string' || !c.client_secret) {
    throw new Error(
      `OAuthクライアントの JSON に "installed" か "web" の client_id と client_secret がありません（${p}）。` +
        'Google Cloudの「OAuth 2.0 クライアント ID」でダウンロードした JSON を指定してください。登録していません',
    );
  }
  console.log(`OAuthクライアント: ${p}（client_id 末尾 …${clientIdTail(c.client_id)}）`);
  return { id: c.client_id, secret: c.client_secret };
}

/** client_id の見分け用の末尾6文字。Googleの client_id は全部 .apps.googleusercontent.com で終わるので、その手前から取る */
function clientIdTail(id) {
  return id.replace(/\.apps\.googleusercontent\.com$/, '').slice(-6);
}

function vercelEnvSet(name, value) {
  const r = spawnSync('npx', ['--yes', VERCEL, 'env', 'add', name, 'production', '--force', '-y'], {
    cwd: REPO_ROOT,
    input: value,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  if (r.status !== 0) {
    throw new Error(`vercel env add ${name} に失敗しました: ${r.error?.message ?? ''} ${String(r.stderr ?? '').slice(0, 300)}`.trim());
  }
  console.log(`登録しました: ${name}（production）`);
}

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

async function gmailFlow(account, expect, keysPath) {
  const suffix = SUFFIX[account];
  if (!suffix || !expect) usage();
  assertVercelLinked();
  // 登録済みの GMAIL_ALERT_CLIENT_* と同じクライアントで取らないと、本番でその鍵を使えない
  const { id, secret } = oauthClient(keysPath);

  // 認可コードの送り込み・横取りを防ぐため state と PKCE(S256) を使い、このMacの中だけで待ち受ける
  const state = randomBytes(16).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPE,
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
      client_id: id,
      client_secret: secret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tok = await tokenRes.json();
  if (!tok.refresh_token) throw new Error(`refresh_token が返りませんでした: ${tok.error ?? tokenRes.status}`);
  const scopes = String(tok.scope ?? '').split(' ').filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== SCOPE) {
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
  vercelEnvSet(`GMAIL_ALERT_REFRESH_TOKEN_${suffix}`, tok.refresh_token);
}

function hiddenPrompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {}; // 入力した文字を表示しない
    process.stdout.write(question);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function setFlow(name) {
  if (!SETTABLE.includes(name)) usage();
  assertVercelLinked();
  const value = await hiddenPrompt(`${name} の値を貼り付けて Enter（画面には表示されません）: `);
  if (!value) throw new Error('値が空でした。登録していません');
  vercelEnvSet(name, value);
}

async function clientFlow(keysPath) {
  assertVercelLinked();
  const { id, secret } = oauthClient(keysPath);
  vercelEnvSet('GMAIL_ALERT_CLIENT_ID', id);
  vercelEnvSet('GMAIL_ALERT_CLIENT_SECRET', secret);
}

/** `--name 値` を取り出して args から除く。値が無ければ使い方を出して止める */
function takeOption(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) usage();
  args.splice(i, 2);
  return value;
}

const args = process.argv.slice(2);
const keysPath = takeOption(args, '--keys');
const expect = takeOption(args, '--expect');
const [cmd, arg] = args;
try {
  // client に --expect は無い(gmail と打ち間違えたまま、クライアントだけ登録し直さないため)
  if (cmd === 'client' && expect === undefined) await clientFlow(keysPath);
  else if (cmd === 'gmail') await gmailFlow(arg, expect, keysPath);
  else if (cmd === 'set' && keysPath === undefined) await setFlow(arg);
  else usage();
} catch (e) {
  console.error(`失敗: ${e.message}`);
  process.exit(1);
}
