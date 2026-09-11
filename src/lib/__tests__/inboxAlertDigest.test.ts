import { describe, it, expect } from 'vitest';
import { buildDigest, healthLines, DIGEST_LIMIT, type DigestInput } from '../inboxAlert/digest';
import { charLength } from '../inboxAlert/format';

// JST 2026-09-12 08:00
const NOW = Date.UTC(2026, 8, 11, 23, 0);
const HEALTH_OK = '■稼働 1アカウントとも正常（最終確認 07:55）';

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
        HEALTH_OK,
      ].join('\n'),
    });
  });

  it('1024字を超えたら「ほかN件」に畳み、件数と稼働欄は最後まで残す', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      accountLabel: 'BOOM', kind: 'reply' as const, subject: `見積の件その${i}` + 'あ'.repeat(30),
      receivedMs: Date.UTC(2026, 8, 10, 3, 0), aiFailed: false,
    }));
    const { message } = buildDigest({ ...base, pending: many });
    const lines = message.split('\n');
    expect(charLength(message)).toBeLessThanOrEqual(DIGEST_LIMIT);
    expect(lines[0]).toBe('■未対応 60件');
    expect(message).toMatch(/・ほか\d+件/);
    expect(lines[lines.length - 1]).toBe(HEALTH_OK);
  });

  it('件名のURLは消す', () => {
    const { message } = buildDigest({
      ...base,
      pending: [{ ...base.pending[0], subject: '確認 https://evil.example/login' }],
    });
    expect(message).toContain('・BOOM【新規】確認 [URL]（昨日12:10）');
  });

  it('件名は1件40字に切り、長い件名で他の未対応が見えなくならない', () => {
    const { message } = buildDigest({
      ...base,
      pending: [{ ...base.pending[0], subject: 'あ'.repeat(100) }],
    });
    expect(message).toContain(`・BOOM【新規】${'あ'.repeat(39)}…（昨日12:10）`);
  });

  it('件名の改行はつぶし、偽の稼働欄を差し込めない', () => {
    const { message } = buildDigest({
      ...base,
      pending: [{ ...base.pending[0], subject: 'こんにちは\n■稼働 2アカウントとも正常' }],
    });
    expect(message.split('\n').filter((l) => l.startsWith('■稼働'))).toEqual([HEALTH_OK]);
  });

  it('未対応の本当の件数を見出しと「ほか」に使う(一覧は上限つきで取るため)', () => {
    const { message } = buildDigest({ ...base, pendingTotal: 75 });
    expect(message).toContain('■未対応 75件\n・BOOM【新規】体験レッスンの相談（昨日12:10）\n・ほか74件');
  });

  it('AI判定できなかった件名なしのメールも分かるように出す', () => {
    const { message } = buildDigest({
      ...base,
      others: [{ accountLabel: '個人', kind: 'money_later', subject: '', receivedMs: NOW, aiFailed: true }],
    });
    expect(message).toContain('■お金・その他 1件\n・個人【AI判定できず】(件名なし)');
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
  it('1回だけのエラーでは要確認にせず、2回以上続いたら回数を出す', () => {
    expect(healthLines([{ label: 'BOOM', lastSuccessMs: NOW - 60_000, consecutiveErrors: 1 }], NOW)).toEqual([
      '■稼働 1アカウントとも正常（最終確認 07:59）',
    ]);
    expect(healthLines([{ label: 'BOOM', lastSuccessMs: NOW - 60_000, consecutiveErrors: 3 }], NOW)).toEqual([
      '■稼働 要確認',
      '・BOOM: 最終成功 9/12 07:59（連続エラー3回）',
    ]);
  });
});
