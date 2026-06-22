import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// ダウンロード期限（Vimeo 終了）
const DEADLINE_LABEL = '2026年6月25日(水)';
// 映像ページ(Vimeo showcase)。パスワードは6/5の案内メールに記載のものを利用してもらう(本メールには載せない)
const VIDEO_URL = 'https://vimeo.com/showcase/12263534';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(buyerName: string): string {
  const name = escapeHtml(buyerName || 'お客').trim();
  return `
<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
  <div style="background: linear-gradient(135deg, #f97316, #ea580c); color: #fff; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 20px;">⏰ ダウンロード期限のお知らせ</h1>
  </div>
  <div style="padding: 24px; line-height: 1.8;">
    <p>${name} 様</p>
    <p>BW5 映像データをご購入いただき、誠にありがとうございます。</p>
    <p>ダウンロード期間は <strong style="color:#ea580c;">${DEADLINE_LABEL}まで</strong> となっております。<br />
    <strong>期限を過ぎるとダウンロードができなくなり、再配布・再販売も行っておりません。</strong></p>
    <p>まだお手元に保存されていない方は、<strong>今のうちに、すべてのデータをダウンロードして保存</strong>しておくことを強くおすすめします。</p>

    <div style="text-align:center; margin: 24px 0;">
      <a href="${VIDEO_URL}" style="display:inline-block; background:#ea580c; color:#fff; padding:14px 36px; border-radius:8px; text-decoration:none; font-weight:bold; font-size:16px;" target="_blank">▶ 映像ページを開く</a>
      <div style="font-size:12px; color:#999; word-break:break-all; margin-top:8px;">${VIDEO_URL}</div>
    </div>

    <p style="font-size:14px; color:#555;">
      ページを開くと<strong>視聴パスワード</strong>を聞かれます。<br />
      パスワードは、<strong>6月5日にお送りした「視聴・ダウンロードのご案内」メール</strong>に記載のものをご入力ください。<br />
      各動画の<strong>右下のダウンロードボタン</strong>から保存できます（画質を選べます）。
    </p>
    <p style="font-size:13px; color:#777;">
      メールが見当たらない場合や、ダウンロードがうまくいかない場合は、お早めに本メールにご返信いただくか、BOOM公式LINEへご連絡ください。
    </p>
    <hr style="margin: 28px 0; border: none; border-top: 1px solid #eee;" />
    <p style="font-size: 12px; color: #888; line-height: 1.7;">
      ご不明な点は本メールにご返信いただくか、<a href="mailto:boom.sendai@gmail.com">boom.sendai@gmail.com</a> までご連絡ください。<br />
      BOOM Dance School / BOOM WOP vol.5
    </p>
  </div>
</div>`.trim();
}

const SUBJECT = `【${DEADLINE_LABEL}まで】BW5映像データ ダウンロード期限のお知らせ`;

type Buyer = { buyer_name: string; email: string };

/**
 * POST /api/staff/video-preorders/send-download-deadline
 *   決済済み(status='paid')の予約者へ、ダウンロード期限(6/25)のリマインドメールを送る。
 *
 *   body:
 *     { }                       → ドライラン: 送信せず対象件数とプレビューだけ返す
 *     { testTo: "x@y.com" }     → テスト送信: 指定1件だけに送る(本番配信しない)
 *     { confirm: true }         → 本送信: 決済済み全員(メール重複除外)に送る
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));

  // 決済済みの一意メール宛先を作る (同一メール重複を除外)
  const rows = (await getAll(
    `SELECT buyer_name, email FROM video_preorders
     WHERE status = 'paid' AND email IS NOT NULL AND TRIM(email) <> ''
     ORDER BY created_at`
  )) as Buyer[];
  const byEmail = new Map<string, Buyer>();
  for (const r of rows) {
    const key = r.email.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { buyer_name: r.buyer_name, email: r.email.trim() });
  }
  const recipients = [...byEmail.values()];

  // テスト送信
  if (body.testTo) {
    await sendEmail({ to: String(body.testTo), subject: `[テスト] ${SUBJECT}`, html: buildHtml('テスト 太郎') });
    return NextResponse.json({ ok: true, mode: 'test', sent_to: body.testTo, would_send_count: recipients.length });
  }

  // ドライラン (デフォルト)
  if (body.confirm !== true) {
    return NextResponse.json({
      ok: true,
      mode: 'dry_run',
      recipient_count: recipients.length,
      subject: SUBJECT,
      sample_names: recipients.slice(0, 3).map((r) => r.buyer_name),
    });
  }

  // 本送信
  const results: { email: string; status: 'sent' | 'failed'; reason?: string }[] = [];
  for (const r of recipients) {
    try {
      await sendEmail({ to: r.email, subject: SUBJECT, html: buildHtml(r.buyer_name) });
      results.push({ email: r.email, status: 'sent' });
    } catch (e) {
      results.push({ email: r.email, status: 'failed', reason: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((res) => setTimeout(res, 400)); // Gmail SMTP レート緩和
  }
  const sent = results.filter((r) => r.status === 'sent').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  return NextResponse.json({ ok: true, mode: 'send', total: recipients.length, sent, failed, results });
}
