import { describe, expect, test } from 'vitest';
import {
  generateStreamKey,
  normalizeStreamKey,
  decideSessionTakeover,
  buildStreamKeyEmail,
} from '../bf6Stream';

describe('generateStreamKey: 視聴キー生成', () => {
  test('BF6-XXXX-XXXX-XXXX形式(紛らわしい文字なし)で毎回異なる', () => {
    const a = generateStreamKey();
    const b = generateStreamKey();
    expect(a).toMatch(/^BF6-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(a).not.toBe(b);
  });
});

describe('normalizeStreamKey: 入力ゆらぎの吸収', () => {
  test('小文字・全角・空白・ハイフン抜けを正規化', () => {
    expect(normalizeStreamKey(' bf6-abcd-efgh-jklm ')).toBe('BF6-ABCD-EFGH-JKLM');
    expect(normalizeStreamKey('BF6ABCDEFGHJKLM')).toBe('BF6-ABCD-EFGH-JKLM');
    expect(normalizeStreamKey('ｂｆ６－ＡＢＣＤ－ＥＦＧＨ－ＪＫＬＭ')).toBe('BF6-ABCD-EFGH-JKLM');
  });

  test('形式外はそのまま大文字化して返す(照合失敗させる)', () => {
    expect(normalizeStreamKey('hello')).toBe('HELLO');
  });
});

describe('decideSessionTakeover: 同時1端末の判定', () => {
  const now = 1_760_000_000_000;

  test('既存セッションなし→接続OK', () => {
    expect(decideSessionTakeover(null, 'sess-new', now, 60)).toEqual({ allow: true, takeover: false });
  });

  test('生きている別セッションあり(60秒以内)→拒否', () => {
    const active = { sessionId: 'sess-a', lastSeenAt: now - 30_000 };
    expect(decideSessionTakeover(active, 'sess-new', now, 60)).toEqual({ allow: false, takeover: false });
  });

  test('死んだセッション(60秒超過)→乗っ取りOK', () => {
    const stale = { sessionId: 'sess-a', lastSeenAt: now - 61_000 };
    expect(decideSessionTakeover(stale, 'sess-new', now, 60)).toEqual({ allow: true, takeover: true });
  });

  test('同じセッションIDからの再接続はいつでもOK(リロード対応)', () => {
    const mine = { sessionId: 'sess-same', lastSeenAt: now - 10_000 };
    expect(decideSessionTakeover(mine, 'sess-same', now, 60)).toEqual({ allow: true, takeover: false });
  });
});

describe('buildStreamKeyEmail: 視聴キー発行メール', () => {
  test('キー・視聴URL・同時1端末とアーカイブ1週間の説明が入る', () => {
    const mail = buildStreamKeyEmail({
      buyerName: '山田花子',
      streamKey: 'BF6-ABCD-EFGH-JKLM',
      receiptNo: 'BF6-012',
    });
    expect(mail.subject).toContain('配信視聴キー');
    expect(mail.text).toContain('BF6-ABCD-EFGH-JKLM');
    expect(mail.text).toContain('/bf6/stream/watch');
    expect(mail.text).toContain('同時に視聴できるのは1台');
    expect(mail.text).toContain('1週間');
  });
});
