// POST /api/cron/inbox-alert — 受信箱アラートの本処理(Cloudflare Worker boom-cron が5分おきに叩く)。
// 認証: x-cron-secret(CRON_SECRET_CF) または Authorization: Bearer(CRON_SECRET)。
// レスポンスは件数だけ(件名・差出人は返さない。Workerのログに残るため)。
import { NextRequest, NextResponse } from 'next/server';
import {
  backfillDays,
  isDryRun,
  loadAccounts,
  loadGmailClient,
  loadPushoverUser,
  missingAccountLabels,
} from '@/lib/inboxAlert/accounts';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';
import { buildLiveDeps } from '@/lib/inboxAlert/live';
import { runAccount, type RunSummary } from '@/lib/inboxAlert/run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 新しいメールの処理を始めてよい時間(run.ts は本文を取る前にも締め切りを確かめる)。
 * それでも通信が上限まで待ち続けてVercelに打ち切られた時は、run.ts が「最後の成功から30分」で止まっていることを知らせる
 */
const BUDGET_MS = 20_000;

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const client = loadGmailClient();
  const pushoverUser = loadPushoverUser();
  const accounts = loadAccounts();
  const missing = missingAccountLabels();
  if (!client || !pushoverUser || accounts.length === 0) {
    // 共通の鍵が無い時は朝のまとめも送れない。ログで異常として見えるよう 503 にする
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        missing,
        missingShared: [client ? null : 'GMAIL_ALERT_CLIENT', pushoverUser ? null : 'PUSHOVER_USER_KEY'].filter(Boolean),
      },
      { status: 503 },
    );
  }

  const deps = buildLiveDeps({
    client,
    pushoverUser,
    deadlineMs: Date.now() + BUDGET_MS,
    dryRun: isDryRun(),
    backfillDays: backfillDays(),
  });

  // 過去分の判定中に1アカウントが時間を使い切っても他が止まらないよう、5分ごとに先頭を入れ替える
  const offset = Math.floor(Date.now() / 300_000) % accounts.length;
  const ordered = [...accounts.slice(offset), ...accounts.slice(0, offset)];

  const results: RunSummary[] = [];
  for (const account of ordered) {
    try {
      results.push(await runAccount(account, deps));
    } catch (e) {
      // runAccount は例外を投げない作りだが、万一でも残りのアカウントの処理を止めない
      results.push({
        account: account.key, fresh: 0, processed: 0, notified: 0, pushFailed: 0, resolved: 0,
        aiFailed: 0, inputTokens: 0, outputTokens: 0, complete: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return NextResponse.json({
    ok: true,
    dryRun: deps.dryRun,
    // Workerのログは先頭約300字しか残らないので、エラーの要約を先に置く
    errors: results.filter((r) => r.error).map((r) => `${r.account}: ${(r.error ?? '').slice(0, 80)}`),
    missing,
    results,
  });
}
