// POST /api/cron/inbox-alert-digest — 受信箱アラートの朝のまとめ(boom-cron が毎朝8:00に叩き、8:10に予備で再度叩く)。
// 20時間以内に送信済みなら何もしない(予備の発火で二重に送らないため)。
// 未対応の件名はGmailから取り直す(DBに件名を持たないため)。まとめは「BOOM」のPushoverアプリから送る。
import { NextRequest, NextResponse } from 'next/server';
import {
  isDryRun,
  loadAccounts,
  loadGmailClient,
  loadPushoverUser,
  missingAccountLabels,
  type AccountKey,
  type AlertAccount,
} from '@/lib/inboxAlert/accounts';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';
import { buildDigest, type DigestItem } from '@/lib/inboxAlert/digest';
import { charLength } from '@/lib/inboxAlert/format';
import { getAccessToken, getMessageMeta, headerMap } from '@/lib/inboxAlert/gmail';
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
const SENT_RECENTLY_MS = 20 * 60 * 60 * 1000;
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const client = loadGmailClient();
  const pushoverUser = loadPushoverUser();
  const accounts = loadAccounts();
  if (!client || !pushoverUser || accounts.length === 0) {
    return NextResponse.json({
      ok: true,
      configured: false,
      missingShared: [client ? null : 'GMAIL_ALERT_CLIENT', pushoverUser ? null : 'PUSHOVER_USER_KEY'].filter(Boolean),
    });
  }

  const dryRun = isDryRun();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const lastDigestAt = await getLastDigestAt();
  if (!dryRun && lastDigestAt && nowMs - Date.parse(lastDigestAt) < SENT_RECENTLY_MS) {
    return NextResponse.json({ ok: true, skipped: 'sent recently' });
  }
  const since = lastDigestAt ?? new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  const byKey = new Map<AccountKey, AlertAccount>(accounts.map((a) => [a.key, a]));
  const tokens = new Map<AccountKey, Promise<string>>();

  const toDigestItem = async (item: OpenItem): Promise<DigestItem> => {
    const account = byKey.get(item.account);
    let subject = '(件名を取得できませんでした)';
    if (account) {
      try {
        if (!tokens.has(item.account)) tokens.set(item.account, getAccessToken(client, account.refreshToken));
        const token = await tokens.get(item.account)!;
        subject = headerMap((await getMessageMeta(token, item.messageId)).payload)['subject'] || '(件名なし)';
      } catch {
        // 連携切れ・削除済みでも、まとめ自体は送る
      }
    }
    return {
      accountLabel: account?.label ?? item.account,
      kind: item.kind,
      subject,
      receivedMs: item.receivedMs,
      aiFailed: item.aiFailed,
    };
  };

  const [open, pendingTotal, undigested, counts] = await Promise.all([
    listOpenAll(LIST_LIMIT),
    countOpenAll(),
    listUndigested(LIST_LIMIT),
    countSince(since),
  ]);
  const pending = await Promise.all(open.map(toDigestItem));
  const later = await Promise.all(undigested.map(toDigestItem));
  const health = await Promise.all(
    accounts.map(async (a) => {
      const s = await dbStore.getState(a.key);
      return {
        label: a.label,
        lastSuccessMs: s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : null,
        consecutiveErrors: s.consecutiveErrors,
      };
    }),
  );

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

  if (!dryRun) {
    const sender = byKey.get('boom') ?? accounts[0];
    await sendPushover(sender.pushoverToken, pushoverUser, digest);
    await markDigested(undigested, nowIso);
    await setLastDigestAt(nowIso);
    await purgeBefore(new Date(nowMs - RETENTION_MS).toISOString());
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    sent: !dryRun,
    pending: pending.length,
    later: later.length,
    chars: charLength(digest.message),
  });
}
