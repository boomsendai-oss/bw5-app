// GET/POST /api/cron/gift-tshirt-order-sheet — 入会特典Tシャツの発注表(週1回)。
// GitHub Actions(.github/workflows/gift-tshirt-order-sheet.yml)が毎週叩き、Markdownの表をジョブのまとめに出す。
// 台帳の「回答済み・未発注」を 品番(United Athle 5001-01 / キッズ 5001-02)×色×サイズ で数えるだけ。
// 読み取りのみ。Amazonでの購入・台帳の「発注済み」への書き換えはしない。名前は返さない(台帳IDだけ)。
//
// ⚠️ proxy の matcher 外(セッション認証なし)。理由: cron から叩く入口なので、
// 他の cron と同じく CRON_SECRET / CRON_SECRET_CF を Authorization: Bearer か x-cron-secret で受け取り、
// 一致しなければ 401 で弾く(cronAuthorized)。鍵の設定が無ければ全部 401。
import { NextRequest, NextResponse } from 'next/server';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';
import { getGiftTshirtOrderSheet, isMissingTableError } from '@/lib/giftTshirtDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await getGiftTshirtOrderSheet());
  } catch (e) {
    if (isMissingTableError(e)) {
      return NextResponse.json({ ok: true, skipped: 'table_missing', note: 'gift_tshirt_claims が未作成(マイグレーション未適用)' });
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
