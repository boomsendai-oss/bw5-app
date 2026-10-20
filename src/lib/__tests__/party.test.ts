import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PARTY_SETTINGS,
  resolvePartySettings,
  partySettingsToRows,
  jstLocalToMs,
  isBeforeDeadline,
  ticketCardState,
  ticketCashState,
  entryState,
  audioOpen,
  ticketTotal,
  entryUnitPrice,
  entryTotal,
  validateTicketInput,
  validateEntryInput,
  sortRosterByKana,
  calcSettlement,
  formatPartyReceiptNo,
  formatJstLabel,
  summarizePartyOrders,
  rosterRows,
  gradeLabel,
  type PartySettings,
} from '../party';

// JSTの壁時計 → Date
const jst = (s: string) => new Date(`${s}+09:00`);

const OPEN: PartySettings = { ...DEFAULT_PARTY_SETTINGS, openAt: '2026-10-20T20:00' };

describe('resolvePartySettings', () => {
  it('空なら既定値(未公開)', () => {
    const s = resolvePartySettings({});
    expect(s).toEqual(DEFAULT_PARTY_SETTINGS);
    expect(s.openAt).toBe('');
    expect(s.presalePrice).toBe(2000);
    expect(s.doorPrice).toBe(2500);
    expect(s.performerFee).toBe(2000);
    expect(s.teamCap).toBe(8);
    expect(s.venueFee).toBe(99000);
    expect(s.ticketCardDeadline).toBe('2026-12-16T20:00');
    expect(s.ticketCashDeadline).toBe('2026-12-16T20:00');
    expect(s.entryDeadline).toBe('2026-12-01T23:59');
    expect(s.audioDeadline).toBe('2026-12-12T23:59');
  });
  it('不正値は既定に戻す', () => {
    const s = resolvePartySettings({ presale_price: 'abc', team_cap: '-1', open_at: '明日', entry_deadline: '2026/12/01' });
    expect(s.presalePrice).toBe(2000);
    expect(s.teamCap).toBe(8);
    expect(s.openAt).toBe('');
    expect(s.entryDeadline).toBe('2026-12-01T23:59');
  });
  it('行に戻して読み直すと同じ', () => {
    const s = { ...OPEN, presalePrice: 1800, suspended: true };
    expect(resolvePartySettings(partySettingsToRows(s))).toEqual(s);
  });
});

describe('締切の判定(JST・締切の分は含む)', () => {
  it('jstLocalToMs', () => {
    expect(jstLocalToMs('2026-12-16T20:00')).toBe(jst('2026-12-16T20:00:00').getTime());
    expect(jstLocalToMs('')).toBeNull();
  });
  it('20:00締切は 20:00:59 まで受付・20:01:00 で締切', () => {
    expect(isBeforeDeadline('2026-12-16T20:00', jst('2026-12-16T20:00:59'))).toBe(true);
    expect(isBeforeDeadline('2026-12-16T20:00', jst('2026-12-16T20:01:00'))).toBe(false);
  });
});

describe('受付の状態は商品ごとに別', () => {
  it('公開日時が空なら before', () => {
    expect(ticketCardState(DEFAULT_PARTY_SETTINGS, jst('2026-11-01T12:00'))).toBe('before');
    expect(entryState(DEFAULT_PARTY_SETTINGS, jst('2026-11-01T12:00'), 0)).toBe('before');
  });
  it('公開日時の前は before・後は open', () => {
    expect(ticketCardState(OPEN, jst('2026-10-20T19:59:59'))).toBe('before');
    expect(ticketCardState(OPEN, jst('2026-10-20T20:00:00'))).toBe('open');
  });
  it('カードの締切だけ過ぎても当日現金予約は開いている', () => {
    const s = { ...OPEN, ticketCardDeadline: '2026-12-10T20:00' };
    const now = jst('2026-12-12T10:00');
    expect(ticketCardState(s, now)).toBe('closed');
    expect(ticketCashState(s, now)).toBe('open');
  });
  it('エントリーは上限で full・締切で closed', () => {
    expect(entryState(OPEN, jst('2026-11-01T12:00'), 7)).toBe('open');
    expect(entryState(OPEN, jst('2026-11-01T12:00'), 8)).toBe('full');
    expect(entryState(OPEN, jst('2026-12-02T00:00'), 0)).toBe('closed');
  });
  it('チケット予約だけ先に開けられる(エントリーは openAt まで before)', () => {
    const s = { ...OPEN, ticketOpenAt: '2026-10-15T20:00' };
    const now = jst('2026-10-16T12:00');
    expect(ticketCardState(s, now)).toBe('open');
    expect(ticketCashState(s, now)).toBe('open');
    expect(entryState(s, now, 0)).toBe('before');
    expect(entryState(s, jst('2026-10-20T20:00:00'), 0)).toBe('open');
  });
  it('ticketOpenAt が空ならチケットもエントリーと同時に開く', () => {
    expect(ticketCardState(OPEN, jst('2026-10-20T19:59:59'))).toBe('before');
    expect(resolvePartySettings({ ticket_open_at: '2026-10-15T20:00' }).ticketOpenAt).toBe('2026-10-15T20:00');
    expect(resolvePartySettings({ ticket_open_at: 'bad' }).ticketOpenAt).toBe('');
  });
  it('緊急停止は全部止める', () => {
    const s = { ...OPEN, suspended: true };
    const now = jst('2026-11-01T12:00');
    expect(ticketCardState(s, now)).toBe('suspended');
    expect(ticketCashState(s, now)).toBe('suspended');
    expect(entryState(s, now, 0)).toBe('suspended');
  });
  it('音源は公開日時に関係なく締切まで', () => {
    expect(audioOpen(DEFAULT_PARTY_SETTINGS, jst('2026-12-12T23:59:30'))).toBe(true);
    expect(audioOpen(DEFAULT_PARTY_SETTINGS, jst('2026-12-13T00:00:00'))).toBe(false);
  });
});

describe('金額は設定値から計算', () => {
  it('参加費は人数×前売・未就学児は数えない', () => {
    expect(ticketTotal(3, OPEN)).toBe(6000);
  });
  it('出演は1人あたり出演料だけ(入場は出演者もチケットで別に払う)', () => {
    expect(entryUnitPrice(OPEN)).toBe(2000);
    expect(entryTotal(4, OPEN)).toBe(8000);
    expect(entryTotal(4, { ...OPEN, performerFee: 1500 })).toBe(6000);
  });
  it('エントリーで入場チケットもまとめ買いすると 出演料×人数+前売×枚数', () => {
    expect(entryTotal(3, OPEN, 3)).toBe(12000);
    expect(entryTotal(3, OPEN, 1)).toBe(8000);
  });
});

const baseTicket = {
  buyerName: '木村 太郎',
  buyerKana: 'きむら たろう',
  email: 'taro@example.com',
  phone: '090-1234-5678',
  isMember: 'member',
  peopleCount: 2,
  infantCount: 1,
  payMethod: 'card',
};

describe('validateTicketInput', () => {
  it('正常系は正規化して返す', () => {
    const v = validateTicketInput(baseTicket);
    expect(typeof v).toBe('object');
    if (typeof v === 'string') return;
    expect(v.phone).toBe('09012345678');
    expect(v.isMember).toBe(true);
    expect(v.payMethod).toBe('card');
  });
  it('カタカナのふりがなはひらがなに直す', () => {
    const v = validateTicketInput({ ...baseTicket, buyerKana: 'キムラ タロウ' });
    expect(typeof v !== 'string' && v.buyerKana).toBe('きむら たろう');
  });
  it('エラー', () => {
    expect(validateTicketInput({ ...baseTicket, buyerName: ' ' })).toMatch(/お名前/);
    expect(validateTicketInput({ ...baseTicket, buyerKana: 'kimura' })).toMatch(/ふりがな/);
    expect(validateTicketInput({ ...baseTicket, email: 'x' })).toMatch(/メール/);
    expect(validateTicketInput({ ...baseTicket, phone: '123' })).toMatch(/電話/);
    expect(validateTicketInput({ ...baseTicket, isMember: '' })).toMatch(/会員/);
    expect(validateTicketInput({ ...baseTicket, peopleCount: 0 })).toMatch(/人数/);
    expect(validateTicketInput({ ...baseTicket, peopleCount: 21 })).toMatch(/人数/);
    expect(validateTicketInput({ ...baseTicket, infantCount: -1 })).toMatch(/未就学児/);
    expect(validateTicketInput({ ...baseTicket, payMethod: 'paypay' })).toMatch(/支払/);
  });
});

const baseEntry = {
  teamName: 'BOOM KIDS',
  teamKana: 'ブーム キッズ',
  genre: 'HIPHOP',
  buyerName: '木村 太郎',
  buyerKana: 'きむら たろう',
  email: 'taro@example.com',
  phone: '09012345678',
  members: [
    { name: 'あいう', grade: 'g1_3' },
    { name: 'かきく', grade: 'jhs' },
    { name: '', grade: '' },
  ],
  payMethod: 'card',
};

describe('validateEntryInput', () => {
  it('空行のメンバーは捨て、チーム名のふりがなはひらがなに直す', () => {
    const v = validateEntryInput(baseEntry);
    expect(typeof v).toBe('object');
    if (typeof v === 'string') return;
    expect(v.members).toEqual([
      { name: 'あいう', grade: 'g1_3' },
      { name: 'かきく', grade: 'jhs' },
    ]);
    expect(v.teamKana).toBe('ぶーむ きっず');
  });
  it('入場チケットのまとめ買いは0〜メンバー数(省略時は0)', () => {
    const v0 = validateEntryInput(baseEntry);
    expect(typeof v0 === 'object' && v0.ticketCount).toBe(0);
    const v2 = validateEntryInput({ ...baseEntry, ticketCount: 2 });
    expect(typeof v2 === 'object' && v2.ticketCount).toBe(2);
    expect(validateEntryInput({ ...baseEntry, ticketCount: 3 })).toMatch(/0〜2枚/);
    expect(validateEntryInput({ ...baseEntry, ticketCount: -1 })).toMatch(/入場チケット/);
    expect(validateEntryInput({ ...baseEntry, ticketCount: 1.5 })).toMatch(/入場チケット/);
  });
  it('2人未満はNG(1人での出演はなし)', () => {
    expect(validateEntryInput({ ...baseEntry, members: [{ name: 'ひとり', grade: 'hs' }] })).toMatch(/2人以上/);
  });
  it('チーム名・ふりがな・ジャンル必須', () => {
    expect(validateEntryInput({ ...baseEntry, teamName: '' })).toMatch(/チーム名/);
    expect(validateEntryInput({ ...baseEntry, teamKana: 'boom' })).toMatch(/ふりがな/);
    expect(validateEntryInput({ ...baseEntry, genre: '' })).toMatch(/ジャンル/);
  });
  it('名前を書いたメンバーは学年も必須', () => {
    expect(validateEntryInput({ ...baseEntry, members: [{ name: 'あ', grade: 'g1_3' }, { name: 'い', grade: '' }] })).toMatch(/学年/);
  });
  it('出演エントリーはカード払いのみ', () => {
    expect(validateEntryInput({ ...baseEntry, payMethod: 'cash' })).toMatch(/カード/);
  });
  it('学年ラベル', () => {
    expect(gradeLabel('g4_6')).toBe('小学4〜6年生');
    expect(gradeLabel('adult')).toBe('それ以上');
  });
});

describe('名簿・精算・表示', () => {
  it('ふりがなの50音順', () => {
    const rows = [{ buyerKana: 'わたなべ' }, { buyerKana: 'あべ' }, { buyerKana: 'かとう' }];
    expect(sortRosterByKana(rows).map((r) => r.buyerKana)).toEqual(['あべ', 'かとう', 'わたなべ']);
  });
  it('精算: 期待額との差と会場費の相殺', () => {
    const r = calcSettlement({ expectedCash: 20000, walkinCount: 10, actualCash: 44000, doorPrice: 2500, venueFee: 99000 });
    expect(r.walkinExpected).toBe(25000);
    expect(r.expectedTotal).toBe(45000);
    expect(r.diff).toBe(-1000);
    expect(r.netToBoom).toBe(-55000);
  });
  it('受付番号と日時ラベル', () => {
    expect(formatPartyReceiptNo(7)).toBe('X26-007');
    expect(formatJstLabel('2026-12-16T20:00')).toBe('12/16(水) 20:00');
    expect(formatJstLabel('')).toBe('');
  });
});


describe('スタッフ集計', () => {
  const o = (x: Partial<Parameters<typeof summarizePartyOrders>[0][number]> & { buyerKana?: string }) => ({
    kind: 'ticket' as const, status: 'paid', payMethod: 'card' as const, peopleCount: 0, infantCount: 0,
    memberCount: 0, amountTotal: 0, isMember: true, buyerKana: 'あ', ...x,
  });
  const orders = [
    o({ peopleCount: 3, infantCount: 1, amountTotal: 6000, buyerKana: 'わ' }),
    o({ status: 'cash_due', payMethod: 'cash', peopleCount: 2, amountTotal: 4000, isMember: false, buyerKana: 'か' }),
    o({ kind: 'entry', status: 'cash_due', payMethod: 'cash', memberCount: 4, amountTotal: 16000, isMember: null, buyerKana: 'さ' }),
    o({ status: 'expired', peopleCount: 9, amountTotal: 18000, buyerKana: 'あ' }),
    o({ status: 'canceled', peopleCount: 9, amountTotal: 18000, buyerKana: 'い' }),
  ];
  it('確定分だけ数える', () => {
    expect(summarizePartyOrders(orders)).toEqual({
      ticketOrders: 2, people: 5, infants: 1, nonMemberOrders: 1, teams: 1, performers: 4,
      cardPaid: 6000, cashDue: 20000, headcount: 5,
    });
  });
  it('名簿は確定分を50音順', () => {
    expect(rosterRows(orders).map((r) => r.buyerKana)).toEqual(['か', 'さ', 'わ']);
  });
});

describe('金額表示', () => {
  it('マイナスは −¥ で表示', async () => {
    const { yen, signedYen } = await import('../party');
    expect(yen(-1000)).toBe('−¥1,000');
    expect(signedYen(1000)).toBe('+¥1,000');
    expect(signedYen(0)).toBe('¥0');
  });
});

describe('画伯コーナーの答え合わせ', () => {
  it('Q1: くまのプーさん・熊のプーさん・プーさん・プーはすべて正解', async () => {
    const { checkGahakuAnswer } = await import('../party');
    for (const a of ['くまのプーさん', 'クマノプーサン', '熊のプーさん', 'プーさん', 'ぷーさん', 'プー', ' プー さん ', 'Pooh']) {
      expect(checkGahakuAnswer('Q1', a)).toBe(true);
    }
    expect(checkGahakuAnswer('Q1', 'くま')).toBe(false);
    expect(checkGahakuAnswer('Q1', '')).toBe(false);
  });
  it('Q2: ロバはひらがなでもカタカナでも正解', async () => {
    const { checkGahakuAnswer } = await import('../party');
    for (const a of ['ロバ', 'ろば', 'ロバ！', 'ろばさん']) expect(checkGahakuAnswer('Q2', a)).toBe(true);
    expect(checkGahakuAnswer('Q2', 'うま')).toBe(false);
  });
});

describe('入力欄のその場チェック', () => {
  it('形式が違うときだけエラー文・空はエラーにしない', async () => {
    const { contactFieldError } = await import('../party');
    expect(contactFieldError('email', '')).toBe('');
    expect(contactFieldError('email', 'boom@example.com')).toBe('');
    expect(contactFieldError('email', 'boom@')).toMatch(/メールアドレス/);
    expect(contactFieldError('phone', '090-1234-5678')).toBe('');
    expect(contactFieldError('phone', '０９０１２３４５６７８')).toBe('');
    expect(contactFieldError('phone', '1234')).toMatch(/10〜11桁/);
    expect(contactFieldError('kana', 'キムラ タロウ')).toBe('');
    expect(contactFieldError('kana', '木村')).toMatch(/ひらがな/);
  });
});

describe('不具合チェック対応', () => {
  it('存在しない日付は設定値として受け付けない', async () => {
    const { isValidJstLocal } = await import('../party');
    expect(isValidJstLocal('2026-12-16T20:00')).toBe(true);
    expect(isValidJstLocal('2026-02-30T10:00')).toBe(false);
    expect(isValidJstLocal('2026-12-16T24:00')).toBe(false);
  });
  it('ふりがなに中黒(・)を使える', () => {
    const v = validateEntryInput({ ...baseEntry, teamKana: 'ぶーむ・きっず' });
    expect(typeof v !== 'string' && v.teamKana).toBe('ぶーむ・きっず');
  });
});

describe('チーム名の照合', () => {
  it('表記ゆれを吸収する', async () => {
    const { normalizeTeamKey } = await import('../party');
    expect(normalizeTeamKey('BOOM KIDS')).toBe(normalizeTeamKey('ｂｏｏｍ ｋｉｄｓ'));
    expect(normalizeTeamKey('ブーム・キッズ')).toBe(normalizeTeamKey('ぶーむきっず'));
    expect(normalizeTeamKey('BOOM KIDS!')).toBe('boomkids');
    expect(normalizeTeamKey('')).toBe('');
  });
});
