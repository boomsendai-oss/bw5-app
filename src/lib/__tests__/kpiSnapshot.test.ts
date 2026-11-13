import { describe, it, expect } from 'vitest';
import { pickSnapshotExpense, snapshotTargetMonths } from '../kpiSnapshot';
import { comparableFriendCounts, countLstepFriends } from '../lstepFriendCount';

describe('snapshotTargetMonths(月初は前月も締め直す)', () => {
  it('1日は前月と当月', () => {
    expect(snapshotTargetMonths('2026-11-01')).toEqual(['2026-10', '2026-11']);
  });
  it('10日までは前月も', () => {
    expect(snapshotTargetMonths('2026-11-10')).toEqual(['2026-10', '2026-11']);
  });
  it('11日以降は当月だけ', () => {
    expect(snapshotTargetMonths('2026-11-11')).toEqual(['2026-11']);
  });
  it('年またぎ', () => {
    expect(snapshotTargetMonths('2027-01-01')).toEqual(['2026-12', '2027-01']);
  });
});

describe('pickSnapshotExpense(経費が0円になる不具合)', () => {
  it('正準の経費があればそれを使う', () => {
    expect(pickSnapshotExpense(812_000, 0)).toBe(812_000);
    expect(pickSnapshotExpense(812_000, 500_000)).toBe(812_000);
  });
  it('正準が0円で手入力があれば手入力を残す', () => {
    expect(pickSnapshotExpense(0, 400_000)).toBe(400_000);
  });
  it('どちらも無ければ0', () => {
    expect(pickSnapshotExpense(0, null)).toBe(0);
  });
});

describe('countLstepFriends', () => {
  it('2行目ヘッダ・数字IDの行だけ数え、ブロックを引く', () => {
    const csv = [
      'Lstep友だちリスト,,',
      'ID,表示名,ユーザーブロック',
      '1,a,0',
      '2,b,1',
      '3,c,',
      'x,合計,',
    ].join('\n');
    expect(countLstepFriends(csv)).toEqual({ total: 3, blocked: 1, active: 2, has_block_column: true });
  });
});

describe('comparableFriendCounts(ブロック列が増えた日の誤報防止)', () => {
  it('片方にブロック列が無ければ総数どうしで比べる', () => {
    const before = { total: 915, blocked: 0, active: 915, has_block_column: false };
    const after = { total: 929, blocked: 284, active: 645, has_block_column: true };
    expect(comparableFriendCounts(after, before)).toEqual({ now: 929, prev: 915, basis: 'total' });
  });
  it('両方にあればブロック除く人数で比べる', () => {
    const a = { total: 929, blocked: 284, active: 645, has_block_column: true };
    const b = { total: 925, blocked: 250, active: 675, has_block_column: true };
    expect(comparableFriendCounts(a, b)).toEqual({ now: 645, prev: 675, basis: 'active' });
  });
});
