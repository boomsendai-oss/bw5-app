// 受信箱アラート: 本番用の依存(Gmail API / Turso / Claude / Pushover)を組み立てる。
import type { GmailClient } from './accounts';
import { classifyMail } from './classify';
import {
  getAccessToken,
  getMessageFull,
  getMessageMeta,
  getProfileEmail,
  getThreadMessages,
  listMessageRefsSince,
} from './gmail';
import { sendPushover } from './pushover';
import type { RunDeps } from './run';
import { dbStore } from './store';

export function buildLiveDeps(opts: {
  client: GmailClient;
  pushoverUser: string;
  /** 全アカウントのPushoverの鍵(BOOMを先頭)。自分の鍵で送れなかった時に順に試す */
  fallbackTokens: string[];
  deadlineMs: number;
  dryRun: boolean;
  backfillDays: number;
}): RunDeps {
  return {
    gmail: {
      accessToken: (refreshToken) => getAccessToken(opts.client, refreshToken),
      profileEmail: (token) => getProfileEmail(token),
      listSince: (token, afterSec) => listMessageRefsSince(token, afterSec),
      meta: (token, id) => getMessageMeta(token, id),
      full: (token, id) => getMessageFull(token, id),
      thread: (token, threadId) => getThreadMessages(token, threadId),
    },
    store: dbStore,
    classify: (mail, mode) => classifyMail(mail, mode),
    push: (appToken, msg) => sendPushover(appToken, opts.pushoverUser, msg),
    fallbackTokens: opts.fallbackTokens,
    nowMs: () => Date.now(),
    deadlineMs: opts.deadlineMs,
    dryRun: opts.dryRun,
    backfillDays: opts.backfillDays,
  };
}
