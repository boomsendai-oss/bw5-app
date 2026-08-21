'use client';

// スクロールに合わせて商品が回る演出（Appleの製品ページと同じ方式）。
//
// CSSで写真を傾けるのではなく、**3Dで回した連番画像を差し替える**。
// 平面写真をrotateYすると紙が回っているようにしか見えず、90°で消えるため。
//
// 連番の作り方(再現手順):
//   1. 背景透過PNGのアルファから距離変換で「中心ほど厚い」厚みマップを作る
//   2. three.jsで表(+z)・裏(-z)の2曲面を張る。厚みは縁で0なので勝手に閉じた立体になる
//   3. 表は実物写真、裏はプリントを消した無地版(cv2.inpaint)を貼る
//   4. headless Chromeで -12°〜45° を48枚レンダリング → webp
//   ⚠️ 元が平置き写真のため45°を超えると木の葉型に潰れる。範囲を広げないこと。
import { useEffect, useRef, useState, type RefObject } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useSpring, useTransform, type MotionValue } from 'framer-motion';

const FRAME_COUNT = 48;
const FRAME_SIZE = 560;
const SCROLL_VH = 320;

const frameUrl = (i: number) => `/merch/turn/${String(i).padStart(2, '0')}.webp`;

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
    body: '正面からは沈んで見えるロゴが、角度がつくと立ち上がってきます。',
  },
  {
    eyebrow: 'EVERY DAY',
    title: 'レッスンでも、街でも。',
    body: '一枚で成立する落ち感。着るところを選びません。',
  },
];

export default function TurntableShowcase({ productName }: { productName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<HTMLImageElement[]>([]);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();

  const raw = useSectionProgress(ref);
  // スクロールに1:1で貼りつくと機械的に見えるので、ばねで少し遅らせて追従させる
  const p = useSpring(raw, { stiffness: 110, damping: 30, mass: 0.5, restDelta: 0.0004 });

  // 連番の読み込み。1枚目が来たらすぐ描き、残りは裏で読む
  useEffect(() => {
    let alive = true;
    const imgs: HTMLImageElement[] = [];
    let loaded = 0;
    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.src = frameUrl(i);
      img.onload = () => {
        if (!alive) return;
        loaded += 1;
        if (i === 0) setReady(true);
        if (loaded === FRAME_COUNT) draw(currentIndex.current);
      };
      imgs.push(img);
    }
    framesRef.current = imgs;
    return () => {
      alive = false;
    };
  }, []);

  const currentIndex = useRef(0);

  const draw = (index: number) => {
    const canvas = canvasRef.current;
    const img = framesRef.current[index];
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };

  // 進行度 → コマ番号
  useMotionValueEvent(p, 'change', (v) => {
    const i = Math.min(FRAME_COUNT - 1, Math.max(0, Math.round(v * (FRAME_COUNT - 1))));
    if (i === currentIndex.current) return;
    currentIndex.current = i;
    draw(i);
  });

  // 初期表示
  useEffect(() => {
    if (ready) draw(currentIndex.current);
  }, [ready]);

  // 端末の解像度に合わせてキャンバスの実ピクセルを決める
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = FRAME_SIZE * dpr;
    canvas.height = FRAME_SIZE * dpr;
    draw(currentIndex.current);
  }, [ready]);

  if (reduced) {
    return (
      <section className="px-6 pt-14">
        <div className="mx-auto max-w-lg text-center">
          <p className="text-[10px] tracking-[0.45em] text-white/35 uppercase">BOOM OFFICIAL</p>
          {/* 動きを減らす設定では正面の1枚だけ */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frameUrl(12)} alt={productName} className="mt-6 w-full" />
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} style={{ height: `${SCROLL_VH}vh` }} className="relative">
      <div className="sticky top-0 h-[100svh] overflow-hidden flex flex-col items-center justify-center">
        <div className="relative w-[min(84vw,430px)] aspect-square">
          {/* 黒地に黒シャツが沈まないよう、背後に淡い光を置く */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 46%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 45%, transparent 70%)',
            }}
          />
          <canvas
            ref={canvasRef}
            aria-label={productName}
            className="relative w-full h-full"
            style={{ opacity: ready ? 1 : 0, transition: 'opacity .4s ease' }}
          />
        </div>

        <div className="relative mt-6 h-32 w-full px-8">
          {CHAPTERS.map((c, i) => (
            <ChapterCopy key={c.eyebrow} chapter={c} index={i} progress={p} />
          ))}
        </div>

        <ScrollHint progress={p} />
      </div>
    </section>
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
  const y = useTransform(
    progress,
    [start - fade, start, end - fade, end],
    isFirst ? [0, 0, 0, -10] : isLast ? [10, 0, 0, 0] : [10, 0, 0, -10]
  );

  return (
    <motion.div style={{ opacity, y }} className="absolute inset-x-0 text-center pointer-events-none">
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
