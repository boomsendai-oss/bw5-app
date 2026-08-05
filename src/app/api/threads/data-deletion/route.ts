import { NextRequest, NextResponse } from 'next/server';
import { parseSignedRequest, clearConnection } from '@/lib/threads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Threads API の「削除コールバック」(利用者からのデータ削除リクエスト)。
//
// ⚠️ 公開API(認証なし)。理由はアンインストールコールバックと同じ(Metaが直接叩く)。
//   署名検証を通ったものだけ処理する。
//
// Metaの仕様上、`url`(進捗確認用ページ) と `confirmation_code` をJSONで返す必要がある。
//
// BOOMがThreadsについて保持しているのは**自分のアカウントのアクセストークンだけ**で、
// 他人の個人データは持たない。したがって削除処理＝連携情報の破棄で十分。
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const signed = form?.get('signed_request');
  const payload = typeof signed === 'string' ? parseSignedRequest(signed) : null;
  const origin = new URL(req.url).origin;
  if (!payload) {
    return NextResponse.json({ error: 'invalid signed_request' }, { status: 400 });
  }
  await clearConnection();
  // 確認コードは問い合わせ時の照合用。ユーザーIDから決まる固定値で足りる
  const code = `threads-${String(payload.user_id ?? 'unknown')}`;
  return NextResponse.json({
    url: `${origin}/api/threads/data-deletion/status?code=${encodeURIComponent(code)}`,
    confirmation_code: code,
  });
}
