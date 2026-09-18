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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 1707 }, facingMode: 'environment' },
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 p-4">
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-white">{dancerName}</p>
        <button onClick={close} className="rounded border border-white/30 px-3 py-1.5 text-sm text-white">
          閉じる
        </button>
      </div>

      <div ref={stageRef} className="relative mt-3 flex flex-1 items-center justify-center overflow-hidden">
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
            {/* 保存される範囲の縦横比(0.78)と同じ viewBox。歪まずにぴったり重なる */}
            <svg viewBox="0 0 78 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
              {[
                { stroke: 'rgba(0,0,0,0.55)', width: 5, dash: undefined },
                { stroke: 'rgba(255,255,255,0.95)', width: 2.5, dash: '10 7' },
              ].map((l, i) => (
                <g key={i} fill="none" stroke={l.stroke} strokeWidth={l.width} strokeDasharray={l.dash} strokeLinecap="round">
                  <ellipse cx="39" cy="23" rx="8.5" ry="11" vectorEffect="non-scaling-stroke" />
                  <path
                    d="M 5 100 L 6 66 C 7 58, 14 53, 26 50 C 31 48.5, 34 46, 34.5 41 L 34.8 34 M 43.2 34 L 43.5 41 C 44 46, 47 48.5, 52 50 C 64 53, 71 58, 72 66 L 73 100"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </svg>
            <p className="absolute inset-x-0 top-1 text-center text-sm font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
              点線に頭と肩を合わせる
            </p>
          </div>
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

      <div className="mt-3 flex gap-3">
        {phase === 'live' && (
          <button onClick={shoot} className="flex-1 rounded-xl bg-brand-600 py-4 text-lg font-black text-white">
            撮影する
          </button>
        )}
        {phase === 'preview' && (
          <>
            <button
              onClick={() => { setPhase('live'); setPreview(''); }}
              className="flex-1 rounded-xl border border-white/40 py-4 text-lg font-bold text-white"
            >
              撮り直す
            </button>
            <button onClick={save} className="flex-1 rounded-xl bg-brand-600 py-4 text-lg font-black text-white">
              これで登録
            </button>
          </>
        )}
      </div>

      <p className="mt-2 text-center text-xs text-white/60">
        無地の壁の前で、点線の人型に頭と肩がぴったり収まる距離で撮ってください
      </p>
    </div>
  );
}
