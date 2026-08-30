'use client';

// BOOM オフィシャルTシャツ 公開注文ページ。
// デザイン方針: マット黒 + 白/グレーの階調のみ。余白を大きく取り、商品写真を主役にする
// (アパレルECの商品ページの見え方。BOOMブランド3色はここでは使わない=TARO指定)。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  getOrderView,
  submitOrder,
  loadOwnOrder,
  updateOwnOrder,
  type OrderReceipt,
  type PublicOrderView,
} from './actions';
import { TSHIRT_SIZES, type TshirtSize } from '@/lib/tshirtOrder';
import PantherHero from './PantherHero';

const TOKEN_KEY = 'boom_tshirt_order_token';

const yen = (n: number) => '¥' + n.toLocaleString('ja-JP');

// '2026-08-29' → '8/29(土)'
const WD = ['日', '月', '火', '水', '木', '金', '土'];
function fmtDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${wd})`;
}

export default function TshirtOrderPage() {
  const [view, setView] = useState<PublicOrderView | null>(null);
  const [loading, setLoading] = useState(true);
  // 演出を入れてフォームが下に伸びたぶん、注文への導線を常に出しておく
  const orderRef = useRef<HTMLDivElement>(null);
  const [showBar, setShowBar] = useState(false);

  const [name, setName] = useState('');
  const [size, setSize] = useState<TshirtSize | ''>('');
  const [qty, setQty] = useState(1);
  const [wantsShipping, setWantsShipping] = useState(false);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await getOrderView();
      setView(v);
      setLoading(false);
      const url = new URL(window.location.href);
      const t = url.searchParams.get('t') || localStorage.getItem(TOKEN_KEY);
      if (t) {
        const own = await loadOwnOrder(t);
        if (own.ok) {
          setToken(t);
          setName(own.order.name);
          setSize(own.order.size as TshirtSize);
          setQty(own.order.qty);
          setWantsShipping(own.order.wantsShipping);
          setAddress(own.order.address ?? '');
          setPhone(own.order.phone ?? '');
          setEditing(true);
        }
      }
    })();
  }, []);

  const settings = view?.settings ?? null;
  const state = view?.state ?? 'open';

  // 注文バーの出し入れ。
  //   出す条件 = 1画面ぶんスクロールした後（最初の1画面は商品だけ見せたいので出さない）
  //   引っ込める条件 = 注文フォームが画面に入った（同じボタンが二重に見えないように）
  useEffect(() => {
    const el = orderRef.current;
    if (!el) return;
    let formVisible = false;
    const evaluate = () => {
      const pastHero = window.scrollY > window.innerHeight * 0.8;
      setShowBar(pastHero && !formVisible);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        formVisible = entry.isIntersecting;
        evaluate();
      },
      { rootMargin: '-15% 0px 0px 0px' }
    );
    io.observe(el);
    window.addEventListener('scroll', evaluate, { passive: true });
    evaluate();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', evaluate);
    };
  }, [loading, state]);

  const total = useMemo(() => {
    if (!settings) return 0;
    return settings.unitPrice * qty + (wantsShipping ? settings.shippingFee : 0);
  }, [settings, qty, wantsShipping]);

  const onSubmit = useCallback(async () => {
    setError('');
    setSubmitting(true);
    const payload = { name, size, qty, wantsShipping, address, phone };
    // 新規と更新で戻り値の型が違う(新規だけ token を返す)ので、分岐してから受け取る
    if (token && editing) {
      const res = await updateOwnOrder(token, payload);
      setSubmitting(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReceipt(res.receipt);
    } else {
      const res = await submitOrder(payload);
      setSubmitting(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      localStorage.setItem(TOKEN_KEY, res.token);
      setToken(res.token);
      setReceipt(res.receipt);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [name, size, qty, wantsShipping, address, phone, token, editing]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0b0b0c] flex items-center justify-center">
        <p className="text-white/30 text-sm tracking-[0.3em]">LOADING</p>
      </main>
    );
  }

  // ---------- 注文完了 ----------
  if (receipt && settings) {
    return (
      <main className="min-h-screen bg-[#0b0b0c] text-white px-6 py-20">
        <div className="mx-auto max-w-lg">
          <p className="text-[11px] tracking-[0.4em] text-white/40 uppercase">Thank you</p>
          <h1 className="mt-5 text-2xl font-light tracking-wide">ご注文を承りました</h1>

          <div className="mt-10 border-y border-white/10 divide-y divide-white/10">
            <Row k="お名前" v={receipt.name} />
            <Row k="サイズ" v={receipt.size} />
            <Row k="枚数" v={`${receipt.qty}枚`} />
            <Row k="受け取り" v={receipt.wantsShipping ? '郵送' : 'レッスンで受け取り'} />
            <Row k="お支払い金額" v={yen(receipt.totalAmount)} strong />
          </div>

          <div className="mt-10 space-y-5 text-sm leading-relaxed text-white/70">
            <div>
              <p className="text-white/40 text-[11px] tracking-[0.2em] mb-1.5">お渡し</p>
              <p>{settings.pickupNote || '9/10(木)以降のレッスン時に、直接お渡しします。'}</p>
            </div>
            <div>
              <p className="text-white/40 text-[11px] tracking-[0.2em] mb-1.5">お支払い</p>
              <p>{settings.thanksNote || 'お支払いは、お渡しのときに現金と引き換えでお願いします。'}</p>
            </div>
            {receipt.wantsShipping && (
              <div>
                <p className="text-white/40 text-[11px] tracking-[0.2em] mb-1.5">郵送について</p>
                <p>ご記入の住所へお送りします。発送前にこちらからご連絡します。</p>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setReceipt(null);
              setEditing(true);
            }}
            className="mt-12 w-full border border-white/20 py-4 text-xs tracking-[0.25em] text-white/70 hover:bg-white/5 transition"
          >
            注文内容を変更する
          </button>
          <p className="mt-4 text-[11px] text-white/30 leading-relaxed">
            このページをブックマークしておくと、締切までは内容を変更できます。
          </p>
        </div>
      </main>
    );
  }

  // ---------- 受付期間外 ----------
  if (state !== 'open' && settings) {
    const msg =
      state === 'before'
        ? {
            label: 'COMING SOON',
            title: '受付開始前です',
            body: `${fmtDate(settings.openAt)} から ${fmtDate(settings.closeAt)} まで受け付けます。`,
          }
        : state === 'closed'
          ? {
              label: 'CLOSED',
              title: '受付を終了しました',
              body: `${fmtDate(settings.closeAt)} をもって締め切りました。次回の販売をお待ちください。`,
            }
          : {
              label: 'CLOSED',
              title: '現在、受付を停止しています',
              body: '再開までしばらくお待ちください。',
            };
    return (
      <main className="min-h-screen bg-[#0b0b0c] text-white flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <ProductImage settings={settings} />
          <p className="mt-10 text-[11px] tracking-[0.4em] text-white/40">{msg.label}</p>
          <h1 className="mt-4 text-xl font-light tracking-wide">{msg.title}</h1>
          <p className="mt-4 text-sm text-white/50 leading-relaxed">{msg.body}</p>
        </div>
      </main>
    );
  }

  if (!settings) return null;

  // ---------- 注文フォーム ----------
  return (
    <main className="min-h-screen bg-[#0b0b0c] text-white">
      {/* ヒーロー: スクロールに合わせて商品が動く(Appleの製品ページのような見せ方) */}
      {/* E案(黒豹動画)で確定 2026-08-30。D案(3D回転)は /merch/tshirt/preview に残してある */}
      <PantherHero />

      {/* 商品情報 */}
      <section className="px-6">
        <div className="mx-auto max-w-lg">
          <h1 className="text-[22px] font-light leading-snug tracking-wide">
            {settings.productName}
          </h1>
          <p className="mt-3 text-lg font-light tracking-wider text-white/90">
            {yen(settings.unitPrice)}
            <span className="ml-2 text-[11px] text-white/35">税込</span>
          </p>

          {settings.introMd && (
            <p className="mt-7 text-[13px] leading-[2] text-white/55 whitespace-pre-wrap">
              {settings.introMd}
            </p>
          )}

          <dl className="mt-9 border-t border-white/10 divide-y divide-white/10 text-[13px]">
            <SpecRow k="サイズ" v={TSHIRT_SIZES.join(' / ')} />
            <SpecRow k="お渡し" v={settings.pickupNote} />
            <SpecRow k="お支払い" v={settings.thanksNote} />
            <SpecRow
              k="受付期間"
              v={`${fmtDate(settings.openAt)} 〜 ${fmtDate(settings.closeAt)}`}
            />
            <SpecRow
              k="郵送をご希望の方"
              v={`全国一律 +${yen(settings.shippingFee)}（何枚でも一律です）`}
            />
          </dl>
        </div>
      </section>

      {/* 注文フォーム */}
      <section ref={orderRef} className="px-6 pt-16 pb-24">
        <div className="mx-auto max-w-lg">
          <p className="text-[10px] tracking-[0.4em] text-white/35 uppercase">
            {editing ? 'Edit your order' : 'Order'}
          </p>
          {editing && (
            <p className="mt-3 text-[12px] text-white/45 leading-relaxed">
              前回のご注文を読み込みました。内容を書き換えて「注文内容を更新する」を押してください。
            </p>
          )}

          <div className="mt-8 space-y-9">
            <Field label="お名前">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ブーム 太郎"
                autoComplete="name"
                className="w-full bg-transparent border-b border-white/20 py-3 text-[15px] outline-none focus:border-white/60 transition placeholder:text-white/20"
              />
            </Field>

            <Field label="サイズ">
              <div className="grid grid-cols-5 gap-2">
                {TSHIRT_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSize(s)}
                    className={`py-3.5 text-[13px] tracking-wider border transition ${
                      size === s
                        ? 'border-white bg-white text-black'
                        : 'border-white/20 text-white/60 hover:border-white/50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="枚数">
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-11 h-11 border border-white/20 text-white/60 hover:border-white/50 transition text-lg leading-none"
                  aria-label="減らす"
                >
                  −
                </button>
                <span className="text-lg font-light w-8 text-center tabular-nums">{qty}</span>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(20, q + 1))}
                  className="w-11 h-11 border border-white/20 text-white/60 hover:border-white/50 transition text-lg leading-none"
                  aria-label="増やす"
                >
                  +
                </button>
              </div>
            </Field>

            {/* 郵送オプション: チェック時のみ住所・電話を表示 */}
            <div className="border-t border-white/10 pt-8">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={wantsShipping}
                  onChange={(e) => setWantsShipping(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-white"
                />
                <span>
                  <span className="text-[14px] text-white/85 group-hover:text-white transition">
                    郵送を希望する
                  </span>
                  <span className="block mt-1 text-[11px] text-white/35">
                    レッスンに来られない方はこちら（何枚でも一律 +{yen(settings.shippingFee)}）
                  </span>
                </span>
              </label>

              {wantsShipping && (
                <div className="mt-8 space-y-8 pl-7">
                  <Field label="ご住所">
                    <input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="宮城県仙台市〇〇区〇〇 1-2-3 〇〇マンション101"
                      autoComplete="street-address"
                      className="w-full bg-transparent border-b border-white/20 py-3 text-[15px] outline-none focus:border-white/60 transition placeholder:text-white/20"
                    />
                  </Field>
                  <Field label="お電話番号">
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="090-1234-5678"
                      inputMode="tel"
                      autoComplete="tel"
                      className="w-full bg-transparent border-b border-white/20 py-3 text-[15px] outline-none focus:border-white/60 transition placeholder:text-white/20"
                    />
                  </Field>
                </div>
              )}
            </div>

            {/* 合計。郵送を選んだときは内訳を出す(送料が枚数分に見えないように) */}
            <div className="border-t border-white/10 pt-7">
              {wantsShipping && (
                <div className="mb-3 space-y-1 text-[12px] text-white/40">
                  <div className="flex justify-between">
                    <span>
                      Tシャツ {yen(settings.unitPrice)} × {qty}枚
                    </span>
                    <span>{yen(settings.unitPrice * qty)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>郵送料（何枚でも一律）</span>
                    <span>{yen(settings.shippingFee)}</span>
                  </div>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] tracking-[0.25em] text-white/40">合計</span>
                <span className="text-2xl font-light tracking-wide">{yen(total)}</span>
              </div>
            </div>

            {error && (
              <p className="text-[13px] text-red-300/90 border border-red-400/25 bg-red-500/5 px-4 py-3">
                {error}
              </p>
            )}

            <button
              onClick={onSubmit}
              disabled={submitting}
              className="w-full bg-white text-black py-5 text-[12px] tracking-[0.3em] font-medium hover:bg-white/85 transition disabled:opacity-40"
            >
              {submitting ? '送信中…' : editing ? '注文内容を更新する' : '注文する'}
            </button>

            <p className="text-[11px] text-white/30 leading-[1.9] text-center">
              お支払いはこの画面では発生しません。
              <br />
              {settings.thanksNote}
            </p>
          </div>
        </div>
      </section>

      {/* 画面下の注文バー: フォームが見えていない間だけ出す */}
      <div
        className={`fixed inset-x-0 bottom-0 z-20 transition-all duration-300 ${
          showBar ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="bg-[#0b0b0c]/90 backdrop-blur-md border-t border-white/10 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-lg flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] tracking-[0.2em] text-white/35 truncate">オフィシャルTシャツ</p>
              <p className="text-[15px] font-light">{yen(settings.unitPrice)}</p>
            </div>
            <button
              onClick={() => orderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="shrink-0 bg-white text-black px-7 py-3 text-[11px] tracking-[0.25em] font-medium hover:bg-white/85 transition"
            >
              注文する
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function ProductImage({ settings }: { settings: { imageUrl: string; productName: string } }) {
  return (
    <div className="relative mt-6 aspect-square w-full">
      {/* 商品の背後に淡い光を置き、黒地に黒Tシャツが沈まないようにする */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 42%, transparent 68%)',
        }}
      />
      <Image
        src={settings.imageUrl}
        alt={settings.productName}
        fill
        priority
        sizes="(max-width: 640px) 100vw, 512px"
        className="object-contain p-4"
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] tracking-[0.3em] text-white/40 mb-3 uppercase">{label}</p>
      {children}
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div className="flex gap-6 py-4">
      <dt className="w-28 shrink-0 text-white/35 text-[11px] tracking-[0.15em] pt-0.5">{k}</dt>
      <dd className="text-white/70 leading-relaxed">{v}</dd>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between items-baseline py-4">
      <span className="text-[11px] tracking-[0.2em] text-white/40">{k}</span>
      <span className={strong ? 'text-lg font-light' : 'text-[15px] text-white/85'}>{v}</span>
    </div>
  );
}
