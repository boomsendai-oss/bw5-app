import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { gbpConfigured, getGbpAccessToken, putGbpReply } from '@/lib/gbp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/gbp-reviews/[id]/approve - 編集後ドラフトをGBPに投稿
// 返信の自動投稿は必ず人間の承認後 (このエンドポイントはスタッフ操作からのみ叩かれる)
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (!comment) {
    return NextResponse.json({ error: '返信本文(comment)が空です' }, { status: 400 });
  }
  if (!gbpConfigured()) {
    return NextResponse.json({ error: 'GBP APIが未設定です (アクセス承認待ち)' }, { status: 503 });
  }
  const row = await getOne(`SELECT review_id, status FROM gbp_reviews WHERE review_id=?`, [id]);
  if (!row) return NextResponse.json({ error: 'クチコミが見つかりません' }, { status: 404 });

  const token = await getGbpAccessToken();
  await putGbpReply(token, id, comment);

  await execute(
    `UPDATE gbp_reviews SET status='posted', reply_comment=?, posted_at=datetime('now'), draft=? WHERE review_id=?`,
    [comment, comment, id]
  );
  return NextResponse.json({ ok: true });
}
