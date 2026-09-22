import { describe, it, expect } from 'vitest';
import { streamFullscreenStyle } from '../bf6StreamFullscreen';

describe('streamFullscreenStyle(配信を横向き全画面にする見た目)', () => {
  it('スマホが縦向きのときは、映像の枠を90度回して画面いっぱいに横長で出す', () => {
    // ⚠️ iPhoneのSafariは、動画以外の要素を本物の全画面にできない(埋め込みプレーヤーの中の動画にも手が届かない)。
    //    なので画面に貼り付けた枠を回して「横向き全画面」に見せる(TARO 2026-09-22 実機で要望)。
    const s = streamFullscreenStyle(true);
    expect(s.transform).toContain('rotate(90deg)');
    expect(s.width).toBe('100dvh');
    expect(s.height).toBe('100dvw');
  });

  it('横向きのときは回さず、そのまま画面いっぱい', () => {
    const s = streamFullscreenStyle(false);
    expect(s.transform).not.toContain('rotate');
    expect(s.width).toBe('100dvw');
    expect(s.height).toBe('100dvh');
  });

  it('どちらの向きでも画面の中央に置く', () => {
    for (const portrait of [true, false]) {
      const s = streamFullscreenStyle(portrait);
      expect(s.position).toBe('fixed');
      expect(s.left).toBe('50%');
      expect(s.top).toBe('50%');
      expect(s.transform).toContain('translate(-50%, -50%)');
    }
  });
});
