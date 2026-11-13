import { NextRequest, NextResponse } from 'next/server';
import { configured as threadsConfigured, ensureFreshToken } from '@/lib/threads';
import { REFRESH_WITHIN_DAYS } from '@/lib/threadsToken';
import { LEGACY_ORIGIN } from '@/lib/appOrigin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/cron/threads-token-refresh
// Threadsの長期トークン(60日)を、期限の15日前を過ぎたら自動で延長する(2026-11-13〜)。
// GitHub Actions(threads-token-refresh.yml)から毎日1回叩く。
//
// 背景: 延長関数はあったがどこからも呼ばれておらず、2026-10-04に失効してThreads転載が止まった。
// 切れた鍵は延長できず、再連携(Metaへのログイン)しか直し方が無い。だから「切れる前に毎日見る」。
//
// 返す ok:
//   ok:true  … 延長した / まだ期限まで余裕がある / Threads env未設定(dormant)
//   ok:false … 期限切れ・延長失敗・未連携(env設定済みなのに鍵が無い)。ワークフローが赤くなる
//              (黙って止まらない。再連携が要るときは reconnectUrl を返す)
//
// ⚠️ 認証: withAuthではなくCRON_SECRET(fail-closed)。GH Actionsから叩くため(threads-autopostと同パターン)
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return req.headers.get('x-cron-secret') === secret;
}

// Metaに登録してあるリダイレクトURIは旧住所(bw5-app.vercel.app)なので、連携はこの住所から始める
const RECONNECT_URL = `${LEGACY_ORIGIN}/api/staff/threads/connect`;

async function run(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!threadsConfigured()) {
    return NextResponse.json({ ok: true, status: 'dormant', note: 'Threads env未設定のためスキップ' });
  }

  const r = await ensureFreshToken();
  if (r.state === 'not_connected') {
    return NextResponse.json({
      ok: false,
      status: 'not_connected',
      error: 'Threadsの鍵がDBにありません(未連携)。再連携してください',
      reconnectUrl: RECONNECT_URL,
    });
  }
  if (r.state === 'failed') {
    return NextResponse.json({
      ok: false,
      status: r.needsReconnect ? 'needs_reconnect' : 'refresh_failed',
      error: r.reason,
      expiresAt: r.expiresAt ?? null,
      daysLeft: r.daysLeft ?? null,
      // 一時的な失敗なら翌日の実行で再試行される(期限まで15日あるので数日の失敗では切れない)
      ...(r.needsReconnect ? { reconnectUrl: RECONNECT_URL } : {}),
    });
  }
  // 延長したのに期限が近いまま / 期限が近いのに延長できなかった(発行24時間以内など)も赤にする
  const tooClose = r.daysLeft < REFRESH_WITHIN_DAYS;
  return NextResponse.json({
    ok: !tooClose,
    status: r.refreshed ? 'refreshed' : 'fresh',
    expiresAt: r.expiresAt,
    daysLeft: r.daysLeft,
    ...(tooClose ? { error: `期限まで${r.daysLeft}日しかありません(延長できていません)` } : {}),
  });
}

export const POST = run;
export const GET = run;
