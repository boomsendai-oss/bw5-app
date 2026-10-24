// メロジョイ(Mellojoy Japan 公式ストア)在庫見張りの純ロジック(2026-10-24 TARO依頼)。
//
// 目的: クリパの景品用。ストアは毎日12:00(JST)に在庫更新、入荷は数秒〜数分で売り切れる。
//   入荷した瞬間にTAROのiPhoneへ知らせ、入荷と売り切れの履歴を残して入荷パターンを学ぶ。
// ⚠️ 読むだけ。Shopifyの公開JSON(products.json)を取得するだけで、カート投入・購入は一切しない。
//    購入はTAROが通知を見て手で行う。
//
// ここはネットワークもDBも触らない(fetch は引数で受け取る)。DBは mellojoyWatchDb.ts、
// 1回分の流れ(取得→差分→通知→保存)は mellojoyWatchRun.ts。
import type { PushoverMessage } from './inboxAlert/pushover';
import { truncateChars } from './inboxAlert/format';

export const MELLOJOY_ORIGIN = 'https://www.mellojoyjapan.com';
export const MELLOJOY_PRODUCTS_URL = `${MELLOJOY_ORIGIN}/products.json?limit=250`;
/** 複数商品が同時に入荷した時に開くページ(Shopifyの全商品一覧) */
export const MELLOJOY_ALL_URL = `${MELLOJOY_ORIGIN}/collections/all`;

export function productUrl(handle: string): string {
  return `${MELLOJOY_ORIGIN}/products/${encodeURIComponent(handle)}`;
}

/** 普通のブラウザと同じ User-Agent(素の fetch の UA だと弾かれることがあるため) */
export const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export type EventKind = 'restock' | 'soldout' | 'new_product' | 'updated_while_soldout' | 'fetch_error';

/** products.json を平らにした1バリエーション */
export type MjVariant = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  handle: string;
  /** Shopifyの表記そのまま(例 "2499") */
  price: string;
  available: boolean;
  /** バリエーションの updated_at。在庫数が変わると動く(売り切れのまま動いた=取りこぼした入荷の手がかり) */
  variantUpdatedAt: string;
};

/** DBに持つ最新状態(mellojoy_watch_state 1行) */
export type MjState = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  handle: string;
  price: string;
  available: boolean;
  /** 在庫あり/なしが最後に切り替わった時刻(ISO)。売り切れ時の「在庫があった時間」の起点 */
  lastChangeAt: string;
  /** 最後に一覧に載っていた時刻(ISO) */
  lastSeenAt: string;
  variantUpdatedAt: string;
};

export type MjEvent = {
  at: string;
  kind: EventKind;
  variantId: string;
  productTitle: string;
  price: string;
  detail: string;
};

/** 通知に載せる1件 */
export type MjAlertItem = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  handle: string;
  price: string;
};

/** 取得できたが中身がおかしい(HTMLが返った・形が違う・0件)。軽い失敗として記録だけする */
export class MellojoyFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MellojoyFetchError';
  }
}

const str = (v: unknown): string => (v == null ? '' : String(v));

/** products.json の中身 → バリエーションの平らな一覧。形が違えば MellojoyFetchError */
export function parseProducts(json: unknown): MjVariant[] {
  const products = (json as { products?: unknown } | null)?.products;
  if (!Array.isArray(products)) throw new MellojoyFetchError('products が配列でない');
  const out: MjVariant[] = [];
  for (const p of products) {
    if (!p || typeof p !== 'object') continue;
    const prod = p as { title?: unknown; handle?: unknown; variants?: unknown };
    if (!Array.isArray(prod.variants)) continue;
    for (const v of prod.variants) {
      if (!v || typeof v !== 'object') continue;
      const va = v as { id?: unknown; title?: unknown; price?: unknown; available?: unknown; updated_at?: unknown };
      if (va.id == null) continue;
      out.push({
        variantId: str(va.id),
        productTitle: str(prod.title),
        variantTitle: str(va.title),
        handle: str(prod.handle),
        price: str(va.price),
        available: va.available === true,
        variantUpdatedAt: str(va.updated_at),
      });
    }
  }
  if (out.length === 0) {
    // 0件は「全部消えた」と読むと売り切れ記録が一斉に出るので、取得失敗扱いにする
    throw new MellojoyFetchError('商品が0件');
  }
  return out;
}

/** 応答本文(文字列)→ バリエーション一覧。JSONでない(HTMLが返る時がある)なら MellojoyFetchError */
export function parseProductsText(text: string): MjVariant[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const head = text.trim().slice(0, 40).replace(/\s+/g, ' ');
    throw new MellojoyFetchError(`JSONでない応答: ${head}`);
  }
  return parseProducts(json);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * products.json を取りに行く。失敗したら3秒あけて1回だけやり直す(連打しない)。
 * 2回ともだめなら MellojoyFetchError。
 * 429(回数制限・Retry-After: 60 が付く。2026-10-24 実測)はやり直しても同じなので、すぐ諦めて次の分に任せる。
 */
export async function fetchMellojoyVariants(
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<MjVariant[]> {
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await wait(3000);
    try {
      const res = await fetchImpl(MELLOJOY_PRODUCTS_URL, {
        headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
        redirect: 'follow',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      if (res.status === 429) {
        const ra = res.headers.get('retry-after');
        throw new MellojoyFetchError(`HTTP 429(回数制限${ra ? `・retry-after ${ra}秒` : ''})`);
      }
      if (!res.ok) throw new MellojoyFetchError(`HTTP ${res.status}`);
      return parseProductsText(text);
    } catch (e) {
      lastErr = e instanceof Error ? `${e.name === 'MellojoyFetchError' ? '' : `${e.name}: `}${e.message}` : String(e);
      if (lastErr.startsWith('HTTP 429')) break;
    }
  }
  throw new MellojoyFetchError(lastErr || '取得失敗');
}

/** 秒数 → 「45秒」「2分15秒」「1時間3分」 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}秒`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}分${r}秒` : `${m}分`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}時間${m}分` : `${h}時間`;
}

function secondsBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

/** 売り切れ記録の detail。先頭の「在庫あり N秒」を履歴画面が読むので書式を変えない */
function soldoutDetail(prev: MjState, nowIso: string, suffix = ''): string {
  const sec = secondsBetween(prev.lastChangeAt, nowIso);
  const head = sec == null ? '在庫あり 不明' : `在庫あり ${sec}秒(${formatDuration(sec)})`;
  return suffix ? `${head} ${suffix}` : head;
}

/**
 * 前回の状態と今回の一覧を比べる。
 * - restock: 前回在庫なし → 今回在庫あり(通知する)
 * - soldout: 前回在庫あり → 今回在庫なし / 一覧から消えた(記録だけ。在庫があった秒数を detail に入れる)
 * - new_product: 初めて見たバリエーション(在庫ありなら通知する。初回実行で既に在庫がある物も知らせる)
 * - updated_while_soldout: 在庫なしのまま updated_at が動いた(1分おきの見張りの間に入荷→売り切れした可能性。記録だけ)
 *
 * next = 保存すべき状態(変化が無くても last_seen_at を進めるので、今回見えた全件+消えた在庫あり分)
 */
export function diffVariants(
  prev: MjState[],
  current: MjVariant[],
  nowIso: string,
): { next: MjState[]; events: MjEvent[]; alerts: MjAlertItem[] } {
  const prevById = new Map(prev.map((p) => [p.variantId, p]));
  const seen = new Set<string>();
  const next: MjState[] = [];
  const events: MjEvent[] = [];
  const alerts: MjAlertItem[] = [];

  for (const v of current) {
    if (seen.has(v.variantId)) continue; // 同じIDが2回載っていても1回だけ数える
    seen.add(v.variantId);
    const p = prevById.get(v.variantId);
    const base = { at: nowIso, variantId: v.variantId, productTitle: v.productTitle, price: v.price };
    const alert = { variantId: v.variantId, productTitle: v.productTitle, variantTitle: v.variantTitle, handle: v.handle, price: v.price };
    let lastChangeAt = p?.lastChangeAt || nowIso;

    if (!p) {
      events.push({ ...base, kind: 'new_product', detail: v.available ? '初めて見た・在庫あり' : '初めて見た・在庫なし' });
      if (v.available) alerts.push(alert);
      lastChangeAt = nowIso;
    } else if (!p.available && v.available) {
      events.push({ ...base, kind: 'restock', detail: '入荷(在庫なし→在庫あり)' });
      alerts.push(alert);
      lastChangeAt = nowIso;
    } else if (p.available && !v.available) {
      events.push({ ...base, kind: 'soldout', detail: soldoutDetail(p, nowIso) });
      lastChangeAt = nowIso;
    } else if (!p.available && !v.available && p.variantUpdatedAt && v.variantUpdatedAt && p.variantUpdatedAt !== v.variantUpdatedAt) {
      events.push({
        ...base,
        kind: 'updated_while_soldout',
        detail: `在庫なしのまま更新 ${p.variantUpdatedAt} → ${v.variantUpdatedAt}(見張りの間に入荷→売り切れした可能性)`,
      });
    }

    next.push({
      variantId: v.variantId,
      productTitle: v.productTitle,
      variantTitle: v.variantTitle,
      handle: v.handle,
      price: v.price,
      available: v.available,
      lastChangeAt,
      lastSeenAt: nowIso,
      variantUpdatedAt: v.variantUpdatedAt,
    });
  }

  // 前回在庫ありだったのに一覧から消えた(非公開化など)= 売り切れ扱い。
  // 在庫なしにしておけば、再び在庫ありで載った時に restock として通知される。
  for (const p of prev) {
    if (seen.has(p.variantId) || !p.available) continue;
    events.push({
      at: nowIso,
      kind: 'soldout',
      variantId: p.variantId,
      productTitle: p.productTitle,
      price: p.price,
      detail: soldoutDetail(p, nowIso, '一覧から消えた'),
    });
    next.push({ ...p, available: false, lastChangeAt: nowIso });
  }

  return { next, events, alerts };
}

/** 商品名からストア共通の注意書き(【開封後のキャンセルができません】等)を外して短くする。型番【A032】は残す */
export function shortTitle(title: string): string {
  return title
    .replace(/【[^】]*(キャンセル|ブラインドボックス)[^】]*】/g, '')
    .replace(/^\s*Mellojoy\s*[-－—–]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2499" → "¥2,499"。数字でなければそのまま */
export function formatPrice(price: string): string {
  const n = Number(price);
  if (!price || Number.isNaN(n)) return price;
  return `¥${n.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}`;
}

const PUSHOVER_MESSAGE_MAX = 1024;

/** 入荷通知(複数商品は1通にまとめる)。高優先度=おやすみモードでも鳴る */
export function buildAlertMessage(items: MjAlertItem[]): PushoverMessage {
  const lines = items.map((it) => {
    const variant = it.variantTitle && it.variantTitle !== 'Default Title' ? ` ${it.variantTitle}` : '';
    return `・${shortTitle(it.productTitle)}${variant} ${formatPrice(it.price)}`;
  });
  const single = items.length === 1;
  const url = single ? productUrl(items[0].handle) : MELLOJOY_ALL_URL;
  const body = [...lines, '', `ストア: ${url}`].join('\n');
  return {
    title: single ? 'メロジョイ 在庫あり！' : `メロジョイ 在庫あり！(${items.length}件)`,
    message: truncateChars(body, PUSHOVER_MESSAGE_MAX),
    url,
    url_title: single ? '商品ページを開く' : 'ストアを開く',
    priority: 1,
  };
}

/** 履歴画面用: 売り切れ記録の detail から在庫があった秒数を読む(無ければ null) */
export function availableSecondsOf(detail: string): number | null {
  const m = /^在庫あり (\d+)秒/.exec(detail);
  return m ? Number(m[1]) : null;
}
