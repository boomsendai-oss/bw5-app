// 当日の顔写真まわり(純ロジック・DOMにもDBにも触らない)。
//
// 背景除去は受付のブラウザ内で行う(会場に別機材を置かず、機器間の通信を障害点にしないため)。
// ここには「検証」「切り出し枠の計算」「マスクの整形」だけを置き、
// カメラとcanvasの操作は画面側(PhotoCapture)に持たせる。

/** DBに入れる上限。会場の回線とTursoの行サイズを守る。 */
export const PHOTO_MAX_BYTES = 1_500_000;

/** 書き出す高さ。LED(1080p)で画面の6割強を占めるので、これ未満だと粗く見える。 */
export const PHOTO_TARGET_HEIGHT = 1000;

export type PhotoUploadInput = { itemId: number; mime: string; size: number };
export type PhotoValidation = { ok: true } | { ok: false; error: string };

/** 切り抜き後は透過が要るのでPNGのみ受け付ける。 */
export function validatePhotoUpload(input: PhotoUploadInput): PhotoValidation {
  if (!Number.isInteger(input.itemId) || input.itemId <= 0) {
    return { ok: false, error: '出場者の指定が正しくありません' };
  }
  if (input.mime !== 'image/png') {
    return { ok: false, error: '切り抜き後の透過を保つため、PNGのみ受け付けます' };
  }
  if (input.size <= 0) return { ok: false, error: '画像が空です' };
  if (input.size > PHOTO_MAX_BYTES) {
    return { ok: false, error: `画像が大きすぎます(${Math.round(PHOTO_MAX_BYTES / 1000)}KBまで)` };
  }
  return { ok: true };
}

export type Frame = { x: number; y: number; width: number; height: number };

/**
 * バストアップの切り出し枠。
 * 顔は写真の上寄りにあるので上端から取り、横は中央に置く。
 * 縦横比は 3:4 に寄せる(LEDの表示枠に合わせるとトリミングが減る)。
 */
export function fitBustFrame(src: { width: number; height: number }): Frame {
  const RATIO = 0.78; // width / height
  let height = Math.min(src.height, Math.round(src.height * 0.92));
  let width = Math.round(height * RATIO);
  if (width > src.width) {
    width = src.width;
    height = Math.round(width / RATIO);
  }
  height = Math.min(height, src.height);
  width = Math.min(width, src.width);
  return {
    x: Math.max(0, Math.round((src.width - width) / 2)),
    y: 0,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

/**
 * セグメンテーションの確信度(0〜1)を、そのままアルファに使える0〜255へ整形する。
 * 素の確信度をそのまま使うと輪郭が硬く、髪の毛のあたりが階段状になる。
 * 中央付近を伸ばして、境目に中間値を残す。
 */
export function refineMask(conf: Float32Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  const LO = 0.35;
  const HI = 0.72;
  for (let i = 0; i < out.length; i += 1) {
    const v = conf[i] ?? 0;
    let t: number;
    if (v <= LO) t = 0;
    else if (v >= HI) t = 1;
    else t = (v - LO) / (HI - LO);
    // 端を少しなめらかに(硬い縁を避ける)
    const eased = t * t * (3 - 2 * t);
    out[i] = Math.round(eased * 255);
  }
  return out;
}
