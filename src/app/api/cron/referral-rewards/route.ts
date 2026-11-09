import { NextRequest, NextResponse } from 'next/server';
import { getPendingRewards, markReward } from '@/lib/referralRewardsDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET  /api/cron/referral-rewards  … 紹介特典のチケット付与待ち(pending)一覧。氏名は返さない。
// POST /api/cron/referral-rewards  … 付与結果の書き戻し { id, status: 'granted'|'skipped'|'needs_review', ticket_expires_on?, note? }
// 呼び出し元 = M1のスクリプト(boom-events-hub scripts/referral_reward/grant.py)。
// ⚠️ withAuth ではなく cron の共有シークレットで認証する。理由: 呼び出し元がスクリプトで
// スタッフのログインセッションを持たない。他の /api/cron/* と同じ方式・未設定なら拒否。
function authorized(req: NextRequest): boolean {
  const secrets = [process.env.REPORT_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (secrets.length === 0) return false;
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, pending: await getPendingRewards() });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: { id?: number; status?: string; ticket_expires_on?: string | null; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSONが読めません' }, { status: 400 });
  }
  const id = Number(body.id);
  const status = body.status;
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: 'id が不正' }, { status: 400 });
  if (status !== 'granted' && status !== 'skipped' && status !== 'needs_review') {
    return NextResponse.json({ ok: false, error: 'status は granted / skipped / needs_review' }, { status: 400 });
  }
  const exp = body.ticket_expires_on ?? null;
  if (exp !== null && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) return NextResponse.json({ ok: false, error: 'ticket_expires_on は YYYY-MM-DD' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null;
  const updated = await markReward(id, status, exp, note);
  return NextResponse.json({ ok: true, updated });
}
