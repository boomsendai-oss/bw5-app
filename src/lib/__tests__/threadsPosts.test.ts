import { describe, expect, it } from 'vitest';
import {
  THREADS_TEXT_MAX,
  MAX_THREADS_POSTS_PER_RUN,
  validateThreadsText,
  resolveLinkedAction,
} from '../threadsPosts';

describe('validateThreadsText (Threadsテキスト投稿の事前検証)', () => {
  it('通常のテキストはOK(null)', () => {
    expect(validateThreadsText('こんにちは、BOOMです。')).toBeNull();
  });

  it('空文字はエラー', () => {
    expect(validateThreadsText('')).toMatch(/空/);
  });

  it('空白のみもエラー', () => {
    expect(validateThreadsText('   \n ')).toMatch(/空/);
  });

  it('文字列以外はエラー', () => {
    expect(validateThreadsText(123)).toMatch(/文字列/);
  });

  it('500字ちょうどはOK', () => {
    expect(validateThreadsText('あ'.repeat(THREADS_TEXT_MAX))).toBeNull();
  });

  it('500字超はエラー(上限値を含むメッセージ)', () => {
    expect(validateThreadsText('あ'.repeat(THREADS_TEXT_MAX + 1))).toMatch(/500/);
  });
});

describe('resolveLinkedAction (X承認への追従判定)', () => {
  it('draft + Xがapproved → approve(承認に追従)', () => {
    expect(resolveLinkedAction('draft', 'approved')).toBe('approve');
  });

  it('draft + Xがposting → approve(投稿着手済み=承認済み)', () => {
    expect(resolveLinkedAction('draft', 'posting')).toBe('approve');
  });

  it('draft + Xがposted → approve(投稿済み=承認済み)', () => {
    expect(resolveLinkedAction('draft', 'posted')).toBe('approve');
  });

  it('draft + Xがrejected → reject(ボツに追従)', () => {
    expect(resolveLinkedAction('draft', 'rejected')).toBe('reject');
  });

  it('draft + Xがdraft → none(まだ判断されていない)', () => {
    expect(resolveLinkedAction('draft', 'draft')).toBe('none');
  });

  it('draft + Xがfailed → none(X失敗はThreads可否と無関係。差し戻し再承認を待つ)', () => {
    expect(resolveLinkedAction('draft', 'failed')).toBe('none');
  });

  it('draft + リンク先なし(null) → none(勝手に動かさない)', () => {
    expect(resolveLinkedAction('draft', null)).toBe('none');
  });

  it('approved以降のステータスは追従しない(none)', () => {
    expect(resolveLinkedAction('approved', 'rejected')).toBe('none');
    expect(resolveLinkedAction('posted', 'rejected')).toBe('none');
    expect(resolveLinkedAction('failed', 'approved')).toBe('none');
    expect(resolveLinkedAction('rejected', 'approved')).toBe('none');
    expect(resolveLinkedAction('posting', 'approved')).toBe('none');
  });
});

describe('定数', () => {
  it('1回のcronで最大5件(x-autopostと同じ)', () => {
    expect(MAX_THREADS_POSTS_PER_RUN).toBe(5);
  });
});
