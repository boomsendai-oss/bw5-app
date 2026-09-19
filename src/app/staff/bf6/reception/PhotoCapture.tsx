'use client';

// 当日の顔写真を撮る。撮影 → 背景除去 → その場で確認 → 登録 or 撮り直し。
//
// 背景除去はこの端末のブラウザ内で完結させる(会場に別機材を置かず、
// 機器間の通信を障害点にしないため)。モデルは自前で配信しているので
// 外部CDNにも依存しない。
import { useCallback, useEffect, useRef, useState } from 'react';
import { PHOTO_TARGET_HEIGHT, fillEdgeColors, fitBustFrame, refineMask } from '@/lib/bf6Photo';
import { guideRect, type Rect } from '@/lib/bf6PhotoAlign';

type Phase = 'idle' | 'loading' | 'live' | 'working' | 'preview' | 'saving';

/**
 * 撮影ガイドの人型(viewBox 78x100 = 保存される写真と同じ縦横比)。
 * 頭は卵形(頭頂側が広く、あごに向かって細い)。楕円だと人の顔に見えない。
 */
const GUIDE_HEAD =
  'M 39 10 C 45.5 10, 49.5 15, 49.5 22 C 49.5 28, 48.5 32, 46 35 C 44 38, 41.5 40, 39 40 ' +
  'C 36.5 40, 34 38, 32 35 C 29.5 32, 28.5 28, 28.5 22 C 28.5 15, 32.5 10, 39 10 Z';
/**
 * 首から肩、腕の外側。実際の人物(KANNA)の写真を偽カメラに流して頭を合わせ、
 * 肩の位置が合うように決めた(2026-09-18)。首は短く(あごの直下から肩が始まる)、
 * 肩幅は頭の幅(21)の約2.7倍。細身の服ならこの中に収まり、大きめの服は少しはみ出す。
 */
const GUIDE_BODY =
  'M 33.5 39.5 L 33.5 42 C 33.5 44.5, 30 45.5, 25 46.5 C 18.5 47.8, 13.5 48.8, 12 52 C 11 54.5, 10.8 57, 10.8 62 L 10.5 100 ' +
  'M 44.5 39.5 L 44.5 42 C 44.5 44.5, 48 45.5, 53 46.5 C 59.5 47.8, 64.5 48.8, 66 52 C 67 54.5, 67.2 57, 67.2 62 L 67.5 100';
/** 頭頂(10)とあご(40)の目印線。頭の左右に短く出す */
const GUIDE_TICKS = 'M 23 10 L 30 10 M 48 10 L 55 10 M 23 40 L 30 40 M 48 40 L 55 40';
/** 下に黒い太線、上に白い点線。明るい壁でも暗い壁でも見える */
const GUIDE_LAYERS: { stroke: string; width: number; dash?: string }[] = [
  { stroke: 'rgba(0,0,0,0.55)', width: 5 },
  { stroke: 'rgba(255,255,255,0.95)', width: 2.5, dash: '9 6' },
];

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- MediaPipeは型定義を持たない */
type Segmenter = any;

export default function PhotoCapture({
  itemId,
  dancerName,
  hasPhoto,
  onDone,
}: {
  itemId: number;
  dancerName: string;
  hasPhoto: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  // 撮影ガイド(点線の人型)を重ねる位置。保存される範囲(fitBustFrame)と必ず一致させる
  const stageRef = useRef<HTMLDivElement>(null);
  const [guide, setGuide] = useState<Rect | null>(null);
  // カメラの映像が縦長か。縦向きだと保存範囲が画面の上の方だけになり撮りにくいので案内を出す。
  // ⚠️ 写真撮影の担当はクルー画面(スマホ)。受付のiPadにも同じ部品が載っている。
  //    文言に端末名(iPad/スマホ)を書かないこと。どちらからも開かれる。
  const [portrait, setPortrait] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const segRef = useRef<Segmenter>(null);
  const blobRef = useRef<Blob | null>(null);
  // 切り抜き前の元画像。会場のMac(切り抜き係)が高品質に抜き直すために一緒に送る
  const rawRef = useRef<Blob | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // 映像の表示位置と大きさが決まったら、保存範囲を画面の座標に写してガイドを置く。
  // カメラの向き(縦長/横長)や画面の回転で変わるので、そのたびに測り直す。
  useEffect(() => {
    if (!open) return;
    const v = videoRef.current;
    const stage = stageRef.current;
    if (!v || !stage) return;
    const update = () => {
      const vb = v.getBoundingClientRect();
      const sb = stage.getBoundingClientRect();
      const r = guideRect({ width: v.videoWidth, height: v.videoHeight }, { width: vb.width, height: vb.height });
      setGuide(r ? { left: vb.left - sb.left + r.left, top: vb.top - sb.top + r.top, width: r.width, height: r.height } : null);
      setPortrait(v.videoWidth > 0 && v.videoWidth < v.videoHeight);
    };
    update();
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    ro.observe(v);
    ro.observe(stage);
    return () => {
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [open]);

  /** カメラを開く。前面/背面はどちらでも撮れるよう指定しすぎない。 */
  const start = useCallback(async () => {
    setError('');
    setPhase('loading');
    try {
      // ⚠️ 頼む解像度を端末の向きに合わせる。縦長(1280x1707)を固定で頼んでいたため、
      //    横向きで開いても縦長の映像が届き、横向きの利点(画面を広く使える)が消えていた
      //    (2026-09-19 偽カメラで検証して判明)。
      const landscape = window.matchMedia('(orientation: landscape)').matches;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: landscape
          ? { width: { ideal: 1707 }, height: { ideal: 1280 }, facingMode: 'environment' }
          : { width: { ideal: 1280 }, height: { ideal: 1707 }, facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase('live');
    } catch {
      setError('カメラを開けませんでした。ブラウザのカメラ許可を確認してください。');
      setPhase('idle');
    }
  }, []);

  /**
   * 端末の向きとカメラ映像の向きが食い違っていたら、カメラを開き直す。
   *
   * ⚠️ iPhoneで、縦向きでカメラを開いてから横向きにすると、映像が縦長のまま残った
   *    (TARO実機 2026-09-19)。カメラは開いたときの向きの解像度で動き続けるため。
   *    そのままだと保存範囲が画面の上の方だけになり、横向きにした意味がなくなる。
   * 回転直後は映像の大きさがまだ古いことがあるので、少し待ってから比べる。
   * iOSが自分で映像を回転させた場合は向きが一致するので、開き直さない。
   */
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const reopenIfRotated = useCallback(() => {
    setTimeout(() => {
      const v = videoRef.current;
      if (!v || !streamRef.current || v.videoWidth === 0) return;
      // 撮影直後の確認画面では開き直さない(撮り直すを押したときに改めて確かめる)
      if (phaseRef.current !== 'live') return;
      const screenLandscape = window.matchMedia('(orientation: landscape)').matches;
      const videoLandscape = v.videoWidth > v.videoHeight;
      if (screenLandscape !== videoLandscape) {
        stopCamera();
        void start();
      }
    }, 400);
  }, [start, stopCamera]);

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => reopenIfRotated();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open, reopenIfRotated]);

  /** 切り抜きモデルを読み込む(初回だけ時間がかかるので、画面を開いた時点で温める) */
  const loadSegmenter = useCallback(async (): Promise<Segmenter> => {
    if (segRef.current) return segRef.current;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- グローバルに生える */
    const w = window as any;
    if (!w.SelfieSegmentation) {
      await new Promise<void>((resolve, reject) => {
        const el = document.createElement('script');
        el.src = '/bf6/seg/selfie_segmentation.js';
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('モデルを読み込めませんでした'));
        document.head.appendChild(el);
      });
    }
    const seg = new w.SelfieSegmentation({ locateFile: (f: string) => `/bf6/seg/${f}` });
    // modelSelection 0 = 一般モデル(256x256)、1 = 横長モデル(144x256・速い)。
    // 実機で肩や髪が抜けきらなかったため(2026-09-10)、解像度の高い 0 を使う。
    // 5秒→少し延びるが、当日は1人ずつなので許容。
    seg.setOptions({ modelSelection: 0, selfieMode: false });
    await seg.initialize();
    segRef.current = seg;
    return seg;
  }, []);

  useEffect(() => {
    if (open) loadSegmenter().catch(() => setError('切り抜きモデルの読み込みに失敗しました'));
  }, [open, loadSegmenter]);

  /** 撮って切り抜く */
  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setPhase('working');
    setError('');
    try {
      // 1. バストアップに切り出す
      const frame = fitBustFrame({ width: video.videoWidth, height: video.videoHeight });
      const h = PHOTO_TARGET_HEIGHT;
      const w = Math.round((frame.width / frame.height) * h);
      const shot = document.createElement('canvas');
      shot.width = w;
      shot.height = h;
      shot.getContext('2d')!.drawImage(
        video, frame.x, frame.y, frame.width, frame.height, 0, 0, w, h
      );

      // 1'. 元画像をJPEGで保持(Macの切り抜き係が使う。端末内の切り抜きは仮)
      rawRef.current = await new Promise<Blob | null>((resolve) => shot.toBlob((b) => resolve(b), 'image/jpeg', 0.9));

      // 2. 人物のマスクを取る
      const seg = await loadSegmenter();
      const mask: HTMLCanvasElement = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('切り抜きが時間内に終わりませんでした')), 8000);
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- MediaPipeの結果 */
        seg.onResults((res: any) => {
          clearTimeout(timer);
          resolve(res.segmentationMask as HTMLCanvasElement);
        });
        seg.send({ image: shot }).catch(reject);
      });

      // 3. マスクをアルファに整えて合成する
      const mc = document.createElement('canvas');
      mc.width = w;
      mc.height = h;
      const mctx = mc.getContext('2d')!;
      mctx.drawImage(mask, 0, 0, w, h);
      const md = mctx.getImageData(0, 0, w, h);
      const conf = new Float32Array(w * h);
      for (let i = 0; i < conf.length; i += 1) conf[i] = md.data[i * 4] / 255;
      const alpha = refineMask(conf, w, h);

      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const octx = out.getContext('2d')!;
      octx.drawImage(shot, 0, 0);
      const od = octx.getImageData(0, 0, w, h);
      // 境目の半透明画素に壁の色が混ざって灰色のフチになるので、近くの人物の色で塗り替える
      fillEdgeColors(od.data, alpha, w, h);
      for (let i = 0; i < alpha.length; i += 1) od.data[i * 4 + 3] = alpha[i];
      octx.putImageData(od, 0, 0);

      // PNGは重い。LEDで必要な解像度まで落としてから書き出す(32人ぶんをDBに入れるため)
      const SAVE_H = 760;
      const sw = Math.round((w / h) * SAVE_H);
      const small = document.createElement('canvas');
      small.width = sw;
      small.height = SAVE_H;
      const sctx = small.getContext('2d')!;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(out, 0, 0, sw, SAVE_H);
      const blob: Blob = await new Promise((resolve) => small.toBlob((b) => resolve(b!), 'image/png'));
      blobRef.current = blob;
      setPreview(URL.createObjectURL(blob));
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : '切り抜きに失敗しました');
      setPhase('live');
    }
  }, [loadSegmenter]);

  const save = useCallback(async () => {
    if (!blobRef.current) return;
    setPhase('saving');
    try {
      const fd = new FormData();
      fd.append('itemId', String(itemId));
      fd.append('photo', blobRef.current, 'photo.png');
      if (rawRef.current) fd.append('raw', rawRef.current, 'raw.jpg');
      const r = await fetch('/api/bf6/photo/upload', { method: 'POST', body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? '保存に失敗しました');
      stopCamera();
      setOpen(false);
      setPhase('idle');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
      setPhase('preview');
    }
  }, [itemId, onDone, stopCamera]);

  const close = () => {
    stopCamera();
    setOpen(false);
    setPhase('idle');
    setError('');
  };

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); start(); }}
        className={`rounded px-2 py-1 text-xs font-bold ${
          hasPhoto ? 'bg-emerald-100 text-emerald-700' : 'border border-sand-300 text-navy-700'
        }`}
      >
        {hasPhoto ? '✓ 写真あり(撮り直す)' : '写真を撮る'}
      </button>
    );
  }

  // ⚠️ 横向きのときは、名前・閉じる・撮影ボタンを右側に縦に並べ、カメラ映像を画面の高さいっぱいに出す
  //    (カメラアプリと同じ配置)。縦向きと同じ上下の配置のままだと、スマホ横向き(高さ390px)では
  //    上の名前と下のボタン・説明文に高さを取られ、映像が縦向きより小さくなっていた(2026-09-19 実測)。
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black p-4 landscape:flex-row landscape:gap-3 landscape:p-3">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between landscape:hidden">
        <p className="text-base font-bold text-white">{dancerName}</p>
        <button onClick={close} className="rounded border border-white/30 px-3 py-1.5 text-sm text-white">
          閉じる
        </button>
      </div>

      <div ref={stageRef} className="relative mt-3 flex flex-1 items-center justify-center overflow-hidden landscape:mt-0">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`max-h-full max-w-full ${phase === 'preview' ? 'hidden' : ''}`}
        />
        {/* 撮影ガイド(TARO 2026-09-18)。点線の人型に頭と肩を合わせて撮ると、
            全員の頭の大きさと位置がそろう。LEDでは頭頂の高さを自動でそろえるが、
            大きさは自動では直せない(ポーズが自由なため)ので、撮る時点で揃える。
            ⚠️ 外側を暗くしてあるのが保存されない範囲。ここから肩がはみ出すと切れる
               (前に肩が見切れた件の対策も兼ねる)。 */}
        {phase === 'live' && guide && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: guide.left,
              top: guide.top,
              width: guide.width,
              height: guide.height,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
            }}
          >
            {/* 保存される範囲の縦横比(0.78)と同じ viewBox。歪まずにぴったり重なる。
                人型の比率は証明写真の撮影ガイドと人体の標準比率に合わせた(TARO 2026-09-18
                「頭が異様に小さい」)。旧ガイドは肩幅が頭の幅の3.5倍あり、頭が小さく見えていた。
                  頭 … 写真の高さの30%(頭頂10% → あご40%)。幅はその0.7倍の卵形
                  首 … 頭の幅の0.5倍・短め(あごの直下から肩が始まる)
                  肩 … 頭の幅の2.7倍。実際の人物の写真を偽カメラに流して頭を合わせ、肩が合う位置に決めた
                頭頂とあごの目印線は証明写真の定番。ここに合わせる距離で撮ると、全員の頭の大きさが揃う。 */}
            {/* ⚠️ 保存範囲は横長(1.2:1)。人型は 78:100 のまま中央に置く(meet)。
                   none にすると人型が横に引き伸ばされる。高さはぴったり合うので、
                   頭頂10%・あご40%の線は保存される写真の高さに対して正しい位置に来る。 */}
            <svg viewBox="0 0 78 100" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" aria-hidden>
              {GUIDE_LAYERS.map((l, i) => (
                <g key={i} fill="none" stroke={l.stroke} strokeWidth={l.width} strokeDasharray={l.dash} strokeLinecap="round" strokeLinejoin="round">
                  <path d={GUIDE_HEAD} vectorEffect="non-scaling-stroke" />
                  <path d={GUIDE_BODY} vectorEffect="non-scaling-stroke" />
                  {/* ⚠️ 目印線は実線。"none" を明示しないと親の点線を引き継ぐ */}
                  <path d={GUIDE_TICKS} vectorEffect="non-scaling-stroke" strokeDasharray="none" />
                </g>
              ))}
              {/* スマホの小さい画面でも読める大きさ(保存範囲の高さの3.6%) */}
              <g fontSize="3.6" fontWeight="900" fill="#fff" stroke="rgba(0,0,0,0.75)" strokeWidth="0.7" paintOrder="stroke">
                <text x="56.5" y="11.2">頭のてっぺん</text>
                <text x="56.5" y="41.2">あご</text>
              </g>
            </svg>
            {/* ⚠️ 上に置くと、小さい画面で頭のてっぺんの線と重なる。胸のあたり(下)に置く */}
            <p className="absolute inset-x-0 bottom-2 text-center text-sm font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
              頭のてっぺんとあごを線に合わせる
            </p>
          </div>
        )}
        {phase === 'live' && guide && portrait && (
          <p className="pointer-events-none absolute inset-x-4 bottom-4 rounded-lg bg-black/70 px-3 py-2 text-center text-sm font-bold text-white">
            横向きにすると、画面を広く使えて撮りやすくなります
          </p>
        )}
        {phase === 'preview' && preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            className="max-h-full max-w-full bg-[repeating-conic-gradient(#333_0%_25%,#222_0%_50%)] bg-[length:24px_24px]"
          />
        )}
        {(phase === 'loading' || phase === 'working' || phase === 'saving') && (
          <p className="absolute text-lg font-bold text-white">
            {phase === 'loading' ? 'カメラを起動しています…' : phase === 'working' ? '切り抜いています…' : '保存しています…'}
          </p>
        )}
      </div>

      {error && <p className="mt-2 rounded bg-red-600 px-3 py-2 text-sm font-bold text-white">{error}</p>}
      </div>

      <div className="mt-3 flex flex-col gap-2 landscape:mt-0 landscape:w-40 landscape:shrink-0 landscape:justify-between">
        {/* 横向きのときだけ、名前と閉じるをここ(右上)に出す */}
        <div className="hidden landscape:flex landscape:flex-col landscape:gap-2">
          <p className="text-sm font-bold text-white">{dancerName}</p>
          <button onClick={close} className="rounded border border-white/30 px-3 py-1.5 text-sm text-white">
            閉じる
          </button>
        </div>

        <div className="flex gap-3 landscape:flex-col">
          {phase === 'live' && (
            <button onClick={shoot} className="flex-1 rounded-xl bg-brand-600 py-4 text-lg font-black text-white landscape:flex-none landscape:py-6">
              撮影する
            </button>
          )}
          {phase === 'preview' && (
            <>
              <button
                onClick={() => { setPhase('live'); setPreview(''); reopenIfRotated(); }}
                className="flex-1 rounded-xl border border-white/40 py-4 text-lg font-bold text-white landscape:flex-none"
              >
                撮り直す
              </button>
              <button onClick={save} className="flex-1 rounded-xl bg-brand-600 py-4 text-lg font-black text-white landscape:flex-none">
                これで登録
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-white/60 landscape:hidden">
          無地の壁の前で、頭のてっぺんとあごが線に合う距離で撮ってください(横向き推奨)
        </p>
      </div>
    </div>
  );
}
