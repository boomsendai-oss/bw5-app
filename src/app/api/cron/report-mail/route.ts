import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { formatKeikoMail, isEmptyBody } from '@/lib/reportMail';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/cron/report-mail
//
// boom-events-hub 側で生成されたレポート本文を受け取り、TARO本人へメールする配信口。
// 現在の利用者は KEIKO向け日次共有:
//   クラウドルーティン(毎朝) が STATE.md の前日ログを KEIKO が読める日本語に直して
//   docs/reports/daily/YYYY-MM-DD.md へ commit
//     → GH Actions `daily-keiko-digest.yml` が push 検知で本文をここへPOST
//       → TAROにメール → TAROが中身を見てLINEへコピペ(送るまでもなければ無視)
//
// 送信先はTARO本人(boom.sendai@gmail.com)固定。**リクエストで宛先を指定させない**
// (任意の宛先に送れる口はスパム踏み台になるため)。
//
// 認証: x-cron-secret / Bearer が REPORT_SECRET または CRON_SECRET と一致。未設定なら拒否。
const TARO_EMAIL = 'boom.sendai@gmail.com';
const MAX_BODY_CHARS = 20000;

function authorized(req: NextRequest): boolean {
  const secrets = [process.env.REPORT_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (secrets.length === 0) return false;
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const kind = String(payload.kind ?? '');
  const date = String(payload.date ?? '');
  const bodyRaw = typeof payload.body === 'string' ? payload.body : '';

  if (kind !== 'daily-keiko') {
    return NextResponse.json({ error: `unsupported kind: ${kind}` }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (bodyRaw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: 'body too long' }, { status: 400 });
  }
  // 沈黙=何も無かった日。空の共有を毎朝送ると本当に読んでほしい日まで埋もれる
  // (FAQ日次ダイジェストと同じ運用方針・TARO要望2026-07-27)。
  if (isEmptyBody(bodyRaw)) {
    return NextResponse.json({ ok: true, sent: false, skipped: 'empty-body' });
  }

  const mail = formatKeikoMail(date, bodyRaw);
  try {
    await sendEmail({ to: TARO_EMAIL, subject: mail.subject, text: mail.text });
  } catch (e) {
    console.error('[cron/report-mail]', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `send failed: ${msg}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sent: true, subject: mail.subject });
}
