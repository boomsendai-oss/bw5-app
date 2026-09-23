'use client';

// 当日の顔写真を撮る。撮影 → 背景除去 → その場で確認 → 登録 or 撮り直し。
//
// 背景除去はこの端末のブラウザ内で完結させる(会場に別機材を置かず、
// 機器間の通信を障害点にしないため)。モデルは自前で配信しているので
// 外部CDNにも依存しない。
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { PHOTO_TARGET_HEIGHT, fillEdgeColors, refineMask } from '@/lib/bf6Photo';
import {
  OVERLAY_DEG,
  capturePlan,
  captureTransform,
  shouldReopen,
  stageView,
  toScreenOffset,
} from '@/lib/bf6PhotoRotate';

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
  // 画面全体(映像と、上に重ねる層の土台)。大きさを測ってガイドの位置を決める
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  // ⚠️ 写真撮影の担当はクルー画面(スマホ)。受付のiPadにも同じ部品が載っている。
  //    文言に端末名(iPad/スマホ)を書かないこと。どちらからも開かれる。
  // 画面が縦向きか。縦向きのときは「仮想の横画面」で撮る(TARO 2026-09-23「回転ロックのまま
  // 縦持ちでも、横向きのカメラ画面が出るようにする」)。回転ロックONで横に倒すと画面は縦のままなので、
  // 横持ちした人から正しい向きに見えるように、重ねるものだけを90°回す。
  // (以前は縦向きだと黒い画面で撮影を止めていたが、回転ロックの人には「真っ黒に見える」だけだった)
  //
  // ⚠️ 持ち方は決め打ち:「スマホを左に倒して横向きに構える」(TARO 2026-09-23)。
  //    自動判定もボタンも置かない。角度と切り出しは bf6PhotoRotate の OVERLAY_DEG 1つから出す。
  const [screenPortrait, setScreenPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const update = () => setScreenPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // 縦画面では重ねるものを回す(横画面は今までどおり回さない)
  const rotated = screenPortrait;

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

  // 画面と映像の大きさを測る。カメラの向き(縦長/横長)や画面の回転で変わるので、そのたびに測り直す。
  useEffect(() => {
    if (!open) return;
    const v = videoRef.current;
    const el = stageRef.current;
    if (!v || !el) return;
    const update = () => {
      const sb = el.getBoundingClientRect();
      setStage({ width: sb.width, height: sb.height });
      setVideoSize(v.videoWidth > 0 ? { width: v.videoWidth, height: v.videoHeight } : null);
    };
    update();
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [open]);

  // 上に重ねる層(名前・ボタン・ガイド・確認画面の写真)。横画面では画面そのもの、縦画面では
  // 縦横を入れ替えた箱を画面の中心で OVERLAY_DEG だけ回したもの(= 横持ちした人から見た横画面)。
  // ⚠️ 回転は style で書く。Tailwind v4 の rotate/translate クラスは transform と二重に掛かることがある
  const layerSize = stage && (rotated ? { width: stage.height, height: stage.width } : stage);
  const layerStyle: CSSProperties | undefined =
    stage && rotated
      ? {
          left: (stage.width - stage.height) / 2,
          top: (stage.height - stage.width) / 2,
          width: stage.height,
          height: stage.width,
          transform: `rotate(${OVERLAY_DEG}deg)`,
        }
      : undefined;

  // 撮影ガイド(点線の人型)を重ねる位置(層の座標)と、映像の寄せ方。
  // ⚠️ 映像は画面に対して回さない(回転ロックONのiPhoneが返すフレームは「端末の窓」で、
  //    横に倒して持つ人にはそのまま正しく見える・TARO実機 2026-09-23)。層だけが回るので、
  //    層から見た映像は縦横が入れ替わって見える。その大きさでガイドを計算する(stageView)。
  //    層の回転と保存時の切り出し(capturePlan)の対応は bf6PhotoRotate のテストで固定している。
  // 寄せ(scale と移動)は見た目だけの話。保存される画素は変わらない(切り出しは映像の座標で決める)。
  const view = videoSize && layerSize ? stageView(videoSize, layerSize, rotated) : null;
  const guide = view?.guide ?? null;
  // 映像はガイドと同じだけ寄せる。回していないので、移動量は画面の座標に直してから渡す
  const videoStyle: CSSProperties | undefined = (() => {
    if (!view) return undefined;
    const o = toScreenOffset(view.dx, view.dy, rotated);
    // ⚠️ transform は1本の文字列で書く。Tailwind v4 の translate/scale クラスと混ぜると二重に掛かる
    return { transform: `translate(${o.x}px, ${o.y}px) scale(${view.scale})` };
  })();

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
   * 画面は横向きなのに縦長の映像が来ているときだけ、カメラを開き直す。
   *
   * ⚠️ iPhoneで、縦向きでカメラを開いてから横向きにすると、映像が縦長のまま残った
   *    (TARO実機 2026-09-19)。カメラは開いたときの向きの解像度で動き続けるため。
   *    そのままだと保存範囲が画面の上の方だけになり、横向きにした意味がなくなる。
   * 回転直後は映像の大きさがまだ古いことがあるので、少し待ってから比べる。
   * ⚠️ 「画面と映像の向きが違えば開き直す」にしないこと。回転ロックONの実機は
   *    縦画面に横長の映像をよこすので、開き直しが止まらなくなる(あれは正しく扱える状態)。
   */
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const reopenIfRotated = useCallback(() => {
    setTimeout(() => {
      const v = videoRef.current;
      if (!v || !streamRef.current || v.videoWidth === 0) return;
      // 撮影直後の確認画面では開き直さない(撮り直すを押したときに改めて確かめる)
      if (phaseRef.current !== 'live') return;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      if (shouldReopen(portrait, { width: v.videoWidth, height: v.videoHeight })) {
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
      const vsize = { width: video.videoWidth, height: video.videoHeight };
      const h = PHOTO_TARGET_HEIGHT;
      const shot = document.createElement('canvas');
      // 画面に見えていたのと同じ向きに起こして保存する(capturePlan が向きを決める)。
      // ⚠️ 切り抜き(MediaPipe)も元画像(JPEG)も、向きを直し終えた画像に対して行う。
      //    横倒し・逆さまのまま渡すと、人物の認識が落ちる・Macの切り抜き係にもその向きで届く。
      const { frame, src, turned } = capturePlan(vsize, rotated);
      const w = Math.round((frame.width / frame.height) * h);
      shot.width = w;
      shot.height = h;
      const ctx = shot.getContext('2d')!;
      const t = captureTransform(turned, w, h);
      ctx.translate(t.tx, t.ty);
      ctx.rotate(t.angle);
      ctx.drawImage(video, src.x, src.y, src.width, src.height, 0, 0, t.drawWidth, t.drawHeight);

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
  }, [loadSegmenter, rotated]);

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

  // 配置(TARO 2026-09-23「横向きの撮影画面はカメラ映像を画面全体・中央に。閉じるは右上、
  // 撮影するは右下に、映像の上に重ねて置く」)。
  // ⚠️ 以前は右に操作列(幅10rem)を置いて映像を左に寄せていたため、手を広げると
  //    左がスマホの枠の外に出ていた。映像は画面いっぱい・中央にし、操作は上に重ねる。
  //    撮影ボタンは右下の角(ガイドは横の中央にあるので、頭・あごの線にはかからない)。
  // ⚠️ このアプリは body の文字色が白。ボタン・文字は色を必ず明示する(CLAUDE.md §11)
  return (
    <div ref={stageRef} className="fixed inset-0 z-50 overflow-hidden bg-black text-white">
      {/* ⚠️ 映像は画面に対して回さない。回転ロックONのiPhoneが返すフレームは「端末の窓」で、
          スマホを左に倒して構えた人には、回さないのが正しい向き(TARO実機 2026-09-23・3枚目で確定)。
          拡大だけして、保存される範囲が画面いっぱいに映るようにする */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={videoStyle}
        data-testid="photo-video"
        className={`absolute inset-0 h-full w-full object-contain ${phase === 'preview' ? 'hidden' : ''}`}
      />

      <div className="absolute inset-0" style={layerStyle} data-testid="photo-layer" data-rotated={rotated ? 'yes' : 'no'}>
        {/* 撮影ガイド(TARO 2026-09-18)。点線の人型に頭と肩を合わせて撮ると、
            全員の頭の大きさと位置がそろう。LEDでは頭頂の高さを自動でそろえるが、
            大きさは自動では直せない(ポーズが自由なため)ので、撮る時点で揃える。
            ⚠️ 外側を暗くしてあるのが保存されない範囲。ここから肩がはみ出すと切れる
               (前に肩が見切れた件の対策も兼ねる)。 */}
        {phase === 'live' && guide && (
          <div
            className="pointer-events-none absolute"
            data-testid="photo-guide"
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

        {/* 撮った写真の確認。縦画面でも層ごと回っているので、横持ちした人から正しい向きに見える */}
        {phase === 'preview' && preview && (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt=""
              data-testid="photo-preview"
              className="max-h-full max-w-full bg-[repeating-conic-gradient(#333_0%_25%,#222_0%_50%)] bg-[length:24px_24px]"
            />
          </div>
        )}

        {(phase === 'loading' || phase === 'working' || phase === 'saving') && (
          <p className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
            {phase === 'loading' ? 'カメラを起動しています…' : phase === 'working' ? '切り抜いています…' : '保存しています…'}
          </p>
        )}

        {/* 左上: 名前(ガイドの頭にかからない幅に抑える) */}
        <p className="absolute left-3 top-3 max-w-[30%] truncate rounded-lg bg-black/60 px-2.5 py-1.5 text-base font-bold text-white">
          {dancerName}
        </p>

        {/* 右上: 閉じる */}
        <button
          onClick={close}
          className="absolute right-3 top-3 rounded-lg border border-white/40 bg-black/60 px-3 py-1.5 text-sm font-bold text-white"
        >
          閉じる
        </button>

        {error && (
          <p className="absolute bottom-3 left-3 max-w-[45%] rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">{error}</p>
        )}

        {/* 右下: 撮影する / 撮り直す・これで登録(親指で押す場所。これで登録をいちばん下の角に) */}
        <div className="absolute bottom-3 right-3 flex w-36 flex-col gap-2">
          {phase === 'live' && (
            <button onClick={shoot} className="rounded-2xl bg-brand-600 py-6 text-xl font-black text-white shadow-lg shadow-black/50">
              撮影する
            </button>
          )}
          {phase === 'preview' && (
            <>
              <button
                onClick={() => { setPhase('live'); setPreview(''); reopenIfRotated(); }}
                className="rounded-xl border border-white/50 bg-black/60 py-3 text-base font-bold text-white"
              >
                撮り直す
              </button>
              <button onClick={save} className="rounded-2xl bg-brand-600 py-5 text-lg font-black text-white shadow-lg shadow-black/50">
                これで登録
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
