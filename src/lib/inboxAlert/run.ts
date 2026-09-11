// 受信箱アラート: 1アカウント分の処理。依存(Gmail/DB/AI/Pushover/時計)は注入してテストする。
// 件名・差出人・本文は通知を組み立てる間だけ使い、DBにもログにも残さない。
import { todayJst } from '@/lib/dateJst';
import type { AlertAccount } from './accounts';
import type { AiReadMode, ClassifyResult, MailForAi } from './classify';
import { truncateChars } from './format';
import {
  extractBodyText,
  GmailAuthError,
  GmailNotFoundError,
  headerMap,
  threadResolution,
  type GmailMessage,
  type MessageRef,
} from './gmail';
import { decideReadMode } from './prefilter';
import { buildNowMessage, gmailLink, type PushoverMessage } from './pushover';
import type { AlertState, AlertStore } from './store';

export type GmailPort = {
  accessToken(refreshToken: string): Promise<string>;
  profileEmail(token: string): Promise<string>;
  listSince(token: string, afterSec: number): Promise<MessageRef[]>;
  meta(token: string, id: string): Promise<GmailMessage>;
  full(token: string, id: string): Promise<GmailMessage>;
  thread(token: string, threadId: string): Promise<GmailMessage[] | null>;
};

export type RunDeps = {
  gmail: GmailPort;
  store: AlertStore;
  classify: (mail: MailForAi, mode: AiReadMode) => Promise<ClassifyResult>;
  push: (appToken: string, msg: PushoverMessage) => Promise<void>;
  nowMs: () => number;
  /** この時刻を過ぎたら新しいメールの処理を始めない */
  deadlineMs: number;
  dryRun: boolean;
  backfillDays: number;
};

export type RunSummary = {
  account: string;
  fresh: number;
  processed: number;
  notified: number;
  resolved: number;
  aiFailed: number;
  inputTokens: number;
  outputTokens: number;
  complete: boolean;
  error?: string;
};

const OVERLAP_SEC = 600;
const RESOLVE_LIMIT = 20;
const RESEND_LIMIT = 10;
const RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 5分おき×6回=約30分エラーが続いたら知らせる */
export const STALL_THRESHOLD = 6;

const isoNow = (deps: RunDeps) => new Date(deps.nowMs()).toISOString();

export async function runAccount(account: AlertAccount, deps: RunDeps): Promise<RunSummary> {
  const summary: RunSummary = {
    account: account.key, fresh: 0, processed: 0, notified: 0, resolved: 0, aiFailed: 0,
    inputTokens: 0, outputTokens: 0, complete: false,
  };
  const startMs = deps.nowMs();
  let state: AlertState | null = null;

  try {
    state = await deps.store.getState(account.key);
    const token = await deps.gmail.accessToken(account.refreshToken);
    const email = await deps.gmail.profileEmail(token);

    const firstRun = state.lastCheckedMs === 0;
    const baseline = firstRun && deps.backfillDays === 0;
    const lookbackSec = firstRun && deps.backfillDays > 0 ? deps.backfillDays * 86_400 : OVERLAP_SEC;
    const fromMs = firstRun ? startMs : state.lastCheckedMs;
    const refs = await deps.gmail.listSince(token, Math.floor(fromMs / 1000) - lookbackSec);

    const known = await deps.store.knownIds(account.key, refs.map((r) => r.id));
    const fresh = refs.filter((r) => !known.has(r.id)).reverse();
    summary.fresh = fresh.length;

    let complete = true;
    for (const ref of fresh) {
      if (deps.nowMs() > deps.deadlineMs) {
        complete = false;
        break;
      }
      try {
        await processMessage(account, ref, token, email, baseline, deps, summary);
      } catch (e) {
        // 一覧を取った後に削除されたメールは飛ばす(次回の一覧にも出てこない)
        if (!(e instanceof GmailNotFoundError)) throw e;
      }
    }

    if (complete && !deps.dryRun) {
      await resendUnnotified(account, token, email, deps, summary);
      await resolveOpen(account, token, deps, summary);
    }

    summary.complete = complete;
    await deps.store.saveSuccess(account.key, complete ? startMs : state.lastCheckedMs, isoNow(deps));
    if (state.stallAlerted) await deps.store.setStallAlerted(account.key, false);
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    summary.error = message;
    const errors = await deps.store.saveError(account.key, message);
    const current = state ?? (await deps.store.getState(account.key));

    if (e instanceof GmailAuthError) {
      const today = todayJst(new Date(deps.nowMs()));
      if (current.tokenAlertDate !== today) {
        await safePush(account, {
          title: `【受信箱アラート】${account.label}のGmail連携が切れました`,
          message: 'Claudeに「受信箱アラートの連携が切れた」と伝えてください。Googleに再ログインすれば直ります。',
        }, deps);
        await deps.store.setTokenAlertDate(account.key, today);
      }
    } else if (errors >= STALL_THRESHOLD && !current.stallAlerted) {
      await safePush(account, {
        title: `【受信箱アラート】${account.label}の監視が止まっています`,
        message: `約30分エラーが続いています: ${truncateChars(message, 200)}`,
      }, deps);
      await deps.store.setStallAlerted(account.key, true);
    }
    return summary;
  }
}

async function processMessage(
  account: AlertAccount,
  ref: MessageRef,
  token: string,
  email: string,
  baseline: boolean,
  deps: RunDeps,
  summary: RunSummary,
): Promise<void> {
  const meta = await deps.gmail.meta(token, ref.id);
  const headers = headerMap(meta.payload);
  const labelIds = meta.labelIds ?? [];
  const common = {
    account: account.key,
    messageId: ref.id,
    threadId: ref.threadId,
    receivedMs: Number(meta.internalDate ?? 0),
    inInbox: labelIds.includes('INBOX'),
    dryRun: deps.dryRun,
    aiFailed: false,
    inputTokens: 0,
    outputTokens: 0,
    notified: false,
  };

  if (baseline) {
    await deps.store.insertItem({ ...common, readMode: 'baseline', tier: 'count', kind: 'other' }, isoNow(deps));
    summary.processed++;
    return;
  }

  const mode = decideReadMode({ labelIds, headers });
  if (mode === 'count_only') {
    await deps.store.insertItem({ ...common, readMode: mode, tier: 'count', kind: 'other' }, isoNow(deps));
    summary.processed++;
    return;
  }

  const full = await deps.gmail.full(token, ref.id);
  const subject = headers['subject'] ?? '';
  const from = headers['from'] ?? '';
  const result = await deps.classify(
    { accountLabel: account.label, from, subject, receivedIso: new Date(common.receivedMs).toISOString(), body: extractBodyText(full) },
    mode,
  );
  summary.inputTokens += result.inputTokens;
  summary.outputTokens += result.outputTokens;
  if (result.aiFailed) summary.aiFailed++;

  let notified = false;
  if (result.tier === 'now' && !deps.dryRun) {
    try {
      await deps.push(
        account.pushoverToken,
        buildNowMessage({
          subject,
          from,
          summary: result.summary,
          kind: result.kind,
          aiFailed: result.aiFailed,
          link: gmailLink(email, ref.threadId),
          receivedMs: common.receivedMs,
        }),
      );
      notified = true;
      summary.notified++;
    } catch {
      // 送れなかった通知は notified_at を空で残し、次回に再送する
    }
  }

  await deps.store.insertItem(
    {
      ...common,
      readMode: mode,
      tier: result.tier,
      kind: result.kind,
      aiFailed: result.aiFailed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      notified,
    },
    isoNow(deps),
  );
  summary.processed++;
}

async function resendUnnotified(account: AlertAccount, token: string, email: string, deps: RunDeps, summary: RunSummary): Promise<void> {
  const since = new Date(deps.nowMs() - RESEND_WINDOW_MS).toISOString();
  const items = await deps.store.listUnnotified(account.key, since, RESEND_LIMIT);
  for (const item of items) {
    if (deps.nowMs() > deps.deadlineMs) return;
    let meta: GmailMessage;
    try {
      meta = await deps.gmail.meta(token, item.messageId);
    } catch (e) {
      if (!(e instanceof GmailNotFoundError)) throw e;
      // 通知を送れないまま削除されたメールは、未対応から外す
      await deps.store.markResolved(account.key, item.messageId, 'archived', isoNow(deps));
      summary.resolved++;
      continue;
    }
    const h = headerMap(meta.payload);
    try {
      await deps.push(
        account.pushoverToken,
        buildNowMessage({
          subject: h['subject'] ?? '',
          from: h['from'] ?? '',
          summary: '',
          kind: item.kind,
          aiFailed: item.aiFailed,
          link: gmailLink(email, item.threadId),
          receivedMs: item.receivedMs,
        }),
      );
    } catch {
      return;
    }
    await deps.store.markNotified(account.key, item.messageId, isoNow(deps));
    summary.notified++;
  }
}

async function resolveOpen(account: AlertAccount, token: string, deps: RunDeps, summary: RunSummary): Promise<void> {
  const open = await deps.store.listOpen(account.key, RESOLVE_LIMIT);
  for (const item of open) {
    if (deps.nowMs() > deps.deadlineMs) return;
    const reason = threadResolution(await deps.gmail.thread(token, item.threadId), item.messageId, item.inInbox);
    if (reason) {
      await deps.store.markResolved(account.key, item.messageId, reason, isoNow(deps));
      summary.resolved++;
    }
  }
}

/** 警報の送信。ドライラン中は送らない。送信失敗で本処理を止めない */
async function safePush(account: AlertAccount, msg: PushoverMessage, deps: RunDeps): Promise<void> {
  if (deps.dryRun) return;
  try {
    await deps.push(account.pushoverToken, msg);
  } catch {
    // 警報が送れなくても、次の失敗時にまた判定する
  }
}
