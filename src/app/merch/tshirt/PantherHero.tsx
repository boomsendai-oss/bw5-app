'use client';

// ハイブランド風のヒーロー帯（TARO案 2026-08-22）。
// 3D回転とは別方向の案で、最上部に短い動画を流す。
//
// 素材の作り:
//   背景の黒豹 = nanobanana(Gemini/pro)で生成した16:9・右側は商品用の余白として空ける
//   Tシャツ    = **実物写真の切り抜きを合成**。AIに描かせるとロゴが別物になるため絶対にやらない
//   動画       = 上の静止画を LitMedia/Seedance 2.0 に投げて生成(最初と最後に同じ画像を指定=ループ)
//   ロゴ       = **動画に焼き込まずHTMLで重ねる**。生成を通すと必ず崩れるため
//
// 動画が未搬入のうちは静止画のまま成立する(poster と <img> フォールバック)。
import { useEffect, useRef, useState } from 'react';

const STILL = '/merch/hero/panther_hero.jpg';
const VIDEO = '/merch/hero/panther_hero.mp4';
const LOGO = '/merch/hero/boom_logo_white.png';

export default function PantherHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  // 動画ファイルが置かれていれば使う。無ければ静止画のまま(404でも見た目は崩れない)
  useEffect(() => {
    let alive = true;
    fetch(VIDEO, { method: 'HEAD' })
      .then((r) => {
        if (alive && r.ok) setHasVideo(true);
      })
      .catch(() => {
        /* 未搬入。静止画のままでよい */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="relative w-full overflow-hidden bg-black">
      <div className="relative w-full aspect-video">
        {hasVideo ? (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            src={VIDEO}
            poster={STILL}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={STILL} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}

        {/* 下端を黒へ落として、この下のページと地続きに見せる */}
        <div
          className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, #0b0b0c)' }}
        />

        {/* ロゴは正本の白版をそのまま置く(自作・白ベタ化・座布団敷きは禁止) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={LOGO}
          alt="BOOM"
          className="absolute left-5 top-5 w-12 md:w-16 opacity-90 pointer-events-none"
        />
      </div>
    </section>
  );
}
