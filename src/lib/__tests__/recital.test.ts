import { describe, it, expect } from 'vitest';
import {
  parseRecitalSettings, jstToMs, deadlineMs, entryPhase, canFamilyEdit, payGate, isCountedCast, moneySummary,
  householdView, householdViewLabel, payableAmount, payButtonState, countPeople, schoolGrade, ageOn,
  recitalMyUrl, checkSettingValue, normalizePhone, normalizeEmail, RECITAL_SETTING_KEYS_SHOWN, RECITAL_SETTING_KEYS_LOCKED, type CountPerson, type MoneySummary,
} from '../recital';

const S = (over: Record<string, string> = {}) =>
  parseRecitalSettings(Object.entries({ suspended: '0', ...over }).map(([key, value]) => ({ key, value })));
const J = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms);
const M = (total: number, paid: number, todo = 0) =>
  moneySummary({ chargeAmounts: [total], paymentAmounts: paid ? [paid] : [], refundTodoAmounts: todo ? [todo] : [] });

describe('設定の読み', () => {
  it('空なら初めの値。止めている・試しの鍵・pay_ok_at は空', () => {
    const s = parseRecitalSettings([]);
    expect(s.suspended).toBe(true);
    expect(s.stripe_mode).toBe('test');
    expect(s.pay_ok_at).toBeNull();
    expect(s.fee_check_first).toEqual([26500, 32500, 35500, 38500, 41500]);
    expect(s.fee_check_family).toBe(8000);
    expect(s.max_works_per_person).toBe(5);
    expect(s.tshirt_sizes).toEqual(['130', '140', '150', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
    expect(s.bank_ask_at).toEqual(['19:00', '20:30']);
    expect(s.ref_skip).toEqual([]);
    expect(s.mail_bcc_staff).toBe(false);
  });
  it('suspended は "0" のときだけ開く。stripe_mode は "live" のときだけ本番', () => {
    expect(S({ suspended: '0' }).suspended).toBe(false);
    expect(S({ suspended: 'x' }).suspended).toBe(true);
    expect(S({ stripe_mode: 'live' }).stripe_mode).toBe('live');
    expect(S({ stripe_mode: 'LIVE' }).stripe_mode).toBe('test');
  });
  it('カンマの並び・数・空の日付', () => {
    const s = S({ ref_skip: ' 2008, 3009 ,', max_works_per_person: 'abc', pay_ok_at: '2026-12-14 20:00', roster_fix_on: '' });
    expect(s.ref_skip).toEqual(['2008', '3009']);
    expect(s.max_works_per_person).toBe(5);
    expect(s.pay_ok_at).toBe('2026-12-14 20:00');
    expect(s.roster_fix_on).toBeNull();
    expect(s.raw.ref_skip).toBe(' 2008, 3009 ,');
  });
  it('画面に出す鍵に、LOCKED・suspended・stripe_mode・【1空】の鍵が無い', () => {
    for (const k of [...RECITAL_SETTING_KEYS_LOCKED, 'suspended', 'stripe_mode', 'seat_total', 'tshirt_colors', 'pamphlet_due'])
      expect(RECITAL_SETTING_KEYS_SHOWN).not.toContain(k);
  });
});

describe('日時（JST の文字 → ミリ秒）', () => {
  it('jstToMs と deadlineMs', () => {
    expect(jstToMs('2026-12-15 12:00')).toBe(J(2026, 12, 15, 12));
    expect(jstToMs('2027-02-10')).toBe(J(2027, 2, 10));
    expect(deadlineMs('2027-01-31 23:59')).toBe(J(2027, 1, 31, 23, 59, 59, 999));
    expect(deadlineMs('2027-02-10')).toBe(J(2027, 2, 10, 23, 59, 59, 999));
    expect(Number.isNaN(jstToMs('2027/02/10'))).toBe(true);
  });
});

describe('受付の状態（5-4）', () => {
  it('上から：止めている／受付前／受付中／締切のあと', () => {
    expect(entryPhase(S({ suspended: '1' }), J(2027, 1, 10))).toBe('suspended');
    expect(entryPhase(S(), J(2026, 12, 15, 11, 59, 59, 999))).toBe('before');
    expect(entryPhase(S(), J(2026, 12, 15, 12))).toBe('open');
    expect(entryPhase(S(), J(2027, 1, 31, 23, 59))).toBe('open');
    expect(entryPhase(S(), J(2027, 1, 31, 23, 59, 59, 999))).toBe('open');
    expect(entryPhase(S(), J(2027, 2, 1, 0, 0))).toBe('closed');
  });
  it('世帯の延長が今より先なら受付中。止めている時は延長でも開かない', () => {
    expect(entryPhase(S(), J(2027, 2, 3), '2027-02-05 23:59')).toBe('open');
    expect(entryPhase(S(), J(2027, 2, 6), '2027-02-05 23:59')).toBe('closed');
    expect(entryPhase(S({ suspended: '1' }), J(2027, 2, 3), '2027-02-05 23:59')).toBe('suspended');
  });
  it('日時の設定が読めなければ開けない', () => {
    expect(entryPhase(S({ entry_open_at: '12/15' }), J(2027, 1, 10))).toBe('suspended');
  });
  it('canFamilyEdit：受付中かつ change_close_at まで。延長の世帯は延長の日まで（4-2・K219）', () => {
    expect(canFamilyEdit(S(), J(2027, 1, 31, 23, 59, 59, 999))).toBe(true);
    expect(canFamilyEdit(S(), J(2027, 2, 1, 0, 0))).toBe(false);
    expect(canFamilyEdit(S({ change_close_at: '2027-01-20 23:59' }), J(2027, 1, 25))).toBe(false);
    expect(canFamilyEdit(S(), J(2027, 2, 3), '2027-02-05 23:59')).toBe(true);
    expect(canFamilyEdit(S(), J(2027, 2, 6), '2027-02-05 23:59')).toBe(false);
    expect(canFamilyEdit(S({ suspended: '1' }), J(2027, 1, 10))).toBe(false);
  });
});

describe('支払いの鍵2つ（K224）', () => {
  it('pay_open_at の前は before（pay_ok_at があっても）', () => {
    expect(payGate(S({ pay_ok_at: '2026-12-14 20:00' }), J(2026, 12, 15, 11, 59))).toBe('before');
  });
  it('時刻を過ぎて pay_ok_at が空なら preparing', () => {
    expect(payGate(S(), J(2026, 12, 15, 12))).toBe('preparing');
  });
  it('両方そろえば open', () => {
    expect(payGate(S({ pay_ok_at: '2026-12-14 20:00' }), J(2026, 12, 15, 12))).toBe('open');
  });
  it('境目はミリ秒まで：11:59:59.999 は before、12:00:00.000 は open', () => {
    expect(payGate(S({ pay_ok_at: '2026-12-14 20:00' }), J(2026, 12, 15, 11, 59, 59, 999))).toBe('before');
    expect(payGate(S({ pay_ok_at: '2026-12-14 20:00' }), J(2026, 12, 15, 12, 0, 0, 0))).toBe('open');
  });
  it('pay_open_at が読めない形なら before（開けない）', () => {
    expect(payGate(S({ pay_open_at: '2026/12/15 12:00', pay_ok_at: '2026-12-14 20:00' }), J(2027, 1, 10))).toBe('before');
  });
});

describe('電話とメールのそろえ方', () => {
  it('全角・ハイフン・大文字・前後の空白をそろえる', () => {
    expect(normalizePhone('０９０－１２３４－５６７８')).toBe('09012345678');
    expect(normalizePhone('090-1234-5678')).toBe('09012345678');
    expect(normalizeEmail('  Ａ@Example.COM ')).toBe('a@example.com');
  });
});

describe('マイページの URL', () => {
  it('家庭向けのドメインで作る', () => {
    expect(recitalMyUrl('a'.repeat(48))).toBe('https://event.boom-sendai.com/bw6/my?t=' + 'a'.repeat(48));
    expect(recitalMyUrl('a'.repeat(48), { fromMail: true })).toBe('https://event.boom-sendai.com/bw6/my?t=' + 'a'.repeat(48) + '&from=mail');
  });
});

describe('checkSettingValue（6 の保存と 18 の画面の両方が使う）', () => {
  it.each([
    ['pay_ok_at', '2026-12-14 10:00', false],          // 鍵はボタンだけ（K224）
    ['bank_audit_done_at', '2027-02-12 21:00', false],
    ['suspended', '0', false],                         // 受付を開ける・止めるのボタンだけ
    ['stripe_mode', 'live', false],                    // 種だけで決める
    ['tshirt_colors', '白', false],                    // 段階1の画面に出さない鍵（R-19）
    ['entry_open_at', '2026-12-15 12:00', true],
    ['entry_open_at', '2026/12/15 12:00', false],
    ['entry_open_at', '2026-12-15', false],
    ['entry_close_at', '1/31', false],
    ['pay_due', '2027-02-10', true],
    ['pay_due', '2027-02-30', false],
    ['roster_fix_on', '', true],
    ['fee_check_first', '26500,32500,35500,38500,41500', true],
    ['fee_check_first', '26500,32500,35500,38500', false],
    ['fee_check_family', '8000', true],
    ['max_works_per_person', '5', true],
    ['max_works_per_person', '0', false],
    ['ref_skip', '', true],
    ['ref_skip', '2003', true],
    ['ref_skip', '1234,5724', true],
    ['ref_skip', '12a4', false],
    ['bank_ask_at', '19:00,20:30', true],
    ['bank_ask_at', '19時', false],
    ['test_mail_to', '', true],
    ['test_mail_to', 'not-mail', false],
    ['mail_bcc_staff', '1', true],
    ['mail_bcc_staff', '2', false],
  ])('%s = %s → 入れてよい %s', (k, v, ok) => expect(checkSettingValue(k, v) === null).toBe(ok));
});

describe('お金に数える出演（D4 2-3）', () => {
  it('counted・dropped でない・in のときだけ', () => {
    expect(isCountedCast({ fee_type: 'counted', status: 'open' }, { status: 'in' })).toBe(true);
    expect(isCountedCast({ fee_type: 'counted', status: 'dropped' }, { status: 'in' })).toBe(false);
    expect(isCountedCast({ fee_type: 'extra', status: 'open' }, { status: 'in' })).toBe(false);
    expect(isCountedCast({ fee_type: 'separate', status: 'open' }, { status: 'in' })).toBe(false);
    for (const st of ['maybe', 'out', 'passed'] as const)
      expect(isCountedCast({ fee_type: 'counted', status: 'fixed' }, { status: st })).toBe(false);
  });
});

describe('式4行（5章頭・K199）', () => {
  it('お支払いずみの分と返す分のちがい（5-7 の5行）', () => {
    const rows: [number[], number, number, number][] = [
      // 入金の行, 返す分 todo, 合計, → 払った額・お支払いずみの分 は下で確かめる
      [[35500], 0, 32500, 0],
      [[32500], 6000, 26500, 0],
      [[32500, -6000], 0, 26500, 0],
      [[32500], 0, 26500, 0],
      [[35500], 3000, 32500, 0],
    ];
    const want = [[35500, 3000], [26500, 0], [26500, 0], [32500, 6000], [32500, 0]];
    rows.forEach(([pays, todo, total], i) => {
      const m = moneySummary({ chargeAmounts: [total], paymentAmounts: pays, refundTodoAmounts: todo ? [todo] : [] });
      expect([m.paid, m.overpaid]).toEqual(want[i]);
      expect(m.remaining).toBe(0);
    });
  });
  it('adjust の下げる行で合計が0より小さくなれば合計は0（K228）', () => {
    expect(moneySummary({ chargeAmounts: [-5000], paymentAmounts: [], refundTodoAmounts: [] }))
      .toEqual({ total: 0, paid: 0, remaining: 0, overpaid: 0 });
  });
});

describe('世帯の見え方（5行の順・K218・K222）', () => {
  it.each([
    [{ hasIn: false, hasMaybe: false, paid: 8000, remaining: 0 }, 'none'],
    [{ hasIn: false, hasMaybe: true, paid: 0, remaining: 0 }, 'tentative'],
    [{ hasIn: false, hasMaybe: true, paid: 26500, remaining: 0 }, 'complete'],
    [{ hasIn: true, hasMaybe: false, paid: 0, remaining: 0 }, 'complete'],
    [{ hasIn: true, hasMaybe: true, paid: 26500, remaining: 6000 }, 'complete_extra'],
    [{ hasIn: true, hasMaybe: false, paid: 20000, remaining: 6500 }, 'complete_extra'],
    [{ hasIn: true, hasMaybe: false, paid: 0, remaining: 26500 }, 'tentative'],
  ] as const)('%o → %s', (x, v) => expect(householdView(x)).toBe(v));
  it('言葉4つ', () => {
    expect(householdViewLabel('none', 0)).toBe('出演なし');
    expect(householdViewLabel('tentative', 26500)).toBe('仮受付');
    expect(householdViewLabel('complete', 0)).toBe('申込完了');
    expect(householdViewLabel('complete_extra', 6000)).toBe('申込完了（追加分 6,000円のお支払い待ち）');
  });
});

describe('場面 A〜E（5-5）', () => {
  it.each([
    ['A 申し込む', 26500, 0, 26500, 0, '仮受付'],
    ['A 26,500 を払う', 26500, 26500, 0, 0, '申込完了'],
    ['B 1作品を足す', 32500, 26500, 6000, 0, '申込完了（追加分 6,000円のお支払い待ち）'],
    ['B 6,000 を払う', 32500, 32500, 0, 0, '申込完了'],
    ['C 1作品をやめる', 26500, 32500, 0, 6000, '申込完了'],
    ['C 別の1作品を足す', 32500, 32500, 0, 0, '申込完了'],
    ['D 2作品で申し込む', 32500, 0, 32500, 0, '仮受付'],
    ['D 1作品を足す', 35500, 0, 35500, 0, '仮受付'],
    ['D 1作品をやめる', 32500, 0, 32500, 0, '仮受付'],
    ['E 兄1・妹1で申し込む', 34500, 0, 34500, 0, '仮受付'],
    ['E 34,500 を1回で払う', 34500, 34500, 0, 0, '申込完了'],
    ['E 兄が1作品を足す', 37500, 34500, 3000, 0, '申込完了（追加分 3,000円のお支払い待ち）'],
    ['E 妹がやめる', 32500, 34500, 0, 2000, '申込完了'],
  ] as const)('%s', (_n, total, paid, remaining, overpaid, label) => {
    const m = M(total, paid);
    expect(m).toEqual({ total, paid, remaining, overpaid });
    const v = householdView({ hasIn: true, hasMaybe: false, paid: m.paid, remaining: m.remaining });
    expect(householdViewLabel(v, m.remaining)).toBe(label);
  });
});

describe('払う額と「払う」の出し方（K204・K207）', () => {
  it('振り込みましたの印が開いていて残り＞印の金額なら 残り−印の金額。そうでなければ残り', () => {
    expect(payableAmount(M(32500, 0), { amount: 26500 })).toBe(6000);
    expect(payableAmount(M(26500, 0), { amount: 26500 })).toBe(26500);
    expect(payableAmount(M(26500, 0), { amount: 30000 })).toBe(26500);
    expect(payableAmount(M(26500, 0), null)).toBe(26500);
  });
  const st = (gate: 'before' | 'preparing' | 'open', m: MoneySummary, todo = 0) =>
    payButtonState({ gate, view: householdView({ hasIn: true, hasMaybe: false, paid: m.paid, remaining: m.remaining }), m, refundTodo: todo });
  it('残り0は出さない。鍵が開くまでは before／preparing', () => {
    expect(st('open', M(26500, 26500))).toBe('hidden');
    expect(st('before', M(26500, 0))).toBe('before');
    expect(st('preparing', M(26500, 0))).toBe('preparing');
    expect(st('open', M(26500, 0))).toBe('show');
  });
  it('返す分≧残りの間は refund_hold（K207）', () => {
    expect(st('open', M(35500, 38500, 6000), 6000)).toBe('refund_hold'); // 残り 3,000・返す分 6,000
    expect(st('open', M(35500, 35500, 3000), 3000)).toBe('refund_hold'); // 残り 3,000・返す分 3,000
    expect(st('open', M(38500, 35500, 3000), 3000)).toBe('show');        // 残り 6,000・返す分 3,000
  });
  it('出演なしは出さない', () => {
    expect(payButtonState({ gate: 'open', view: 'none', m: M(3000, 0), refundTodo: 0 })).toBe('hidden');
  });
});

describe('人数（5-9 の例6行）', () => {
  const p = (countedIn: number, rem: number, over: Partial<CountPerson> = {}): CountPerson =>
    ({ category: 'student', feeClass: null, countedIn, maybeCount: 0, householdRemaining: rem, isTestEvent: false, ...over });
  const now = new Date('2026-12-20T03:00:00.000Z');
  it.each([
    ['1人1作品・仮受付', [p(1, 26500)], [1, 0, 1, 0]],
    ['その世帯が 26,500 を払った', [p(1, 0)], [1, 1, 0, 0]],
    ['兄1・妹1 で払ったあと兄が足した（追加 3,000 待ち）', [p(2, 3000), p(1, 3000)], [2, 0, 2, 0]],
    ['その 3,000 を払った', [p(2, 0), p(1, 0)], [2, 2, 0, 0]],
    ['払ったあと妹がやめた', [p(1, 0), p(0, 0)], [1, 1, 0, 0]],
    ['迷っているだけの世帯', [p(0, 0, { maybeCount: 1 })], [0, 0, 0, 1]],
  ] as const)('%s', (_n, people, [going, paid, unpaid, maybe]) => {
    const c = countPeople([...people], now);
    expect([c.going, c.paid, c.unpaid, c.maybe]).toEqual([going, paid, unpaid, maybe]);
    expect(c.countedAt).toBe('2026-12-20T03:00:00.000Z');
  });
  it('試し用は数えない・free と tshirt_only は別の行・イントラは出る人に入れない', () => {
    const c = countPeople([
      p(1, 0, { isTestEvent: true }), p(1, 0, { feeClass: 'free' }), p(1, 0, { feeClass: 'tshirt_only' }),
      p(1, 0, { category: 'instructor' }), p(1, 0, { category: 'non_member' }),
    ], now);
    expect([c.going, c.special]).toEqual([1, 2]);
  });
});

describe('学年と年齢（5-10）', () => {
  it.each([
    ['2019-04-02', '2027-04-11', '小2'], ['2019-04-01', '2027-04-11', '小3'], ['2019-04-02', '2026-12-15', '小1'],
    ['2012-04-02', '2027-04-11', '中3'], ['2021-05-01', '2027-04-11', '年長'], ['2022-05-01', '2027-04-11', '年中'],
    ['2009-06-01', '2027-04-11', '高3'], ['2000-01-01', '2027-04-11', '大人'], ['2025-01-01', '2027-04-11', '未就学'],
  ])('%s の %s は %s', (b, on, g) => expect(schoolGrade(b, on)).toBe(g));
  it('満年齢（誕生日の当日に1つ上がる）', () => {
    expect(ageOn('2009-04-12', '2027-04-11')).toBe(17);
    expect(ageOn('2009-04-11', '2027-04-11')).toBe(18);
    expect(ageOn('2008-12-16', '2026-12-15')).toBe(17);
  });
});
