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
 * MediaPipeの確信度マップをアルファに整える。
 *
 * 実機(2026-09-10)で分かったこと:
 *  - モデルは256px程度で切り抜くため、髪の輪郭が階段状になる
 *  - 境目の半透明画素に背景の壁の色が乗り、暗いLEDの上で灰色のフチになる
 * 対策: ①しきい値で決める → ②画像サイズに応じた半径でぼかして階段を均す →
 *       ③50%点を内側に寄せて(浸食)フチの背景を落とす。ゴマ粒ノイズも消える。
 */
export function refineMask(conf: Float32Array, width: number, height: number): Uint8ClampedArray {
  const LO = 0.55;
  const HI = 0.9;
  const smooth = (v: number, lo: number, hi: number) => {
    if (v <= lo) return 0;
    if (v >= hi) return 1;
    const t = (v - lo) / (hi - lo);
    return t * t * (3 - 2 * t);
  };

  const n = width * height;
  let cur: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i += 1) cur[i] = smooth(conf[i] ?? 0, LO, HI);

  // 画像が大きいほど階段も大きいので、半径はサイズに比例させる(760px高で約4px)
  const r = Math.max(1, Math.round(Math.min(width, height) / 150));
  const boxBlur = (src: Float32Array): Float32Array => {
    const tmp = new Float32Array(n);
    const dst = new Float32Array(n);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let cnt = 0;
        for (let dx = -r; dx <= r; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += src[y * width + xx];
          cnt += 1;
        }
        tmp[y * width + x] = sum / cnt;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -r; dy <= r; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          sum += tmp[yy * width + x];
          cnt += 1;
        }
        dst[y * width + x] = sum / cnt;
      }
    }
    return dst;
  };
  cur = boxBlur(boxBlur(cur)); // 2回でガウスに近い滑らかさ

  // 50%点を内側へ寄せる。ぼかしで外側に広がった半透明帯(背景色が乗る)を切り落とす
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.round(smooth(cur[i], 0.4, 0.95) * 255);
  return out;
}
