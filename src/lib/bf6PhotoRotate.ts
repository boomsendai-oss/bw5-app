// 回転ロックのまま横持ちで撮るための純ロジック(DOMにもDBにも触らない)。
//
// 背景(TARO 2026-09-23「回転ロックのまま縦持ちでも、横向きのカメラ画面が出るようにする」):
// スタッフのiPhoneは回転ロックがONのことが多い。横に倒しても画面は縦のままで、
// 以前は「横にして」の黒い画面が出て撮れなかった(「真っ黒に見える」)。
//
// ■ 持ち方は決め打ち(TARO 2026-09-23)
// 当日は「スマホを左に倒して(端末の上端が左・左の辺が下)横向きに構える」。これだけ。
// 傾きセンサーでの自動判定も、向きを切り替えるボタンも置かない(当日に迷う余地を作らない)。
//
// ■ 何をどう回すか(実機の画面写真から決めた。理屈から決めない)
//  - カメラ映像(<video>)は画面に対して回さない。
//    ⚠️ 実機(TARO iPhone 2026-09-23・3枚目)で分かったこと: 回転ロックONのiPhoneが返す
//       フレームは「端末の窓」そのもの。画面に対して回さずに出すと、横に倒して持っている人には
//       そのまま正しい向きに見える。1つ前の版は映像を -90° 回していて、TAROから
//       「今の映像をさらに90°時計回りにしたのが正しい」= 回転0が正しい、という報告が出た。
//  - 重ねるもの(名前・ボタン・ガイド・確認画面の写真)だけを +90°(時計回り)回す。
//    この値は実機で文字の向きに文句が出ていない今の見え方をそのまま固定したもの。
//  - 保存する範囲は「横持ちした人から見た横長」。画面(=映像)の座標では縦長の範囲になる。
//
// ■ 見たものがそのまま保存される(WYSIWYG)
// ガイドの位置も、切り出す範囲も、保存時の回転も、すべて下の OVERLAY_DEG 1つから出す。
// ガイドの四隅が保存範囲の四隅に重なることはテストで固定している。
import { fitBustFrame, type Frame } from './bf6Photo';
import type { Rect } from './bf6PhotoAlign';

/**
 * 縦画面のときに、重ねるもの(名前・ボタン・ガイド・確認画面)を画面に対して回す角度。
 * CSSの rotate と同じで時計回りが正。「スマホを左に倒す」持ち方に合わせた +90°。
 * ⚠️ 実機の見え方(TARO iPhone 2026-09-23)を固定した値。理屈で動かさないこと。
 */
export const OVERLAY_DEG = 90;

/** 横持ちした人から見た映像の大きさ。縦画面では縦横が入れ替わる */
export function viewedSize(video: { width: number; height: number }, rotated: boolean): { width: number; height: number } {
  return rotated ? { width: video.height, height: video.width } : { width: video.width, height: video.height };
}

/**
 * 横持ちした人から見た座標の枠を、映像そのものの座標に戻す。
 *
 * 重ねるものを +90°(時計回り)回しているので、映像は層から見ると -90° 回って見える。
 * つまり 見た目の上 = 映像の右(+x)、見た目の右 = 映像の下(+y)。
 *
 * ⚠️ 画面側の回転(OVERLAY_DEG)と必ず同じ対応にすること。ずれるとガイドに合わせて撮っても
 *    別の場所が保存される。テストで両者の一致を確かめている。
 */
export function viewedToVideoRect(frame: Frame, video: { width: number; height: number }): Frame {
  return { x: video.width - frame.y - frame.height, y: frame.x, width: frame.height, height: frame.width };
}

/** 保存時に canvas を回す量。'none' = そのまま(画面が横向き)、'quarter' = -90°(縦画面) */
export type CaptureTurn = 'none' | 'quarter';

/**
 * 撮るときの切り出し。
 * frame … 保存される写真の縦横(横長 1.2:1)。見た目の座標
 * src   … 映像から切り出す範囲。映像の座標
 */
export function capturePlan(
  video: { width: number; height: number },
  screenPortrait: boolean
): { frame: Frame; src: Frame; turned: CaptureTurn } {
  if (!screenPortrait) {
    const frame = fitBustFrame(video);
    return { frame, src: frame, turned: 'none' };
  }
  const frame = fitBustFrame(viewedSize(video, true));
  return { frame, src: viewedToVideoRect(frame, video), turned: 'quarter' };
}

/**
 * 切り出した範囲を、横長で正しい向きの画像(幅 outW × 高さ outH)に描くための変換。
 * ctx.translate(tx, ty) → ctx.rotate(angle) のあと
 * drawImage(video, src..., 0, 0, drawWidth, drawHeight)。
 *
 * 縦画面では -90°(反時計回り)。重ねるものを +90° 回して見せているぶんを戻すと、
 * 横持ちした人が見ていた向き = 世界の上 が、写真の上になる。
 */
export function captureTransform(
  turned: CaptureTurn,
  outW: number,
  outH: number
): { tx: number; ty: number; angle: number; drawWidth: number; drawHeight: number } {
  if (turned === 'quarter') {
    // 原点を左下に置いて反時計回りに90°。回したあとなので描き先は幅と高さが入れ替わる
    return { tx: 0, ty: outH, angle: -Math.PI / 2, drawWidth: outH, drawHeight: outW };
  }
  return { tx: 0, ty: 0, angle: 0, drawWidth: outW, drawHeight: outH };
}

/** object-contain で箱に収めたときに、映像が実際に映る範囲(箱の座標) */
export function containRect(src: { width: number; height: number }, box: { width: number; height: number }): Rect | null {
  if (src.width <= 0 || src.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const s = Math.min(box.width / src.width, box.height / src.height);
  const width = src.width * s;
  const height = src.height * s;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

/** 画面いっぱいに寄せるときの上限。これ以上拡大しても粗くなるだけ */
const MAX_ZOOM = 3;
/** 保存範囲の外に残す余白の割合。頭のてっぺんの線とその文字が画面の端に触れないように */
const GUIDE_MARGIN = 0.9;

/**
 * 画面に何をどう出すか。保存範囲(ガイド)を画面の真ん中に、画面いっぱいまで寄せて出す。
 * 返す guide は寄せたあとの位置(層の座標)。映像には scale と、同じだけの移動を掛ける。
 *
 * ⚠️ 保存範囲(ガイド)は画面から絶対にはみ出させない(contain。cover にしない)。
 *    寄せる倍率を映像の中心で掛けていたため、上端に貼り付いている保存範囲が画面の外に出て、
 *    頭のてっぺんの線と文字が切れた(TARO実機 2026-09-23「頭の先っぽ切れちゃってて
 *    レイアウト崩れてますね」)。スタッフは頭とあごをこの線に合わせるので、線が見えないのは致命的。
 *    黒帯が出るのは構わない。ガイドの中心を画面の中心に置き、余白ぶん小さく収める。
 */
export function stageView(
  video: { width: number; height: number },
  box: { width: number; height: number },
  rotated: boolean
): { guide: Rect; scale: number; dx: number; dy: number } | null {
  const viewed = viewedSize(video, rotated);
  const shown = containRect(viewed, box);
  if (!shown) return null;
  const { frame } = capturePlan(video, rotated);
  const p = shown.width / viewed.width;
  const g: Rect = {
    left: shown.left + frame.x * p,
    top: shown.top + frame.y * p,
    width: frame.width * p,
    height: frame.height * p,
  };
  if (g.width <= 0 || g.height <= 0) return null;
  // 横画面は今までどおり、映像を丸ごと見せる(寄せない)
  if (!rotated) return { guide: g, scale: 1, dx: 0, dy: 0 };

  const scale = Math.min(
    MAX_ZOOM,
    (box.width * GUIDE_MARGIN) / g.width,
    (box.height * GUIDE_MARGIN) / g.height
  );
  // ガイドの中心が画面の中心に来るように動かす(映像も同じだけ動かす)
  const gcx = g.left + g.width / 2;
  const gcy = g.top + g.height / 2;
  const dx = scale * (box.width / 2 - gcx);
  const dy = scale * (box.height / 2 - gcy);
  const width = g.width * scale;
  const height = g.height * scale;
  return {
    guide: { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height },
    scale,
    dx,
    dy,
  };
}

/**
 * 上の移動量(層の座標)を、画面の座標に直す。映像は画面に対して回していないので、
 * CSSの transform に入れる前に層の回転ぶん(OVERLAY_DEG)だけ回す必要がある。
 */
export function toScreenOffset(dx: number, dy: number, rotated: boolean): { x: number; y: number } {
  if (!rotated) return { x: dx, y: dy };
  // OVERLAY_DEG = 90 の回転: (x, y) → (-y, x)。⚠️ OVERLAY_DEG を変えたらここも直す
  return { x: -dy, y: dx };
}

/**
 * カメラを開き直すべきか。
 * ⚠️ 「画面と映像の向きが違えば開き直す」にしないこと。回転ロックONの実機は
 *    縦画面に横長の映像をよこすので、開き直しが止まらなくなる(あれは正しく扱える状態)。
 *    開き直して得があるのは「画面は横向きなのに縦長の映像が来ている」場合だけ
 *    (縦向きで開いたカメラが縦長のまま残り、横向きの利点が消える・2026-09-19の件)。
 */
export function shouldReopen(screenPortrait: boolean, video: { width: number; height: number }): boolean {
  return !screenPortrait && video.width > 0 && video.width <= video.height;
}
