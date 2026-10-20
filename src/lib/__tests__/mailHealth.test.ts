import { describe, it, expect, vi } from 'vitest';
import { runMailHealth, mailHealthBody, MAIL_HEALTH_SUBJECT } from '../mailHealth';

describe('runMailHealth', () => {
  it('SMTPにログインできれば通知しない', async () => {
    const notify = vi.fn(async () => {});
    expect(await runMailHealth({ verify: async () => ({ ok: true }), notify })).toEqual({ ok: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it('ログインできなければ、対処(スクリプト名)入りで通知する', async () => {
    const notify = vi.fn<(o: { subjectPrefix: string; subject: string; body: string }) => Promise<void>>(async () => {});
    const r = await runMailHealth({ verify: async () => ({ ok: false, error: '535 Invalid login' }), notify });
    expect(r).toEqual({ ok: false, error: '535 Invalid login', notified: true });
    const arg = notify.mock.calls[0][0];
    expect(arg.subject).toBe(MAIL_HEALTH_SUBJECT);
    expect(arg.subject).toContain('アプリパスワード');
    expect(arg.body).toContain('bash scripts/after_google_password_change.sh');
    expect(arg.body).toContain('535 Invalid login');
  });

  it('通知まで失敗しても throw せず、結果に残す', async () => {
    const r = await runMailHealth({
      verify: async () => ({ ok: false, error: 'GMAIL_APP_PASSWORD が未設定です' }),
      notify: async () => { throw new Error('全経路失敗'); },
    });
    expect(r).toEqual({ ok: false, error: 'GMAIL_APP_PASSWORD が未設定です', notified: false, notifyError: '全経路失敗' });
  });

  it('本文にエラーと対処が入る', () => {
    expect(mailHealthBody('x')).toMatch(/エラー: x[\s\S]*after_google_password_change\.sh/);
  });
});
