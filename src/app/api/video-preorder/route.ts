import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne, getAll } from '@/lib/db';
import { isAuthorized } from '@/lib/eventAuth';
import { sendVideoPreorderEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

// 予約締切: 2026-05-20 00:00 JST (= 5/19 23:59:59.999 まで受付)
// 締切後は 410 Gone で受付拒否
const PREORDER_DEADLINE = new Date('2026-05-20T00:00:00+09:00');

// 締切後の「特別受付リンク」用トークン。
// 締切に間に合わなかった人にだけ /?late=<TOKEN> のURLを渡すと、
// このトークン付きの申込のみ締切後でも受け付ける(全体の締切は閉じたまま)。
// このファイルはサーバー専用(APIルート)なので、値はブラウザのバンドルに出ない。
const LATE_BYPASS_TOKEN = '_qbDm6BMFR6oEsAG';

interface PreorderBody {
  merch_id: number;
  buyer_name: string;
  email: string;
  phone: string;
  note?: string;
  bypass?: string;
}

// POST /api/video-preorder — 映像データ販売の事前予約
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PreorderBody;

    // 締切チェック。締切後でも、正しい特別受付トークン付きの申込のみ許可。
    const now = new Date();
    const hasValidBypass = body.bypass === LATE_BYPASS_TOKEN;
    if (now >= PREORDER_DEADLINE && !hasValidBypass) {
      return NextResponse.json(
        {
          error: '映像データの予約受付は終了しました。',
          message: 'ご希望の方は boom.sendai@gmail.com までご連絡ください。',
          deadline: PREORDER_DEADLINE.toISOString(),
        },
        { status: 410 } // Gone = もう利用できない
      );
    }

    const required = ['merch_id', 'buyer_name', 'email', 'phone'] as const;
    for (const k of required) {
      if (!body[k as keyof PreorderBody] && body[k as keyof PreorderBody] !== 0) {
        return NextResponse.json({ error: `必須項目が未入力です: ${k}` }, { status: 400 });
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(body.email)) {
      return NextResponse.json({ error: 'メールアドレスの形式が正しくありません' }, { status: 400 });
    }

    const merch = await getOne('SELECT id, name, price FROM merchandise WHERE id = ?', [body.merch_id]);
    if (!merch) {
      return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });
    }

    // 締切後の特別受付は note に印を付け、管理画面で識別できるようにする
    const noteBase = body.note ?? '';
    const finalNote = hasValidBypass
      ? `${noteBase ? noteBase + ' / ' : ''}[締切後特別受付]`
      : noteBase;

    const result = await execute(
      `INSERT INTO video_preorders (merch_id, buyer_name, email, phone, note, status)
       VALUES (?, ?, ?, ?, ?, 'waiting')`,
      [body.merch_id, body.buyer_name, body.email, body.phone, finalNote]
    );

    const preorderId = Number(result.lastInsertRowid);

    let emailSent = false;
    try {
      await sendVideoPreorderEmail({
        to: body.email,
        buyerName: body.buyer_name,
        phone: body.phone,
        preorderId,
        // merchName は省略 (固定文言 "BOOM WOP vol.5 フルパフォーマンス映像" を使う)
        price: Number(merch.price) || 0,
      });
      emailSent = true;
      // 送信成功時に confirmation_email_sent_at を記録 (管理画面の送信履歴用)
      try {
        await execute(
          `UPDATE video_preorders SET confirmation_email_sent_at = ? WHERE id = ?`,
          [new Date().toISOString(), preorderId]
        );
      } catch (e) {
        console.error('[video-preorder] confirmation_email_sent_at update failed', e);
      }
    } catch (e) {
      console.error('[video-preorder] email failed but record saved', e);
    }

    return NextResponse.json({ success: true, preorder_id: preorderId, email_sent: emailSent });
  } catch (e) {
    console.error('video-preorder POST err', e);
    return NextResponse.json({ error: '予約の登録に失敗しました' }, { status: 500 });
  }
}

// GET /api/video-preorder — 管理者用一覧 (cookie/header認証)
export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const rows = await getAll(`
      SELECT v.*, m.name AS merch_name
      FROM video_preorders v
      LEFT JOIN merchandise m ON m.id = v.merch_id
      ORDER BY v.created_at DESC
    `);
    return NextResponse.json({ preorders: rows });
  } catch (e) {
    console.error('video-preorder GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
