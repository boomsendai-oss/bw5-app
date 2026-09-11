// 受信箱アラート: 1アカウント分の処理。依存(Gmail/DB/AI/Pushover/時計)は注入してテストする。
// 件名・差出人・本文は通知を組み立てる間だけ使い、DBにもログにも残さない。
// 大原則: 通知すべきメールを黙って落とさない・止まったら黙らない。
// runAccount は例外を外に投げない(1アカウントの失敗で、残りのアカウントの処理を止めないため)。
import { todayJst } from '@/lib/dateJst';
import type { AlertAccount } from './accounts';
import type { AiReadMode, ClassifyResult, MailForAi } from './classify';
import { truncateChars } from './format';
import {
  extractBodyText,
  GmailApiError,
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
  /** Pushoverに送れなかった回数(鍵の設定ミスなどに気づくため) */
  pushFailed: number;
  resolved: number;
  aiFailed: number;
  inputTokens: number;
  outputTokens: number;
  complete: boolean;
  error?: string;
};

/** 前回確認時刻から遡って取り直す幅。Gmailの索引遅れや、受信時刻がずれて取り込まれたメールを拾う */
const OVERLAP_SEC = 60 * 60;
const RESOLVE_LIMIT = 20;
const RESEND_LIMIT = 10;
const RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 5分おき×6回=約30分エラーが続いたら知らせる */
export const STALL_THRESHOLD = 6;
/** Vercelに打ち切られてエラーすら記録できない時のため、最後の成功からの時間でも知らせる */
export const STALL_MS = 30 * 60 * 1000;

const STALL_TITLE = (account: AlertAccount) => `【受信箱アラート】${account.label}の監視が止まっています`;
const isoNow = (deps: RunDeps) => new Date(deps.nowMs()).toISOString();

/** 1通のGmail側の一時的な失敗。そのメールだけ次回に回し、新しいメールの処理は続ける */
function isRetryableGmailError(e: unknown): boolean {
  return e instanceof GmailApiError || (e instanceof Error && e.name === 'TimeoutError');
}

export async function runAccount(account: AlertAccount, deps: RunDeps): Promise<RunSummary> {
  const summary: RunSummary = {
    account: account.key, fresh: 0, processed: 0, notified: 0, pushFailed: 0, resolved: 0, aiFailed: 0,
    inputTokens: 0, outputTokens: 0, complete: false,
  };
  const startMs = deps.nowMs();
  if (startMs > deps.deadlineMs) {
    // 前のアカウントで時間を使い切った。何も記録せず次回に回す
    return { ...summary, error: 'skipped: deadline' };
  }
  let state: AlertState | null = null;

  try {
    state = await deps.store.getState(account.key);
    const stallAlerted = state.stallAlerted || (await alertIfStalledByTime(account, state, startMs, deps));

    const token = await deps.gmail.accessToken(account.refreshToken);
    const email = await deps.gmail.profileEmail(token);

    // 通知ありの時は過去分を判定しない(過去30日ぶんを一斉に鳴らさないため)
    const backfillDays = deps.dryRun ? deps.backfillDays : 0;
    const firstRun = state.lastCheckedMs === 0;
    const baseline = firstRun && backfillDays === 0;
    const lookbackSec = firstRun && backfillDays > 0 ? backfillDays * 86_400 : OVERLAP_SEC;
    const fromMs = firstRun ? startMs : state.lastCheckedMs;
    const refs = await deps.gmail.listSince(token, Math.floor(fromMs / 1000) - lookbackSec);

    const known = await deps.store.knownIds(account.key, refs.map((r) => r.id));
    const fresh = refs.filter((r) => !known.has(r.id)).reverse();
    summary.fresh = fresh.length;

    let complete = true;
    let deferredError: unknown = null;
    for (const ref of fresh) {
      if (deps.nowMs() > deps.deadlineMs) {
        complete = false;
        break;
      }
      try {
        const outcome = await processMessage(account, ref, token, email, baseline, deps, summary);
        if (outcome === 'deferred') {
          complete = false;
          break;
        }
      } catch (e) {
        // 一覧を取った後に削除されたメールは飛ばす(次回の一覧にも出てこない)
        if (e instanceof GmailNotFoundError) continue;
        // 1通だけGmail側で失敗しても新しいメールは処理する(前回確認時刻を進めないので、そのメールは次回に再挑戦)
        if (isRetryableGmailError(e)) {
          complete = false;
          deferredError ??= e;
          continue;
        }
        throw e;
      }
    }

    if (complete && !deps.dryRun) {
      // 先に返信済み・アーカイブ済みを閉じてから、送れなかった通知を再送する(返信済みのメールを鳴らさない)
      await bestEffort(summary, () => resolveOpen(account, token, deps, summary));
      await bestEffort(summary, () => resendUnnotified(account, token, email, deps, summary));
    }

    summary.complete = complete;
    if (deferredError) throw deferredError;

    await deps.store.saveSuccess(account.key, complete ? startMs : state.lastCheckedMs, isoNow(deps));
    if (stallAlerted) await deps.store.setStallAlerted(account.key, false);
    if (state.tokenAlertDate) await deps.store.setTokenAlertDate(account.key, '');
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    summary.error = message;
    try {
      const errors = await deps.store.saveError(account.key, message);
      const current = state ?? (await deps.store.getState(account.key));
      if (e instanceof GmailAuthError) {
        const today = todayJst(new Date(deps.nowMs()));
        const sent =
          current.tokenAlertDate !== today &&
          (await safePush(account, {
            title: `【受信箱アラート】${account.label}のGmail連携が切れました`,
            message: 'Claudeに「受信箱アラートの連携が切れた」と伝えてください。Googleに再ログインすれば直ります。',
          }, deps));
        if (sent) await deps.store.setTokenAlertDate(account.key, today);
      } else {
        const sent =
          errors >= STALL_THRESHOLD &&
          !current.stallAlerted &&
          (await safePush(account, {
            title: STALL_TITLE(account),
            message: `約30分エラーが続いています: ${truncateChars(message, 200)}`,
          }, deps));
        if (sent) await deps.store.setStallAlerted(account.key, true);
      }
    } catch (storeError) {
      // DBまで落ちている時は記録も警報もできない(朝のまとめが届かないことで気づく)。例外は外に投げない
      summary.error = `${message} / store: ${storeError instanceof Error ? storeError.message : String(storeError)}`;
    }
    return summary;
  }
}

/** 最後の成功から30分以上たっていたら知らせる。送れた時だけ印をつけ、true を返す */
async function alertIfStalledByTime(account: AlertAccount, state: AlertState, nowMs: number, deps: RunDeps): Promise<boolean> {
  if (!state.lastSuccessAt || state.stallAlerted) return false;
  if (nowMs - Date.parse(state.lastSuccessAt) <= STALL_MS) return false;
  const sent = await safePush(account, {
    title: STALL_TITLE(account),
    message: '30分以上、処理が最後まで終わっていません',
  }, deps);
  if (sent) await deps.store.setStallAlerted(account.key, true);
  return sent;
}

async function processMessage(
  account: AlertAccount,
  ref: MessageRef,
  token: string,
  email: string,
  baseline: boolean,
  deps: RunDeps,
  summary: RunSummary,
): Promise<'done' | 'deferred'> {
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
    return 'done';
  }

  const mode = decideReadMode({ labelIds, headers });
  if (mode === 'count_only') {
    await deps.store.insertItem({ ...common, readMode: mode, tier: 'count', kind: 'other' }, isoNow(deps));
    summary.processed++;
    return 'done';
  }

  // 本文取得・AI判定・通知は時間がかかるので、締め切りを過ぎていたら次回に回す(記録しないので次回また一覧に出る)
  if (deps.nowMs() > deps.deadlineMs) return 'deferred';

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
      summary.pushFailed++;
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
  return 'done';
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
      summary.pushFailed++;
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

/** 再確認と再送は本処理のおまけ。失敗しても新着の記録は済んでいるので、エラーを書き残して続ける */
async function bestEffort(summary: RunSummary, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    summary.error = summary.error ? `${summary.error} / ${message}` : message;
  }
}

/** 警報の送信。ドライラン中は送らない。送れたら true(送れなかった時は印をつけず、次回また判定する) */
async function safePush(account: AlertAccount, msg: PushoverMessage, deps: RunDeps): Promise<boolean> {
  if (deps.dryRun) return false;
  try {
    await deps.push(account.pushoverToken, msg);
    return true;
  } catch {
    return false;
  }
}
