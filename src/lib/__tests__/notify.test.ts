import { describe, it, expect } from 'vitest';
import { formatSubject } from '../notify';

describe('formatSubject', () => {
  it('prefix未指定なら既存の [BOOM Story] を保つ(既存呼び出し側の互換)', () => {
    expect(formatSubject('要対応 2026-07-20')).toBe('[BOOM Story] 要対応 2026-07-20');
  });

  it('prefixを指定したらそれを使う', () => {
    expect(formatSubject('同期が失敗しました', '[BOOM 同期]')).toBe(
      '[BOOM 同期] 同期が失敗しました'
    );
  });

  it('prefixに空文字を渡したら既定値にフォールバックする', () => {
    expect(formatSubject('件名', '')).toBe('[BOOM Story] 件名');
  });
});
