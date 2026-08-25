'use client';

// 無人物販kiosk (iPad向け・ガイドアクセスでロックして会場に設置)。
// 画面フロー: 商品いちらん(トップ) → 商品詳細(カラー/サイズ/枚数) → カゴ → QR決済 or 現金 → 完了。
// TAROフィードバック(2026-08-25)反映: アトラクト画面廃止・カラー行+サイズプルダウン・
// 枚数まとめ入れ・「お会計に進む」導線・決済ボタンは手段名を主文言に。
// 決済完了の検知は /api/kiosk/order/[id]/status のポーリング。
// オフライン・API障害時は「現金でお願いします」に縮退する。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  addToCart,
  cartCount,
  cartTotal,
  changeQty,
  removeFromCart,
  type CartLine,
} from '@/lib/kioskCart';
import { KIOSK_MAX_QTY_PER_ORDER } from '@/lib/kioskShared';

const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');

interface CatalogVariant {
  id: number;
  label: string;
  color: string;
  size: string;
  available: number;
}
interface CatalogProduct {
  id: number;
  name: string;
  price: number;
  imageUrl: string;
  description: string;
  available: number;
  variants: CatalogVariant[];
}
interface Catalog {
  sale: { id: number; name: string } | null;
  products: CatalogProduct[];
}

type Screen =
  | { kind: 'catalog' }
  | { kind: 'product'; product: CatalogProduct }
  | { kind: 'cart' }
  | { kind: 'cashConfirm' }
  | { kind: 'qr'; orderId: number; qrDataUrl: string; amountTotal: number; expiresAt: number }
  | { kind: 'done'; amountTotal: number; method: 'stripe' | 'cash' }
  | { kind: 'offline' };

const IDLE_RESET_MS = 90_000;
const DONE_RESET_MS = 8_000;
const POLL_MS = 2_500;

export default function KioskPage() {
  const [screen, setScreen] = useState<Screen>({ kind: 'catalog' });
  const [catalog, setCatalog] = useState<Catalog>({ sale: null, products: [] });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const lastTouchRef = useRef(Date.now());

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/kiosk/catalog', { cache: 'no-store' });
      if (!res.ok) throw new Error('catalog');
      setCatalog(await res.json());
      if (screenRef.current.kind === 'offline') setScreen({ kind: 'catalog' });
    } catch {
      if (screenRef.current.kind === 'catalog') setScreen({ kind: 'offline' });
    }
  }, []);

  // 初回+定期リロード(在庫の反映)。オフライン復帰の再試行も兼ねる
  useEffect(() => {
    loadCatalog();
    const t = setInterval(() => {
      if (screenRef.current.kind === 'catalog' || screenRef.current.kind === 'offline') loadCatalog();
    }, 30_000);
    return () => clearInterval(t);
  }, [loadCatalog]);

  const resetToTop = useCallback(() => {
    setCart([]);
    setNotice('');
    setScreen({ kind: 'catalog' });
    loadCatalog();
  }, [loadCatalog]);

  const cancelOrder = useCallback((orderId: number) => {
    // 応答は待たない(リセット優先)。サーバ側でStripeセッションも失効される
    fetch(`/api/kiosk/order/${orderId}/cancel`, { method: 'POST' }).catch(() => undefined);
  }, []);

  // 無操作リセット(トップとQR・完了・オフラインは除外)
  useEffect(() => {
    const mark = () => {
      lastTouchRef.current = Date.now();
    };
    window.addEventListener('pointerdown', mark);
    const t = setInterval(() => {
      const s = screenRef.current;
      if (s.kind === 'catalog' || s.kind === 'qr' || s.kind === 'done' || s.kind === 'offline') return;
      if (Date.now() - lastTouchRef.current > IDLE_RESET_MS) resetToTop();
    }, 5_000);
    return () => {
      window.removeEventListener('pointerdown', mark);
      clearInterval(t);
    };
  }, [resetToTop]);

  // QR画面: 決済完了ポーリング + 期限切れ自動リセット
  useEffect(() => {
    if (screen.kind !== 'qr') return;
    const { orderId, amountTotal, expiresAt } = screen;
    const t = setInterval(async () => {
      if (Date.now() > expiresAt) {
        cancelOrder(orderId);
        setNotice('時間切れになりました。もう一度お試しください');
        setCart([]);
        setScreen({ kind: 'catalog' });
        return;
      }
      try {
        const res = await fetch(`/api/kiosk/order/${orderId}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const { status } = await res.json();
        if (status === 'paid') setScreen({ kind: 'done', amountTotal, method: 'stripe' });
        else if (status === 'expired' || status === 'voided') {
          setNotice('お支払いが確認できませんでした。もう一度お試しください');
          setCart([]);
          setScreen({ kind: 'catalog' });
        }
      } catch {
        /* 一時的な通信エラーは次のポーリングで再試行 */
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [screen, cancelOrder]);

  // 完了画面: 自動で先頭へ
  useEffect(() => {
    if (screen.kind !== 'done') return;
    const t = setTimeout(resetToTop, DONE_RESET_MS);
    return () => clearTimeout(t);
  }, [screen, resetToTop]);

  const startStripe = async () => {
    if (busy || cart.length === 0) return;
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/kiosk/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setNotice(body?.error ?? 'エラーが発生しました。現金でのお支払いをお願いします');
        return;
      }
      const qrDataUrl = await QRCode.toDataURL(body.checkoutUrl, { width: 480, margin: 1 });
      setScreen({
        kind: 'qr',
        orderId: body.orderId,
        qrDataUrl,
        amountTotal: body.amountTotal,
        expiresAt: Date.now() + Number(body.holdSeconds ?? 300) * 1000,
      });
    } catch {
      setNotice('通信エラーです。現金でのお支払いをお願いします');
    } finally {
      setBusy(false);
    }
  };

  const confirmCash = async () => {
    if (busy || cart.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/kiosk/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setNotice(body?.error ?? 'エラーが発生しました。スタッフをお呼びください');
        setScreen({ kind: 'cart' });
        return;
      }
      setScreen({ kind: 'done', amountTotal: body.amountTotal, method: 'cash' });
    } catch {
      setNotice('通信エラーです。お手数ですがスタッフをお呼びください');
      setScreen({ kind: 'cart' });
    } finally {
      setBusy(false);
    }
  };

  const total = useMemo(() => cartTotal(cart), [cart]);
  const count = useMemo(() => cartCount(cart), [cart]);

  // ─────────────────────────── 画面 ───────────────────────────

  if (screen.kind === 'offline') {
    return (
      <Center>
        <p className="text-6xl">🙏</p>
        <h1 className="text-4xl font-bold">ただいまオンライン決済が</h1>
        <h1 className="text-4xl font-bold">ご利用いただけません</h1>
        <p className="mt-6 text-2xl text-navy-700">
          お手数ですが、<span className="font-bold">現金を貯金箱へ</span>お願いします。
          <br />
          金額分を入れて、商品をお持ちください。
        </p>
        <p className="mt-8 text-lg text-navy-500">(接続が復帰すると自動でもとに戻ります)</p>
      </Center>
    );
  }

  if (screen.kind === 'product') {
    return (
      <ProductScreen
        product={screen.product}
        onBack={() => setScreen({ kind: 'catalog' })}
        onAdd={(input, qty) => {
          setCart((c) => addToCart(c, input, qty));
          setScreen({ kind: 'catalog' });
        }}
      />
    );
  }

  if (screen.kind === 'qr') {
    const secondsLeft = Math.max(0, Math.round((screen.expiresAt - Date.now()) / 1000));
    return (
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-6 p-8 text-center">
        <h2 className="text-4xl font-bold">
          スマホのカメラで読み取って
          <br />
          お支払いください
        </h2>
        <p className="text-2xl font-bold text-brand-700">{yen(screen.amountTotal)}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- クライアント生成のQR data URL */}
        <img src={screen.qrDataUrl} alt="お支払いQRコード" className="h-80 w-80 rounded-xl bg-white p-3 shadow-lg" />
        <p className="text-xl text-navy-700">カード / PayPay / Apple Pay / Google Pay が使えます</p>
        <p className="text-lg text-navy-500">お支払いが確認できると、この画面が自動で切り替わります(残り約{Math.ceil(secondsLeft / 60)}分)</p>
        <BigButton
          subtle
          onClick={() => {
            cancelOrder(screen.orderId);
            setScreen({ kind: 'cart' });
          }}
        >
          ← やめる(カゴに戻る)
        </BigButton>
      </div>
    );
  }

  if (screen.kind === 'done') {
    return (
      <Center>
        <p className="text-7xl">🙌</p>
        <h1 className="text-5xl font-extrabold text-brand-700">
          {screen.method === 'cash' ? 'ありがとうございました！' : 'お支払い確認できました！'}
        </h1>
        <p className="mt-6 text-3xl font-bold">商品をお持ちください</p>
        <p className="mt-2 text-2xl text-navy-700">{yen(screen.amountTotal)}</p>
        <p className="mt-10 text-lg text-navy-500">この画面は数秒で最初に戻ります</p>
      </Center>
    );
  }

  if (screen.kind === 'cashConfirm') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-8 p-8 text-center">
        <h2 className="text-4xl font-bold">現金でのお支払い</h2>
        <p className="rounded-2xl bg-white px-10 py-6 text-5xl font-extrabold text-brand-700 shadow">{yen(total)}</p>
        <p className="text-2xl leading-relaxed text-navy-800">
          この金額を<span className="font-bold">貯金箱</span>に入れてください
          <br />
          <span className="text-lg text-navy-500">(おつりは出ません。ぴったりの金額をお願いします)</span>
        </p>
        <div className="flex gap-6">
          <BigButton subtle onClick={() => setScreen({ kind: 'cart' })}>
            ← まだ
          </BigButton>
          <BigButton onClick={confirmCash} disabled={busy}>
            {busy ? '記録中…' : '入れました'}
          </BigButton>
        </div>
      </div>
    );
  }

  if (screen.kind === 'cart') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 p-6">
        <h2 className="text-3xl font-bold">カゴの中身</h2>
        {notice && <Banner>{notice}</Banner>}
        <div className="flex-1 space-y-3">
          {cart.length === 0 && <p className="py-16 text-center text-2xl text-navy-500">カゴは空です</p>}
          {cart.map((l) => (
            <div key={`${l.productId}:${l.variantId}`} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow">
              <div className="flex-1">
                <p className="text-2xl font-bold">
                  {l.name}
                  {l.variantLabel && <span className="ml-2 rounded bg-sand-100 px-2 py-0.5 text-lg">{l.variantLabel}</span>}
                </p>
                <p className="text-xl text-navy-700">{yen(l.price)}</p>
              </div>
              <button type="button" onClick={() => setCart((c) => changeQty(c, l.productId, l.variantId, -1))} className="h-14 w-14 rounded-full bg-sand-100 text-3xl font-bold">
                −
              </button>
              <span className="w-10 text-center text-3xl font-bold">{l.qty}</span>
              <button type="button" onClick={() => setCart((c) => changeQty(c, l.productId, l.variantId, +1))} className="h-14 w-14 rounded-full bg-sand-100 text-3xl font-bold">
                ＋
              </button>
              <button type="button" onClick={() => setCart((c) => removeFromCart(c, l.productId, l.variantId))} className="ml-2 text-lg text-navy-400 underline">
                削除
              </button>
            </div>
          ))}
        </div>
        <div className="rounded-2xl bg-navy-900 p-6 text-white">
          <div className="flex items-center justify-between text-2xl">
            <span>合計 {count}点</span>
            <span className="text-4xl font-extrabold">{yen(total)}</span>
          </div>
          <p className="mt-4 text-center text-lg font-bold text-white/80">お支払い方法を選んでください</p>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <button
              type="button"
              disabled={cart.length === 0 || busy}
              onClick={startStripe}
              className="rounded-2xl bg-brand-500 px-6 py-6 text-2xl font-bold disabled:opacity-40"
            >
              {busy ? '準備中…' : 'カード / PayPay / Apple Pay'}
              <span className="block text-base font-normal">支払い用QRコードを表示</span>
            </button>
            <button
              type="button"
              disabled={cart.length === 0 || busy}
              onClick={() => setScreen({ kind: 'cashConfirm' })}
              className="rounded-2xl bg-white px-6 py-6 text-2xl font-bold text-navy-900 disabled:opacity-40"
            >
              現金
              <span className="block text-base font-normal">この金額を貯金箱に入れてください</span>
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setScreen({ kind: 'catalog' })} className="py-2 text-xl text-navy-600 underline">
          ← 商品いちらんに戻る
        </button>
      </div>
    );
  }

  // catalog (トップ)
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-6 pb-32">
      <div className="text-center">
        <p className="text-lg font-bold tracking-widest text-brand-600">BOOM GOODS</p>
        <h1 className="text-3xl font-extrabold">{catalog.sale ? catalog.sale.name : '準備中です'}</h1>
      </div>
      {notice && <Banner>{notice}</Banner>}
      <div className="grid flex-1 grid-cols-2 content-start gap-5 md:grid-cols-3">
        {catalog.products.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={p.available <= 0}
            onClick={() => setScreen({ kind: 'product', product: p })}
            className="rounded-2xl bg-white p-4 text-left shadow disabled:opacity-50"
          >
            {p.imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- 動的な商品写真 */
              <img src={p.imageUrl} alt={p.name} className="aspect-square w-full rounded-xl object-cover" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-sand-100 text-5xl">🛍️</div>
            )}
            <p className="mt-3 text-xl font-bold">{p.name}</p>
            <p className="text-2xl font-extrabold text-brand-700">{yen(p.price)}</p>
            {p.available <= 0 ? (
              <p className="font-bold text-red-600">売り切れ</p>
            ) : p.available <= 3 ? (
              <p className="text-red-600">残りわずか</p>
            ) : null}
          </button>
        ))}
        {catalog.sale && catalog.products.length === 0 && (
          <p className="col-span-full py-16 text-center text-2xl text-navy-500">商品を準備中です</p>
        )}
      </div>
      <div className="flex items-center justify-end">
        <a href="/kiosk/legal" className="py-2 text-sm text-navy-400 underline">
          特定商取引法に基づく表記
        </a>
      </div>
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 p-4">
          {/* TARO要望(2026-08-25): 目立つオレンジで。kioskはイベント現場UIなのでブランド3色縛りの対象外 */}
          <button
            type="button"
            onClick={() => setScreen({ kind: 'cart' })}
            className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-orange-500 px-8 py-6 text-white shadow-2xl ring-4 ring-white/60"
          >
            <span className="text-3xl font-extrabold">お会計に進む →</span>
            <span className="text-3xl font-extrabold">
              {count}点 {yen(total)}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** 商品詳細: カラー行 + サイズプルダウン + 枚数 → カゴに入れる。 */
function ProductScreen({
  product: p,
  onBack,
  onAdd,
}: {
  product: CatalogProduct;
  onBack: () => void;
  onAdd: (input: { productId: number; variantId: number | null; name: string; variantLabel: string; price: number; max: number }, qty: number) => void;
}) {
  const colors = useMemo(() => {
    const seen: string[] = [];
    for (const v of p.variants) if (!seen.includes(v.color)) seen.push(v.color);
    return seen;
  }, [p.variants]);
  const hasColors = colors.some((c) => c !== '');

  const [color, setColor] = useState(colors[0] ?? '');
  const [variantId, setVariantId] = useState<number | ''>('');
  const [qty, setQty] = useState(1);

  const sizesOfColor = p.variants.filter((v) => v.color === color);
  const selectedVariant = p.variants.find((v) => v.id === variantId) ?? null;
  const maxQty = Math.min(p.variants.length > 0 ? (selectedVariant?.available ?? 0) : p.available, KIOSK_MAX_QTY_PER_ORDER);
  const canAdd = p.variants.length === 0 ? p.available > 0 : selectedVariant != null && selectedVariant.available > 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 p-8">
      <div className="flex items-start gap-6">
        {p.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- 動的な商品写真 */
          <img src={p.imageUrl} alt={p.name} className="h-48 w-48 rounded-2xl object-cover shadow" />
        ) : (
          <div className="flex h-48 w-48 items-center justify-center rounded-2xl bg-sand-100 text-6xl">🛍️</div>
        )}
        <div>
          <h2 className="text-4xl font-bold">{p.name}</h2>
          <p className="mt-2 text-3xl font-extrabold text-brand-700">{yen(p.price)}</p>
          {p.description && <p className="mt-3 text-lg text-navy-600">{p.description}</p>}
        </div>
      </div>

      {hasColors && (
        <div>
          <p className="mb-2 text-xl font-bold">カラー</p>
          <div className="flex flex-wrap gap-3">
            {colors.map((c) => {
              const colorAvailable = p.variants.filter((v) => v.color === c).reduce((s, v) => s + v.available, 0);
              return (
                <button
                  key={c || '(単色)'}
                  type="button"
                  disabled={colorAvailable <= 0}
                  onClick={() => {
                    setColor(c);
                    setVariantId('');
                    setQty(1);
                  }}
                  className={`rounded-2xl border-4 px-6 py-4 text-2xl font-bold disabled:border-navy-100 disabled:text-navy-300 ${
                    color === c ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-navy-200 bg-white'
                  }`}
                >
                  {c || 'その他'}
                  {colorAvailable <= 0 && <span className="block text-sm font-normal">売り切れ</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {p.variants.length > 0 && (
        <div>
          <p className="mb-2 text-xl font-bold">サイズ</p>
          <select
            value={variantId}
            onChange={(e) => {
              setVariantId(e.target.value === '' ? '' : Number(e.target.value));
              setQty(1);
            }}
            className="w-full max-w-sm rounded-2xl border-4 border-navy-200 bg-white px-5 py-4 text-2xl font-bold"
          >
            <option value="">サイズを選んでください</option>
            {sizesOfColor.map((v) => (
              <option key={v.id} value={v.id} disabled={v.available <= 0}>
                {v.size || v.label}
                {v.available <= 0 ? '(売り切れ)' : v.available <= 3 ? ` (残り${v.available})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <p className="mb-2 text-xl font-bold">枚数</p>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-16 w-16 rounded-full bg-sand-100 text-4xl font-bold">
            −
          </button>
          <span className="w-14 text-center text-4xl font-bold">{qty}</span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(Math.max(1, maxQty), q + 1))}
            className="h-16 w-16 rounded-full bg-sand-100 text-4xl font-bold"
          >
            ＋
          </button>
          {selectedVariant && selectedVariant.available <= 3 && <span className="text-lg text-red-600">残り{selectedVariant.available}</span>}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-4">
        <BigButton subtle onClick={onBack}>
          ← もどる
        </BigButton>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() =>
            onAdd(
              {
                productId: p.id,
                variantId: selectedVariant?.id ?? null,
                name: p.name,
                variantLabel: selectedVariant?.label ?? '',
                price: p.price,
                max: Math.max(1, maxQty),
              },
              qty
            )
          }
          className="flex-1 rounded-2xl bg-brand-500 px-8 py-6 text-3xl font-bold text-white disabled:opacity-40"
        >
          カゴに入れる {qty > 1 ? `(${qty}点)` : ''}
        </button>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center p-8 text-center">{children}</div>;
}

function Banner({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl bg-red-50 px-6 py-4 text-xl font-bold text-red-700">{children}</div>;
}

function BigButton({ children, onClick, subtle, disabled }: { children: React.ReactNode; onClick: () => void; subtle?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        subtle
          ? 'rounded-2xl border-2 border-navy-300 px-8 py-5 text-2xl font-bold text-navy-700 disabled:opacity-40'
          : 'rounded-2xl bg-brand-500 px-8 py-5 text-2xl font-bold text-white disabled:opacity-40'
      }
    >
      {children}
    </button>
  );
}
