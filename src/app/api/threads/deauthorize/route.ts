import { NextRequest, NextResponse } from 'next/server';
import { parseSignedRequest, clearConnection } from '@/lib/threads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Threads API の「アンインストールコールバック」。
//
// ⚠️ 公開API(認証なし)。理由: **Metaのサーバーが直接叩く**ため管理パスワードを要求できない。
//   代わりに signed_request の署名(app secretでHMAC)を検証し、通らないものは無視する。
//   これが無いと、誰でも「連携解除された」と偽装して連携を壊せる。
//
// ⚠️ /api/staff/ 配下に置けない。proxy.ts が /api/staff/* を認証必須にしており、
//   cookieを持たないMetaからのリクエストは401で弾かれてしまうため。
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const signed = form?.get('signed_request');
  if (typeof signed !== 'string' || !parseSignedRequest(signed)) {
    // 署名が検証できないものは何もしない(200を返すのはMetaに再送させないため)
    return NextResponse.json({ ok: true, ignored: true });
  }
  await clearConnection();
  return NextResponse.json({ ok: true });
}
