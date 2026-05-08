import { NextResponse } from 'next/server';
import { buildAuthorizeUrl } from '@/lib/base';

export const dynamic = 'force-dynamic';

// GET /api/base-auth — BASE のOAuth認可ページにリダイレクト
// 管理者がブラウザで一度この URL を踏むだけでトークン取得が完了する
export async function GET() {
  const url = buildAuthorizeUrl();
  return NextResponse.redirect(url);
}
