import { describe, it, expect } from 'vitest';
import { contentTopRatio, headAlignShift, guideRect, photoFadeStops, VS_PHOTO_SCALE, VS_HEAD_TARGET } from '../bf6PhotoAlign';

/** 幅w・高さhのRGBA画像を作り、topRow行目から下を不透明にする */
function rgba(w: number, h: number, topRow: number | null, alpha = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  if (topRow === null) return d;
  for (let y = topRow; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) d[(y * w + x) * 4 + 3] = alpha;
  }
  return d;
}

describe('contentTopRatio(切り抜き写真の中で人物が始まる高さ)', () => {
  it('人物が始まる行を、画像の高さに対する割合で返す', () => {
    expect(contentTopRatio(rgba(10, 100, 25), 10, 100)).toBeCloseTo(0.25, 5);
  });

  it('いちばん上から人物なら 0', () => {
    expect(contentTopRatio(rgba(10, 100, 0), 10, 100)).toBe(0);
  });

  it('全部透明なら null(揃えようがないので、何もずらさない)', () => {
    expect(contentTopRatio(rgba(10, 100, null), 10, 100)).toBeNull();
  });

  it('切り抜きの縁の薄いゴミは頭とみなさない', () => {
    // ⚠️ 背景除去の縁に alpha 10 前後のゴマ粒が残る。これを頭頂とすると大きくずれる
    const d = rgba(10, 100, 40);
    d[(5 * 10 + 3) * 4 + 3] = 12; // 5行目に薄い点
    expect(contentTopRatio(d, 10, 100)).toBeCloseTo(0.4, 5);
  });

  it('1画素だけの濃い点も頭とみなさない(1行のうち一定数が不透明な行から数える)', () => {
    const d = rgba(100, 100, 40);
    d[(5 * 100 + 50) * 4 + 3] = 255; // 5行目に1画素だけ
    expect(contentTopRatio(d, 100, 100)).toBeCloseTo(0.4, 5);
  });
});

describe('headAlignShift(頭頂を揃えるための上下のずらし量)', () => {
  it('頭頂が目標の高さに来るようにずらす(拡大ぶんも考える)', () => {
    // 1.3倍・上端基準で拡大した後、頭頂を画像枠の6%に置きたい
    const top = 0.2;
    const shift = headAlignShift(top, { scale: 1.3, target: 0.06 });
    // 見た目の頭頂 = ずらし + 拡大後の頭頂
    expect(shift + top * 1.3).toBeCloseTo(0.06, 6);
  });

  it('頭の位置が違う2人でも、揃えた後の頭頂は同じ高さになる', () => {
    const opt = { scale: VS_PHOTO_SCALE, target: VS_HEAD_TARGET };
    const kanna = headAlignShift(0.187, opt) + 0.187 * VS_PHOTO_SCALE;
    const yui = headAlignShift(0.343, opt) + 0.343 * VS_PHOTO_SCALE;
    expect(kanna).toBeCloseTo(yui, 6);
  });

  it('測れなかった写真(null)はずらさない', () => {
    expect(headAlignShift(null, { scale: 1.3, target: 0.06 })).toBe(0);
  });
});

describe('guideRect(撮影ガイドを重ねる位置)', () => {
  it('縦向きのカメラでは、切り出し範囲(上寄せ・横いっぱい)をそのまま画面の座標に写す', () => {
    // 1280x1707 の映像が、画面上で 640x853.5 で表示されている
    const r = guideRect({ width: 1280, height: 1707 }, { width: 640, height: 853.5 })!;
    expect(r).not.toBeNull();
    expect(r.top).toBe(0); // 切り出しは上端から
    expect(r.left + r.width / 2).toBeCloseTo(320, 0); // 横は中央
    expect(r.width / r.height).toBeCloseTo(1.2, 2); // 保存される写真と同じ縦横比
  });

  it('横向きのカメラでは、画面のほぼ全体が写真になる(下8%だけ使わない)', () => {
    const r = guideRect({ width: 1920, height: 1440 }, { width: 960, height: 720 })!;
    expect(r).not.toBeNull();
    expect(r.height / 720).toBeCloseTo(0.92, 2);
    expect(r.left + r.width / 2).toBeCloseTo(480, 0);
    expect(r.width / r.height).toBeCloseTo(1.2, 2);
  });

  it('映像の大きさがまだ分からないときは null(ガイドを出さない)', () => {
    expect(guideRect({ width: 0, height: 0 }, { width: 640, height: 480 })).toBeNull();
  });
});

describe('photoFadeStops(写真の下をぼかす位置を、画像の中の割合に直す)', () => {
  it('ずらし・拡大した後の見た目で、指定した高さからぼけ始めて指定した高さで消える', () => {
    const shift = -0.3, scale = 1.3;
    const { start, end } = photoFadeStops(shift, scale, 0.6, 0.97);
    // 画像の中の割合 f は、見た目では shift + f*scale の高さに来る
    expect(shift + start * scale).toBeCloseTo(0.6, 6);
    expect(shift + end * scale).toBeCloseTo(0.97, 6);
  });

  it('頭の位置が違う2人でも、ぼけ始める見た目の高さは同じになる', () => {
    const a = headAlignShift(0.187, { scale: VS_PHOTO_SCALE, target: VS_HEAD_TARGET });
    const b = headAlignShift(0.343, { scale: VS_PHOTO_SCALE, target: VS_HEAD_TARGET });
    const fa = photoFadeStops(a, VS_PHOTO_SCALE, 0.6, 0.97);
    const fb = photoFadeStops(b, VS_PHOTO_SCALE, 0.6, 0.97);
    expect(a + fa.start * VS_PHOTO_SCALE).toBeCloseTo(b + fb.start * VS_PHOTO_SCALE, 6);
  });
});

describe('photoFadeStops の安全装置', () => {
  it('写真を大きく上にずらした人でも、写真の下端までに必ず消えきる', () => {
    // ⚠️ 頭頂が低い写真(34.7%)は大きく持ち上げるので、写真の下端が
    //    「消えきる高さ」より上に来る。そのままだと半透明のまま写真が終わり、
    //    胴体に直線の切れ目が出た(2026-09-18 実画像で確認)
    const shift = headAlignShift(0.347, { scale: VS_PHOTO_SCALE, target: VS_HEAD_TARGET });
    const { start, end } = photoFadeStops(shift, VS_PHOTO_SCALE, 0.6, 0.97);
    expect(end).toBeLessThanOrEqual(1);
    expect(start).toBeLessThan(end);
  });

  it('ぼかしの幅は最低限確保する(急に消えて線に見えないように)', () => {
    const { start, end } = photoFadeStops(-0.6, 1.3, 0.6, 0.97);
    expect(end - start).toBeGreaterThanOrEqual(0.2 - 1e-9);
  });
});
