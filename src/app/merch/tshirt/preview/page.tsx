'use client';

// 動きの見比べ用ページ（TARO確認用・公開ページからは辿れない）。
// 3案を上のボタンで切り替えて、同じ商品で同じ文言のままスクロール感だけ比べる。
import { useState } from 'react';
import ProductShowcase, { type ShowcaseVariant } from '../ProductShowcase';

const VARIANTS: { key: ShowcaseVariant; label: string; note: string }[] = [
  { key: 'still', label: 'A 静', note: '商品は動かさない。文字だけがゆっくり入れ替わる' },
  { key: 'light', label: 'B 光', note: '商品は静止。生地の上を光が一度だけ通る' },
  { key: 'drift', label: 'C 流', note: '商品がゆっくり上へ流れる。わずかに近づく' },
];

export default function ShowcasePreviewPage() {
  const [v, setV] = useState<ShowcaseVariant>('light');
  const current = VARIANTS.find((x) => x.key === v)!;

  return (
    <main className="min-h-screen bg-[#0b0b0c] text-white">
      <div className="fixed top-0 inset-x-0 z-30 bg-[#0b0b0c]/85 backdrop-blur-md border-b border-white/10">
        <div className="mx-auto max-w-lg px-4 py-2.5">
          <div className="flex gap-2">
            {VARIANTS.map((x) => (
              <button
                key={x.key}
                onClick={() => setV(x.key)}
                className={`flex-1 py-2 text-[12px] tracking-wider border transition ${
                  v === x.key
                    ? 'border-white bg-white text-black'
                    : 'border-white/20 text-white/55 hover:border-white/45'
                }`}
              >
                {x.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-white/40 text-center">{current.note}</p>
        </div>
      </div>

      {/* 切り替えたら演出を作り直す(keyを変える)。スクロール位置は上に戻す */}
      <div className="pt-[76px]">
        <ProductShowcase
          key={v}
          variant={v}
          imageUrl="/merch/tshirt_black_black.png"
          productName="BOOM オフィシャルTシャツ（黒×黒モデル）"
        />
      </div>

      <section className="px-6 pb-32">
        <div className="mx-auto max-w-lg text-center">
          <p className="text-[10px] tracking-[0.4em] text-white/30 uppercase">Here the form follows</p>
          <p className="mt-4 text-[13px] text-white/45 leading-relaxed">
            この下に、いつもの商品情報と注文フォームが続きます。
            <br />
            見比べ用のページなので、ここでは省略しています。
          </p>
          <p className="mt-8 text-2xl font-light">¥3,500</p>
        </div>
      </section>
    </main>
  );
}
