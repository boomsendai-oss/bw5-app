import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken } from '@/lib/base';

export const dynamic = 'force-dynamic';

// GET /api/base-callback?code=XXX — BASE OAuth コールバック
// code を受け取って access_token / refresh_token を保存
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px;">
        <h1>❌ BASE 連携エラー</h1>
        <p>${error}</p>
      </body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  if (!code) {
    return new NextResponse(
      '<html><body style="font-family:sans-serif;padding:40px;"><h1>❌ code がありません</h1></body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  try {
    await exchangeCodeForToken(code);
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px;text-align:center;">
        <h1>✅ BASE 連携完了！</h1>
        <p>access_token を保存しました。</p>
        <p>BW5アプリの物販ページで BASE 商品が表示されるようになります。</p>
        <p><a href="https://bw5-app.vercel.app/admin">管理画面に戻る</a></p>
      </body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px;">
        <h1>❌ token 取得に失敗</h1>
        <pre>${msg}</pre>
      </body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
