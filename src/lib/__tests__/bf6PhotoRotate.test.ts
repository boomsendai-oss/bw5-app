import { describe, it, expect } from 'vitest';
import { fitBustFrame, PHOTO_ASPECT } from '../bf6Photo';
import { guideRect } from '../bf6PhotoAlign';
import {
  DEFAULT_TURN,
  effectiveTurn,
  containRect,
  flipTurn,
  motionSign,
  overlayRotationDeg,
  physicalSize,
  physicalToVideoRect,
  portraitLockCrop,
  turnFromGravity,
  uprightTransform,
  type TurnDir,
} from '../bf6PhotoRotate';

/** 縦向きのカメラ映像(iPhoneの縦画面で届く大きさ) */
const VIDEO = { width: 1080, height: 1440 };

/** CSS の rotate(deg)(時計回りが正・y は下向き)で点を回す */
function rot(deg: number, p: { x: number; y: number }) {
  const a = (deg * Math.PI) / 180;
  return { x: Math.cos(a) * p.x - Math.sin(a) * p.y, y: Math.sin(a) * p.x + Math.cos(a) * p.y };
}

describe('physicalSize / flipTurn', () => {
  it('横持ちした人から見た大きさは縦横が入れ替わる', () => {
    expect(physicalSize(VIDEO)).toEqual({ width: 1440, height: 1080 });
  });
  it('↻で向きが入れ替わる', () => {
    expect(flipTurn('ccw')).toBe('cw');
    expect(flipTurn('cw')).toBe('ccw');
    expect(DEFAULT_TURN).toBe('ccw');
  });
});

describe('portraitLockCrop(回転ロックの縦画面で保存する範囲)', () => {
  it('保存される写真は横長(1.2:1)で、横向きのカメラで撮ったときと同じ枠になる', () => {
    const { frame } = portraitLockCrop(VIDEO, 'ccw');
    expect(frame).toEqual(fitBustFrame({ width: 1440, height: 1080 }));
    expect(frame.width / frame.height).toBeCloseTo(PHOTO_ASPECT, 2);
  });

  it('映像の座標では縦長の範囲になり、映像の外にはみ出さない', () => {
    for (const d of ['ccw', 'cw'] as TurnDir[]) {
      const { src } = portraitLockCrop(VIDEO, d);
      expect(src.height).toBeGreaterThan(src.width);
      expect(src.x).toBeGreaterThanOrEqual(0);
      expect(src.y).toBeGreaterThanOrEqual(0);
      expect(src.x + src.width).toBeLessThanOrEqual(VIDEO.width);
      expect(src.y + src.height).toBeLessThanOrEqual(VIDEO.height);
    }
  });

  it('頭側(見た目の上)の端に寄せて取る: ccw は映像の右端、cw は映像の左端', () => {
    const a = portraitLockCrop(VIDEO, 'ccw').src;
    expect(a.x + a.width).toBe(VIDEO.width);
    const b = portraitLockCrop(VIDEO, 'cw').src;
    expect(b.x).toBe(0);
  });
});

describe('画面のガイド(層を回す)と保存範囲(映像の座標に戻す)が一致する', () => {
  // 映像を等倍で画面いっぱいに出したとする。層は画面の中心で回る。
  // 層の中で guideRect が指す点を、層の回転で画面に写した位置 = 映像の座標で保存する点
  for (const d of ['ccw', 'cw'] as TurnDir[]) {
    it(`${d}: ガイドの四隅が保存範囲の四隅に重なる`, () => {
      const phys = physicalSize(VIDEO);
      const g = guideRect(phys, phys)!;
      const corners = [
        { x: g.left, y: g.top },
        { x: g.left + g.width, y: g.top },
        { x: g.left, y: g.top + g.height },
        { x: g.left + g.width, y: g.top + g.height },
      ].map((p) => {
        const r = rot(overlayRotationDeg(d), { x: p.x - phys.width / 2, y: p.y - phys.height / 2 });
        return { x: Math.round(r.x + VIDEO.width / 2), y: Math.round(r.y + VIDEO.height / 2) };
      });
      const { src } = portraitLockCrop(VIDEO, d);
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      expect(Math.min(...xs)).toBe(src.x);
      expect(Math.max(...xs)).toBe(src.x + src.width);
      expect(Math.min(...ys)).toBe(src.y);
      expect(Math.max(...ys)).toBe(src.y + src.height);
    });
  }
});

describe('uprightTransform(保存画像を正しい向きに描く)', () => {
  /** drawImage の描き先(回転後の座標 lx, ly)を canvas の座標に写す */
  function toCanvas(t: { tx: number; ty: number; angle: number }, l: { x: number; y: number }) {
    const c = Math.cos(t.angle);
    const s = Math.sin(t.angle);
    return { x: Math.round(t.tx + c * l.x - s * l.y), y: Math.round(t.ty + s * l.x + c * l.y) };
  }

  for (const d of ['ccw', 'cw'] as TurnDir[]) {
    it(`${d}: 見た目の左上・右上・左下が canvas の左上・右上・左下に来て、はみ出さない`, () => {
      const { frame, src } = portraitLockCrop(VIDEO, d);
      const outW = 1200;
      const outH = 1000;
      const t = uprightTransform(d, outW, outH);
      // 映像の点 → drawImage の描き先(幅 outH × 高さ outW に拡大)
      const local = (vx: number, vy: number) => ({
        x: ((vx - src.x) / src.width) * outH,
        y: ((vy - src.y) / src.height) * outW,
      });
      // 見た目の点(frame の中) → 映像の点(1画素の枠を physicalToVideoRect で戻す)
      const phys = (u: number, v: number) => {
        const r = physicalToVideoRect({ x: u, y: v, width: 0, height: 0 }, VIDEO, d);
        return toCanvas(t, local(r.x, r.y));
      };
      expect(phys(frame.x, frame.y)).toEqual({ x: 0, y: 0 });
      expect(phys(frame.x + frame.width, frame.y)).toEqual({ x: outW, y: 0 });
      expect(phys(frame.x, frame.y + frame.height)).toEqual({ x: 0, y: outH });
      expect(phys(frame.x + frame.width, frame.y + frame.height)).toEqual({ x: outW, y: outH });
    });
  }
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

describe('turnFromGravity(端末をどちらに倒したか)', () => {
  const android = motionSign(false);
  const ios = motionSign(true);

  it('Android(仕様どおり): 右側が上を向くと x が正 → 反時計回り', () => {
    expect(turnFromGravity(null, { x: 9.8, y: 0.3 }, android)).toBe('ccw');
    expect(turnFromGravity(null, { x: -9.8, y: 0.3 }, android)).toBe('cw');
  });

  it('iPhone: 符号が逆なので反転してから判定する', () => {
    expect(turnFromGravity(null, { x: -9.8, y: 0.3 }, ios)).toBe('ccw');
    expect(turnFromGravity(null, { x: 9.8, y: 0.3 }, ios)).toBe('cw');
  });

  it('平置き・縦持ち・中途半端な傾きでは前の値のまま(パタパタ入れ替わらない)', () => {
    expect(turnFromGravity('cw', { x: 0.2, y: 0.1 }, android)).toBe('cw');
    expect(turnFromGravity('cw', { x: 3, y: 1 }, android)).toBe('cw');
    expect(turnFromGravity('ccw', { x: 6, y: 8 }, android)).toBe('ccw');
    expect(turnFromGravity(null, { x: 0.2, y: 9.7 }, android)).toBeNull();
  });

  it('値が取れない端末(null)では前の値のまま', () => {
    expect(turnFromGravity('ccw', { x: null, y: null }, ios)).toBe('ccw');
  });
});

describe('effectiveTurn', () => {
  it('傾きが取れていれば傾きの向き。符号直しがONなら反転する', () => {
    expect(effectiveTurn({ gravity: 'cw', signFix: false, manual: 'ccw' })).toBe('cw');
    expect(effectiveTurn({ gravity: 'cw', signFix: true, manual: null })).toBe('ccw');
  });
  it('傾きが取れなければ手動の向き、それも無ければ既定', () => {
    expect(effectiveTurn({ gravity: null, signFix: true, manual: 'cw' })).toBe('cw');
    expect(effectiveTurn({ gravity: null, signFix: true, manual: null })).toBe(DEFAULT_TURN);
  });
});
