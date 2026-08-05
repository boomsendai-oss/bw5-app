import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { selectPage } from '@/lib/facebookPage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/facebook/select?page_id=XXX
// 投稿先のFacebookページを確定する。連携直後の選択画面(callback)のリンクから叩かれる。
// GETで状態が変わるが、これは一度きりのセットアップ導線で、管理パスワード必須(proxy+isAuthorized)。
// 押し間違えても同じ画面から選び直せるので実害はない。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const pageId = new URL(req.url).searchParams.get('page_id');
  if (!pageId) return NextResponse.json({ error: 'page_id required' }, { status: 400 });
  try {
    const page = await selectPage(pageId);
    return new NextResponse(
      `<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:32px;line-height:1.7;">
       <h1>✅ 投稿先を設定しました</h1><p><b>${page.name}</b></p>
       <p><a href="${new URL(req.url).origin}/staff/instagram">→ 連携状況ページに戻る</a></p></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
