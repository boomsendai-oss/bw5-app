import { NextRequest, NextResponse } from 'next/server';
import { exchangeAndStoreToken } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/instagram/callback?code=XXX
// Instagram連携の同意後コールバック。長期トークン+IGアカウントIDを保存する。
//
// ※認証パスワードは付けない (Facebookがリダイレクトで叩くため)。
//   code が無ければ何もできないので実害なし。
function html(status: number, body: string) {
  return new NextResponse(
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
     <body style="font-family:sans-serif;padding:32px;max-width:640px;margin:auto;line-height:1.7;">${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  const origin = url.origin;

  if (error) return html(400, `<h1>❌ 連携エラー</h1><p>${error}</p>`);
  if (!code) return html(400, '<h1>❌ code がありません</h1>');

  try {
    const { igUserId } = await exchangeAndStoreToken(code, origin);
    return html(
      200,
      `<h1>✅ Instagram連携 完了！</h1>
       <p>InstagramビジネスアカウントID: <code>${igUserId}</code></p>
       <p><a href="${origin}/staff/instagram">→ 連携状況ページに戻る</a></p>`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return html(500, `<h1>❌ 連携に失敗</h1><pre style="white-space:pre-wrap;">${msg}</pre>`);
  }
}
