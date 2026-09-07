import { describe, it, expect } from 'vitest';
import { resolveMediaUrl } from '../mediaUrl';

describe('resolveMediaUrl (R2移行 2026-09-08)', () => {
  const origin = 'https://bw5-app.vercel.app';
  it('R2の絶対URLはそのまま返す(Metaに直リンクで渡す)', () => {
    const u = 'https://media.boom-sendai.com/reels/2026-09-01_HIPHOP_76.mp4';
    expect(resolveMediaUrl(u, origin)).toBe(u);
  });
  it('旧い相対パスは自分のoriginで解決する', () => {
    expect(resolveMediaUrl('/reels/2026-08-18_HOUSE_3.mp4', origin)).toBe(
      'https://bw5-app.vercel.app/reels/2026-08-18_HOUSE_3.mp4'
    );
  });
  it('相対パスの日本語・空白はパーセントエンコードする(2026-07-28障害の再発防止)', () => {
    expect(resolveMediaUrl('/reels/初級 a.mp4', origin)).toBe(
      'https://bw5-app.vercel.app/reels/%E5%88%9D%E7%B4%9A%20a.mp4'
    );
  });
  it('先頭スラッシュ無し・origin末尾スラッシュ有りでも二重にならない', () => {
    expect(resolveMediaUrl('reels/a.mp4', 'https://bw5-app.vercel.app/')).toBe(
      'https://bw5-app.vercel.app/reels/a.mp4'
    );
  });
});
