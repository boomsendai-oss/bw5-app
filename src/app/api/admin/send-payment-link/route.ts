// POST /api/admin/send-payment-link
// BW5 動画パック (Square決済リンク) 案内メールを送るための管理エンドポイント
//
// 認証: Header `x-admin-password` (bcrypt比較)
// Body: { to: string, buyerName: string, mode?: "test" | "live" }

import { Resend } from "resend";
import { verifyPassword } from "@/lib/eventAuth";

// Square 決済リンク (住所入力不要のカテゴリで作成された新URL)
const PAYMENT_URL = "https://square.link/u/QgqAM1c2";
const PRICE_LABEL = "¥3,000 (税込)";
const PRODUCT_NAME = "BW5 演目映像データ (全パック)";

export async function POST(req: Request) {
  const pw = req.headers.get("x-admin-password");
  if (!pw || !(await verifyPassword(pw))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { to?: string; buyerName?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
  }

  const to = body.to;
  const buyerName = body.buyerName ?? "BW5 ご予約者";
  const mode = body.mode ?? "test";
  if (!to) {
    return new Response(JSON.stringify({ error: "to required" }), { status: 400 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500 });
  }

  const resend = new Resend(resendKey);
  const FROM = process.env.RESEND_FROM || "BW5 <onboarding@resend.dev>";

  const subjectPrefix = mode === "test" ? "【テスト送信】" : "";
  const subject = `${subjectPrefix}【BW5】演目映像データ 決済のご案内`;

  const text = `${buyerName} 様

このたびはBOOM WOP vol.5 (BW5) の演目映像データをご予約いただき、誠にありがとうございます。
ご決済のご案内です。

━━━━━━━━━━━━━━━━━━
■ 商品: ${PRODUCT_NAME}
   全31演目のダンス映像 (本番＋ゲネプロ ベストカット編集) を1パックでお届けします。
■ 価格: ${PRICE_LABEL}
■ 決済リンク (Square):
   ${PAYMENT_URL}
━━━━━━━━━━━━━━━━━━

【ご決済の流れ】
1. 上記URLにアクセス
2. お名前・メールアドレスを入力
3. クレジットカード or Apple Pay / Google Pay でお支払い
4. 決済完了後、後日メールにて映像データのダウンロードリンクをお送りいたします

【ご注意】
・ダウンロードリンク送信後、3日以内に最大5回までダウンロード可能です
・お一人につき1回のみご決済ください (重複ご予約された方も決済は1回でOKです)
・ご不明点はこちらのメールに直接ご返信ください

ご質問・お問い合わせは boom.sendai@gmail.com まで

BOOM ダンススクール
https://www.boom-sendai.com/
`;

  const html = `
<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
  <div style="background: linear-gradient(135deg, #f27a1a, #dc4c04); color: #fff; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">BW5 演目映像データ 決済のご案内</h1>
    ${mode === "test" ? '<p style="margin: 8px 0 0; font-size: 12px; opacity: 0.9;">⚠️ テスト送信</p>' : ""}
  </div>
  <div style="padding: 28px;">
    <p>${escapeHtml(buyerName)} 様</p>
    <p>このたびは <strong>BOOM WOP vol.5 (BW5)</strong> の演目映像データをご予約いただき、誠にありがとうございます。<br>
    ご決済のご案内です。</p>

    <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <p style="margin: 0 0 6px; font-size: 14px; color: #b45309;"><strong>商品</strong></p>
      <p style="margin: 0 0 14px; font-size: 16px;">${PRODUCT_NAME}<br>
      <span style="font-size: 13px; color: #555;">全31演目のダンス映像 (本番＋ゲネプロ ベストカット編集)</span></p>

      <p style="margin: 0 0 6px; font-size: 14px; color: #b45309;"><strong>価格</strong></p>
      <p style="margin: 0; font-size: 20px; font-weight: bold; color: #dc4c04;">${PRICE_LABEL}</p>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${PAYMENT_URL}" style="display: inline-block; background: linear-gradient(135deg, #f27a1a, #dc4c04); color: #fff; padding: 14px 32px; border-radius: 24px; text-decoration: none; font-weight: bold; font-size: 16px;">
        決済リンクを開く
      </a>
      <p style="margin: 12px 0 0; font-size: 12px; color: #777;">${PAYMENT_URL}</p>
    </div>

    <h2 style="font-size: 15px; border-left: 4px solid #f27a1a; padding-left: 10px; margin-top: 28px;">ご決済の流れ</h2>
    <ol style="font-size: 14px; line-height: 1.8; padding-left: 20px;">
      <li>上記ボタンから決済リンクへ</li>
      <li>お名前・メールアドレスを入力</li>
      <li>クレジットカード／Apple Pay／Google Pay でお支払い</li>
      <li>決済完了後、後日メールにて映像ダウンロードリンクをお送りします</li>
    </ol>

    <h2 style="font-size: 15px; border-left: 4px solid #f27a1a; padding-left: 10px; margin-top: 24px;">ご注意</h2>
    <ul style="font-size: 13px; line-height: 1.8; padding-left: 20px; color: #555;">
      <li>ダウンロードリンクは <strong>3日以内・最大5回</strong> までダウンロード可能</li>
      <li>お一人につき1回のみご決済ください（重複予約された方も決済は1回でOK）</li>
      <li>ご不明点はこのメールに直接ご返信ください</li>
    </ul>

    <hr style="margin: 32px 0; border: 0; border-top: 1px solid #e5e7eb;">
    <p style="font-size: 12px; color: #777; line-height: 1.6;">
      BOOM ダンススクール<br>
      <a href="https://www.boom-sendai.com/" style="color: #dc4c04;">https://www.boom-sendai.com/</a><br>
      お問い合わせ: boom.sendai@gmail.com
    </p>
  </div>
</div>
`;

  try {
    const result = await resend.emails.send({
      from: FROM,
      to,
      subject,
      text,
      html,
    });
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!;
  });
}
