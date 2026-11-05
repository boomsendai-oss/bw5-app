// HIRO ワークショップの申込: 受付期間・料金・定員・会員の照合・メール・決済通知の振り分け。
import { describe, it, expect } from 'vitest';
import {
  bf7WsCapacityError,
  bf7WsGate,
  bf7WsGateError,
  bf7WsMemberDiff,
  bf7WsPayDeadline,
  bf7WsPrice,
  buildBf7WsEmail,
  calcBf7WsRemaining,
  checkBf7WsMember,
  formatBf7WsNo,
  toKatakana,
  validateBf7WsInput,
  type Bf7WsInput,
} from '../bf7Workshop';
import { buildBf7WsCheckoutFormParams, parseBf7WsWebhookEvent } from '../bf7WorkshopStripe';
import { parseBf7WebhookEvent } from '../bf7Stripe';

const input = (o: Partial<Bf7WsInput> = {}): Bf7WsInput => ({
  name: '山田 花子',
  kana: 'ヤマダ ハナコ',
  age: '25歳',
  guardianName: '',
  phone: '090-1234-5678',
  email: 'a@example.com',
  isMember: true,
  course: 'both',
  payMethod: 'transfer',
  note: '',
  agreed: true,
  ...o,
});

const member = (id: number, full_name: string, full_name_kana: string, status = 'active', rep_name: string | null = null) => ({
  id,
  full_name,
  full_name_kana,
  status,
  rep_name,
});

describe('受付期間', () => {
  it('11/22までは開始前・11/23から会員先行・11/30から誰でも・1/29まで', () => {
    expect(bf7WsGate('2026-11-22')).toBe('before');
    expect(bf7WsGate('2026-11-23')).toBe('member');
    expect(bf7WsGate('2026-11-29')).toBe('member');
    expect(bf7WsGate('2026-11-30')).toBe('open');
    expect(bf7WsGate('2027-01-29')).toBe('open');
    expect(bf7WsGate('2027-01-30')).toBe('closed');
  });

  it('先行期間に会員以外は申し込めない・会員は申し込める', () => {
    expect(bf7WsGateError('member', false)).toContain('11月30日(月)');
    expect(bf7WsGateError('member', true)).toBeNull();
    expect(bf7WsGateError('open', false)).toBeNull();
    expect(bf7WsGateError('before', true)).not.toBeNull();
    expect(bf7WsGateError('closed', true)).not.toBeNull();
  });
});

describe('料金', () => {
  it('会員 1本¥3,500・2本¥6,000 / 一般 1本¥4,000・2本¥7,000', () => {
    expect(bf7WsPrice('first', true)).toBe(3500);
    expect(bf7WsPrice('second', true)).toBe(3500);
    expect(bf7WsPrice('both', true)).toBe(6000);
    expect(bf7WsPrice('first', false)).toBe(4000);
    expect(bf7WsPrice('both', false)).toBe(7000);
  });

  it('会員でなかったときの差額は 1本¥500・2本¥1,000', () => {
    expect(bf7WsMemberDiff(true, false)).toBe(500);
    expect(bf7WsMemberDiff(false, true)).toBe(500);
    expect(bf7WsMemberDiff(true, true)).toBe(1000);
  });
});

describe('振込期限', () => {
  it('申込日から7日以内で、締切の1/29を越えない', () => {
    expect(bf7WsPayDeadline('2026-11-23')).toBe('2026-11-30');
    expect(bf7WsPayDeadline('2027-01-25')).toBe('2027-01-29');
    expect(bf7WsPayDeadline('2027-01-29')).toBe('2027-01-29');
  });
});

describe('定員', () => {
  it('各クラス25名で残りを数える', () => {
    expect(calcBf7WsRemaining({ first: 25, second: 3 })).toEqual({ first: 0, second: 22 });
  });

  it('満員のクラスを含む申込だけ止める', () => {
    const r = { first: 0, second: 5 };
    expect(bf7WsCapacityError('first', r)).toContain('1本目');
    expect(bf7WsCapacityError('both', r)).toContain('1本目');
    expect(bf7WsCapacityError('second', r)).toBeNull();
  });
});

describe('入力チェック', () => {
  it('正しい入力を整えて返す', () => {
    const v = validateBf7WsInput(input());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.phone).toBe('09012345678');
  });

  it('会員かどうか・クラス・支払い方法・確認のチェックは必須', () => {
    const v = validateBf7WsInput(input({ isMember: null, course: '', payMethod: '', agreed: false }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.errors).sort()).toEqual(['agreed', 'course', 'isMember', 'payMethod']);
  });

  it('18歳未満は保護者の名前が要る', () => {
    const v = validateBf7WsInput(input({ age: '中学2年' }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.guardianName).toBeTruthy();
  });
});

describe('会員の照合', () => {
  const list = [
    member(1, '山田 花子', 'ヤマダ ハナコ'),
    member(2, '佐藤 次郎', 'サトウ ジロウ', 'withdrew'),
    member(3, '鈴木 一郎', 'スズキ イチロウ'),
    member(4, '鈴木 一郎', 'スズキ イチロウ'),
    member(5, '田中 ゆき', 'タナカ ユキ', 'active', '田中 母'),
    member(6, '高橋 優', 'タカハシ ユウ'),
  ];

  it('在籍中の会員1人にぴったり一致すれば確認済み(スペースの違いは無視)', () => {
    expect(checkBf7WsMember('山田花子', 'ヤマダハナコ', list)).toEqual({ check: 'confirmed', memberId: 1 });
  });

  it('漢字が違っても、フリガナが1人に一致すれば確認済み(ひらがな入力も可)', () => {
    expect(checkBf7WsMember('髙橋 優', 'たかはし ゆう', list)).toEqual({ check: 'confirmed', memberId: 6 });
  });

  it('退会者だけに一致したら要確認', () => {
    expect(checkBf7WsMember('佐藤 次郎', 'サトウ ジロウ', list)).toEqual({ check: 'review', candidateIds: [2] });
  });

  it('同姓同名は要確認で候補を両方出す', () => {
    expect(checkBf7WsMember('鈴木 一郎', 'スズキ イチロウ', list)).toEqual({ check: 'review', candidateIds: [3, 4] });
  });

  it('保護者の名前で申し込んだ人は会員本人ではないので要確認', () => {
    expect(checkBf7WsMember('田中 母', 'タナカ ハハ', list)).toEqual({ check: 'review', candidateIds: [5] });
  });

  it('どこにも一致しなければ候補なしの要確認', () => {
    expect(checkBf7WsMember('存在 しない', 'ソンザイ シナイ', list)).toEqual({ check: 'review', candidateIds: [] });
  });

  it('ひらがなをカタカナにする', () => {
    expect(toKatakana('たかはし ゆう')).toBe('タカハシ ユウ');
  });
});

describe('控えのメール', () => {
  const base = { id: 7, name: '山田 花子', first: true, second: true, amountTotal: 6000, isMember: true, appliedOn: '2026-11-23' };

  it('支払い済みは確定、振込待ちは振込先を案内する', () => {
    const paid = buildBf7WsEmail({ ...base, payMethod: 'prepaid', paid: true });
    expect(paid.subject).toContain('確定');
    expect(paid.text).not.toContain('お振込み先');
    const t = buildBf7WsEmail({ ...base, payMethod: 'transfer', paid: false });
    expect(t.subject).toContain('お振込み');
    expect(t.text).toContain('GMOあおぞらネット銀行');
    expect(t.text).toContain('WS007');
    expect(t.text).toContain('11月30日(月) まで');
  });

  it('当日払いの案内は書かない', () => {
    expect(buildBf7WsEmail({ ...base, payMethod: 'transfer', paid: false }).text).not.toContain('現金');
  });

  it('受付番号・クラス・料金が入り、照合の結果には触れない', () => {
    const { text } = buildBf7WsEmail({ ...base, payMethod: 'prepaid', paid: true });
    expect(text).toContain(formatBf7WsNo(7));
    expect(text).toContain('REGULAR CLASS');
    expect(text).toContain('BASIC STEP PREMIUM');
    expect(text).toContain('¥6,000');
    expect(text).not.toContain('要確認');
  });
});

describe('カード決済', () => {
  it('Stripeへ渡す印は bf7_ws_order_id', () => {
    const p = buildBf7WsCheckoutFormParams({
      itemName: 'HIRO WORKSHOP',
      amount: 6000,
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/ng',
      customerEmail: 'a@example.com',
      orderId: 12,
      expiresAtEpochSec: 1,
    });
    expect(p.get('metadata[bf7_ws_order_id]')).toBe('12');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('6000');
    expect(p.get('metadata[bf7_order_id]')).toBeNull();
  });

  it('決済の通知をvol.7エントリーと取り違えない', () => {
    const ws = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 6000, metadata: { bf7_ws_order_id: '12' } } } };
    const entry = { id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: 'cs_2', metadata: { bf7_order_id: '12' } } } };
    expect(parseBf7WsWebhookEvent(ws)).toMatchObject({ orderId: 12, amountTotal: 6000, sessionId: 'cs_1' });
    expect(parseBf7WebhookEvent(ws)).toBeNull();
    expect(parseBf7WsWebhookEvent(entry)).toBeNull();
  });
});
