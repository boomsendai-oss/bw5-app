// src/lib/youtube.ts — Node.js runtime 専用。
//
// リールを YouTube Shorts として投稿する。
//
// 採用API: YouTube Data API v3 videos.insert（レジューム可能アップロード）
//   1. POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//      → メタデータをJSONで送り、レスポンスの Location ヘッダにアップロード先URLが返る
//   2. PUT <Location> に動画バイト列を送る → 完了時に videos リソースが返る
//
// Shorts になる条件（別APIではなく、動画の性質で自動判定される）:
//   - 縦動画（アスペクト比が正方形以下）
//   - 3分以内
//   説明に #Shorts を入れるのは保険（crosspost.ts が自動で付ける）
//
// クォータ: videos.insert は 1回 1600 units。既定の上限は 1日 10,000 units
//   → 1日6本までしか上げられない。リールは1日1本なので余裕がある。
//
// 認証: OAuth 2.0 リフレッシュトークン。GBPと同じ Google OAuth クライアントを使うが、
//   **スコープが違うので認可し直しが必要**:
//     https://www.googleapis.com/auth/youtube.upload
//   env:
//     GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET  (GBPと共用・設定済み)
//     YOUTUBE_REFRESH_TOKEN                                (要追加)
//
// 未設定の間は configured()=false で no-op。

const UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** YouTubeが受け付ける動画の上限(実運用の安全側。API仕様上は128GB) */
export const YT_MAX_BYTES = 256 * 1024 * 1024;

export function configured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.YOUTUBE_REFRESH_TOKEN
  );
}

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN ?? '',
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`YouTube token取得失敗 ${res.status}: ${raw.slice(0, 300)}`);
  const token = (JSON.parse(raw) as { access_token?: string }).access_token;
  if (!token) throw new Error('YouTube token: access_tokenが空');
  return token;
}

export type UploadShortInput = {
  bytes: Uint8Array;
  title: string;
  description: string;
  tags: string[];
  /** 既定は 'public'。検証中は 'private' にしておくと安全 */
  privacyStatus?: 'public' | 'unlisted' | 'private';
};

export type UploadShortResult = { videoId: string; permalink: string };

/**
 * 動画をアップロードして videoId を返す。失敗は throw。
 *
 * 冪等ではない（同じ動画を2回呼べば2本上がる）。呼び出し側で
 * reel_crossposts の status を 'posting' に claim してから呼ぶこと。
 */
export async function uploadShort(input: UploadShortInput): Promise<UploadShortResult> {
  if (!configured()) throw new Error('YouTube連携env未設定');
  if (input.bytes.byteLength === 0) throw new Error('動画データが空です');
  if (input.bytes.byteLength > YT_MAX_BYTES) {
    throw new Error(`動画が上限を超過 (${input.bytes.byteLength} bytes)`);
  }

  const token = await getAccessToken();
  const metadata = {
    snippet: {
      title: input.title,
      description: input.description,
      tags: input.tags,
      // 22 = People & Blogs。ダンススクールの投稿としては 24(Entertainment) でもよいが、
      // 教室紹介・レッスン風景が主なので People & Blogs にしている
      categoryId: '22',
    },
    status: {
      privacyStatus: input.privacyStatus ?? 'public',
      selfDeclaredMadeForKids: false,
    },
  };

  // 1. セッション開始 — Location にアップロード先URLが返る
  const init = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(input.bytes.byteLength),
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) {
    throw new Error(`YouTube upload開始失敗 ${init.status}: ${(await init.text()).slice(0, 300)}`);
  }
  const location = init.headers.get('location');
  if (!location) throw new Error('YouTube upload: Locationヘッダが無い');

  // 2. 本体を送る
  const put = await fetch(location, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(input.bytes.byteLength),
    },
    // Uint8Array をそのまま渡す(Bufferのプール由来のオフセットを避けるためコピー済みを想定)
    body: input.bytes as unknown as BodyInit,
  });
  const raw = await put.text();
  if (!put.ok) {
    throw new Error(`YouTube upload失敗 ${put.status}: ${raw.slice(0, 300)}`);
  }
  const videoId = (JSON.parse(raw) as { id?: string }).id;
  if (!videoId) throw new Error(`YouTube upload: idが返ってこない: ${raw.slice(0, 200)}`);

  return { videoId, permalink: `https://www.youtube.com/shorts/${videoId}` };
}
