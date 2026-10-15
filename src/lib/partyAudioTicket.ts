// 音源アップロード用の短時間の通行証(サーバ専用)。
// 「チーム名かメールアドレス」で開ける提出ページでは、チームの控えページ用トークン(edit_token)を
// ブラウザに渡さない(渡すと代表者名などが見える控えページを開けてしまうため)。
// かわりに「この申込IDの音源を、この時刻まで上げてよい」という署名つきの文字列を渡す。
import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MIN = 60;

function key(): string {
  // 専用の環境変数を増やさず、本番に必ずある秘密値から派生させる(値そのものは使わない)
  const base = process.env.PARTY_TICKET_SECRET || process.env.TURSO_AUTH_TOKEN || process.env.ADMIN_PASSWORD || 'local-dev';
  return createHmac('sha256', 'party-audio-ticket').update(base).digest('hex');
}

function sign(body: string): string {
  return createHmac('sha256', key()).update(body).digest('hex').slice(0, 32);
}

export function makeAudioTicket(orderId: number, nowMs = Date.now()): string {
  const body = `${orderId}.${Math.floor(nowMs / 1000) + TTL_MIN * 60}`;
  return `${body}.${sign(body)}`;
}

/** 正しく期限内なら申込ID、それ以外は null。 */
export function verifyAudioTicket(ticket: string, nowMs = Date.now()): number | null {
  const m = /^(\d+)\.(\d+)\.([0-9a-f]{32})$/.exec(String(ticket ?? ''));
  if (!m) return null;
  const body = `${m[1]}.${m[2]}`;
  const a = Buffer.from(sign(body));
  const b = Buffer.from(m[3]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(m[2]) * 1000 < nowMs) return null;
  return Number(m[1]);
}
