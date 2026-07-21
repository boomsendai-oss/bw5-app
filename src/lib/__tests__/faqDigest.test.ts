import { describe, it, expect } from 'vitest';
import { formatFaqDigest, type FaqDigestInput } from '../faqDigest';

const base: FaqDigestInput = {
  dateLabel: '7/20(日)',
  questions: 34,
  people: 12,
  categories: [
    { category: '料金・支払い', n: 12 },
    { category: 'スケジュール', n: 8 },
    { category: null, n: 2 },
  ],
  topQuestions: ['料金を教えて', '体験したい！'],
  newReports: 0,
  brokenAnswers: 0,
  reportsUrl: 'https://bw5-app.vercel.app/staff/faq/reports',
  statsUrl: 'https://bw5-app.vercel.app/staff/faq/stats',
};

describe('formatFaqDigest', () => {
  it('件名に対象日が入る', () => {
    expect(formatFaqDigest(base).subject).toBe('【BOOMくんに質問】7/20(日)の日次レポート');
  });

  it('通常日は利用状況とカテゴリ内訳を含む', () => {
    const { text } = formatFaqDigest(base);
    expect(text).toContain('質問数: 34件 / 人数: 12人');
    expect(text).toContain('・料金・支払い: 12件');
    expect(text).toContain('・(未分類): 2件'); // category=null は「(未分類)」表記
  });

  it('警告が無い日は「異常なし」を出す', () => {
    const { text } = formatFaqDigest(base);
    expect(text).toContain('✅ 空応答・未仕分けのエラー報告はありません。');
    expect(text).not.toContain('⚠️');
  });

  it('空応答があると警告と件数を出す', () => {
    const { text } = formatFaqDigest({ ...base, brokenAnswers: 3 });
    expect(text).toContain('⚠️ 空応答・エラー応答が 3件');
  });

  it('未仕分けのエラー報告があると仕分けURL付きで促す', () => {
    const { text } = formatFaqDigest({ ...base, newReports: 2 });
    expect(text).toContain('🔧 未仕分けのエラー報告が 2件');
    expect(text).toContain(base.reportsUrl);
  });

  it('質問ゼロの日は無理にカテゴリを出さない', () => {
    const { text } = formatFaqDigest({
      ...base,
      questions: 0,
      people: 0,
      categories: [],
      topQuestions: [],
    });
    expect(text).toContain('質問はありませんでした');
    expect(text).not.toContain('カテゴリ内訳');
  });
});
