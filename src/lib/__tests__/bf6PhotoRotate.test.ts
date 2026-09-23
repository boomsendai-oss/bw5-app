import { describe, it, expect } from 'vitest';
import { fitBustFrame, PHOTO_ASPECT } from '../bf6Photo';
import {
  OVERLAY_DEG,
  capturePlan,
  captureTransform,
  containRect,
  shouldReopen,
  viewedSize,
  stageView,
  toScreenOffset,
  viewedToVideoRect,
} from '../bf6PhotoRotate';

/** 回転ロックONの実機が縦画面によこす横長の映像 */
const WIDE = { width: 1280, height: 960 };
/** 縦長の映像(端末によってはこちらが来る) */
const TALL = { width: 960, height: 1280 };

/** CSS の rotate(deg)(時計回りが正・y は下向き)で点を回す */
function rot(deg: number, p: { x: number; y: number }) {
  const a = (deg * Math.PI) / 180;
  return { x: Math.cos(a) * p.x - Math.sin(a) * p.y, y: Math.sin(a) * p.x + Math.cos(a) * p.y };
}

describe('持ち方は決め打ち(スマホを左に倒す)', () => {
  it('重ねるものは画面に対して +90°(実機の見え方を固定した値・TARO 2026-09-23)', () => {
    // ⚠️ 理屈で動かさない。映像は回さず(回転0)、重ねるものだけを回す
    expect(OVERLAY_DEG).toBe(90);
  });

  it('横持ちした人から見た映像は縦横が入れ替わる', () => {
    expect(viewedSize(WIDE, true)).toEqual({ width: 960, height: 1280 });
    expect(viewedSize(WIDE, false)).toEqual(WIDE);
  });
});

describe('capturePlan(切り出し)', () => {
  for (const [name, video] of [['横長の映像', WIDE], ['縦長の映像', TALL]] as const) {
    it(`縦画面 / ${name}: 保存は横長(1.2:1)、切り出しは映像の座標では縦長`, () => {
      const p = capturePlan(video, true);
      expect(p.turned).toBe('quarter');
      expect(p.frame).toEqual(fitBustFrame(viewedSize(video, true)));
      expect(p.frame.width / p.frame.height).toBeCloseTo(PHOTO_ASPECT, 2);
      expect(p.src.height).toBeGreaterThan(p.src.width);
      expect(p.src.x).toBeGreaterThanOrEqual(0);
      expect(p.src.y).toBeGreaterThanOrEqual(0);
      expect(p.src.x + p.src.width).toBeLessThanOrEqual(video.width);
      expect(p.src.y + p.src.height).toBeLessThanOrEqual(video.height);
      // 見た目の上(人の頭)は映像の右。右端に貼り付いて切り出す
      expect(p.src.x + p.src.width).toBe(video.width);
    });
  }

  it('画面が横向きのときは今までどおり(回さず、そのまま切り出す)', () => {
    const p = capturePlan(WIDE, false);
    expect(p.turned).toBe('none');
    expect(p.src).toEqual(fitBustFrame(WIDE));
    expect(p.frame.width / p.frame.height).toBeCloseTo(PHOTO_ASPECT, 2);
  });
});

describe('ガイドと保存範囲が一致する(見たものがそのまま保存される)', () => {
  // 層の中でガイドが指す点を、層の回転(OVERLAY_DEG)で画面=映像の座標に写し、
  // capturePlan の切り出し範囲と重なるかを見る。映像は画面に対して回していないので、
  // 画面の座標 = 映像の座標(等倍で出したとして)。
  for (const [name, video] of [['横長の映像', WIDE], ['縦長の映像', TALL]] as const) {
    it(`${name}: ガイドの四隅が保存範囲の四隅に重なる`, () => {
      const viewed = viewedSize(video, true);
      const g = fitBustFrame(viewed);
      const corners = [
        { x: g.x, y: g.y },
        { x: g.x + g.width, y: g.y },
        { x: g.x, y: g.y + g.height },
        { x: g.x + g.width, y: g.y + g.height },
      ].map((p) => {
        const r = rot(OVERLAY_DEG, { x: p.x - viewed.width / 2, y: p.y - viewed.height / 2 });
        // ⚠️ -0 と 0 は toBe で別物になる。|| 0 で潰す
        return { x: Math.round(r.x + video.width / 2) || 0, y: Math.round(r.y + video.height / 2) || 0 };
      });
      const { src } = capturePlan(video, true);
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      expect(Math.min(...xs)).toBe(src.x);
      expect(Math.max(...xs)).toBe(src.x + src.width);
      expect(Math.min(...ys)).toBe(src.y);
      expect(Math.max(...ys)).toBe(src.y + src.height);
    });
  }

  it('viewedToVideoRect は1点でも同じ対応になる(枠の幅0でも崩れない)', () => {
    const r = viewedToVideoRect({ x: 10, y: 20, width: 0, height: 0 }, WIDE);
    expect(r).toEqual({ x: WIDE.width - 20, y: 10, width: 0, height: 0 });
  });
});

describe('captureTransform(保存する向き)', () => {
  /** drawImage の描き先(回転後の座標)を canvas の座標に写す */
  function toCanvas(t: { tx: number; ty: number; angle: number }, l: { x: number; y: number }) {
    const c = Math.cos(t.angle);
    const s = Math.sin(t.angle);
    // ⚠️ -0 と 0 は toEqual で別物になる。|| 0 で潰す
    return { x: Math.round(t.tx + c * l.x - s * l.y) || 0, y: Math.round(t.ty + s * l.x + c * l.y) || 0 };
  }
  const outW = 1200;
  const outH = 1000;

  for (const [name, video] of [['横長の映像', WIDE], ['縦長の映像', TALL]] as const) {
    it(`縦画面 / ${name}: 見た目の左上(頭側)が保存画像の左上に来る`, () => {
      const { frame, src, turned } = capturePlan(video, true);
      const t = captureTransform(turned, outW, outH);
      expect(t.drawWidth).toBe(outH);
      expect(t.drawHeight).toBe(outW);
      // 映像の点 → drawImage の描き先
      const local = (vx: number, vy: number) => ({
        x: ((vx - src.x) / src.width) * t.drawWidth,
        y: ((vy - src.y) / src.height) * t.drawHeight,
      });
      // 見た目の点 → 映像の点 → canvas の点
      const at = (u: number, v: number) => {
        const r = viewedToVideoRect({ x: u, y: v, width: 0, height: 0 }, video);
        return toCanvas(t, local(r.x, r.y));
      };
      expect(at(frame.x, frame.y)).toEqual({ x: 0, y: 0 });
      expect(at(frame.x + frame.width, frame.y)).toEqual({ x: outW, y: 0 });
      expect(at(frame.x, frame.y + frame.height)).toEqual({ x: 0, y: outH });
      expect(at(frame.x + frame.width, frame.y + frame.height)).toEqual({ x: outW, y: outH });
    });
  }

  it('映像の右上の目印は、保存画像の左上に出る(縦画面)', () => {
    // 見た目の上 = 映像の右。映像の右上の角は、保存される写真では左上の角になる
    const { src, turned } = capturePlan(WIDE, true);
    const t = captureTransform(turned, outW, outH);
    const local = (vx: number, vy: number) => ({
      x: ((vx - src.x) / src.width) * t.drawWidth,
      y: ((vy - src.y) / src.height) * t.drawHeight,
    });
    expect(toCanvas(t, local(src.x + src.width, src.y))).toEqual({ x: 0, y: 0 });
    // 映像の右下は保存画像の右上
    expect(toCanvas(t, local(src.x + src.width, src.y + src.height))).toEqual({ x: outW, y: 0 });
  });

  it('画面が横向き: そのまま(左上が左上)', () => {
    const t = captureTransform('none', outW, outH);
    expect(t.drawWidth).toBe(outW);
    expect(toCanvas(t, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(toCanvas(t, { x: outW, y: outH })).toEqual({ x: outW, y: outH });
  });
});

describe('containRect', () => {
  it('横長の箱に縦長の映像を収めると、左右に余白が出て中央に来る', () => {
    expect(containRect({ width: 300, height: 400 }, { width: 800, height: 400 })).toEqual({
      left: 250,
      top: 0,
      width: 300,
      height: 400,
    });
  });

  it('大きさが0なら null', () => {
    expect(containRect({ width: 0, height: 400 }, { width: 800, height: 400 })).toBeNull();
  });
});

describe('shouldReopen(カメラを開き直すか)', () => {
  it('画面が横向きなのに縦長の映像が来ているときだけ開き直す(2026-09-19の件)', () => {
    expect(shouldReopen(false, TALL)).toBe(true);
    expect(shouldReopen(false, WIDE)).toBe(false);
  });

  it('⚠️ 縦画面では開き直さない。回転ロックONの実機は横長をよこすので、止まらなくなる', () => {
    expect(shouldReopen(true, WIDE)).toBe(false);
    expect(shouldReopen(true, TALL)).toBe(false);
  });

  it('映像の大きさがまだ取れていないときは何もしない', () => {
    expect(shouldReopen(false, { width: 0, height: 0 })).toBe(false);
  });
});

describe('stageView(ガイドは画面から絶対にはみ出さない)', () => {
  // ⚠️ 実機で頭のてっぺんの線が画面の外に出て切れた(TARO 2026-09-23
  //    「頭の先っぽ切れちゃっててレイアウト崩れてますね」)。寄せる倍率を映像の中心で
  //    掛けていたため、上端に貼り付いた保存範囲が画面の外に出ていた。
  //    スタッフは頭とあごをこの線に合わせる。黒帯は許すが、線が切れるのは許さない。
  const PORTRAIT = { width: 390, height: 844 };
  const LANDSCAPE = { width: 844, height: 390 };
  const cases = [
    { name: '縦画面 / 横長の映像', video: WIDE, box: { width: PORTRAIT.height, height: PORTRAIT.width }, rotated: true },
    { name: '縦画面 / 縦長の映像', video: TALL, box: { width: PORTRAIT.height, height: PORTRAIT.width }, rotated: true },
    { name: '横画面', video: WIDE, box: LANDSCAPE, rotated: false },
  ];

  for (const c of cases) {
    it(`${c.name}: ガイドが画面の中に丸ごと入る(余白は0以上)`, () => {
      const v = stageView(c.video, c.box, c.rotated)!;
      expect(v).not.toBeNull();
      expect(v.guide.left).toBeGreaterThanOrEqual(0);
      expect(v.guide.top).toBeGreaterThanOrEqual(0);
      expect(v.guide.left + v.guide.width).toBeLessThanOrEqual(c.box.width);
      expect(v.guide.top + v.guide.height).toBeLessThanOrEqual(c.box.height);
      // 保存される写真と同じ縦横比のまま(歪めていない)
      expect(v.guide.width / v.guide.height).toBeCloseTo(PHOTO_ASPECT, 2);
    });
  }

  it('縦画面ではガイドを画面の中央に置き、画面の9割まで寄せる', () => {
    const box = { width: PORTRAIT.height, height: PORTRAIT.width };
    const v = stageView(WIDE, box, true)!;
    expect(v.guide.top + v.guide.height / 2).toBeCloseTo(box.height / 2, 5);
    expect(v.guide.left + v.guide.width / 2).toBeCloseTo(box.width / 2, 5);
    // 高さいっぱい(9割)まで大きくなる
    expect(v.guide.height).toBeCloseTo(box.height * 0.9, 5);
    expect(v.scale).toBeGreaterThan(1);
  });

  it('横画面は今までどおり寄せない(倍率1・移動なし)', () => {
    const v = stageView(WIDE, LANDSCAPE, false)!;
    expect(v.scale).toBe(1);
    expect(v.dx).toBe(0);
    expect(v.dy).toBe(0);
  });

  it('映像の大きさが0なら null', () => {
    expect(stageView({ width: 0, height: 0 }, LANDSCAPE, false)).toBeNull();
  });
});

describe('toScreenOffset(層の移動量を画面の座標に直す)', () => {
  it('縦画面では層の回転(+90°)ぶん回す', () => {
    expect(toScreenOffset(10, 20, true)).toEqual({ x: -20, y: 10 });
  });
  it('横画面はそのまま', () => {
    expect(toScreenOffset(10, 20, false)).toEqual({ x: 10, y: 20 });
  });
});
