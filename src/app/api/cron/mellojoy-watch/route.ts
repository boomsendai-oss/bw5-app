// POST/GET /api/cron/mellojoy-watch — メロジョイ(Mellojoy Japan 公式ストア)の在庫見張り(2026-10-24 TARO依頼)。
// Cloudflare Worker(boom-cron)が毎日 11:56〜12:30 JST に毎分、加えて 12:45 と 13:30 に1回ずつ叩く
// (ストアは毎日12:00に在庫更新・入荷は数秒〜数分で売り切れるため)。
//
// ⚠️ proxy の matcher 外(セッション認証なし)。理由: cron から叩く入口なので、
// 他の cron と同じく CRON_SECRET(GitHub Actions) / CRON_SECRET_CF(Cloudflare Worker) を
// Authorization: Bearer か x-cron-secret で受け取り、一致しなければ 401 で弾く(下の cronAuthorized)。
//
// やること: ストアの公開JSON(products.json)を読み、前回との差分を履歴に残す。
// 入荷(在庫なし→在庫あり)・在庫ありの新商品があれば、Pushover(高優先度)で1通にまとめてTAROのiPhoneへ知らせる。
// ⚠️ 読むだけ。カート投入・購入は一切しない(購入はTAROが通知を見て手で行う)。メールは送らない。
// 取得失敗(ときどきHTMLが返る)は履歴に fetch_error を残すだけで通知しない。
import { NextRequest, NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';
import { runMellojoyWatchLive } from '@/lib/mellojoyWatchRun';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const r = await runMellojoyWatchLive();
    // 取得失敗は軽い失敗なので200のまま返す(Workerのログに ok:false が残る)。
    // 入荷を検知したのに通知できなかった時だけ500(次の分で再通知される)。
    const status = r.ok || r.fetched === 0 ? 200 : 500;
    return NextResponse.json(r, { status });
  } catch (e) {
    console.error(`[mellojoy-watch] 失敗: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ ok: false, error: 'internal error' }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
