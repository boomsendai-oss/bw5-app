// POST /api/cron/inbox-alert-digest — 受信箱アラートの朝のまとめ(boom-cron が毎朝8:00に叩き、8:10に予備で再度叩く)。
// JSTの同じ日に送信済みなら何もしない(予備の発火や手動の確認で二重に送らず、翌朝のまとめも消さない)。
// 未対応の件名はGmailから取り直す(DBに件名を持たないため)。Gmailの上限と60秒の上限を守り、少しずつ・締め切りつきで取る。
// まとめは「BOOM」のPushoverアプリから送る(送れなければ他のアカウントのアプリから)。レスポンスに件名・差出人は入れない。
// 認証: x-cron-secret(CRON_SECRET_CF) または Authorization: Bearer(CRON_SECRET)。
import { NextRequest, NextResponse } from 'next/server';
import { todayJst } from '@/lib/dateJst';
import {
  isDryRun,
  loadAccounts,
  loadGmailClient,
  loadPushoverUser,
  missingAccountLabels,
  pushoverTokensInFallbackOrder,
  type AccountKey,
  type AlertAccount,
} from '@/lib/inboxAlert/accounts';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';
import { buildDigest, type DigestItem } from '@/lib/inboxAlert/digest';
import { charLength } from '@/lib/inboxAlert/format';
import { getAccessToken, getMessageMeta, GmailAuthError, headerMap } from '@/lib/inboxAlert/gmail';
import { sendPushover } from '@/lib/inboxAlert/pushover';
import {
  countOpenAll,
  countSince,
  dbStore,
  getLastDigestAt,
  listOpenAll,
  listUndigested,
  markDigested,
  purgeBefore,
  setLastDigestAt,
  type OpenItem,
} from '@/lib/inboxAlert/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const LIST_LIMIT = 60;
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
/** Gmailの1ユーザーあたりの上限(同時接続・毎秒)を守るための、件名取り直しの同時数 */
const SUBJECT_CONCURRENCY = 5;
/** 件名の取り直しに使ってよい時間(送信とDB書き込みの時間を残す) */
const SUBJECT_BUDGET_MS = 25_000;
const SUBJECT_UNAVAILABLE = '(件名を取得できませんでした)';

/** 同時に limit 件までだけ走らせて、順番どおりの結果を返す */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const client = loadGmailClient();
  const pushoverUser = loadPushoverUser();
  const accounts = loadAccounts();
  if (!client || !pushoverUser || accounts.length === 0) {
    // 設定が欠けている時は、ログで異常として見えるよう 503 にする
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        missing: missingAccountLabels(),
        missingShared: [client ? null : 'GMAIL_ALERT_CLIENT', pushoverUser ? null : 'PUSHOVER_USER_KEY'].filter(Boolean),
      },
      { status: 503 },
    );
  }

  const dryRun = isDryRun();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const lastDigestAt = await getLastDigestAt();
  if (!dryRun && lastDigestAt && todayJst(new Date(lastDigestAt)) === todayJst(new Date(nowMs))) {
    return NextResponse.json({ ok: true, skipped: 'sent today' });
  }
  const since = lastDigestAt ?? new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  const byKey = new Map<AccountKey, AlertAccount>(accounts.map((a) => [a.key, a]));
  const tokens = new Map<AccountKey, Promise<string>>();
  const subjectDeadline = nowMs + SUBJECT_BUDGET_MS;
  const fetched = new Set<string>();
  const itemKey = (item: OpenItem) => `${item.account}/${item.messageId}`;

  const tokenFor = (account: AlertAccount): Promise<string> => {
    let token = tokens.get(account.key);
    if (!token) {
      token = getAccessToken(client, account.refreshToken);
      tokens.set(account.key, token);
    }
    return token;
  };

  const toDigestItem = async (item: OpenItem): Promise<DigestItem> => {
    const account = byKey.get(item.account);
    const base = {
      accountLabel: account?.label ?? item.account,
      kind: item.kind,
      receivedMs: item.receivedMs,
      aiFailed: item.aiFailed,
    };
    if (!account || Date.now() >= subjectDeadline) return { ...base, subject: SUBJECT_UNAVAILABLE };

    let token: string;
    try {
      token = await tokenFor(account);
    } catch (e) {
      // 一時的な失敗なら次の件で取り直す(連携切れは何度試しても同じなので覚えたままにする)
      if (!(e instanceof GmailAuthError)) tokens.delete(account.key);
      return { ...base, subject: SUBJECT_UNAVAILABLE };
    }
    if (Date.now() >= subjectDeadline) return { ...base, subject: SUBJECT_UNAVAILABLE };

    try {
      const meta = await getMessageMeta(token, item.messageId);
      fetched.add(itemKey(item));
      return { ...base, subject: headerMap(meta.payload)['subject'] || '(件名なし)' };
    } catch {
      // 削除済み・一時的な失敗でも、まとめ自体は送る
      return { ...base, subject: SUBJECT_UNAVAILABLE };
    }
  };

  const [open, pendingTotal, undigested, counts] = await Promise.all([
    listOpenAll(LIST_LIMIT),
    countOpenAll(),
    listUndigested(LIST_LIMIT),
    countSince(since),
  ]);
  const pending = await mapLimit(open, SUBJECT_CONCURRENCY, toDigestItem);
  const later = await mapLimit(undigested, SUBJECT_CONCURRENCY, toDigestItem);
  const states = await Promise.all(accounts.map(async (a) => ({ account: a, state: await dbStore.getState(a.key) })));
  const health = states.map(({ account: a, state: s }) => ({
    label: a.label,
    lastSuccessMs: s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : null,
    consecutiveErrors: s.consecutiveErrors,
    pushFailing: Boolean(s.pushFailedAt),
  }));

  const digest = buildDigest({
    nowMs,
    pending,
    pendingTotal,
    failures: later.filter((i) => i.kind === 'automation_failure'),
    others: later.filter((i) => i.kind !== 'automation_failure'),
    counts,
    health,
    missing: missingAccountLabels(),
  });
  const subjectFailed = open.length + undigested.length - fetched.size;

  // まとめを届けたPushoverの鍵の持ち主(BOOM以外の鍵で届いた時は pushFallback=true)。鍵そのものはレスポンスに出さない
  let sentVia: AccountKey | null = null;
  let pushFallback = false;
  if (!dryRun) {
    // BOOMの鍵から順に試す(1つの鍵が壊れていても、まとめ自体は届ける)。全部だめなら例外で500にし、8:10の予備に任せる
    const tokens = pushoverTokensInFallbackOrder(accounts);
    let lastError: unknown = new Error('pushover: 試す鍵がありません');
    let usedToken: string | null = null;
    for (const token of tokens) {
      try {
        await sendPushover(token, pushoverUser, digest);
        usedToken = token;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (usedToken === null) throw lastError;
    // 送れたら真っ先に印をつける(この後の書き込みで落ちても、8:10の予備で同じまとめを二重に送らない)
    await setLastDigestAt(nowIso);
    const owner =
      accounts.find((a) => a.key === 'boom' && a.pushoverToken === usedToken) ??
      accounts.find((a) => a.pushoverToken === usedToken);
    sentVia = owner?.key ?? null;
    pushFallback = usedToken !== tokens[0];
    // 自分の鍵でまとめを届けられたアカウントは、送信失敗の印を消す(一時的な失敗で「要確認」が毎朝残り続けないため)
    for (const { account: a, state: s } of states) {
      if (a.pushoverToken !== usedToken || !s.pushFailedAt) continue;
      try {
        await dbStore.setPushFailedAt(a.key, '');
      } catch {
        // 消せなくても、次に自分の鍵で通知を送れた回に消える。まとめは届いているので失敗にしない
      }
    }
    // 件名を取れなかった分は「まとめに載せた」扱いにせず、翌朝もう一度載せる
    await markDigested(undigested.filter((it) => fetched.has(itemKey(it))), nowIso);
    try {
      await purgeBefore(new Date(nowMs - RETENTION_MS).toISOString());
    } catch {
      // 古い行の削除は翌朝やり直せばよい
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    sent: !dryRun,
    sentVia,
    pushFallback,
    pending: pending.length,
    later: later.length,
    subjectFailed,
    chars: charLength(digest.message),
  });
}
