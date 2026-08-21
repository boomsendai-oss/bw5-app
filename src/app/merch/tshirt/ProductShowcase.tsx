'use client';

// 商品ヒーローのスクロール演出。
//
// 設計方針（2026-08-21 TARO指摘を受けて作り直し）:
//  1. **大きく拡大しない**。元写真が 553px しかなく、以前の2.45倍は実効4.6倍の
//     引き伸ばしでボケていた。ボケた絵が伸び縮みすると安っぽく見える
//  2. **平面写真を3D回転させない**。紙が回っているようにしか見えない
//  3. **動きは一方向・ゆっくり・ばね減衰**。往復させると落ち着きが無くなる
//  4. 商品は基本 **動かさない**。動かすのは光と文字
//
// 仕組み: 縦に長い枠の中で商品を sticky で画面に留め、枠の通過率(0→1)を
// ばねで滑らかにしてから各値へ割り当てる。
import { useEffect, useRef, type RefObject } from 'react';
import Image from 'next/image';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';

export type ShowcaseVariant = 'still' | 'light' | 'drift';

const SCROLL_VH = 300;

interface Chapter {
  eyebrow: string;
  title: string;
  body: string;
}

const CHAPTERS: Chapter[] = [
  {
    eyebrow: 'BOOM OFFICIAL',
    title: '黒に、黒。',
    body: 'ウォッシュをかけた黒のボディに、黒でロゴをのせました。',
  },
  {
    eyebrow: 'THE PRINT',
    title: '光の角度で、浮かぶ。',
    body: '正面からは沈んで見えるロゴが、動くと立ち上がってきます。',
  },
  {
    eyebrow: 'EVERY DAY',
    title: 'レッスンでも、街でも。',
    body: '一枚で成立する落ち感。着るところを選びません。',
  },
];

export default function ProductShowcase({
  imageUrl,
  productName,
  variant = 'light',
}: {
  imageUrl: string;
  productName: string;
  priceLabel?: string;
  variant?: ShowcaseVariant;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const raw = useSectionProgress(ref);

  // スクロール量をそのまま使うと指の動きに1:1で貼りつき、機械的に見える。
  // ばねで少し遅らせて追従させると、ぬるっとした質感になる。
  const p = useSpring(raw, { stiffness: 90, damping: 26, mass: 0.6, restDelta: 0.0005 });

  // 商品は「置いてある」状態を保つ。動かすのはごくわずか。
  const scale = useTransform(p, [0, 1], variant === 'drift' ? [1, 1.1] : [1, 1.04]);
  const y = useTransform(p, [0, 1], variant === 'drift' ? ['4%', '-6%'] : ['0%', '0%']);

  // 光沢: 商品の形で切り抜いた光が、上から下へ一度だけ通る。
  // 「光の角度でロゴが浮かぶ」という商品の売りを、そのまま画面上で見せる。
  const sheen = useTransform(p, [0.1, 0.85], ['-35%', '135%']);
  const sheenOpacity = useTransform(p, [0.05, 0.2, 0.75, 0.9], [0, 1, 1, 0]);

  if (reduced) {
    return (
      <section className="px-6 pt-14">
        <div className="mx-auto max-w-lg text-center">
          <p className="text-[10px] tracking-[0.45em] text-white/35 uppercase">BOOM OFFICIAL</p>
          <StillImage imageUrl={imageUrl} productName={productName} />
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} style={{ height: `${SCROLL_VH}vh` }} className="relative">
      <div className="sticky top-0 h-[100svh] overflow-hidden flex flex-col items-center justify-center">
        <motion.div style={{ scale, y }} className="relative w-[min(78vw,400px)] aspect-square">
          {/* 商品の背後の淡い光。黒地に黒Tシャツが沈まないための最低限 */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 46%, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.03) 45%, transparent 70%)',
            }}
          />
          <Image
            src={imageUrl}
            alt={productName}
            fill
            priority
            sizes="(max-width: 640px) 78vw, 400px"
            className="object-contain"
          />

          {variant === 'light' && (
            <Sheen imageUrl={imageUrl} yPos={sheen} opacity={sheenOpacity} />
          )}
        </motion.div>

        <div className="relative mt-8 h-32 w-full px-8">
          {CHAPTERS.map((c, i) => (
            <ChapterCopy key={c.eyebrow} chapter={c} index={i} progress={p} />
          ))}
        </div>

        <ScrollHint progress={p} />
      </div>
    </section>
  );
}

// 商品のPNG(背景透過)をマスクに使い、光をTシャツの形の中だけに通す。
// 四角い光が横切るのと違って、生地の上を光が滑って見える。
function Sheen({
  imageUrl,
  yPos,
  opacity,
}: {
  imageUrl: string;
  yPos: MotionValue<string>;
  opacity: MotionValue<number>;
}) {
  const mask = {
    maskImage: `url(${imageUrl})`,
    WebkitMaskImage: `url(${imageUrl})`,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
  } as const;

  return (
    <motion.div style={{ ...mask, opacity }} className="absolute inset-0 pointer-events-none">
      <motion.div
        style={{ y: yPos }}
        className="absolute inset-x-0 h-[45%]"
        // 白すぎると生地が飛ぶので、ごく薄い帯を斜めにかける
      >
        <div
          className="w-full h-full"
          style={{
            background:
              'linear-gradient(175deg, transparent 0%, rgba(255,255,255,0.16) 45%, rgba(255,255,255,0.26) 52%, rgba(255,255,255,0.10) 60%, transparent 100%)',
          }}
        />
      </motion.div>
    </motion.div>
  );
}

function findScroller(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

// 対象セクションの通過率 0→1。
// ⚠️ globals.css の `body { overflow-x: hidden }` により body 側がスクロール枠に
//    なり得るため、framer-motion の useScroll(既定でwindow監視)では反応しない。
//    実行時に本当のスクロール枠を突き止める。
function useSectionProgress(ref: RefObject<HTMLDivElement | null>): MotionValue<number> {
  const progress = useMotionValue(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = findScroller(el);
    const target: HTMLElement | Window = scroller ?? window;

    const update = () => {
      const viewH = scroller ? scroller.clientHeight : window.innerHeight;
      const rect = el.getBoundingClientRect();
      const base = scroller ? scroller.getBoundingClientRect().top : 0;
      const travel = el.offsetHeight - viewH;
      progress.set(travel > 0 ? clamp01(-(rect.top - base) / travel) : 0);
    };

    update();
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      target.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ref, progress]);

  return progress;
}

function ChapterCopy({
  chapter,
  index,
  progress,
}: {
  chapter: Chapter;
  index: number;
  progress: MotionValue<number>;
}) {
  const span = 1 / CHAPTERS.length;
  const start = index * span;
  const end = start + span;
  const fade = span * 0.3;
  const isFirst = index === 0;
  const isLast = index === CHAPTERS.length - 1;

  const opacity = useTransform(
    progress,
    [start - fade, start, end - fade, end],
    isFirst ? [1, 1, 1, 0] : isLast ? [0, 1, 1, 1] : [0, 1, 1, 0]
  );
  // 上に流れながら消える(Appleの縦組みの見せ方)。動きは10px程度に抑える
  const y = useTransform(
    progress,
    [start - fade, start, end - fade, end],
    isFirst ? [0, 0, 0, -10] : isLast ? [10, 0, 0, 0] : [10, 0, 0, -10]
  );

  return (
    <motion.div
      style={{ opacity, y }}
      className="absolute inset-x-0 text-center pointer-events-none"
    >
      <p className="text-[10px] tracking-[0.4em] text-white/30 uppercase">{chapter.eyebrow}</p>
      <h2 className="mt-3.5 text-[27px] font-light tracking-[0.02em] text-white leading-snug">
        {chapter.title}
      </h2>
      <p className="mt-3.5 text-[13px] leading-relaxed text-white/45">{chapter.body}</p>
    </motion.div>
  );
}

function ScrollHint({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0, 0.06], [1, 0]);
  return (
    <motion.div
      style={{ opacity }}
      className="absolute bottom-8 inset-x-0 flex flex-col items-center gap-2 pointer-events-none"
    >
      <span className="text-[9px] tracking-[0.35em] text-white/25 uppercase">Scroll</span>
      <span className="block h-8 w-px bg-gradient-to-b from-white/30 to-transparent" />
    </motion.div>
  );
}

function StillImage({ imageUrl, productName }: { imageUrl: string; productName: string }) {
  return (
    <div className="relative mt-6 aspect-square w-full">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 44%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 42%, transparent 68%)',
        }}
      />
      <Image
        src={imageUrl}
        alt={productName}
        fill
        priority
        sizes="(max-width: 640px) 100vw, 512px"
        className="object-contain p-4"
      />
    </div>
  );
}
