import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { listPages, connectionStatus } from '@/lib/facebookPage';
import { getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/facebook/pages
// 連携後に「どのページが見えているか」を確認・選び直すための一覧。
// 連携時にページが1つも見つからなかったときの原因調査にも使う。
export const GET = withAuth(async (_req: NextRequest) => {
  const row = await getOne('SELECT value FROM settings WHERE key = ?', ['facebook_user_token']);
  const userToken = (row?.value as string | undefined) || '';
  if (!userToken) {
    return NextResponse.json({ error: 'Facebook未連携です' }, { status: 400 });
  }
  const pages = await listPages(userToken);
  return NextResponse.json({
    ...(await connectionStatus()),
    // トークンそのものは返さない(画面やログに漏らさないため)
    pages: pages.map((p) => ({ id: p.id, name: p.name })),
  });
});
