// 出場者の写真の「頭の位置」をそろえるための純ロジック。DBにもDOMにも触らない。
//
// 背景(TARO 2026-09-18): 本番の切り抜き写真4枚を測ったところ、人物の頭頂が
// 画像の上から 18.7% / 21.4% / 26.7% / 34.3% とばらばらだった。VS画面で2人を
// 並べると片方だけ小さく見える。撮り方でばらつくので、①表示するときに頭頂を
// 揃え、②撮るときに点線のガイドで大きさと位置を揃える、の二段で直す。
//
// ⚠️ 大きさ(拡大率)の自動補正はしない。しゃがむ・跳ぶなどポーズは自由なので、
//    人物の高さで割って正規化すると、ポーズによって巨大に補正されて破綻する。
//    大きさは撮影ガイドで揃える。ここで揃えるのは頭頂の高さだけ。
import { fitBustFrame } from './bf6Photo';

/** VS画面の写真の拡大率(TARO 2026-09-18「1.3倍がインパクト的にいい」) */
export const VS_PHOTO_SCALE = 1.3;

/**
 * 頭頂を置く高さ。写真枠の高さに対する割合で、拡大後の見た目で測る。
 * 枠の上端ぎりぎりだと頭が窮屈に見えるので少し下げる。
 */
export const VS_HEAD_TARGET = 0.04;

/** この濃さより薄い画素は背景除去の残りかすとみなす(縁に alpha 10 前後が残る) */
const ALPHA_MIN = 48;
/**
 * 1行のうちこの割合以上が不透明になった行を頭頂とする(1画素のゴミを拾わない)。
 * 本番の写真は幅593pxなので12画素。頭のてっぺんは数行で12画素を超えるので、
 * 本物の頭頂からのずれは数px(760px中)で済む。
 */
const ROW_MIN_FRACTION = 0.02;
/** 幅が小さい画像でも最低この画素数は要求する */
const ROW_MIN_PIXELS = 3;

/**
 * 切り抜き写真(RGBA)で、人物が始まる行を画像の高さに対する割合で返す。
 * 全部透明なら null。
 */
export function contentTopRatio(data: Uint8ClampedArray, width: number, height: number): number | null {
  if (width <= 0 || height <= 0) return null;
  const need = Math.max(ROW_MIN_PIXELS, Math.ceil(width * ROW_MIN_FRACTION));
  for (let y = 0; y < height; y += 1) {
    let n = 0;
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3] >= ALPHA_MIN) {
        n += 1;
        if (n >= need) return y / height;
      }
    }
  }
  return null;
}

/**
 * 頭頂を揃えるために写真を上下にずらす量。写真枠の高さに対する割合で返す
 * (CSS の translateY(%) にそのまま使える。% は拡大前の自分の高さが基準)。
 *
 * transform は `translateY(ずらし) scale(拡大)`、基準点は上端中央。
 * このとき見た目の頭頂 = ずらし + 頭頂の位置 × 拡大率 になるので、
 * それが target になるように逆算する。
 *
 * 測れなかった写真(null)は動かさない。
 */
export function headAlignShift(topRatio: number | null, opt: { scale: number; target: number }): number {
  if (topRatio === null) return 0;
  return opt.target - topRatio * opt.scale;
}

export type Rect = { left: number; top: number; width: number; height: number };

/**
 * 撮影ガイドを重ねる位置。実際に保存される範囲(fitBustFrame)を、
 * 画面に表示されている映像の座標に写したもの。
 *
 * ⚠️ ガイドと保存範囲がずれると、ガイドに合わせて撮っても肩が切れる。
 *    保存側と必ず同じ fitBustFrame から計算すること。
 */
export function guideRect(
  video: { width: number; height: number },
  box: { width: number; height: number }
): Rect | null {
  if (video.width <= 0 || video.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const f = fitBustFrame(video);
  const sx = box.width / video.width;
  const sy = box.height / video.height;
  return { left: f.x * sx, top: f.y * sy, width: f.width * sx, height: f.height * sy };
}

/**
 * 写真の下をぼかす位置を、画像の中の割合(マスクの gradient に書く値)に直す。
 * from / to は写真枠の高さに対する見た目の位置(ここからぼけ始め、ここで消える)。
 *
 * ⚠️ ぼかしを写真の外枠(左右いっぱいの箱)に掛けないこと。枠全体に mask を掛けると
 *    その箱ごと別の合成面になり、名前の行の下端(71%付近)に画面を横切る薄い段差が出た
 *    (実測で明るさの段差 0〜2 → 2〜6 に増えた・2026-09-18)。
 *    写真1枚ずつに掛け、位置はこの関数でそろえる。
 *
 * マスクは写真と一緒にずれて拡大されるので、画像の中の割合 f は見た目で
 * shift + f × scale の高さに来る。そこから逆算する。
 */
/** ぼかしの最低幅(画像の高さに対する割合)。短いと急に消えて線に見える。 */
const FADE_MIN = 0.2;

export function photoFadeStops(
  shift: number,
  scale: number,
  from: number,
  to: number
): { start: number; end: number } {
  // ⚠️ 写真の下端(1.0)までに必ず消えきらせる。頭頂が低い写真は大きく持ち上げるので、
  //    写真の下端が「消えきる高さ」より上に来る。そのままだと半透明のまま写真が終わり、
  //    胴体に直線の切れ目が出た(2026-09-18 実画像で確認)。
  const end = Math.min(1, (to - shift) / scale);
  const start = Math.min((from - shift) / scale, end - FADE_MIN);
  return { start, end };
}
