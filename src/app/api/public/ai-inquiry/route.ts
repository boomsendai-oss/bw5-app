// ⚠️ 公開API(認証なし)。boom-sendai.com/ai の相談フォーム専用。
// 防御: CORSで boom-sendai.com のみ許可 / IPごと 1時間5件 / ハニーポット / 各項目をサーバ側で切り詰め。
// 保存はせずメール通知のみ（PIIをDBに残さない）。
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, clientIp } from '@/lib/eventAuth';
import { sendEmail } from '@/lib/email';
import { validateInquiry, buildInquiryMail } from '@/lib/aiInquiry';

const ALLOWED_ORIGINS = new Set(['https://boom-sendai.com', 'https://boom-hp.pages.dev', 'http://localhost:3000', 'http://localhost:3999']);
const TO = 'boom.sendai@gmail.com';

function cors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return ALLOWED_ORIGINS.has(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      }
    : {};
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

export async function POST(req: NextRequest) {
  const headers = cors(req);
  const ip = clientIp(req);
  if (!(await checkRateLimit(`aiinq:${ip}`, 5, 3600))) {
    return NextResponse.json({ ok: false, error: 'rate' }, { status: 429, headers });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'json' }, { status: 400, headers });
  }
  const v = validateInquiry(body);
  // ボットには成功を返して黙らせる
  if (!v.ok && v.error === 'spam') return NextResponse.json({ ok: true }, { headers });
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400, headers });
  const mail = buildInquiryMail(v.data, ip);
  try {
    await sendEmail({ to: TO, subject: mail.subject, text: mail.text });
  } catch (e) {
    console.error('[ai-inquiry] send failed', e);
    return NextResponse.json({ ok: false, error: 'send' }, { status: 500, headers });
  }
  return NextResponse.json({ ok: true }, { headers });
}
