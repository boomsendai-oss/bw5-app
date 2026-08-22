'use client';

// スクロールに合わせて商品が回る演出（Appleの製品ページと同じ方式）。
//
// CSSで写真を傾けるのではなく、**3Dで回した連番画像を差し替える**。
// 平面写真をrotateYすると紙が回っているようにしか見えず、90°で消えるため。
//
// 構成（TARO指定 2026-08-22）:
//   前半 = 商品を大きく左に寄せて回す。右(スマホでは下)に章コピー
//   後半 = 正面まで回し戻しながら中央へ収め、**普通の平面画像**へクロスフェード
//
// 連番の作り方(再現手順):
//   1. 背景透過PNGのアルファから距離変換で厚みマップを作る
//      ⚠️ 距離場は中心軸に稜線が立ち、服に折り目が入って見える(TARO指摘の「凸凹」)。
//         4倍で距離変換→強めのGaussian→楕円プロファイルに直してならすこと
//   2. three.jsで表(+z)・裏(-z)の2曲面を張る。厚みは縁で0なので勝手に閉じた立体になる
//      ⚠️ 頂点サンプリングは双一次補間。最近傍だと階段状の段差が凸凹として出る
//      ⚠️ マテリアルは transparent ではなく alphaTest。透過合成だと縁に白いフリンジが出る
//   3. 表は実物写真、裏はプリントをcv2.inpaintで消した無地版を貼る
//   4. headless Chromeで -12°〜45° を48枚 → 全コマ共通の外接矩形で切り抜き → webp
//   ⚠️ 元が平置き写真のため45°を超えると木の葉型に潰れる。範囲を広げないこと。
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';

const FRAME_COUNT = 48;
const FRAME_PX = 760;
const SCROLL_VH = 360;

// 連番は -12°→45°。正面(0°)はこのコマ。最後はここまで回し戻す
const FRONT_FRAME = 10;
// 章コピーが終わる位置。ここから先は「平面画像へ収束する」区間
const CHAPTERS_END = 0.72;
// 平面画像へ入れ替える区間
const SETTLE_START = 0.86;

const FLAT_IMAGE = '/merch/tshirt_black_black.png';
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
  const currentIndex = useRef(0);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();

  const raw = useSectionProgress(ref);
  // スクロールに1:1で貼りつくと機械的に見えるので、ばねで少し遅らせて追従させる
  const p = useSpring(raw, { stiffness: 110, damping: 30, mass: 0.5, restDelta: 0.0004 });

  const draw = (index: number) => {
    const canvas = canvasRef.current;
    const img = framesRef.current[index];
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = FRAME_PX * dpr;
    canvas.height = FRAME_PX * dpr;
    draw(currentIndex.current);
  }, [ready]);

  // 進行度 → コマ番号。前半は回し、後半は正面まで戻す
  useMotionValueEvent(p, 'change', (v) => {
    let idx: number;
    if (v <= CHAPTERS_END) {
      idx = Math.round((v / CHAPTERS_END) * (FRAME_COUNT - 1));
    } else {
      const t = (v - CHAPTERS_END) / (1 - CHAPTERS_END);
      idx = Math.round(FRAME_COUNT - 1 + (FRONT_FRAME - (FRAME_COUNT - 1)) * t);
    }
    idx = Math.min(FRAME_COUNT - 1, Math.max(0, idx));
    if (idx === currentIndex.current) return;
    currentIndex.current = idx;
    draw(idx);
  });

  // 大きく左に寄せた状態 → 最後に中央の定位置へ収める
  const x = useTransform(p, [0, CHAPTERS_END, 1], ['-13%', '-19%', '0%']);
  const scale = useTransform(p, [0, CHAPTERS_END, 1], [1.34, 1.38, 1]);
  const turnOpacity = useTransform(p, [SETTLE_START, 1], [1, 0]);
  const flatOpacity = useTransform(p, [SETTLE_START, 1], [0, 1]);
  const glowOpacity = useTransform(p, [0, CHAPTERS_END, 1], [0.11, 0.13, 0.07]);

  if (reduced) {
    return (
      <section className="px-6 pt-14">
        <div className="mx-auto max-w-lg text-center">
          <p className="text-[10px] tracking-[0.45em] text-white/35 uppercase">BOOM OFFICIAL</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={FLAT_IMAGE} alt={productName} className="mt-6 w-full" />
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} style={{ height: `${SCROLL_VH}vh` }} className="relative">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {/* 商品。前半は画面いっぱいに大きく、左に寄せる */}
        <motion.div
          style={{ x, scale }}
          className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-[min(92vw,520px)] aspect-square"
        >
          <motion.div
            style={{ opacity: glowOpacity }}
            className="absolute inset-0"
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 50% 48%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.22) 40%, transparent 70%)',
              }}
            />
          </motion.div>

          <motion.canvas
            ref={canvasRef}
            aria-label={productName}
            style={{ opacity: ready ? turnOpacity : 0 }}
            className="absolute inset-0 w-full h-full"
          />

          {/* 章が終わったら、いつもの平面の商品画像に収まる */}
          <motion.img
            src={FLAT_IMAGE}
            alt={productName}
            style={{ opacity: flatOpacity }}
            className="absolute inset-0 w-full h-full object-contain"
          />
        </motion.div>

        {/* 章コピー。スマホは下、横長では右側に置く */}
        <div className="absolute inset-x-0 bottom-[9%] px-7 md:left-auto md:right-[6%] md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:w-[42%] md:px-0">
          <div className="relative h-36 mx-auto max-w-lg md:max-w-none">
            {CHAPTERS.map((c, i) => (
              <ChapterCopy key={c.eyebrow} chapter={c} index={i} progress={p} />
            ))}
          </div>
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
  // 3章を CHAPTERS_END までに収める
  const span = CHAPTERS_END / CHAPTERS.length;
  const start = index * span;
  const end = start + span;
  const fade = span * 0.3;
  const isFirst = index === 0;
  const isLast = index === CHAPTERS.length - 1;

  // 前の章が消えるのと同じ区間で次が現れるよう、入りを担当区間の手前から始める
  // 最後の章は、平面画像へ収束し始めるところで引き取る
  const times = isLast
    ? [start - fade, start, CHAPTERS_END, SETTLE_START]
    : [start - fade, start, end - fade, end];
  const opacity = useTransform(progress, times, isFirst ? [1, 1, 1, 0] : [0, 1, 1, 0]);
  const y = useTransform(progress, times, isFirst ? [0, 0, 0, -10] : [10, 0, 0, -10]);

  return (
    <motion.div style={{ opacity, y }} className="absolute inset-x-0 text-center md:text-left pointer-events-none">
      <p className="text-[10px] tracking-[0.4em] text-white/30 uppercase">{chapter.eyebrow}</p>
      <h2 className="mt-3.5 text-[27px] md:text-[32px] font-light tracking-[0.02em] text-white leading-snug">
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
