import { NextRequest, NextResponse } from 'next/server';
import { exchangeAndListPages } from '@/lib/facebookPage';
import { OAUTH_STATE_COOKIE } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/facebook/callback?code=XXX
// Facebook連携の同意後コールバック。ページ一覧を取得し、1つなら確定・複数なら選ばせる。
//
// ⚠️ 公開API(認証なし)。理由: **Facebookがリダイレクトで直接叩く**ため管理パスワードを
//   要求できない。code が無ければ何もできず、stateがcookieと一致しないcodeは弾く。
function html(status: number, body: string) {
  return new NextResponse(
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
     <body style="font-family:sans-serif;padding:32px;max-width:640px;margin:auto;line-height:1.7;">${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  const origin = url.origin;

  if (error) return html(400, `<h1>❌ 連携エラー</h1><p>${esc(error)}</p>`);
  if (!code) return html(400, '<h1>❌ code がありません</h1>');

  const state = url.searchParams.get('state');
  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!expected || !state || state !== expected) {
    return html(400,
      `<h1>❌ 不正なリクエスト</h1><p>連携リクエストの照合に失敗しました(state不一致)。</p>
       <p><a href="${origin}/staff/instagram">連携状況ページ</a> からやり直してください。</p>`);
  }

  try {
    const pages = await exchangeAndListPages(code, origin);
    // ページが1つなら exchangeAndListPages 側で確定済み
    const body = pages.length === 1
      ? `<h1>✅ Facebookページ連携 完了！</h1>
         <p>投稿先: <b>${esc(pages[0].name)}</b>（ID: <code>${esc(pages[0].id)}</code>）</p>`
      : `<h1>投稿先のページを選んでください</h1>
         <p>複数のページを管理しています。<b>リールの投稿先を1つ選んでください。</b></p>
         <ul>${pages.map((p) =>
            `<li style="margin:12px 0"><a href="${origin}/api/staff/facebook/select?page_id=${encodeURIComponent(p.id)}"
              style="font-size:17px">${esc(p.name)}</a></li>`).join('')}</ul>`;
    const res = html(200, `${body}<p><a href="${origin}/staff/instagram">→ 連携状況ページに戻る</a></p>`);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return html(500, `<h1>❌ 連携に失敗</h1><pre style="white-space:pre-wrap;">${esc(msg)}</pre>`);
  }
}
