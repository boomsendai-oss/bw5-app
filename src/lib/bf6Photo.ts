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
  // 実機(2026-09-10)で3〜4pxの背景色の帯が残ったため、さらに内側へ寄せる
  for (let i = 0; i < n; i += 1) out[i] = Math.round(smooth(cur[i], 0.6, 0.98) * 255);
  return out;
}

/**
 * 境目の半透明画素の色を、いちばん近い不透明画素の色で塗り替える(エッジ拡張)。
 *
 * 半透明の画素には撮影時の背景(壁)の色が混ざっていて、暗いLEDの上で灰色のフチになる。
 * 背景色を推定して引き算する方法もあるが、壁が均一とは限らない。
 * 近くの「確実に人物」の色をそのまま使うほうが、どんな背景でも破綻しない。
 *
 * rgba は Canvas の ImageData.data(RGBA連続)。alpha は同じ画素数のアルファ。
 * 戻り値は無く rgba を書き換える。
 */
export function fillEdgeColors(
  rgba: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 6
): void {
  const n = width * height;
  // 元の色を退避(書き換え中の画素を参照しないため)
  const src = new Uint8ClampedArray(rgba);
  for (let i = 0; i < n; i += 1) {
    const a = alpha[i];
    if (a === 0 || a === 255) continue;
    const x = i % width;
    const y = (i - x) / width;
    let best = -1;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const j = yy * width + xx;
        if (alpha[j] !== 255) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    if (best < 0) continue;
    rgba[i * 4] = src[best * 4];
    rgba[i * 4 + 1] = src[best * 4 + 1];
    rgba[i * 4 + 2] = src[best * 4 + 2];
  }
}

/** 元画像(切り抜き前)の上限。スマホのJPEG(1000px高)で十分収まる。 */
export const RAW_MAX_BYTES = 4_000_000;

/** 元画像の検証。JPEG/PNGどちらでもよい(切り抜き係が読める形式なら可)。 */
export function validateRawUpload(input: { mime: string; size: number }): PhotoValidation {
  if (input.mime !== 'image/jpeg' && input.mime !== 'image/png') {
    return { ok: false, error: '元画像はJPEGかPNGで送ってください' };
  }
  if (input.size <= 0) return { ok: false, error: '元画像が空です' };
  if (input.size > RAW_MAX_BYTES) {
    return { ok: false, error: `元画像が大きすぎます(${Math.round(RAW_MAX_BYTES / 1_000_000)}MBまで)` };
  }
  return { ok: true };
}

/**
 * 切り抜き係の合言葉の照合。長さが違えば即 false、同じ長さなら全桁を必ず比較する
 * (途中で抜けると、応答時間から桁ごとに当てられる)。
 */
export function isWorkerKeyValid(provided: string | null | undefined, stored: string): boolean {
  if (!stored || !provided) return false;
  if (provided.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i += 1) diff |= provided.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}
