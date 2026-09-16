import { describe, it, expect } from 'vitest';
import { breakdownText, fillBroadcastVars } from '../bf6Broadcast';

describe('一斉メールの差し込み', () => {
  it('内訳を1行ずつ、金額を右に並べた文にする', () => {
    const t = breakdownText([
      { label: 'ビギナー部門 エントリー', qty: 1, amount: 2500 },
      { label: '観覧チケット(中学生以上)', qty: 3, amount: 6000 },
    ]);
    expect(t).toContain('ビギナー部門 エントリー');
    expect(t).toContain('¥2,500');
    expect(t).toContain('観覧チケット(中学生以上) × 3');
    expect(t).toContain('¥6,000');
    expect(t.split('\n')).toHaveLength(2);
  });

  it('1枚のものに「× 1」は付けない', () => {
    const t = breakdownText([{ label: '観覧チケット(小学生)', qty: 1, amount: 1000 }]);
    expect(t).not.toContain('×');
  });

  it('差し込みは {{amount}} と {{breakdown}} を置き換える', () => {
    const out = fillBroadcastVars('合計 {{amount}}\n{{breakdown}}\n終わり', {
      amount: '¥8,500',
      breakdown: '  A\n  B',
    });
    expect(out).toBe('合計 ¥8,500\n  A\n  B\n終わり');
  });

  it('同じ差し込みが2か所にあっても両方置き換える', () => {
    expect(fillBroadcastVars('{{amount}}/{{amount}}', { amount: '¥100' })).toBe('¥100/¥100');
  });

  it('値が無い差し込みは空にする(未置換の {{ }} を客に見せない)', () => {
    expect(fillBroadcastVars('X{{nope}}Y', { amount: '¥1' })).toBe('XY');
  });

  it('差し込みが無い文はそのまま', () => {
    expect(fillBroadcastVars('ふつうの文', {})).toBe('ふつうの文');
  });
});

describe('当日現金の人への宛先づくり', () => {
  const lines = (n: number) => new Map([[n, [{ label: 'ビギナー部門 エントリー', qty: 1, amount: 2500 }]]]);

  it('注文1件ぶんの金額と内訳を差し込みに入れる', async () => {
    const { buildCashDueRecipients } = await import('../bf6Broadcast');
    const r = buildCashDueRecipients([{ id: 1, email: 'a@example.com', amountTotal: 2500 }], lines(1));
    expect(r).toHaveLength(1);
    expect(r[0].email).toBe('a@example.com');
    expect(r[0].vars.amount).toBe('¥2,500');
    expect(r[0].vars.breakdown).toContain('ビギナー部門 エントリー');
  });

  it('同じアドレスで2件申し込んでいたら1通にまとめて合算する', async () => {
    const { buildCashDueRecipients } = await import('../bf6Broadcast');
    const m = new Map([
      [1, [{ label: 'ビギナー部門 エントリー', qty: 1, amount: 2500 }]],
      [2, [{ label: '観覧チケット(中学生以上)', qty: 2, amount: 4000 }]],
    ]);
    const r = buildCashDueRecipients(
      [
        { id: 1, email: 'a@example.com', amountTotal: 2500 },
        { id: 2, email: 'a@example.com', amountTotal: 4000 },
      ],
      m
    );
    expect(r).toHaveLength(1);
    expect(r[0].vars.amount).toBe('¥6,500');
    expect(r[0].vars.breakdown).toContain('ビギナー部門 エントリー');
    expect(r[0].vars.breakdown).toContain('観覧チケット(中学生以上) × 2');
  });

  it('メールアドレスが無い申込は宛先にしない', async () => {
    const { buildCashDueRecipients } = await import('../bf6Broadcast');
    const r = buildCashDueRecipients([{ id: 1, email: '', amountTotal: 2500 }], lines(1));
    expect(r).toHaveLength(0);
  });

  it('内訳が取れなかった申込でも、合計だけは伝える', async () => {
    const { buildCashDueRecipients } = await import('../bf6Broadcast');
    const r = buildCashDueRecipients([{ id: 9, email: 'a@example.com', amountTotal: 5000 }], new Map());
    expect(r[0].vars.amount).toBe('¥5,000');
    expect(r[0].vars.breakdown).toBe('');
  });
});
