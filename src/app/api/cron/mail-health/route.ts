// POST/GET /api/cron/mail-health — メール送信(Gmail SMTP)の毎朝の健康診断。
// Cloudflare Worker(boom-cron)が毎朝 07:30 JST に叩く。
//
// ⚠️ proxy の matcher 外(セッション認証なし)。理由: cron から叩く入口なので、
// 他の cron と同じく CRON_SECRET(GitHub Actions) / CRON_SECRET_CF(Cloudflare Worker) を
// Authorization: Bearer か x-cron-secret で受け取り、一致しなければ 401 で弾く(下の cronAuthorized)。
//
// やること: SMTPにログインできるかだけ確かめる(メールは送らない)。
// ダメなら notifyTaro(Pushover優先)で「アプリパスワードが無効の可能性 → after_google_password_change.sh」を知らせる。
// 背景: 2026-10-16 のGoogleパスワード変更でアプリのメールが全部止まり、誰も気づけなかった。
// レスポンスとログに秘密は出さない(エラーは nodemailer の応答文のみ)。
import { NextRequest, NextResponse } from 'next/server';
import { verifyMailTransport } from '@/lib/email';
import { notifyTaro } from '@/lib/notify';
import { runMailHealth } from '@/lib/mailHealth';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const r = await runMailHealth({ verify: () => verifyMailTransport(), notify: (o) => notifyTaro(o) });
  if (r.ok) return NextResponse.json({ ok: true });
  console.error(`[mail-health] SMTPログイン失敗: ${r.error}${r.notified ? '' : ` / 通知も失敗: ${r.notifyError}`}`);
  // 失敗は500で返す(Workerのログで一目で分かるように)
  return NextResponse.json(
    { ok: false, error: r.error, notified: r.notified, ...(r.notifyError ? { notifyError: r.notifyError } : {}) },
    { status: 500 },
  );
}

export const POST = handle;
export const GET = handle;
