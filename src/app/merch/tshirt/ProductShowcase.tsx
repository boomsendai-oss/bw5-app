'use client';

// 商品ヒーローのスクロール演出（Appleの製品ページのような見せ方・TARO指定 2026-08-21）。
//
// 仕組み: 縦に長い枠(下の SCROLL_VH)を置き、その中で商品を sticky で画面に貼り付ける。
// 枠を通り過ぎる間のスクロール量を 0→1 の進行度に変換し、拡大・傾き・寄りに割り当てる。
// 章ごとのコピーは進行度に合わせて入れ替わる。
//
// ⚠️ 動きを減らす設定(prefers-reduced-motion)の人には静止版を出す。
//    画面の高さが低い端末でも破綻しないよう svh を使う。
import { useEffect, useRef, type RefObject } from 'react';
import Image from 'next/image';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'framer-motion';

// 演出に使う縦幅(vh)。長すぎるとフォームに辿り着けないので、章の数ぶんだけ。
const SCROLL_VH = 300;

// 胸のプリント位置(画像内の相対座標)。寄りのときはここを中心に拡大する。
const PRINT_ORIGIN = '50% 44%';

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
  priceLabel,
}: {
  imageUrl: string;
  productName: string;
  priceLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const scrollYProgress = useSectionProgress(ref);

  // 1章=引き / 2章=寄り(プリント) / 3章=引き戻して着用イメージ
  const scale = useTransform(scrollYProgress, [0, 0.34, 0.62, 1], [1, 1.12, 2.45, 0.96]);
  const rotateY = useTransform(scrollYProgress, [0, 0.34, 0.62, 1], [0, -13, -2, 6]);
  const rotateX = useTransform(scrollYProgress, [0, 0.5, 1], [0, 5, -3]);
  const glow = useTransform(scrollYProgress, [0, 0.34, 0.62, 1], [0.1, 0.16, 0.26, 0.12]);

  if (reduced) {
    // 「視差効果を減らす」設定の人には静止した商品カットだけ見せる
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
        {/* 商品 */}
        <motion.div
          className="relative w-[min(88vw,460px)] aspect-square"
          style={{ perspective: 1200 }}
        >
          <motion.div
            className="absolute inset-0"
            style={{
              scale,
              rotateY,
              rotateX,
              transformOrigin: PRINT_ORIGIN,
              transformStyle: 'preserve-3d',
            }}
          >
            <Glow opacity={glow} />
            <Image
              src={imageUrl}
              alt={productName}
              fill
              priority
              sizes="(max-width: 640px) 88vw, 460px"
              className="object-contain"
            />
          </motion.div>
        </motion.div>

        {/* 章ごとのコピー（進行度で入れ替わる） */}
        <div className="relative mt-6 h-32 w-full px-8">
          {CHAPTERS.map((c, i) => (
            <ChapterCopy key={c.eyebrow} chapter={c} index={i} progress={scrollYProgress} />
          ))}
        </div>

        {/* 最初だけ出るスクロールの合図 */}
        <ScrollHint progress={scrollYProgress} />
      </div>

      {/* 演出の終わりに商品名と価格を置き、そのまま下の詳細へつなぐ */}
      <div className="sr-only">
        {productName} {priceLabel}
      </div>
    </section>
  );
}

// 実際にスクロールしている要素を親から探す。
// このアプリは globals.css の `body { overflow-x: hidden }` により **body 自体がスクロール枠**
// になっており(片方の軸を visible 以外にすると、もう片方が auto になるCSSの仕様)、
// window は動かない。framer-motion の useScroll は既定で window を見るため反応しない。
// どのページに置かれても動くよう、実行時に本当のスクロール枠を突き止める。
function findScroller(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null; // 見つからなければ window スクロール
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

// 対象セクションの通過率を 0→1 で返す(useScroll の offset:['start start','end end'] 相当)。
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

function Glow({ opacity }: { opacity: MotionValue<number> }) {
  return (
    <motion.div
      className="absolute inset-0 -z-10"
      style={{
        opacity,
        background:
          'radial-gradient(circle at 50% 44%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.25) 38%, transparent 68%)',
      }}
    />
  );
}

// 章のコピー。担当区間に入るとふわっと出て、抜けると消える。
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
  const fade = span * 0.28;

  // 最初の章は開いた瞬間から見えていること / 最後の章は下まで出しっぱなしにする
  const isFirst = index === 0;
  const isLast = index === CHAPTERS.length - 1;
  // 前の章が消えるのと同じ区間で次の章が現れるように、入りを担当区間より手前から始める。
  // (入りと出をずらすと、切り替わりの瞬間にどちらも消えて文字が無くなる)
  const opacity = useTransform(
    progress,
    [start - fade, start, end - fade, end],
    isFirst ? [1, 1, 1, 0] : isLast ? [0, 1, 1, 1] : [0, 1, 1, 0]
  );
  const y = useTransform(progress, [start - fade, start], isFirst ? [0, 0] : [14, 0]);

  return (
    <motion.div
      style={{ opacity, y }}
      className="absolute inset-x-0 text-center pointer-events-none"
    >
      <p className="text-[10px] tracking-[0.4em] text-white/35 uppercase">{chapter.eyebrow}</p>
      <h2 className="mt-3 text-[26px] font-light tracking-wide text-white">{chapter.title}</h2>
      <p className="mt-3 text-[13px] leading-relaxed text-white/50">{chapter.body}</p>
    </motion.div>
  );
}

function ScrollHint({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0, 0.08], [1, 0]);
  return (
    <motion.div
      style={{ opacity }}
      className="absolute bottom-8 inset-x-0 flex flex-col items-center gap-2 pointer-events-none"
    >
      <span className="text-[9px] tracking-[0.35em] text-white/30 uppercase">Scroll</span>
      <span className="block h-8 w-px bg-gradient-to-b from-white/40 to-transparent" />
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
