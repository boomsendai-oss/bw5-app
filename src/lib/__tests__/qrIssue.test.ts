import { describe, it, expect } from 'vitest';
import { isDummyEmail, resolveRecipient, maskEmail, buildQrEmail } from '../qrIssue';

describe('isDummyEmail', () => {
  it('hacomonoダミーアドレスを判定する', () => {
    expect(isDummyEmail('abc123@dummy.hacomono.mail')).toBe(true);
    expect(isDummyEmail('ABC@DUMMY.HACOMONO.MAIL')).toBe(true);
    expect(isDummyEmail('taro@gmail.com')).toBe(false);
    expect(isDummyEmail('')).toBe(false);
    expect(isDummyEmail(null)).toBe(false);
  });
});

describe('resolveRecipient', () => {
  it('本人アドレスが実アドレスならそれを使う', () => {
    expect(resolveRecipient('taro@gmail.com', '')).toEqual({ ok: true, to: 'taro@gmail.com' });
  });
  it('本人がダミーなら代表アドレスへ', () => {
    expect(resolveRecipient('x@dummy.hacomono.mail', 'parent@gmail.com')).toEqual({ ok: true, to: 'parent@gmail.com' });
  });
  it('本人ダミー+代表なし → manual', () => {
    expect(resolveRecipient('x@dummy.hacomono.mail', '')).toEqual({ ok: false, reason: 'rep_email_missing' });
  });
  it('本人ダミー+代表もダミー → manual', () => {
    expect(resolveRecipient('x@dummy.hacomono.mail', 'y@dummy.hacomono.mail')).toEqual({ ok: false, reason: 'rep_email_dummy' });
  });
  it('本人アドレスが空 → 代表があれば代表へ、無ければmanual', () => {
    expect(resolveRecipient('', 'parent@gmail.com')).toEqual({ ok: true, to: 'parent@gmail.com' });
    expect(resolveRecipient('', '')).toEqual({ ok: false, reason: 'no_email' });
  });
});

describe('maskEmail', () => {
  it('ローカル部を伏せ字にしドメインは残す', () => {
    expect(maskEmail('taro@gmail.com')).toBe('t***@gmail.com');
    expect(maskEmail('a@icloud.com')).toBe('a***@icloud.com');
  });
  it('不正形式は全伏せ', () => {
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('buildQrEmail', () => {
  it('件名と本文(共有禁止・再印刷案内を含む)を組み立てる', () => {
    const m = buildQrEmail('山田 花');
    expect(m.subject).toBe('【BOOM】チェックイン用QRコード（印刷してご利用ください）');
    expect(m.text).toContain('山田 花 様');
    expect(m.text).toContain('他の人に共有しないでください');
    expect(m.text).toContain('チケットが消費');
    expect(m.text).toContain('このメールを保存しておけば、いつでも印刷し直せます');
    expect(m.text).toContain('返信でご連絡ください');
  });
});
