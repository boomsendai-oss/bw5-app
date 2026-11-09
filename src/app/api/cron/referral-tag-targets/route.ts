import { NextRequest, NextResponse } from 'next/server';
import { getReferralTagTargets } from '@/lib/referralRewardsDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/referral-tag-targets
//
// 体験予約フォームの紹介者(カタカナ)が在籍会員の名簿で1人に決まった予約の、LINE(Lステップ友だちID)一覧。
// 「紹介で体験」タグを付けるジョブ(boom-events-hub scripts/lstep-referral-tag)が読む。読み取り専用。
// 返すのは友だちID・予約ID・紹介者の内部IDだけ。氏名は返さない。名簿で決まらない予約は unmatched(件数とID)。
// ⚠️ withAuth ではなく cron の共有シークレットで認証する。理由: 呼び出し元がGitHub Actions/M1のスクリプト
// (スタッフのログインセッションを持たない)。他の /api/cron/* と同じ方式・未設定なら拒否。
function authorized(req: NextRequest): boolean {
  const secrets = [process.env.REPORT_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (secrets.length === 0) return false;
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { targets, unmatched } = await getReferralTagTargets();
  return NextResponse.json({ ok: true, targets, unmatched_count: unmatched.length, unmatched });
}
