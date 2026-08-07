// src/lib/facebookPage.ts — Node.js runtime 専用。
//
// リールのFacebookページ横展開(TARO 2026-08-05)。
//
// **Instagram連携とは別物**。BOOMのInstagramは「Instagramログイン」方式で
// Facebookページを経由していないので、instagram.ts のトークンは一切使えない。
// こちらは通常のFacebookログイン(Graph API)で、ユーザートークン → ページトークンと辿る。
//
//   - OAuth認可:   https://www.facebook.com/v25.0/dialog/oauth
//   - 短期トークン: GET graph.facebook.com/v25.0/oauth/access_token?code=…
//   - 長期トークン: GET graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token
//   - ページ一覧:   GET graph.facebook.com/v25.0/me/accounts  (data[].access_token がページトークン)
//
// **長期ユーザートークンから取得したページトークンは無期限**なので、
// instagram.ts のような45日ごとの更新処理は要らない(Metaの仕様)。
//
// リール投稿は3段階:
//   1. start  … POST {page_id}/video_reels?upload_phase=start → video_id
//   2. upload … POST rupload.facebook.com/video-upload/v25.0/{video_id}
//               `file_url` ヘッダに公開URLを渡せば**バイト列を送らずに済む**
//               (リールは1本50MB近くあるので、これができるのは大きい)
//   3. finish … POST {page_id}/video_reels?upload_phase=finish&video_state=PUBLISHED
//
// 動画要件: mp4 / 9:16 / 1080x1920推奨 / **3〜90秒**。BOOMのリールは12〜65秒なので収まるが、
// 90秒を超えるものが来たら投稿前に弾く(APIに投げてから失敗するより理由が分かる)。
// レート上限は24時間で30投稿。週2〜3本の運用では当たらない。
//
// Meta側のセットアップ(2026-08-06 実施済み・アプリID 1357954775690497):
//   - ユースケース「ページのすべてを管理」を追加し、
//     pages_show_list / pages_manage_posts / pages_read_engagement を有効化
//   - 「ビジネス向けFacebookログイン」の設定「BOOM reel post」を作成(config_id=1083640270989507)
//   - リダイレクトURI https://bw5-app.vercel.app/api/staff/facebook/callback を登録
// 残りはTAROの作業:
//   - env に FACEBOOK_APP_ID(=1357954775690497) / FACEBOOK_APP_SECRET を設定(Vercel環境変数)
//   - /staff/instagram の「Facebookページを連携する」で同意(一度きり)
//     → ページが複数あれば選択画面が出る

import { getOne, execute } from './db';

const PAGE_ID_KEY = 'facebook_page_id';
const PAGE_NAME_KEY = 'facebook_page_name';
const PAGE_TOKEN_KEY = 'facebook_page_token';
const USER_TOKEN_KEY = 'facebook_user_token';
const ISSUED_AT_KEY = 'facebook_token_issued_at';

const GRAPH = 'https://graph.facebook.com/v25.0';
const RUPLOAD = 'https://rupload.facebook.com/video-upload/v25.0';

// ⚠️ 「ビジネス向けFacebookログイン」は scope ではなく **config_id** で権限を決める。
// Metaのコンソールで作った設定(名前: BOOM reel post)に
// pages_show_list / pages_read_engagement / pages_manage_posts を紐づけてある。
// 権限を足したいときはコード(ここ)ではなくコンソールの設定を編集する。
// env で上書きできるようにしてあるのは、設定を作り直したときにデプロイ無しで差し替えるため。
const DEFAULT_CONFIG_ID = '1083640270989507';

function configId(): string {
  return process.env.FACEBOOK_LOGIN_CONFIG_ID || DEFAULT_CONFIG_ID;
}

/** Facebookリールの尺の上限(秒)。これを超える動画はAPIが受け付けない */
export const FB_REEL_MAX_SECONDS = 90;
/** 同じく下限 */
export const FB_REEL_MIN_SECONDS = 3;

function getEnv() {
  return { appId: process.env.FACEBOOK_APP_ID, appSecret: process.env.FACEBOOK_APP_SECRET };
}

export function configured(): boolean {
  const { appId, appSecret } = getEnv();
  return !!(appId && appSecret);
}

function requireEnv() {
  const { appId, appSecret } = getEnv();
  if (!appId || !appSecret) throw new Error('FACEBOOK_APP_ID / FACEBOOK_APP_SECRET が未設定です');
  return { appId, appSecret };
}

export function getRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/staff/facebook/callback`;
}

/** 連携(同意)用URL。stateはコールバック側でhttpOnly cookieと照合する */
export function buildConsentUrl(origin: string, state?: string): string {
  const { appId } = requireEnv();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getRedirectUri(origin),
    response_type: 'code',
    config_id: configId(),
    ...(state ? { state } : {}),
  });
  return `https://www.facebook.com/v25.0/dialog/oauth?${params.toString()}`;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

async function getSetting(key: string): Promise<string | undefined> {
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [key]);
  return (row?.value as string | undefined) || undefined;
}

export type FbPage = { id: string; name: string; access_token: string };

/**
 * 同意後のcodeを処理して、管理しているページの一覧を返す。
 *
 * ページが1つだけならその場で選択まで済ませる。複数ある場合は呼び出し側(callback)が
 * 選択画面を出す — **間違ったページに投稿するのは取り返しがつかない**ので自動で決めない。
 */
export async function exchangeAndListPages(code: string, origin: string): Promise<FbPage[]> {
  const { appId, appSecret } = requireEnv();

  const shortUrl =
    `${GRAPH}/oauth/access_token?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(getRedirectUri(origin))}` +
    `&client_secret=${appSecret}&code=${encodeURIComponent(code)}`;
  const shortRes = await fetch(shortUrl);
  const shortJson = await shortRes.json();
  if (!shortRes.ok || shortJson.error) {
    throw new Error(`短期トークン取得失敗: ${JSON.stringify(shortJson.error ?? shortJson)}`);
  }
  const shortToken = shortJson.access_token as string;

  // 長期ユーザートークン(60日)。ここから引くページトークンが無期限になる
  const longRes = await fetch(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}` +
      `&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
  );
  const longJson = await longRes.json();
  if (!longRes.ok || longJson.error) {
    throw new Error(`長期トークン取得失敗: ${JSON.stringify(longJson.error ?? longJson)}`);
  }
  const userToken = longJson.access_token as string;

  // ⚠️ ページ一覧より先にトークンを保存する。ここで失敗しても
  // /api/staff/facebook/pages から原因を調べられるようにするため
  // (同意はやり直せるが、毎回やり直すのは手間が大きい)。
  await Promise.all([
    upsertSetting(USER_TOKEN_KEY, userToken),
    upsertSetting(ISSUED_AT_KEY, new Date().toISOString()),
  ]);

  const pages = await listPages(userToken);
  if (pages.length === 0) {
    throw new Error('管理しているFacebookページが見つかりませんでした（ページの管理者権限を確認してください）');
  }
  if (pages.length === 1) await selectPage(pages[0].id);
  return pages;
}

/**
 * 投稿できるページの一覧を取る。
 *
 * ⚠️ 経路が2つある。「ビジネス向けFacebookログイン」で同意したページは
 * `/me/accounts` に出ないことがある(ビジネスポートフォリオ配下のページなど)ので、
 * 空だったらビジネス経由でも探す。**片方だけ見て「ページ無し」と判断しない**。
 */
export async function listPages(userToken: string): Promise<FbPage[]> {
  const direct = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${userToken}`);
  const directJson = await direct.json();
  if (direct.ok && !directJson.error) {
    const pages = (directJson.data ?? []) as FbPage[];
    if (pages.length > 0) return pages;
  }

  // ビジネスポートフォリオ経由。owned(自社所有) と client(代理管理) の両方を見る
  const bizRes = await fetch(`${GRAPH}/me/businesses?fields=id,name&access_token=${userToken}`);
  const bizJson = await bizRes.json();
  const businesses = (bizJson.data ?? []) as { id: string }[];
  const found: FbPage[] = [];
  for (const b of businesses) {
    for (const edge of ['owned_pages', 'client_pages']) {
      const r = await fetch(`${GRAPH}/${b.id}/${edge}?fields=id,name,access_token&access_token=${userToken}`);
      const j = await r.json();
      for (const p of (j.data ?? []) as FbPage[]) {
        if (p.id && !found.some((x) => x.id === p.id)) found.push(p);
      }
    }
  }
  // ビジネス経由だとページトークンが付いてこないことがあるので個別に取り直す
  for (const p of found) {
    if (p.access_token) continue;
    const r = await fetch(`${GRAPH}/${p.id}?fields=access_token&access_token=${userToken}`);
    const j = await r.json();
    if (j.access_token) p.access_token = String(j.access_token);
  }
  return found.filter((p) => p.access_token);
}

/** 投稿先ページを確定する。ページトークンは保存済みのユーザートークンから引き直す */
export async function selectPage(pageId: string): Promise<{ id: string; name: string }> {
  const userToken = await getSetting(USER_TOKEN_KEY);
  if (!userToken) throw new Error('Facebook未連携です。先に連携してください');
  const hit = (await listPages(userToken)).find((p) => String(p.id) === String(pageId));
  if (!hit) throw new Error(`ページ ${pageId} は管理対象に見つかりませんでした`);
  await Promise.all([
    upsertSetting(PAGE_ID_KEY, hit.id),
    upsertSetting(PAGE_NAME_KEY, hit.name),
    upsertSetting(PAGE_TOKEN_KEY, hit.access_token),
  ]);
  return { id: hit.id, name: hit.name };
}

export async function connectionStatus(): Promise<{
  facebookConnected: boolean;
  facebookPageId?: string;
  facebookPageName?: string;
  facebookTokenIssuedAt?: string;
}> {
  const [token, id, name, issuedAt] = await Promise.all([
    getSetting(PAGE_TOKEN_KEY),
    getSetting(PAGE_ID_KEY),
    getSetting(PAGE_NAME_KEY),
    getSetting(ISSUED_AT_KEY),
  ]);
  if (!token || !id) return { facebookConnected: false };
  return {
    facebookConnected: true,
    facebookPageId: id,
    facebookPageName: name,
    facebookTokenIssuedAt: issuedAt,
  };
}

async function requireConnection(): Promise<{ pageId: string; pageToken: string }> {
  const [pageId, pageToken] = await Promise.all([getSetting(PAGE_ID_KEY), getSetting(PAGE_TOKEN_KEY)]);
  if (!pageId || !pageToken) {
    throw new Error('Facebookページ未連携です。/staff/instagram の「Facebookページを連携する」から連携してください');
  }
  return { pageId, pageToken };
}

/**
 * リールをFacebookページへ投稿する。
 *
 * @param videoUrl 公開URL。`file_url` ヘッダで渡すのでFacebook側が取りに来る
 *                 (Meta CDN上のURLは拒否されるが、自前のVercel配信なので問題ない)
 * @param description 説明文(ハッシュタグ可)
 */
export async function postReel(
  videoUrl: string,
  description: string
): Promise<{ id: string; permalink: string }> {
  const { pageId, pageToken } = await requireConnection();

  // 1. アップロードセッション開始
  const startRes = await fetch(`${GRAPH}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ upload_phase: 'start', access_token: pageToken }).toString(),
  });
  const startJson = await startRes.json();
  if (!startRes.ok || startJson.error) {
    throw new Error(`アップロード開始失敗: ${JSON.stringify(startJson.error ?? startJson)}`);
  }
  const videoId = String(startJson.video_id ?? '');
  if (!videoId) throw new Error('video_id が取得できませんでした');

  // 2. アップロード。file_url を使うのでバイト列は送らない
  const upRes = await fetch(`${RUPLOAD}/${videoId}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${pageToken}`, file_url: videoUrl },
  });
  const upJson = await upRes.json().catch(() => ({}));
  if (!upRes.ok || upJson.error || upJson.success === false) {
    throw new Error(`アップロード失敗: ${JSON.stringify(upJson.error ?? upJson)}`);
  }

  // 3. 公開
  const finRes = await fetch(`${GRAPH}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
      description,
      access_token: pageToken,
    }).toString(),
  });
  const finJson = await finRes.json();
  if (!finRes.ok || finJson.error || finJson.success === false) {
    throw new Error(`公開失敗: ${JSON.stringify(finJson.error ?? finJson)}`);
  }

  return { id: videoId, permalink: `https://www.facebook.com/reel/${videoId}` };
}

/**
 * ページへのテキスト投稿を**Facebook側の機能で**予約する(GBP月次投稿のFB版に使う)。
 *
 * cronを増やさず、FBの scheduled_publish_time に任せる。制約は
 * 「10分後以上・75日後以内」— 毎月20日に翌月分(最大6週先)を予約する運用は余裕で収まる。
 *
 * @param scheduledAtUtcIso 公開日時(UTC ISO)
 */
export async function schedulePagePost(
  message: string,
  scheduledAtUtcIso: string
): Promise<{ id: string }> {
  const { pageId, pageToken } = await requireConnection();
  const unix = Math.floor(new Date(scheduledAtUtcIso).getTime() / 1000);
  const res = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      message,
      published: 'false',
      scheduled_publish_time: String(unix),
      access_token: pageToken,
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`FB予約投稿の作成失敗: ${JSON.stringify(json.error ?? json)}`);
  }
  return { id: String(json.id) };
}

/** 予約済み投稿の公開予定時刻(UTC ISO)一覧。二重登録の防止に使う */
export async function listScheduledPagePostTimes(): Promise<string[]> {
  const { pageId, pageToken } = await requireConnection();
  const res = await fetch(
    `${GRAPH}/${pageId}/scheduled_posts?fields=scheduled_publish_time&limit=100&access_token=${pageToken}`
  );
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`FB予約一覧の取得失敗: ${JSON.stringify(json.error ?? json)}`);
  }
  return ((json.data ?? []) as { scheduled_publish_time?: number }[])
    .filter((p) => p.scheduled_publish_time)
    .map((p) => new Date(p.scheduled_publish_time! * 1000).toISOString());
}
