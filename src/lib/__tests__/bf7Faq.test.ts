import { describe, expect, it } from 'vitest';
import { pickBf7Faqs } from '../bf7';

describe('vol.7に出すFAQの絞り込み', () => {
  it('いつでも成り立つ質問は出す', () => {
    const got = pickBf7Faqs([
      { q: 'レペゼンって何を書けばいいですか？' },
      { q: 'どんな服装で出ればいいですか？' },
    ]);
    expect(got).toHaveLength(2);
  });

  it('vol.6の部門・定員・料金が前提の質問は出さない(vol.7では未定のため)', () => {
    const got = pickBf7Faqs([
      { q: 'ビギナー部門には誰が出られますか？' },
      { q: '保護者の付き添いは必要ですか？観覧にチケットは要りますか？' },
      { q: '2つ以上の部門にエントリーできますか？(ダブルエントリー)' },
      { q: '予選はどんな形式ですか？' },
    ]);
    expect(got).toEqual([]);
  });
});
