import { describe, it, expect } from 'vitest';
import { normalizeSrc, summarizeBw6, summarizeUserAgent, validateDetails, validatePress } from '@/lib/bw6Interest';

const DEV = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';

describe('validatePress', () => {
  it('正常なボタン押下を通す', () => {
    expect(validatePress({ device_id: DEV, kind: 'want', src: 'line' })).toEqual({
      ok: true,
      data: { deviceId: DEV, kind: 'want', src: 'line' },
    });
  });
  it('端末IDが変な形なら弾く', () => {
    expect(validatePress({ device_id: 'short', kind: 'want' }).ok).toBe(false);
    expect(validatePress({ device_id: `${DEV}'; DROP`, kind: 'want' }).ok).toBe(false);
  });
  it('kindは want/curious だけ', () => {
    expect(validatePress({ device_id: DEV, kind: 'apply' }).ok).toBe(false);
  });
});

describe('normalizeSrc', () => {
  it('空はdirect・未知はother・大文字は小文字に', () => {
    expect(normalizeSrc(undefined)).toBe('direct');
    expect(normalizeSrc('')).toBe('direct');
    expect(normalizeSrc('IG')).toBe('ig');
    expect(normalizeSrc('tiktok')).toBe('other');
  });
});

describe('validateDetails', () => {
  it('任意入力を切り詰めて通す', () => {
    const r = validateDetails({ device_id: DEV, name: ' 山田 花子 ', class_label: 'あ'.repeat(200), age_group: 'kids' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe('山田 花子');
      expect(r.data.classLabel.length).toBe(80);
      expect(r.data.ageGroup).toBe('kids');
      expect(r.data.kind).toBe('want');
      expect(r.data.src).toBe('direct');
    }
  });
  it('全部空なら empty', () => {
    expect(validateDetails({ device_id: DEV, name: ' ', class_label: '' })).toEqual({ ok: false, error: 'empty' });
  });
  it('不明な年代は空扱い', () => {
    const r = validateDetails({ device_id: DEV, name: 'A', age_group: 'baby' });
    expect(r.ok && r.data.ageGroup).toBe('');
  });
  it('ハニーポットは spam', () => {
    expect(validateDetails({ device_id: DEV, name: 'A', website: 'x' })).toEqual({ ok: false, error: 'spam' });
  });
});

describe('summarizeUserAgent', () => {
  it('OSとアプリだけに縮める', () => {
    expect(summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Line/14.0')).toBe('iOS/LINE');
    expect(summarizeUserAgent('Mozilla/5.0 (Linux; Android 14) Instagram 300')).toBe('Android/Instagram');
  });
});

describe('summarizeBw6', () => {
  it('ボタン別・流入元別・名前ありを数える', () => {
    const s = summarizeBw6([
      { kind: 'want', src: 'line', name: '' },
      { kind: 'want', src: 'line', name: 'A' },
      { kind: 'curious', src: 'ig', name: '' },
    ]);
    expect(s.total).toBe(3);
    expect(s.byKind).toEqual({ want: 2, curious: 1 });
    expect(s.withName).toBe(1);
    expect(s.bySrc[0]).toEqual({ src: 'line', want: 2, curious: 0, total: 2 });
  });
});
