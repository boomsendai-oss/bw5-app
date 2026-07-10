// Google Business Profile API クライアント (T-178)
// GBP APIはサービスアカウント非対応のため OAuth2 refresh token 方式。
// 必要env: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GBP_REFRESH_TOKEN
//          GBP_ACCOUNT_ID / GBP_LOCATION_ID (APIアクセス承認後にAPIで取得して固定)

export type GbpReview = {
  reviewId: string;
  name: string; // accounts/{a}/locations/{l}/reviews/{r}
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

export const STAR_TO_NUM: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

export function gbpConfigured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GBP_REFRESH_TOKEN &&
    process.env.GBP_ACCOUNT_ID &&
    process.env.GBP_LOCATION_ID
  );
}

export async function getGbpAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.GBP_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`GBP token refresh失敗: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

function reviewsBase(): string {
  return `https://mybusiness.googleapis.com/v4/accounts/${process.env.GBP_ACCOUNT_ID}/locations/${process.env.GBP_LOCATION_ID}/reviews`;
}

// 全クチコミ取得 (現在5件規模なのでページング全件でOK)
export async function listGbpReviews(token: string): Promise<GbpReview[]> {
  const all: GbpReview[] = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const url = `${reviewsBase()}?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`GBP reviews.list失敗: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { reviews?: GbpReview[]; nextPageToken?: string };
    all.push(...(json.reviews ?? []));
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return all;
}

// 返信投稿 (既存返信があれば上書き)
export async function putGbpReply(token: string, reviewId: string, comment: string): Promise<void> {
  const res = await fetch(`${reviewsBase()}/${reviewId}/reply`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) {
    throw new Error(`GBP reviews.updateReply失敗: ${res.status} ${await res.text()}`);
  }
}

