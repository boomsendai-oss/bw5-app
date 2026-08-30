import { describe, it, expect } from 'vitest';
import { publicWaitlistRows } from '../bf6Waitlist';

const row = (o: Partial<Record<string, unknown>>) => ({
  position: 1, status: 'waiting', dancerName: 'AAA', genre: 'HIPHOP', rep: '仙台',
  email: 'a@example.com', phone: '09000000000', performerName: 'ホンミョウ',
  buyerName: '保護者', grade: 'es5',
  ...o,
});

describe('公開キャンセル待ちリストの組み立て', () => {
  it('待機中と繰り上げ案内中の人を載せる(まだ出場が確定していないため)', () => {
    const r = publicWaitlistRows([
      row({ position: 1, status: 'waiting', dancerName: 'AAA' }),
      row({ position: 2, status: 'offered', dancerName: 'BBB' }),
    ]);
    expect(r.map((x) => x.dancerName)).toEqual(['AAA', 'BBB']);
  });

  it('繰り上がって出場が決まった人は載せない(エントリーリスト本体に載るため)', () => {
    const r = publicWaitlistRows([row({ status: 'accepted', dancerName: 'CCC' })]);
    expect(r).toEqual([]);
  });

  it('辞退・期限切れの人は載せない', () => {
    const r = publicWaitlistRows([
      row({ status: 'declined', dancerName: 'DDD' }),
      row({ status: 'expired', dancerName: 'EEE' }),
    ]);
    expect(r).toEqual([]);
  });

  it('順番(position)の昇順で並ぶ', () => {
    const r = publicWaitlistRows([
      row({ position: 3, dancerName: 'CCC' }),
      row({ position: 1, dancerName: 'AAA' }),
      row({ position: 2, dancerName: 'BBB' }),
    ]);
    expect(r.map((x) => x.dancerName)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('表示は1番から連番になる(欠番が出ても詰める)', () => {
    const r = publicWaitlistRows([
      row({ position: 2, dancerName: 'AAA' }),
      row({ position: 5, dancerName: 'BBB' }),
    ]);
    expect(r.map((x) => x.order)).toEqual([1, 2]);
  });

  it('個人情報は一切含めない(公開されるのはダンサーネーム/ジャンル/レペゼンのみ)', () => {
    const r = publicWaitlistRows([row({})]);
    const keys = Object.keys(r[0]).sort();
    expect(keys).toEqual(['dancerName', 'genre', 'order', 'rep']);
  });
});
