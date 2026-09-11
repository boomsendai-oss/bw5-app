import { describe, it, expect } from 'vitest';
import {
  loadAccounts,
  missingAccountLabels,
  loadGmailClient,
  loadPushoverUser,
  isDryRun,
  backfillDays,
} from '../inboxAlert/accounts';

describe('loadAccounts / missingAccountLabels', () => {
  const env = {
    GMAIL_ALERT_REFRESH_TOKEN_TARO: 'rt-taro',
    PUSHOVER_TOKEN_TARO: 'po-taro',
    GMAIL_ALERT_REFRESH_TOKEN_BOOM: 'rt-boom',
    PUSHOVER_TOKEN_BOOM: 'po-boom',
    GMAIL_ALERT_REFRESH_TOKEN_NITROASH: 'rt-na',
  };

  it('鍵とPushoverトークンが両方あるアカウントだけを定義順に返す', () => {
    const accounts = loadAccounts(env);
    expect(accounts.map((a) => a.key)).toEqual(['boom', 'taro']);
    expect(accounts[0]).toEqual({ key: 'boom', label: 'BOOM', refreshToken: 'rt-boom', pushoverToken: 'po-boom' });
    expect(accounts[1].label).toBe('個人');
  });

  it('片方でも欠けているアカウントは未設定として表示名を返す', () => {
    expect(missingAccountLabels(env)).toEqual(['NITRO ASH']);
    expect(missingAccountLabels({ PUSHOVER_TOKEN_BOOM: 'po' })).toEqual(['BOOM', 'NITRO ASH', '個人']);
  });

  it('何も設定が無ければ監視対象は空', () => {
    expect(loadAccounts({})).toEqual([]);
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
  it('過去分の判定日数はドライラン中だけ 0〜30 に丸めて返す', () => {
    const dry = { INBOX_ALERT_DRY_RUN: '1' };
    expect(backfillDays(dry)).toBe(0);
    expect(backfillDays({ ...dry, INBOX_ALERT_BACKFILL_DAYS: 'abc' })).toBe(0);
    expect(backfillDays({ ...dry, INBOX_ALERT_BACKFILL_DAYS: '-1' })).toBe(0);
    expect(backfillDays({ ...dry, INBOX_ALERT_BACKFILL_DAYS: '7.9' })).toBe(7);
    expect(backfillDays({ ...dry, INBOX_ALERT_BACKFILL_DAYS: '30' })).toBe(30);
    expect(backfillDays({ ...dry, INBOX_ALERT_BACKFILL_DAYS: '45' })).toBe(30);
  });
  it('ドライランでなければ過去分は判定しない', () => {
    expect(backfillDays({ INBOX_ALERT_BACKFILL_DAYS: '30' })).toBe(0);
  });
});
