import { describe, it, expect } from 'vitest';
import { loadAccounts, loadGmailClient, loadPushoverUser, isDryRun, backfillDays } from '../inboxAlert/accounts';

describe('loadAccounts', () => {
  it('鍵とPushoverトークンが両方あるアカウントだけを定義順に返す', () => {
    const env = {
      GMAIL_ALERT_REFRESH_TOKEN_TARO: 'rt-taro',
      PUSHOVER_TOKEN_TARO: 'po-taro',
      GMAIL_ALERT_REFRESH_TOKEN_BOOM: 'rt-boom',
      PUSHOVER_TOKEN_BOOM: 'po-boom',
      GMAIL_ALERT_REFRESH_TOKEN_NITROASH: 'rt-na',
    };
    const accounts = loadAccounts(env);
    expect(accounts.map((a) => a.key)).toEqual(['boom', 'taro']);
    expect(accounts[0]).toEqual({ key: 'boom', label: 'BOOM', refreshToken: 'rt-boom', pushoverToken: 'po-boom' });
    expect(accounts[1].label).toBe('個人');
  });
});

describe('設定の読み込み', () => {
  it('OAuthクライアントは2つそろった時だけ返す', () => {
    expect(loadGmailClient({ GMAIL_ALERT_CLIENT_ID: 'id' })).toBeNull();
    expect(loadGmailClient({ GMAIL_ALERT_CLIENT_ID: 'id', GMAIL_ALERT_CLIENT_SECRET: 's' })).toEqual({ clientId: 'id', clientSecret: 's' });
  });
  it('Pushoverのユーザーキー', () => {
    expect(loadPushoverUser({})).toBeNull();
    expect(loadPushoverUser({ PUSHOVER_USER_KEY: 'u' })).toBe('u');
  });
  it('ドライランは 1 の時だけ', () => {
    expect(isDryRun({ INBOX_ALERT_DRY_RUN: '1' })).toBe(true);
    expect(isDryRun({ INBOX_ALERT_DRY_RUN: 'true' })).toBe(false);
    expect(isDryRun({})).toBe(false);
  });
  it('過去分の判定日数は 0〜30 に丸める', () => {
    expect(backfillDays({})).toBe(0);
    expect(backfillDays({ INBOX_ALERT_BACKFILL_DAYS: 'abc' })).toBe(0);
    expect(backfillDays({ INBOX_ALERT_BACKFILL_DAYS: '30' })).toBe(30);
    expect(backfillDays({ INBOX_ALERT_BACKFILL_DAYS: '45' })).toBe(30);
  });
});
