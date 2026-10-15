// ⚠️ 公開API(認証なし)。理由: BW6プレ告知LP boom-sendai.com/bw6 の「出てみたい／ちょっと気になる」ボタンが
// 名前なしで押せることが要件のため(押した瞬間に1カウント)。
// 防御: CORSで boom-sendai.com 系のみ許可 / IPごと 1時間60件 / 端末IDは英数ハイフンのみ /
//       任意入力はハニーポット＋サーバ側で切り詰め / 返すのは ok だけ(集計値や他人の入力は返さない)。
// 集計は /staff/bw6-interest(proxy認証)。
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, clientIp } from '@/lib/eventAuth';
import { recordPress, saveDetails, validateDetails, validatePress } from '@/lib/bw6Interest';

const ALLOWED_ORIGINS = new Set([
  'https://boom-sendai.com',
  'https://www.boom-sendai.com',
  'https://boom-hp.pages.dev',
  'http://localhost:3000',
  'http://localhost:3999',
]);

function cors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  // Cloudflare Pages のプレビュー(<hash>.boom-hp.pages.dev)も確認用に許可
  const ok = ALLOWED_ORIGINS.has(origin) || /^https:\/\/[a-z0-9-]+\.boom-hp\.pages\.dev$/.test(origin);
  return ok
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
  if (!(await checkRateLimit(`bw6int:${ip}`, 60, 3600))) {
    return NextResponse.json({ ok: false, error: 'rate' }, { status: 429, headers });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'json' }, { status: 400, headers });
  }

  try {
    if (body.action === 'details') {
      const v = validateDetails(body);
      // ボットには成功を返して黙らせる
      if (!v.ok && v.error === 'spam') return NextResponse.json({ ok: true }, { headers });
      if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400, headers });
      await saveDetails(v.data, req.headers.get('user-agent') ?? '');
      return NextResponse.json({ ok: true }, { headers });
    }
    const v = validatePress(body);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400, headers });
    await recordPress(v.data, req.headers.get('user-agent') ?? '');
    return NextResponse.json({ ok: true }, { headers });
  } catch (e) {
    console.error('[bw6-interest] failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'db' }, { status: 500, headers });
  }
}
