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

// 全体を少し右へ寄せる(TARO指定 2026-08-30「もうちょいだけ右」)。
// 動画は16:9の枠にぴったり入っていて切り抜き余地が無いため、
// わずかに拡大してから右へずらす(拡大が左端の隙間を隠す)。
const SHIFT = { transform: 'scale(1.06) translateX(2.5%)' } as const;

export default function PantherHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  // iOS Safariは他アプリ/タブから戻ると動画が凍ったまま復帰することがある。
  // ⚠️ このとき paused が false のままのケースがある(2026-08-30 TARO実機で確認)。
  //    「pausedなら再生」では検知できないので、次の3段構えにする:
  //    1) 復帰イベントでは状態を見ずに必ず play() し直す(失敗したら load() からやり直す)
  //    2) 見張り: currentTime が進んでいるかを定期確認し、凍結を実測で検知して蹴り直す
  //    3) 最後の保険: 動画エリアのタップでも再生(低電力モード等で自動再生が拒否された場合)
  const kick = () => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {
      try {
        v.load();
        v.muted = true;
        v.play().catch(() => {/* 低電力モード等。タップの保険に任せる */});
      } catch {/* noop */}
    });
  };

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', kick);
    window.addEventListener('focus', kick);

    // 凍結の見張り。画面表示中に1.6秒間 currentTime が進んでいなければ蹴り直す。
    // 2回連続で直らなければ load() からやり直す。
    let lastTime = -1;
    let stuckCount = 0;
    const watchdog = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || document.visibilityState !== 'visible') return;
      if (v.currentTime === lastTime) {
        stuckCount += 1;
        if (stuckCount >= 2) {
          try {
            v.load();
            v.muted = true;
          } catch {/* noop */}
          stuckCount = 0;
        }
        v.play().catch(() => {/* タップの保険に任せる */});
      } else {
        stuckCount = 0;
      }
      lastTime = v.currentTime;
    }, 1600);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', kick);
      window.removeEventListener('focus', kick);
      window.clearInterval(watchdog);
    };
  }, []);

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
    <section className="relative w-full overflow-hidden bg-black" onPointerDown={kick}>
      <div className="relative w-full aspect-video">
        {hasVideo ? (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            style={SHIFT}
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
          <img src={STILL} alt="" style={SHIFT} className="absolute inset-0 w-full h-full object-cover" />
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
