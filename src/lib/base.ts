/**
 * BASE API client (https://developers.thebase.in/)
 *
 * OAuth2 + token refresh の管理を含む。
 * トークンは settings テーブルに保存:
 *   - base_access_token
 *   - base_refresh_token
 *   - base_token_expires_at  (unix秒)
 */

import { execute, getOne, getAll } from '@/lib/db';

const BASE_API = 'https://api.thebase.in/1';
const OAUTH_BASE = 'https://api.thebase.in/1/oauth';

const REDIRECT_URI =
  process.env.BASE_REDIRECT_URI ||
  'https://bw5-app.vercel.app/api/base-callback';

const CLIENT_ID = process.env.BASE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.BASE_CLIENT_SECRET || '';

// ========== OAuth helpers ==========

export function buildAuthorizeUrl(
  scope = 'read_users read_items read_orders write_items'
) {
  const u = new URL(`${OAUTH_BASE}/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('scope', scope);
  return u.toString();
}

export async function exchangeCodeForToken(code: string) {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', CLIENT_ID);
  body.set('client_secret', CLIENT_SECRET);
  body.set('code', code);
  body.set('redirect_uri', REDIRECT_URI);

  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };
  await persistToken(data);
  return data;
}

async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', CLIENT_ID);
  body.set('client_secret', CLIENT_SECRET);
  body.set('refresh_token', refreshToken);
  body.set('redirect_uri', REDIRECT_URI);

  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`token refresh failed: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  await persistToken(data);
  return data;
}

async function persistToken(data: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}) {
  const expiresAt = Math.floor(Date.now() / 1000) + Number(data.expires_in) - 60; // 60s 余裕
  const upserts = [
    ['base_access_token', data.access_token],
    ['base_refresh_token', data.refresh_token],
    ['base_token_expires_at', String(expiresAt)],
  ];
  for (const [k, v] of upserts) {
    await execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [k, v]
    );
  }
}

async function getValidAccessToken(): Promise<string | null> {
  const accRow = await getOne(
    "SELECT value FROM settings WHERE key = 'base_access_token'"
  );
  const refRow = await getOne(
    "SELECT value FROM settings WHERE key = 'base_refresh_token'"
  );
  const expRow = await getOne(
    "SELECT value FROM settings WHERE key = 'base_token_expires_at'"
  );

  const acc = accRow?.value as string | undefined;
  const ref = refRow?.value as string | undefined;
  const exp = Number(expRow?.value || 0);

  if (!acc || !ref) return null;

  const now = Math.floor(Date.now() / 1000);
  if (exp > now + 30) {
    return acc; // まだ有効
  }
  // 期限切れ → refresh
  try {
    const data = await refreshAccessToken(ref);
    return data.access_token;
  } catch (e) {
    console.error('[base] refresh failed', e);
    return null;
  }
}

// ========== Items API ==========

export interface BaseItem {
  item_id: number;
  shop_id?: string;
  title: string;
  detail?: string;
  price?: number;
  proper_price?: number;
  stock?: number;
  visible?: number;
  list_order?: number;
  identifier?: string;
  modified?: number;
  delivery_date?: number;
  list_image_url?: string;
  detail_image_url?: string;
  img1_origin?: string;
  img2_origin?: string;
  img3_origin?: string;
  img4_origin?: string;
  img5_origin?: string;
  img6_origin?: string;
  img7_origin?: string;
  img8_origin?: string;
  img9_origin?: string;
  img10_origin?: string;
  variations?: Array<{
    variation_id: number;
    variation: string;
    variation_stock: number;
    variation_identifier?: string;
  }>;
}

interface ItemsResponse {
  items: BaseItem[];
  count: number;
}

/**
 * 商品一覧取得（公開中の商品のみ）
 */
export async function fetchItems(opts: {
  limit?: number;
  order?: 'list_order' | 'created' | 'modified';
} = {}): Promise<BaseItem[]> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('BASE not authorized — go to /api/base-auth first');
  }

  const params = new URLSearchParams();
  params.set('limit', String(opts.limit ?? 50));
  params.set('order', opts.order ?? 'list_order');

  const res = await fetch(`${BASE_API}/items?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`items fetch failed: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as ItemsResponse;
  return data.items;
}

/**
 * 特定商品の詳細取得（in stock判定が必要な時など）
 */
export async function fetchItem(itemId: number): Promise<BaseItem | null> {
  const token = await getValidAccessToken();
  if (!token) return null;
  const res = await fetch(`${BASE_API}/items/detail?item_id=${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { item: BaseItem };
  return data.item ?? null;
}

/**
 * 認可状態確認（管理画面用）
 */
export async function isAuthorized(): Promise<boolean> {
  const token = await getValidAccessToken();
  return !!token;
}

// ========== Items API (write) ==========

/**
 * 商品の説明 (detail) を更新する
 * https://developers.thebase.in/docs/api/items#operation/edit
 */
export async function updateItemDetail(
  itemId: number,
  detail: string
): Promise<{ success: true } | { success: false; error: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'not authorized' };

  const body = new URLSearchParams();
  body.set('item_id', String(itemId));
  body.set('detail', detail);

  const res = await fetch(`${BASE_API}/items/edit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    return { success: false, error: `${res.status}: ${errText.slice(0, 200)}` };
  }
  return { success: true };
}

/**
 * 商品の汎用フィールド更新（title, detail, price, stock など）
 */
export async function updateItem(
  itemId: number,
  fields: Partial<{
    title: string;
    detail: string;
    price: number;
    stock: number;
    visible: number;
    list_order: number;
  }>
): Promise<{ success: true } | { success: false; error: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'not authorized' };

  const body = new URLSearchParams();
  body.set('item_id', String(itemId));
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) body.set(k, String(v));
  }

  const res = await fetch(`${BASE_API}/items/edit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    return { success: false, error: `${res.status}: ${errText.slice(0, 200)}` };
  }
  return { success: true };
}

/**
 * shop URL を組み立てる（itemページ）
 */
export function buildItemUrl(shopUrl: string, itemId: number) {
  const base = shopUrl.replace(/\/$/, '');
  return `${base}/items/${itemId}`;
}
