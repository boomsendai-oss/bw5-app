// src/lib/__tests__/recitalPreview.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recitalPreviewKey, isRecitalPreview, resolvePreviewEvent } from '../recitalPreview';

beforeEach(() => { process.env.RECITAL_PREVIEW_SECRET = 'test-secret-1'; });

describe('試し用の鍵', () => {
  it('32けたの16進で、同じ発表会なら同じ', () => {
    expect(recitalPreviewKey('bw6-test')).toMatch(/^[0-9a-f]{32}$/);
    expect(recitalPreviewKey('bw6-test')).toBe(recitalPreviewKey('bw6-test'));
  });
  it('合う鍵は通る', () => {
    expect(isRecitalPreview('bw6-test', recitalPreviewKey('bw6-test'))).toBe(true);
  });
  it('ちがう鍵・空・null は通らない', () => {
    expect(isRecitalPreview('bw6-test', '0'.repeat(32))).toBe(false);
    expect(isRecitalPreview('bw6-test', '')).toBe(false);
    expect(isRecitalPreview('bw6-test', null)).toBe(false);
  });
  it('別の発表会の鍵は通らない', () => {
    expect(isRecitalPreview('bw6-test', recitalPreviewKey('bw6-smoke'))).toBe(false);
    expect(isRecitalPreview('bw6', recitalPreviewKey('bw6-test'))).toBe(false);
  });
  it('秘密が変わると、前の鍵は通らない', () => {
    const old = recitalPreviewKey('bw6-test');
    process.env.RECITAL_PREVIEW_SECRET = 'test-secret-2';
    expect(isRecitalPreview('bw6-test', old)).toBe(false);
  });
});

describe('resolvePreviewEvent（?ev= と pv= の受け方）', () => {
  const k = (e: string) => recitalPreviewKey(e);
  it('ev なし（または bw6）は本番。本番の鍵が合えば「見るだけの試し」', () => {
    expect(resolvePreviewEvent(null, null, false)).toEqual({ eventKey: 'bw6', preview: false });
    expect(resolvePreviewEvent(undefined, k('bw6'), false)).toEqual({ eventKey: 'bw6', preview: true });
    expect(resolvePreviewEvent('bw6', k('bw6'), false)).toEqual({ eventKey: 'bw6', preview: true });
  });
  it('is_test=1 の発表会で、その発表会の鍵が合う時だけ切り替える', () => {
    expect(resolvePreviewEvent('bw6-test', k('bw6-test'), true)).toEqual({ eventKey: 'bw6-test', preview: true });
  });
  it('鍵がちがう・別の発表会の鍵・is_test=0 の発表会は、本番にもどす', () => {
    expect(resolvePreviewEvent('bw6-test', 'bad', true)).toEqual({ eventKey: 'bw6', preview: false });
    expect(resolvePreviewEvent('bw6-test', k('bw6-smoke'), true)).toEqual({ eventKey: 'bw6', preview: false });
    expect(resolvePreviewEvent('t-real', k('t-real'), false)).toEqual({ eventKey: 'bw6', preview: false });
  });
});
