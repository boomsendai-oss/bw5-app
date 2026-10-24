import { describe, it, expect, vi } from 'vitest';
import {
  MELLOJOY_ALL_URL,
  MELLOJOY_PRODUCTS_URL,
  MellojoyFetchError,
  availableSecondsOf,
  buildAlertMessage,
  diffVariants,
  fetchMellojoyVariants,
  formatDuration,
  formatPrice,
  parseProducts,
  parseProductsText,
  productUrl,
  shortTitle,
  type MjState,
} from '@/lib/mellojoyWatch';
import { runMellojoyWatch, type MellojoyRunDeps } from '@/lib/mellojoyWatchRun';

// products.json の実物(2026-10-24)を縮めた形
function fixture(avail: { a?: boolean; b?: boolean; bUpdated?: string } = {}) {
  return {
    products: [
      {
        id: 9893447532784,
        title: 'Mellojoy -ぱんぱんパンケーキ/ ムースクリーム-にぎにぎおにぎり 【A032】【 開封後のキャンセルができません】【ブラインドボックスのおもちゃ】',
        handle: 'mellojoy-onigiri-a032',
        published_at: '2026-09-01T12:00:00+09:00',
        updated_at: '2026-10-24T12:00:00+09:00',
        variants: [
          { id: 49015389946096, title: '1 * ボックス', price: '2699', available: avail.a ?? false, updated_at: '2026-10-24T12:00:00+09:00' },
        ],
      },
      {
        id: 9984298352880,
        title: 'Mellojoy - ムースクリーム - こんがり焼き餅【Z067-3】',
        handle: 'mellojoy-yakimochi-z067-3',
        published_at: '2026-09-01T12:00:00+09:00',
        updated_at: '2026-10-24T12:00:00+09:00',
        variants: [
          { id: 49566849630448, title: '1 * ボックス', price: '2499', available: avail.b ?? false, updated_at: avail.bUpdated ?? '2026-10-23T12:00:00+09:00' },
        ],
      },
    ],
  };
}

const T0 = '2026-10-24T03:00:00.000Z'; // 12:00 JST
const T1 = '2026-10-24T03:01:00.000Z';
const T2 = '2026-10-24T03:03:15.000Z';

function stateFrom(json: unknown, at: string): MjState[] {
  return diffVariants([], parseProducts(json), at).next;
}

describe('parseProducts', () => {
  it('商品×バリエーションを平らにする(IDは文字列)', () => {
    const v = parseProducts(fixture({ a: true }));
    expect(v).toHaveLength(2);
    expect(v[0]).toEqual({
      variantId: '49015389946096',
      productTitle: expect.stringContaining('にぎにぎおにぎり'),
      variantTitle: '1 * ボックス',
      handle: 'mellojoy-onigiri-a032',
      price: '2699',
      available: true,
      variantUpdatedAt: '2026-10-24T12:00:00+09:00',
    });
    expect(v[1].available).toBe(false);
  });
  it('形が違う・0件は取得失敗扱い', () => {
    expect(() => parseProducts({})).toThrow(MellojoyFetchError);
    expect(() => parseProducts({ products: [] })).toThrow('0件');
  });
  it('HTMLが返った時は JSONでない応答 として失敗', () => {
    expect(() => parseProductsText('<!DOCTYPE html><html>…')).toThrow(/JSONでない応答/);
  });
});

describe('diffVariants', () => {
  it('初回: 在庫ありだけ通知、全件 new_product として記録', () => {
    const d = diffVariants([], parseProducts(fixture({ a: true })), T0);
    expect(d.events.map((e) => e.kind)).toEqual(['new_product', 'new_product']);
    expect(d.events[0].detail).toContain('在庫あり');
    expect(d.events[1].detail).toContain('在庫なし');
    expect(d.alerts.map((a) => a.variantId)).toEqual(['49015389946096']);
    expect(d.next).toHaveLength(2);
    expect(d.next.every((s) => s.lastSeenAt === T0 && s.lastChangeAt === T0)).toBe(true);
  });

  it('初回に何も在庫が無ければ通知しない', () => {
    expect(diffVariants([], parseProducts(fixture()), T0).alerts).toEqual([]);
  });

  it('変化なしなら記録も通知も無し・last_seen_at だけ進む・last_change_at は据え置き', () => {
    const prev = stateFrom(fixture(), T0);
    const d = diffVariants(prev, parseProducts(fixture()), T1);
    expect(d.events).toEqual([]);
    expect(d.alerts).toEqual([]);
    expect(d.next[0].lastSeenAt).toBe(T1);
    expect(d.next[0].lastChangeAt).toBe(T0);
  });

  it('在庫なし→在庫あり = restock で通知', () => {
    const prev = stateFrom(fixture(), T0);
    const d = diffVariants(prev, parseProducts(fixture({ b: true })), T1);
    expect(d.events).toHaveLength(1);
    expect(d.events[0]).toMatchObject({ kind: 'restock', variantId: '49566849630448', price: '2499', at: T1 });
    expect(d.alerts.map((a) => a.handle)).toEqual(['mellojoy-yakimochi-z067-3']);
    expect(d.next.find((s) => s.variantId === '49566849630448')).toMatchObject({ available: true, lastChangeAt: T1 });
  });

  it('在庫あり→在庫なし = soldout(在庫があった秒数を detail に)・通知しない', () => {
    const prev = diffVariants(stateFrom(fixture(), T0), parseProducts(fixture({ b: true })), T1).next;
    const d = diffVariants(prev, parseProducts(fixture()), T2);
    expect(d.alerts).toEqual([]);
    expect(d.events).toHaveLength(1);
    expect(d.events[0].kind).toBe('soldout');
    expect(d.events[0].detail).toBe('在庫あり 135秒(2分15秒)');
    expect(availableSecondsOf(d.events[0].detail)).toBe(135);
  });

  it('在庫ありのまま一覧から消えたら soldout にして在庫なしで保存(再掲載時に restock になる)', () => {
    const prev = stateFrom(fixture({ a: true }), T0);
    const onlyB = { products: [fixture().products[1]] };
    const d = diffVariants(prev, parseProducts(onlyB), T1);
    const gone = d.events.find((e) => e.variantId === '49015389946096');
    expect(gone?.kind).toBe('soldout');
    expect(gone?.detail).toContain('一覧から消えた');
    expect(d.next.find((s) => s.variantId === '49015389946096')).toMatchObject({ available: false, lastSeenAt: T0 });
    const back = diffVariants(d.next, parseProducts(fixture({ a: true })), T2);
    expect(back.events.find((e) => e.variantId === '49015389946096')?.kind).toBe('restock');
    expect(back.alerts).toHaveLength(1);
  });

  it('在庫なしのまま updated_at が動いた = 取りこぼした入荷の手がかりとして記録(通知しない)', () => {
    const prev = stateFrom(fixture(), T0);
    const d = diffVariants(prev, parseProducts(fixture({ bUpdated: '2026-10-24T12:00:05+09:00' })), T1);
    expect(d.events.map((e) => e.kind)).toEqual(['updated_while_soldout']);
    expect(d.alerts).toEqual([]);
  });
});

describe('通知文', () => {
  it('商品名からストア共通の注意書きを外す(型番は残す)', () => {
    expect(shortTitle(fixture().products[0].title)).toBe('ぱんぱんパンケーキ/ ムースクリーム-にぎにぎおにぎり 【A032】');
    expect(shortTitle('Mellojoy - ムースクリーム - こんがり焼き餅【Z067-3】')).toBe('ムースクリーム - こんがり焼き餅【Z067-3】');
  });
  it('価格と時間の表記', () => {
    expect(formatPrice('2499')).toBe('¥2,499');
    expect(formatDuration(45)).toBe('45秒');
    expect(formatDuration(135)).toBe('2分15秒');
    expect(formatDuration(3780)).toBe('1時間3分');
  });
  it('1件なら商品ページ、高優先度', () => {
    const d = diffVariants(stateFrom(fixture(), T0), parseProducts(fixture({ b: true })), T1);
    const m = buildAlertMessage(d.alerts);
    expect(m.title).toBe('メロジョイ 在庫あり！');
    expect(m.priority).toBe(1);
    expect(m.url).toBe(productUrl('mellojoy-yakimochi-z067-3'));
    expect(m.message).toBe(
      `・ムースクリーム - こんがり焼き餅【Z067-3】 1 * ボックス ¥2,499\n\nストア: ${productUrl('mellojoy-yakimochi-z067-3')}`,
    );
  });
  it('複数件は1通にまとめ、全商品一覧を開く', () => {
    const d = diffVariants([], parseProducts(fixture({ a: true, b: true })), T0);
    const m = buildAlertMessage(d.alerts);
    expect(m.title).toBe('メロジョイ 在庫あり！(2件)');
    expect(m.url).toBe(MELLOJOY_ALL_URL);
    expect(m.message.split('\n').filter((l) => l.startsWith('・'))).toHaveLength(2);
  });
});

describe('fetchMellojoyVariants', () => {
  const ok = () => new Response(JSON.stringify(fixture({ a: true })), { status: 200 });
  const html = () => new Response('<html>busy</html>', { status: 200 });

  it('ブラウザのUAで products.json を取る', async () => {
    const f = vi.fn(async () => ok());
    const wait = vi.fn(async () => {});
    const v = await fetchMellojoyVariants(f as unknown as typeof fetch, wait);
    expect(v).toHaveLength(2);
    expect(wait).not.toHaveBeenCalled();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(MELLOJOY_PRODUCTS_URL);
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/Mozilla/);
  });
  it('HTMLが返ったら3秒あけて1回だけやり直す', async () => {
    const f = vi.fn().mockResolvedValueOnce(html()).mockResolvedValueOnce(ok());
    const wait = vi.fn(async () => {});
    await expect(fetchMellojoyVariants(f as unknown as typeof fetch, wait)).resolves.toHaveLength(2);
    expect(f).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(3000);
  });
  it('429(回数制限)はやり直さない', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } }));
    const wait = vi.fn(async () => {});
    await expect(fetchMellojoyVariants(f as unknown as typeof fetch, wait)).rejects.toThrow('HTTP 429(回数制限・retry-after 60秒)');
    expect(f).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
  it('2回ともだめなら MellojoyFetchError(3回目は無い)', async () => {
    const f = vi.fn(async () => new Response('err', { status: 503 }));
    await expect(fetchMellojoyVariants(f as unknown as typeof fetch, async () => {})).rejects.toThrow('HTTP 503');
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('runMellojoyWatch', () => {
  function deps(over: Partial<MellojoyRunDeps> & { prev?: MjState[] } = {}) {
    const saved: { states: MjState[]; events: { kind: string; variantId: string }[] }[] = [];
    const notify = vi.fn(async () => {});
    const d: MellojoyRunDeps = {
      fetchVariants: async () => parseProducts(fixture({ b: true })),
      loadState: async () => over.prev ?? [],
      save: async (states, events) => {
        saved.push({ states, events });
      },
      notify,
      now: () => new Date(T1),
      ...over,
    };
    return { d, saved, notify };
  }

  it('入荷があれば1通だけ通知して保存', async () => {
    const { d, saved, notify } = deps({ prev: stateFrom(fixture(), T0) });
    const r = await runMellojoyWatch(d);
    expect(r).toMatchObject({ ok: true, fetched: 2, available: 1, notified: true });
    expect(r.events.map((e) => e.kind)).toEqual(['restock']);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(saved[0].states).toHaveLength(2);
  });

  it('変化なしなら通知しない', async () => {
    const prev = stateFrom(fixture({ b: true }), T0);
    const { d, notify } = deps({ prev });
    const r = await runMellojoyWatch(d);
    expect(r.events).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('取得失敗は fetch_error を記録するだけ(通知しない)', async () => {
    const { d, saved, notify } = deps({
      fetchVariants: async () => {
        throw new MellojoyFetchError('JSONでない応答: <html>');
      },
    });
    const r = await runMellojoyWatch(d);
    expect(r).toMatchObject({ ok: false, fetched: 0 });
    expect(notify).not.toHaveBeenCalled();
    expect(saved[0].states).toEqual([]);
    expect(saved[0].events[0].kind).toBe('fetch_error');
  });

  it('通知に失敗した入荷は保存しない(次の分でもう一度通知される)', async () => {
    const { d, saved } = deps({
      prev: stateFrom(fixture(), T0),
      notify: async () => {
        throw new Error('pushover 500');
      },
    });
    const r = await runMellojoyWatch(d);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('pushover 500');
    expect(saved[0].states.map((s) => s.variantId)).toEqual(['49015389946096']);
    expect(saved[0].events).toEqual([]);
  });

  it('Pushover未設定でも履歴は残す', async () => {
    const { d, saved } = deps({ notify: null });
    const r = await runMellojoyWatch(d);
    expect(r.ok).toBe(false);
    expect(saved[0].events.map((e) => e.kind)).toEqual(['new_product', 'new_product']);
  });
});
