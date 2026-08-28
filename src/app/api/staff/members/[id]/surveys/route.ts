// 会員詳細ダイアログ用: この会員に紐付いたアンケート回答履歴(スタッフ専用)。
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { listMemberSurveyAnswers } from '@/lib/surveyDb';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  return NextResponse.json({ answers: await listMemberSurveyAnswers(id) });
}
