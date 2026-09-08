import { describe, it, expect } from 'vitest';
import {
  PHOTO_MAX_BYTES,
  PHOTO_TARGET_HEIGHT,
  validatePhotoUpload,
  fitBustFrame,
  refineMask,
} from '../bf6Photo';

describe('写真アップロードの検証', () => {
  it('PNGを受け付ける(切り抜き後は透過が要るため)', () => {
    expect(validatePhotoUpload({ itemId: 5, mime: 'image/png', size: 200_000 })).toEqual({ ok: true });
  });

  it('透過を持てない形式は拒否する', () => {
    const r = validatePhotoUpload({ itemId: 5, mime: 'image/jpeg', size: 200_000 });
    expect(r).toMatchObject({ ok: false });
  });

  it('大きすぎるファイルは拒否する(会場の回線とDBを守る)', () => {
    const r = validatePhotoUpload({ itemId: 5, mime: 'image/png', size: PHOTO_MAX_BYTES + 1 });
    expect(r).toMatchObject({ ok: false });
  });

  it('中身が空なら拒否する', () => {
    expect(validatePhotoUpload({ itemId: 5, mime: 'image/png', size: 0 })).toMatchObject({ ok: false });
  });

  it('出場者の指定が不正なら拒否する', () => {
    expect(validatePhotoUpload({ itemId: 0, mime: 'image/png', size: 1000 })).toMatchObject({ ok: false });
    expect(validatePhotoUpload({ itemId: -3, mime: 'image/png', size: 1000 })).toMatchObject({ ok: false });
  });
});

describe('バストアップの切り出し枠', () => {
  it('縦長の写真は上寄りを使う(顔が上にあるため)', () => {
    const f = fitBustFrame({ width: 1000, height: 2000 });
    expect(f.y).toBe(0);
    expect(f.height).toBeLessThan(2000);
  });

  it('切り出し枠は 3:4 に近い縦長になる', () => {
    const f = fitBustFrame({ width: 1600, height: 1200 });
    const ratio = f.width / f.height;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.95);
  });

  it('横長の写真でも枠が元画像からはみ出さない', () => {
    const f = fitBustFrame({ width: 1920, height: 1080 });
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.y).toBeGreaterThanOrEqual(0);
    expect(f.x + f.width).toBeLessThanOrEqual(1920);
    expect(f.y + f.height).toBeLessThanOrEqual(1080);
  });

  it('枠は横位置の中央に置く', () => {
    const f = fitBustFrame({ width: 1000, height: 1000 });
    expect(f.x + f.width / 2).toBeCloseTo(500, 0);
  });

  it('小さすぎる写真でも枠を返す(落ちない)', () => {
    const f = fitBustFrame({ width: 40, height: 30 });
    expect(f.width).toBeGreaterThan(0);
    expect(f.height).toBeGreaterThan(0);
  });
});

describe('切り抜きマスクの整形', () => {
  const mk = (vals: number[]) => Float32Array.from(vals);

  it('確信度が高い画素は不透明になる', () => {
    const out = refineMask(mk([0.95]), 1, 1);
    expect(out[0]).toBeGreaterThan(240);
  });

  it('確信度が低い画素は透明になる', () => {
    const out = refineMask(mk([0.05]), 1, 1);
    expect(out[0]).toBeLessThan(15);
  });

  it('中間は中間値になる(輪郭が階段状にならない)', () => {
    const out = refineMask(mk([0.5]), 1, 1);
    expect(out[0]).toBeGreaterThan(40);
    expect(out[0]).toBeLessThan(215);
  });

  it('画素数ぶんの結果を返す', () => {
    const out = refineMask(mk([0.1, 0.9, 0.5, 0.2]), 2, 2);
    expect(out).toHaveLength(4);
  });

  it('0〜255の範囲に収まる', () => {
    const out = refineMask(mk([-1, 2, 0.5]), 3, 1);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe('書き出しの基準', () => {
  it('LEDで粗く見えない高さを持つ', () => {
    expect(PHOTO_TARGET_HEIGHT).toBeGreaterThanOrEqual(800);
  });
});
