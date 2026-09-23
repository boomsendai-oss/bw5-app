// 回転ロックのまま横持ちで撮るための純ロジック(DOMにもDBにも触らない)。
//
// 背景(TARO 2026-09-23「回転ロックのまま縦持ちでも、横向きのカメラ画面が出るようにする」):
// スタッフのiPhoneは回転ロックがONのことが多い。横に倒しても画面は縦のままで、
// 以前は「横にして」の黒い画面が出て撮れなかった(「真っ黒に見える」)。
//
// 考え方:
//  - カメラ映像(<video>)は画面に対して回さない。端末と一緒にカメラも回っているので、
//    横に持った人から見ると、縦向きの画面に映る映像はそのまま正しい向きに見えている。
//  - 回すのは上に重ねる文字・ボタン・ガイドだけ(画面の中に「仮想の横画面」を作る)。
//  - 保存範囲は「横持ちした人から見た横長」。画面の座標では縦長の範囲になる。
//    縦横を入れ替えた映像の大きさで fitBustFrame を計算し、映像の座標に戻して切り出す。
//
// 回す向きの呼び方(端末をどちらに倒したか・画面を正面から見て):
//   'ccw' = 反時計回りに倒した。端末の上端(インカメラ側)が左、下端が右に来る
//   'cw'  = 時計回りに倒した。端末の上端が右、下端が左に来る
import { fitBustFrame, type Frame } from './bf6Photo';
import type { Rect } from './bf6PhotoAlign';

export type TurnDir = 'ccw' | 'cw';

/**
 * 向きが分からないとき(傾きセンサーが使えない・拒否された)の既定。
 * 反時計回り(上端が左・下端=ホーム側が右)にした。横向き表示のアプリで一般的な持ち方
 * (iOSの landscapeRight)。逆なら画面の「↻ 上下が逆のとき」で直せる。
 */
export const DEFAULT_TURN: TurnDir = 'ccw';

export function flipTurn(d: TurnDir): TurnDir {
  return d === 'ccw' ? 'cw' : 'ccw';
}

/** 横持ちした人から見た映像の大きさ(縦と横を入れ替える) */
export function physicalSize(video: { width: number; height: number }): { width: number; height: number } {
  return { width: video.height, height: video.width };
}

/**
 * 重ねる文字・ボタンの層を画面に対して何度回すか(CSSの rotate・時計回りが正)。
 * 端末を反時計回りに倒したら、中身は時計回りに回すと正しい向きに見える。
 */
export function overlayRotationDeg(d: TurnDir): 90 | -90 {
  return d === 'ccw' ? 90 : -90;
}

/**
 * 横持ちした人から見た座標(physicalSize の中の枠)を、映像そのものの座標に戻す。
 *
 * 'ccw': 見た目の上 = 映像の右(+x)、見た目の右 = 映像の下(+y)
 * 'cw' : 見た目の上 = 映像の左(-x)、見た目の右 = 映像の上(-y)
 *
 * ⚠️ 画面側の層の回転(overlayRotationDeg)と必ず同じ対応にすること。
 *    ずれるとガイドに合わせて撮っても別の場所が保存される。テストで両者の一致を確かめている。
 */
export function physicalToVideoRect(frame: Frame, video: { width: number; height: number }, d: TurnDir): Frame {
  if (d === 'ccw') {
    return { x: video.width - frame.y - frame.height, y: frame.x, width: frame.height, height: frame.width };
  }
  return { x: frame.y, y: video.height - frame.x - frame.width, width: frame.height, height: frame.width };
}

/**
 * 縦画面に横長の映像が来たとき、映像を画面に対して何度回すか(CSSの rotate)。
 *
 * ⚠️ 重ねる層(overlayRotationDeg)と同じではなく、逆向き(= 層 + 180°)。
 *
 * 分かっている事実(TARO iPhone 2026-09-23・2枚目): 層と同じだけ回したら、映像の中身だけが
 * 上下逆さまになった(重ねた文字とガイドはそのまま読めるのに、写っているMacBookが逆さま)。
 *
 * なぜ「傾きの判定が逆だった」ではなく「層と映像の関係が逆」と言えるか:
 * 倒した向きの判定が逆でも、層と映像は両方とも180°ずれるだけなので、互いの食い違いは出ない。
 * 実機で食い違ったのだから、原因は層と映像の相対関係そのもの。だから相対で180°直す。
 * (このため「↻ 上下が逆のとき」は今も効く。↻は層と映像を一緒に180°回すので、
 *  そろったまま上下だけが入れ替わる。傾きの判定が逆の機種はこれで直せる)
 *
 * 推測(確かめていない): iOSが返す横長のフレームは端末に貼り付いた向きで返っていて、
 * 世界の上がどちら側かがこちらの想定と逆になっている。
 */
export function videoRotationDeg(d: TurnDir): 90 | -90 {
  // overlayRotationDeg(d) + 180 と同じ(±90 なので符号を返すだけで足りる)
  return d === 'ccw' ? -90 : 90;
}

/** 枠を180°回した位置(映像を180°回して見せているときに、見た目の枠を映像の座標に戻す) */
export function rotate180Rect(frame: Frame, video: { width: number; height: number }): Frame {
  return {
    x: video.width - frame.x - frame.width,
    y: video.height - frame.y - frame.height,
    width: frame.width,
    height: frame.height,
  };
}

/** 回転ロックの縦画面で保存する範囲(映像の座標)。保存される写真の縦横は frame 側(横長) */
export function portraitLockCrop(video: { width: number; height: number }, d: TurnDir): { frame: Frame; src: Frame } {
  const frame = fitBustFrame(physicalSize(video));
  return { frame, src: physicalToVideoRect(frame, video, d) };
}

/**
 * 切り出した範囲を、横長で正しい向きの画像(幅 outW × 高さ outH)に描くための変換。
 * canvas で ctx.translate(tx, ty) → ctx.rotate(angle) のあと
 * drawImage(video, src..., 0, 0, outH, outW) と描く(回したあとなので幅と高さが入れ替わる)。
 */
export function uprightTransform(d: TurnDir, outW: number, outH: number): { tx: number; ty: number; angle: number } {
  // 'ccw' は映像の右が上なので、反時計回りに90°戻す。原点を左下に置く
  if (d === 'ccw') return { tx: 0, ty: outH, angle: -Math.PI / 2 };
  // 'cw' は映像の左が上なので、時計回りに90°戻す。原点を右上に置く
  return { tx: outW, ty: 0, angle: Math.PI / 2 };
}

/** object-contain で箱に収めたときに、映像が実際に映る範囲(箱の座標) */
export function containRect(src: { width: number; height: number }, box: { width: number; height: number }): Rect | null {
  if (src.width <= 0 || src.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const s = Math.min(box.width / src.width, box.height / src.height);
  const width = src.width * s;
  const height = src.height * s;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

/**
 * 重力(accelerationIncludingGravity)の符号の向き。
 * ⚠️ iPhone(Safari)と Android(Chrome)で符号が逆。仕様とAndroidは「上向きが正」
 *    (まっすぐ縦に持つと y ≒ +9.8)、iPhoneは「下向きが正」(y ≒ -9.8)。
 *    ここで仕様の向きにそろえてから判定する。符号が合わない機種でも画面の「↻」で直せる。
 */
export function motionSign(iosLike: boolean): 1 | -1 {
  return iosLike ? -1 : 1;
}

/** 横に倒したと判定する x の大きさ(m/s²)。9.8の半分強。机に平置きのときは変えない */
const TURN_ON = 5.5;

/**
 * 重力から、端末をどちらに倒しているかを決める。はっきりしないときは前の値のまま
 * (平置き・斜め持ちで表示がパタパタ入れ替わらないように)。
 * x, y は accelerationIncludingGravity の生の値、sign は motionSign()。
 */
export function turnFromGravity(
  prev: TurnDir | null,
  g: { x: number | null; y: number | null },
  sign: 1 | -1
): TurnDir | null {
  if (g.x == null || !Number.isFinite(g.x)) return prev;
  const x = g.x * sign;
  const y = g.y != null && Number.isFinite(g.y) ? Math.abs(g.y) : 0;
  // 横方向の重力が十分に大きく、縦方向より勝っているときだけ判定する
  if (Math.abs(x) < TURN_ON || Math.abs(x) < y) return prev;
  // 反時計回りに倒すと端末の右側(+x)が上を向く → 仕様の向きで x が正
  return x > 0 ? 'ccw' : 'cw';
}

/**
 * 実際に使う向きを決める。
 *  - 傾きが取れているとき: 傾きの向き。符号が逆の機種のために signFix(「↻」で切り替え・端末に記憶)で反転できる
 *  - 取れないとき(拒否・非対応): 手動の向き(「↻」で切り替え)、それも無ければ既定
 * ⚠️ 2つを分けているのは、「傾きの符号直し」を傾きが無い状態の手動切り替えと混ぜると、
 *    次に傾きが取れたときに逆向きになるため。
 */
export function effectiveTurn(s: { gravity: TurnDir | null; signFix: boolean; manual: TurnDir | null }): TurnDir {
  if (s.gravity) return s.signFix ? flipTurn(s.gravity) : s.gravity;
  return s.manual ?? DEFAULT_TURN;
}

/**
 * 画面と映像の組み合わせ(実機で分かった話・TARO 2026-09-23)。
 *
 * ⚠️ 回転ロックONのiPhoneでは、映像が「世界から見て正しい向き」=横長で届いた
 *    (画面は縦のまま)。「縦画面には必ず縦長の映像が来る」という前提が実機で崩れた
 *    (TARO実機の画面写真。MacBookが横倒しに映り、重ねた文字とガイドだけが回っていた)。
 *    端末・OSで変わるので、届いた映像の縦横で決める。
 *
 *  'landscape'                … 画面が横向き。今までどおり(何も回さない)
 *  'portrait-rotate-video'    … 縦画面 × 横長の映像(回転ロックの実機)。
 *                               映像も重ねる層も同じだけ回す。切り出しは回さずそのまま
 *  'portrait-rotate-overlay'  … 縦画面 × 縦長の映像。映像は回さず、重ねる層だけ回す。
 *                               切り出した縦長の範囲を90°戻して横長にする
 */
export type StageMode = 'landscape' | 'portrait-rotate-video' | 'portrait-rotate-overlay';

export function stageMode(screenPortrait: boolean, video: { width: number; height: number } | null): StageMode {
  if (!screenPortrait) return 'landscape';
  // 映像の大きさがまだ分からないときは、映像を回さない側(安全側)にしておく
  if (video && video.width > video.height) return 'portrait-rotate-video';
  return 'portrait-rotate-overlay';
}

/** ガイドを計算するときの映像の大きさ(横持ちした人から見た向き) */
export function guideSource(video: { width: number; height: number }, mode: StageMode): { width: number; height: number } {
  return mode === 'portrait-rotate-overlay' ? physicalSize(video) : video;
}

/**
 * 撮るときに canvas をどれだけ回すか。
 *  'none'    … そのまま(画面が横向き)
 *  'half'    … 180°(縦画面 × 横長の映像。映像も180°回して見せているので、保存も同じだけ回す)
 *  'quarter' … 90°(縦画面 × 縦長の映像。縦長に切り出した範囲を横長に起こす)
 */
export type CaptureTurn = 'none' | 'half' | 'quarter';

/**
 * 撮るときの切り出し。
 * ⚠️ 見えていたものと保存されるものを必ず一致させる。'portrait-rotate-video' で映像を
 *    180°回して見せているのに切り出しを回さないと、保存した写真だけが上下逆になる。
 */
export function capturePlan(
  video: { width: number; height: number },
  mode: StageMode,
  turn: TurnDir
): { frame: Frame; src: Frame; turned: CaptureTurn } {
  if (mode === 'portrait-rotate-overlay') {
    const { frame, src } = portraitLockCrop(video, turn);
    return { frame, src, turned: 'quarter' };
  }
  const frame = fitBustFrame(video);
  if (mode === 'portrait-rotate-video') {
    // 見た目の上(人の頭)は、映像の座標では下側にある
    return { frame, src: rotate180Rect(frame, video), turned: 'half' };
  }
  return { frame, src: frame, turned: 'none' };
}

/**
 * 切り出した範囲を、正しい向きの画像(幅 outW × 高さ outH)に描くための変換。
 * ctx.translate(tx, ty) → ctx.rotate(angle) のあと
 * drawImage(video, src..., 0, 0, drawWidth, drawHeight)。
 */
export function captureTransform(
  turned: CaptureTurn,
  turn: TurnDir,
  outW: number,
  outH: number
): { tx: number; ty: number; angle: number; drawWidth: number; drawHeight: number } {
  if (turned === 'quarter') {
    // 90°回すので、描き先は幅と高さが入れ替わる
    return { ...uprightTransform(turn, outW, outH), drawWidth: outH, drawHeight: outW };
  }
  if (turned === 'half') {
    return { tx: outW, ty: outH, angle: Math.PI, drawWidth: outW, drawHeight: outH };
  }
  return { tx: 0, ty: 0, angle: 0, drawWidth: outW, drawHeight: outH };
}

/**
 * カメラを開き直すべきか。
 * ⚠️ 「画面と映像の向きが違えば開き直す」にすると、回転ロックの実機(縦画面×横長の映像)で
 *    開き直しが無限に続く。あれは正しく扱える状態なので触らない。
 *    開き直して得があるのは「画面は横向きなのに縦長の映像が来ている」場合だけ
 *    (縦向きで開いたカメラが縦長のまま残り、横向きの利点が消える・2026-09-19の件)。
 */
export function shouldReopen(screenPortrait: boolean, video: { width: number; height: number }): boolean {
  return !screenPortrait && video.width > 0 && video.width <= video.height;
}
