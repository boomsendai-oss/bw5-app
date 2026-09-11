import { describe, it, expect } from 'vitest';
import { buildDigest, healthLines, DIGEST_LIMIT, type DigestInput } from '../inboxAlert/digest';
import { charLength } from '../inboxAlert/format';

// JST 2026-09-12 08:00
const NOW = Date.UTC(2026, 8, 11, 23, 0);

const base: DigestInput = {
  nowMs: NOW,
  pending: [{ accountLabel: 'BOOM', kind: 'new_inquiry', subject: '体験レッスンの相談', receivedMs: Date.UTC(2026, 8, 11, 3, 10), aiFailed: false }],
  failures: [{ accountLabel: 'BOOM', kind: 'automation_failure', subject: '日次同期が失敗しました', receivedMs: Date.UTC(2026, 8, 11, 12, 0), aiFailed: false }],
  others: [],
  counts: { countOnly: 31, aiLight: 48, aiFailed: 0 },
  health: [{ label: 'BOOM', lastSuccessMs: Date.UTC(2026, 8, 11, 22, 55), consecutiveErrors: 0 }],
  missing: [],
};

describe('buildDigest', () => {
  it('設計書の形で組み立てる', () => {
    expect(buildDigest(base)).toEqual({
      title: '朝のまとめ 9/12',
      message: [
        '■未対応 1件',
        '・BOOM【新規】体験レッスンの相談（昨日12:10）',
        '■自動化の失敗 1件',
        '・BOOM【失敗】日次同期が失敗しました',
        '■お金・その他 0件',
        '■件数 宣伝31 / 自動通知48（AI判定できず0）',
        '■稼働 1アカウントとも正常（最終確認 07:55）',
      ].join('\n'),
    });
  });

  it('1024字を超えたら「ほかN件」に畳み、件数の見出しは実数のまま', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      accountLabel: 'BOOM', kind: 'reply' as const, subject: `見積の件その${i}` + 'あ'.repeat(30),
      receivedMs: Date.UTC(2026, 8, 10, 3, 0), aiFailed: false,
    }));
    const { message } = buildDigest({ ...base, pending: many });
    expect(charLength(message)).toBeLessThanOrEqual(DIGEST_LIMIT);
    expect(message.startsWith('■未対応 60件')).toBe(true);
    expect(message).toMatch(/・ほか\d+件/);
    expect(message).toContain('■稼働');
  });

  it('件名のURLは消す', () => {
    const { message } = buildDigest({
      ...base,
      pending: [{ ...base.pending[0], subject: '確認 https://evil.example/login' }],
    });
    expect(message).toContain('・BOOM【新規】確認 [URL]（昨日12:10）');
  });
});

describe('healthLines', () => {
  it('30分以上成功していない・まだ成功していないアカウントを挙げる', () => {
    expect(healthLines([
      { label: 'BOOM', lastSuccessMs: Date.UTC(2026, 8, 11, 20, 0), consecutiveErrors: 0 },
      { label: '個人', lastSuccessMs: null, consecutiveErrors: 2 },
    ], NOW)).toEqual([
      '■稼働 要確認',
      '・BOOM: 最終成功 9/12 05:00',
      '・個人: まだ一度も成功していません',
    ]);
  });
  it('監視中のアカウントが無い', () => {
    expect(healthLines([], NOW)).toEqual(['■稼働 監視中のアカウントがありません']);
  });
  it('設定が欠けたアカウントがあれば、他が正常でも要確認にして名前を出す', () => {
    expect(healthLines([{ label: 'BOOM', lastSuccessMs: NOW - 60_000, consecutiveErrors: 0 }], NOW, ['個人'])).toEqual([
      '■稼働 要確認',
      '・個人: 設定が欠けていて監視していません',
    ]);
  });
});
