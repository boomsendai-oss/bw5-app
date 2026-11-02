import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 事務所Mac(M1)のログイン見張り役(boom-events-hub/scripts/login_watch)からの通知の受け口。
// M1のChromeで HACOMONO・Lステップ・LINE公式 のログインが切れた/戻った時に、
// TAROのスマホへ notifyTaro(Pushover→だめならLINE→メール)で知らせる。2026-11-02
// 通知を出す回数の抑止(切れた時1回・6時間ごと・戻った時1回)は見張り役の側で行う。
// POST body: { title: string, message: string }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title.slice(0, 200) : '';
  const message = typeof body.message === 'string' ? body.message.slice(0, 1500) : '';
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
  try {
    await notifyTaro({ subjectPrefix: '[BOOM ログイン見張り]', subject: title, body: message });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
