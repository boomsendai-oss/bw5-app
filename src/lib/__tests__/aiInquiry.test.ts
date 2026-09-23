import { describe, it, expect } from 'vitest';
import { validateInquiry, buildInquiryMail } from '@/lib/aiInquiry';

const good = {
  name: '山田 太郎',
  business: 'ネイルサロン（一人）',
  contact: 'yamada@example.com',
  message: 'インスタ投稿と月末集計に週10時間かかっています',
  website: '', // honeypot
};

describe('validateInquiry', () => {
  it('正常な入力を通す', () => {
    const r = validateInquiry(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe('山田 太郎');
  });
  it('必須欠落を弾く', () => {
    for (const k of ['name', 'business', 'contact', 'message'] as const) {
      const r = validateInquiry({ ...good, [k]: '   ' });
      expect(r.ok).toBe(false);
    }
  });
  it('ハニーポットに値があれば弾く（ただし理由は spam）', () => {
    const r = validateInquiry({ ...good, website: 'http://spam' });
    expect(r).toEqual({ ok: false, error: 'spam' });
  });
  it('長すぎる入力は切り詰める', () => {
    const r = validateInquiry({ ...good, message: 'あ'.repeat(5000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.message.length).toBe(2000);
  });
  it('オブジェクト以外は弾く', () => {
    expect(validateInquiry(null).ok).toBe(false);
    expect(validateInquiry('x').ok).toBe(false);
  });
});

describe('buildInquiryMail', () => {
  it('件名に名前、本文に全項目を含む', () => {
    const r = validateInquiry(good);
    if (!r.ok) throw new Error('unexpected');
    const m = buildInquiryMail(r.data, '203.0.113.1');
    expect(m.subject).toBe('【AI相談】山田 太郎');
    expect(m.text).toContain('ネイルサロン（一人）');
    expect(m.text).toContain('yamada@example.com');
    expect(m.text).toContain('週10時間');
    expect(m.text).toContain('203.0.113.1');
  });
});
