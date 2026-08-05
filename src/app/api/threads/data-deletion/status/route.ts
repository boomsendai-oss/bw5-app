import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 削除リクエストの進捗確認ページ。
//
// ⚠️ 公開(認証なし)。理由: Metaの仕様で、削除コールバックが返す `url` は
//   **利用者が誰でも開いて進捗を確認できる**必要があるため。
//   確認コードを表示するだけで、個人データは一切出さない。
export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code') ?? '(なし)';
  return new NextResponse(
    `<html><head><meta charset="utf-8"><title>データ削除リクエスト</title></head>
     <body style="font-family:sans-serif;padding:32px;max-width:640px;margin:auto;line-height:1.7;">
     <h1>データ削除リクエスト</h1>
     <p>確認コード: <code>${code.replace(/[<>&"]/g, '')}</code></p>
     <p>このリクエストは<b>完了しています</b>。BOOMのアプリが保持していたThreadsの連携情報は削除されました。</p>
     <p>お問い合わせ: boom.sendai@gmail.com</p></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
