import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getOrCreateIcsExportToken } from '@/lib/scheduleExport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/schedule/export/token
// ICS購読URL用のトークンを返す (無ければ生成)。管理画面のエクスポートUIから呼ぶ。
// 認証: isAuthorized (管理パスワード)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const token = await getOrCreateIcsExportToken();
  return NextResponse.json({ token });
}
