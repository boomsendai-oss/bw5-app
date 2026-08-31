// ⚠️ 公開API(認証なし)。理由: アンケート公開ページ /survey/* で起きたクライアントエラーを
// 回答者のブラウザから受け取って記録するため(白画面バグ調査・WS AO 2026-08-31)。
// PII対策: 受けるのはエラーメッセージ/スタック/UA/URLのみ。氏名・回答内容は送らせない。
// IP単位のレート制限+各フィールドをサーバ側で強制的に切り詰める。
import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { checkRateLimit, clientIp } from '@/lib/eventAuth';

const trim = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.slice(0, max) : null;

export async function POST(req: NextRequest) {
  if (!(await checkRateLimit(`surveyerr:${clientIp(req)}`, 10, 3600))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const obj = (body ?? {}) as Record<string, unknown>;
  await execute(
    'INSERT INTO survey_client_errors (message, stack, user_agent, url) VALUES (?, ?, ?, ?)',
    [trim(obj.message, 500), trim(obj.stack, 2000), trim(obj.ua, 300), trim(obj.url, 300)]
  );
  return NextResponse.json({ ok: true });
}
