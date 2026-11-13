// POST/GET /api/cron/gift-tshirt-scan — 入会特典Tシャツの該当者さがし(毎日)。
// GitHub Actions(.github/workflows/gift-tshirt-scan.yml)が毎朝叩く。
// 11/1以降に特典つきで月謝プラン入会した会員を台帳 gift_tshirt_claims に「未案内」で足すだけ。
// お客さんへの送信(公式LINEの案内)はしない。返すのは数だけ(名前は返さない)。
//
// ⚠️ proxy の matcher 外(セッション認証なし)。理由: cron から叩く入口なので、
// 他の cron と同じく CRON_SECRET / CRON_SECRET_CF を Authorization: Bearer か x-cron-secret で受け取り、
// 一致しなければ 401 で弾く(cronAuthorized)。鍵の設定が無ければ全部 401。
import { NextRequest, NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';
import { runGiftTshirtScan, isMissingTableError } from '@/lib/giftTshirtDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runGiftTshirtScan());
  } catch (e) {
    // 台帳のマイグレーションは秘書の確認後に本番へ適用する。それまでは「未適用」と返して赤にしない
    if (isMissingTableError(e)) {
      return NextResponse.json({ ok: true, skipped: 'table_missing', note: 'gift_tshirt_claims が未作成(マイグレーション未適用)' });
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
