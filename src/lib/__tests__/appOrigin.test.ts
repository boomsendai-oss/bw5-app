import { afterEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('../appOrigin');
}

describe('appOrigin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('NEXT_PUBLIC_BASE_URL が無いときは古い住所のまま（今の本番と同じ動き）', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    const m = await load();
    expect(m.STAFF_ORIGIN).toBe('https://bw5-app.vercel.app');
    expect(m.FALLBACK_HOST).toBe('bw5-app.vercel.app');
    expect(m.LEGACY_ORIGIN).toBe('https://bw5-app.vercel.app');
    expect(m.PUBLIC_ORIGIN).toBe('https://event.boom-sendai.com');
  });

  it('NEXT_PUBLIC_BASE_URL があればそれを使い、最後の / を落とす', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', ' https://app.boom-sendai.com/ ');
    const m = await load();
    expect(m.STAFF_ORIGIN).toBe('https://app.boom-sendai.com');
    expect(m.FALLBACK_HOST).toBe('app.boom-sendai.com');
    expect(m.LEGACY_ORIGIN).toBe('https://bw5-app.vercel.app');
  });
});
