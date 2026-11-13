import { NextRequest, NextResponse } from 'next/server';
import { exchangeAndStoreToken } from '@/lib/threads';
import { OAUTH_STATE_COOKIE } from '@/lib/googleCalendar';
import { isAuthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/threads/callback?code=XXX
// Threads連携の同意後コールバック。長期トークン(+期限)とThreadsユーザーIDを保存する。
//
// 認証: スタッフのログイン(cookie staff_events_auth)が必要(2026-11-13〜)。
//   Metaはブラウザのリダイレクト(トップレベルのGET)でここへ戻すので、SameSite=Lax の
//   ログインcookieはそのまま届く = 連携ボタンを押したスタッフ本人のブラウザならそのまま通る。
//   /api/staff/* は proxy.ts でcookieの有無だけ見ているので、セッションの有効性はここで確かめる。
//   加えて state を cookie と照合する(CSRF対策・Instagramのcallbackと同型)。
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

  if (!(await isAuthorized(req))) {
    return html(
      401,
      `<h1>❌ ログインが必要です</h1>
       <p>スタッフ画面にログインしてから、<a href="${origin}/staff/instagram">連携状況ページ</a>の「Threadsを連携する」をやり直してください。</p>`
    );
  }
  if (error) return html(400, `<h1>❌ 連携エラー</h1><p>${error}</p>`);
  if (!code) return html(400, '<h1>❌ code がありません</h1>');

  const state = url.searchParams.get('state');
  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!expected || !state || state !== expected) {
    return html(
      400,
      `<h1>❌ 不正なリクエスト</h1>
       <p>連携リクエストの照合に失敗しました(state不一致)。</p>
       <p>お手数ですが <a href="${origin}/staff/instagram">連携状況ページ</a> から最初からやり直してください。</p>`
    );
  }

  try {
    const { userId } = await exchangeAndStoreToken(code, origin);
    const okRes = html(
      200,
      `<h1>✅ Threads連携 完了！</h1>
       <p>ThreadsユーザーID: <code>${userId}</code></p>
       <p><a href="${origin}/staff/instagram">→ 連携状況ページに戻る</a></p>`
    );
    okRes.cookies.delete(OAUTH_STATE_COOKIE);
    return okRes;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return html(500, `<h1>❌ 連携に失敗</h1><pre style="white-space:pre-wrap;">${msg}</pre>`);
  }
}
