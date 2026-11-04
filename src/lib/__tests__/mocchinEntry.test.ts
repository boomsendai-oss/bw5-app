import { describe, expect, it } from 'vitest';
import {
  MOCCHIN_PROMISES,
  buildMocchinEmail,
  formatJpDate,
  formatMocchinNo,
  isMinor,
  mocchinCsv,
  mocchinGate,
  mocchinGateError,
  mocchinPayDeadline,
  mocchinTransferPrefix,
  validateMocchinInput,
  type MocchinInput,
} from '../mocchinEntry';

const base: MocchinInput = {
  name: '山田 花子',
  kana: 'ヤマダ ハナコ',
  age: '25歳',
  guardianName: '',
  phone: '090-1234-5678',
  email: 'test@example.com',
  isMember: true,
  memberNo: '',
  danceHistory: '',
  classNumber: 'undecided',
  note: '',
  agreed: MOCCHIN_PROMISES.map(() => true),
};

describe('mocchinGate', () => {
  it('11/7までは開始前、11/8〜11/14は会員先行、11/15〜12/13は誰でも、12/14から締切', () => {
    expect(mocchinGate('2026-11-07')).toBe('before');
    expect(mocchinGate('2026-11-08')).toBe('member');
    expect(mocchinGate('2026-11-14')).toBe('member');
    expect(mocchinGate('2026-11-15')).toBe('open');
    expect(mocchinGate('2026-12-13')).toBe('open');
    expect(mocchinGate('2026-12-14')).toBe('closed');
  });
});

describe('mocchinGateError', () => {
  it('会員の先行期間は会員以外を断り、会員は通す', () => {
    expect(mocchinGateError('member', true)).toBeNull();
    expect(mocchinGateError('member', false)).toContain('11月15日(日)');
    expect(mocchinGateError('open', false)).toBeNull();
    expect(mocchinGateError('before', true)).toContain('11月8日(日)');
    expect(mocchinGateError('closed', true)).toContain('終了');
  });
});

describe('申込番号と振込', () => {
  it('番号は3桁ゼロ埋め・振込名義の頭はハイフンなし', () => {
    expect(formatMocchinNo(1)).toBe('MC-001');
    expect(formatMocchinNo(123)).toBe('MC-123');
    expect(mocchinTransferPrefix(7)).toBe('MC007');
  });
  it('振込期限は申込から7日・ただし12/13を越えない', () => {
    expect(mocchinPayDeadline('2026-11-08')).toBe('2026-11-15');
    expect(mocchinPayDeadline('2026-12-10')).toBe('2026-12-13');
  });
  it('日付は曜日つきで出す', () => {
    expect(formatJpDate('2026-12-13')).toBe('12月13日(日)');
  });
});

describe('validateMocchinInput', () => {
  it('正しい入力は通り、電話はハイフンを外す', () => {
    const r = validateMocchinInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.phone).toBe('09012345678');
  });
  it('未成年(学年)は保護者名が必須', () => {
    const r = validateMocchinInput({ ...base, age: '中学2年' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.guardianName).toBeTruthy();
    expect(validateMocchinInput({ ...base, age: '中学2年', guardianName: '山田 太郎' }).ok).toBe(true);
  });
  it('約束のチェックが1つでも欠けるとNG', () => {
    const r = validateMocchinInput({ ...base, agreed: [true, false, true] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.agreed).toBeTruthy();
  });
  it('会員かどうか未選択・フリガナに漢字はNG', () => {
    const r = validateMocchinInput({ ...base, isMember: null, kana: '山田' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.isMember).toBeTruthy();
      expect(r.errors.kana).toBeTruthy();
    }
  });
});

describe('isMinor', () => {
  it('数字は18未満・学年表記は未成年扱い', () => {
    expect(isMinor('17歳')).toBe(true);
    expect(isMinor('18')).toBe(false);
    expect(isMinor('小学5年')).toBe(true);
    expect(isMinor('大学生')).toBe(false);
  });
});

describe('buildMocchinEmail', () => {
  it('申込番号・振込名義の頭・会員のレッスン代を含む', () => {
    const m = buildMocchinEmail({ id: 3, name: '山田 花子', appliedOn: '2026-11-08', isMember: true, overCapacity: false });
    expect(m.subject).toContain('MC-003');
    expect(m.text).toContain('MC003');
    expect(m.text).toContain('15,000円');
    expect(m.text).toContain('1日 6,000円');
    expect(m.text).toContain('11月15日(日) まで');
    expect(m.text).not.toContain('オーディション');
  });
  it('会員以外は7,000円・定員超えはオーディションの案内', () => {
    const m = buildMocchinEmail({ id: 31, name: 'A', appliedOn: '2026-11-20', isMember: false, overCapacity: true });
    expect(m.text).toContain('1日 7,000円');
    expect(m.text).toContain('オーディション');
  });
});

describe('mocchinCsv', () => {
  it('カンマや改行を含む値はダブルクォートで囲む', () => {
    const csv = mocchinCsv([
      {
        id: 1, createdAt: '11/8 10:00', name: '山田', kana: 'ヤマダ', age: '20', guardianName: '', phone: '090', email: 'a@b.c',
        isMember: true, memberNo: '', danceHistory: '', classNumber: 'yes', note: 'A,B\nC', paid: true, status: 'active',
      },
    ]);
    const [head, line] = csv.split('\n');
    expect(head.startsWith('申込番号')).toBe(true);
    expect(line).toContain('MC-001');
    expect(line).toContain('出る予定');
    expect(csv).toContain('"A,B\nC"');
  });
});
