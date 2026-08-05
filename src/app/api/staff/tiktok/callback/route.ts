import { NextRequest, NextResponse } from 'next/server';
import { exchangeAndStoreToken } from '@/lib/tiktok';
import { OAUTH_STATE_COOKIE } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/tiktok/callback?code=XXX
// TikTok連携の同意後コールバック。アクセス/リフレッシュトークンを保存する。
//
// ⚠️ 公開API(認証なし)。理由: **TikTokがリダイレクトで直接叩く**ため管理パスワードを
//   要求できない。code が無ければ何もできず、stateがcookieと一致しないcodeは弾く。
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

  const state = url.searchParams.get('state');
  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!expected || !state || state !== expected) {
    return html(400,
      `<h1>❌ 不正なリクエスト</h1><p>連携リクエストの照合に失敗しました(state不一致)。</p>
       <p><a href="${origin}/staff/instagram">連携状況ページ</a> からやり直してください。</p>`);
  }

  try {
    const { openId } = await exchangeAndStoreToken(code, origin);
    const res = html(200,
      `<h1>✅ TikTok連携 完了！</h1><p>open_id: <code>${openId}</code></p>
       <p><b>注意:</b> アプリの審査が通るまで、投稿は「自分のみ」の公開範囲になります。
       審査が通れば自動的に全体公開に切り替わります。</p>
       <p><a href="${origin}/staff/instagram">→ 連携状況ページに戻る</a></p>`);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return html(500, `<h1>❌ 連携に失敗</h1><pre style="white-space:pre-wrap;">${msg}</pre>`);
  }
}
