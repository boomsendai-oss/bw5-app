import { NextRequest, NextResponse } from 'next/server';
import { exchangeAndStoreToken, ensureBlockCalendar, OAUTH_STATE_COOKIE } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/google/calendar-callback?code=XXX
// Googleカレンダー連携の同意後コールバック。refresh_token を保存し、
// 所有カレンダー(休講ブロック)を作成してIDを表示する。
//
// ※認証パスワードは付けない (Googleがリダイレクトで叩くため)。
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
  const error = url.searchParams.get('error');
  const origin = url.origin;

  if (error) return html(400, `<h1>❌ 連携エラー</h1><p>${error}</p>`);
  if (!code) return html(400, '<h1>❌ code がありません</h1>');

  // M20: 発行元(calendar-connect)が仕込んだstateと一致するcodeだけ受け付ける。
  // これが無いと、攻撃者が自分のGoogleアカウントで取ったcodeのURLをTAROに踏ませるだけで
  // BOOMのカレンダー連携先を攻撃者のアカウントにすり替えられる。
  const state = url.searchParams.get('state');
  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!expected || !state || state !== expected) {
    return html(
      400,
      `<h1>❌ 不正なリクエスト</h1>
       <p>連携リクエストの照合に失敗しました(state不一致)。</p>
       <p>お手数ですが <a href="${origin}/staff/schedule/sync">カレンダー連携ハブ</a> から最初からやり直してください。</p>`
    );
  }

  try {
    await exchangeAndStoreToken(code, origin);
    const calendarId = await ensureBlockCalendar();
    const okRes = html(
      200,
      `<h1>✅ Googleカレンダー連携 完了！</h1>
       <p>休講ブロック用の<b>所有カレンダー</b>を作成しました。</p>
       <p>このカレンダーIDをLstepの連携設定に貼り付けます👇</p>
       <p style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;font-family:monospace;word-break:break-all;font-size:13px;">${calendarId}</p>
       <p>このIDは <a href="${origin}/staff/schedule/sync">カレンダー連携ハブ</a> でもいつでも確認できます。</p>
       <p><a href="${origin}/staff/schedule/sync">→ カレンダー連携ハブに戻る</a></p>`
    );
    // stateは使い捨て(同じstateでの再送を防ぐ)
    okRes.cookies.delete(OAUTH_STATE_COOKIE);
    return okRes;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return html(500, `<h1>❌ 連携に失敗</h1><pre style="white-space:pre-wrap;">${msg}</pre>`);
  }
}
