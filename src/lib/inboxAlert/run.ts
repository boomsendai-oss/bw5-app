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
import { buildNowMessage, gmailLink, PushoverError, type PushoverMessage } from './pushover';
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
  /** 全アカウントのPushoverの鍵(BOOMを先頭)。自分の鍵で送れなかった時に順に試す(自分の鍵は飛ばす) */
  fallbackTokens: string[];
  /**
   * 1回のcron呼び出しの中で「鍵ごと使えない」失敗をした鍵(全アカウントで共有)。その呼び出しの間は試さない
   * (Pushoverが固まっても、1つの鍵で待つのは呼び出しあたり1度だけにする)
   */
  badTokens: Set<string>;
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
  /** 自分のPushoverの鍵で送れなかった回数(鍵の設定ミスなどに気づくため) */
  pushFailed: number;
  /** 自分の鍵で送れず、他のアカウントの鍵で代わりに届けた回数(notified にも含む) */
  pushFallback: number;
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

/** own = 自分の鍵で届いた / fallback = 他のアカウントの鍵で届いた / failed = どの鍵でも届かなかった */
type PushOutcome = 'own' | 'fallback' | 'failed';
/** この回の通知の送信(自分の鍵で送れたか・送れなかったかを数えながら送る) */
type Deliver = (msg: PushoverMessage) => Promise<PushOutcome>;
/** この回に自分の鍵で1回でも送れた・送れなかったか(push_failed_at の記録用) */
type OwnPush = { ok: boolean; failed: boolean };

/** 1通のGmail側の一時的な失敗。そのメールだけ次回に回し、新しいメールの処理は続ける */
function isRetryableGmailError(e: unknown): boolean {
  return e instanceof GmailApiError || (e instanceof Error && e.name === 'TimeoutError');
}

export async function runAccount(account: AlertAccount, deps: RunDeps): Promise<RunSummary> {
  const summary: RunSummary = {
    account: account.key, fresh: 0, processed: 0, notified: 0, pushFailed: 0, pushFallback: 0, resolved: 0, aiFailed: 0,
    inputTokens: 0, outputTokens: 0, complete: false,
  };
  const startMs = deps.nowMs();
  if (startMs > deps.deadlineMs) {
    // 前のアカウントで時間を使い切った。何も記録せず次回に回す
    return { ...summary, error: 'skipped: deadline' };
  }
  let state: AlertState | null = null;
  // この回に「止まっています」を送った・既に送ってあるか(時間と回数の両方で二重に送らないため)
  let stallAlerted = false;
  const ownPush: OwnPush = { ok: false, failed: false };
  const deliver: Deliver = async (msg) => {
    const outcome = await pushWithFallback(account, msg, deps);
    if (outcome === 'own') {
      ownPush.ok = true;
    } else {
      ownPush.failed = true;
      summary.pushFailed++;
    }
    if (outcome === 'fallback') summary.pushFallback++;
    return outcome;
  };

  try {
    state = await deps.store.getState(account.key);
    stallAlerted = state.stallAlerted || (await alertIfStalledByTime(account, state, startMs, deps, deliver));

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

    let outOfTime = false;
    let deferredError: unknown = null;
    for (const ref of fresh) {
      if (deps.nowMs() > deps.deadlineMs) {
        outOfTime = true;
        break;
      }
      try {
        const outcome = await processMessage(account, ref, token, email, baseline, deps, summary, deliver);
        if (outcome === 'deferred') {
          outOfTime = true;
          break;
        }
      } catch (e) {
        // 一覧を取った後に削除されたメールは飛ばす(次回の一覧にも出てこない)
        if (e instanceof GmailNotFoundError) continue;
        // 1通だけGmail側で失敗しても新しいメールは処理する(前回確認時刻を進めないので、そのメールは次回に再挑戦)
        if (isRetryableGmailError(e)) {
          deferredError ??= e;
          continue;
        }
        throw e;
      }
    }
    const complete = !outOfTime && !deferredError;

    // 時間が残っていれば、1通の失敗があっても再確認と再送は行う(返信済みを閉じ、送れなかった通知を届ける)
    if (!outOfTime && !deps.dryRun) {
      // 先に返信済み・アーカイブ済みを閉じてから、送れなかった通知を再送する(返信済みのメールを鳴らさない)
      await bestEffort(summary, () => resolveOpen(account, token, deps, summary));
      await bestEffort(summary, () => resendUnnotified(account, token, email, deps, summary, deliver));
    }

    summary.complete = complete;
    if (deferredError) throw deferredError;

    await deps.store.saveSuccess(account.key, complete ? startMs : state.lastCheckedMs, isoNow(deps));
    if (stallAlerted) await deps.store.setStallAlerted(account.key, false);
    if (state.tokenAlertDate) await deps.store.setTokenAlertDate(account.key, '');
    const prevPushFailedAt = state.pushFailedAt;
    await bestEffort(summary, () => recordPushHealth(account, prevPushFailedAt, ownPush, deps));
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    summary.error = message;
    let current: AlertState | null = state;
    try {
      const errors = await deps.store.saveError(account.key, message);
      current ??= await deps.store.getState(account.key);
      if (e instanceof GmailAuthError) {
        const today = todayJst(new Date(deps.nowMs()));
        const sent =
          current.tokenAlertDate !== today &&
          (await safePush({
            title: `【受信箱アラート】${account.label}のGmail連携が切れました`,
            message: 'Claudeに「受信箱アラートの連携が切れた」と伝えてください。Googleに再ログインすれば直ります。',
          }, deps, deliver));
        if (sent) await deps.store.setTokenAlertDate(account.key, today);
      } else {
        const sent =
          errors >= STALL_THRESHOLD &&
          !current.stallAlerted &&
          !stallAlerted &&
          (await safePush({
            title: STALL_TITLE(account),
            message: `約30分エラーが続いています: ${truncateChars(message, 200)}`,
          }, deps, deliver));
        if (sent) await deps.store.setStallAlerted(account.key, true);
      }
    } catch (storeError) {
      // DBまで落ちている時は記録も警報もできない(朝のまとめが届かないことで気づく)。例外は外に投げない
      summary.error = `${message} / store: ${storeError instanceof Error ? storeError.message : String(storeError)}`;
    }
    try {
      // エラーの回でも、それまでに送った通知・警報で鍵が失敗していれば記録する
      await recordPushHealth(account, current?.pushFailedAt ?? '', ownPush, deps);
    } catch {
      // 記録できなくても次の回にまた記録する。例外は外に投げない
    }
    return summary;
  }
}

/** 最後の成功から30分以上たっていたら知らせる。送れた時だけ印をつけ、true を返す */
async function alertIfStalledByTime(
  account: AlertAccount,
  state: AlertState,
  nowMs: number,
  deps: RunDeps,
  deliver: Deliver,
): Promise<boolean> {
  if (!state.lastSuccessAt || state.stallAlerted) return false;
  if (nowMs - Date.parse(state.lastSuccessAt) <= STALL_MS) return false;
  const sent = await safePush({
    title: STALL_TITLE(account),
    message: '30分以上、処理が最後まで終わっていません',
  }, deps, deliver);
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
  deliver: Deliver,
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
    const outcome = await deliver(
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
    // どの鍵でも送れなかった通知は notified_at を空で残し、次回に再送する
    if (outcome !== 'failed') {
      notified = true;
      summary.notified++;
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

async function resendUnnotified(
  account: AlertAccount,
  token: string,
  email: string,
  deps: RunDeps,
  summary: RunSummary,
  deliver: Deliver,
): Promise<void> {
  const since = new Date(deps.nowMs() - RESEND_WINDOW_MS).toISOString();
  const items = await deps.store.listUnnotified(account.key, since, RESEND_LIMIT);
  for (const item of items) {
    if (deps.nowMs() > deps.deadlineMs) return;
    let meta: GmailMessage;
    try {
      meta = await deps.gmail.meta(token, item.messageId);
    } catch (e) {
      // 1件だけGmail側で失敗しても、残りの再送は続ける
      if (isRetryableGmailError(e)) continue;
      if (!(e instanceof GmailNotFoundError)) throw e;
      // 通知を送れないまま削除されたメールは、未対応から外す
      await deps.store.markResolved(account.key, item.messageId, 'archived', isoNow(deps));
      summary.resolved++;
      continue;
    }
    const h = headerMap(meta.payload);
    const outcome = await deliver(
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
    if (outcome === 'failed') {
      // 全部の鍵が「鍵ごと使えない」なら、残りも送れないので次回に回す(Pushoverを呼ばずに済ませる)
      if (allTokensBad(account, deps)) return;
      // このメール1通だけがどの鍵でも受け付けられなかった(鍵と関係ない4xx)。後ろのメールは送り続ける
      continue;
    }
    await deps.store.markNotified(account.key, item.messageId, isoNow(deps));
    summary.notified++;
  }
}

async function resolveOpen(account: AlertAccount, token: string, deps: RunDeps, summary: RunSummary): Promise<void> {
  const open = await deps.store.listOpen(account.key, RESOLVE_LIMIT);
  for (const item of open) {
    if (deps.nowMs() > deps.deadlineMs) return;
    let messages: GmailMessage[] | null;
    try {
      messages = await deps.gmail.thread(token, item.threadId);
    } catch (e) {
      // 1件のスレッドだけGmail側で失敗しても、残りの再確認は続ける
      if (isRetryableGmailError(e)) continue;
      throw e;
    }
    const reason = threadResolution(messages, item.messageId, { inInbox: item.inInbox, notified: item.notified });
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

/** 警報の送信。ドライラン中は送らない。届いたら true(他の鍵で届いた時も含む。届かなかった時は印をつけず、次回また判定する) */
async function safePush(msg: PushoverMessage, deps: RunDeps, deliver: Deliver): Promise<boolean> {
  if (deps.dryRun) return false;
  return (await deliver(msg)) !== 'failed';
}

/**
 * 通知の送信。まず自分のアカウントの鍵で送り、だめなら他のアカウントの鍵(BOOMを先頭)で順に試す。
 * 1つの鍵の設定ミスで、そのアカウントの通知も「止まっています」の警報も黙って届かなくなるのを防ぐ。
 * 他の鍵で送る時は、どのアカウントのメールか分かるよう件名の頭に〔表示名〕をつける。例外は投げない。
 * このcron呼び出しで「鍵ごと使えない」失敗をした鍵(deps.badTokens・他のアカウントの回で見つかった分も)は試さない
 * (自分の鍵を飛ばした時も「自分の鍵で送れなかった」扱い)。全部の鍵が失敗済みなら、Pushoverを呼ばずに 'failed' を返す。
 * そのメール1通だけの失敗(鍵と関係ない4xx)では鍵を失敗済みにせず、このメールだけ他の鍵で試す
 */
async function pushWithFallback(account: AlertAccount, msg: PushoverMessage, deps: RunDeps): Promise<PushOutcome> {
  if (!deps.badTokens.has(account.pushoverToken)) {
    try {
      await deps.push(account.pushoverToken, msg);
      return 'own';
    } catch (e) {
      // 自分の鍵で送れなかった。他のアカウントの鍵で試す
      if (isTokenLevelFailure(e)) deps.badTokens.add(account.pushoverToken);
    }
  }
  const fallbackMsg: PushoverMessage = { ...msg, title: truncateChars(`〔${account.label}〕${msg.title}`, 250) };
  for (const token of new Set(deps.fallbackTokens)) {
    if (token === account.pushoverToken || deps.badTokens.has(token)) continue;
    try {
      await deps.push(token, fallbackMsg);
      return 'fallback';
    } catch (e) {
      if (isTokenLevelFailure(e)) deps.badTokens.add(token);
    }
  }
  return 'failed';
}

/** 自分の鍵も他のアカウントの鍵も、このcron呼び出しで全部「鍵ごと使えない」になったか */
function allTokensBad(account: AlertAccount, deps: RunDeps): boolean {
  return [account.pushoverToken, ...deps.fallbackTokens].every((t) => deps.badTokens.has(t));
}

/** 鍵ごと使えない失敗か。種類の分からない例外は、固まった鍵を待ち続けないよう鍵ごと使えない扱いにする */
function isTokenLevelFailure(e: unknown): boolean {
  return !(e instanceof PushoverError) || e.tokenLevel;
}

/**
 * この回に自分の鍵で送れなかったら時刻を記録し、送れたら記録を消す(朝のまとめで鍵の壊れに気づくため)。
 * 同じ回に送れた時と送れなかった時の両方があれば、失敗を残す
 */
async function recordPushHealth(account: AlertAccount, prevPushFailedAt: string, ownPush: OwnPush, deps: RunDeps): Promise<void> {
  if (ownPush.failed) {
    await deps.store.setPushFailedAt(account.key, isoNow(deps));
  } else if (ownPush.ok && prevPushFailedAt) {
    await deps.store.setPushFailedAt(account.key, '');
  }
}
