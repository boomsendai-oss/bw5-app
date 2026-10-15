// 受付開始前に「受付中の画面」を確認するためのプレビュー鍵(サーバ専用)。
// プレビューは表示だけ。申込・決済のサーバ処理は本物の受付状態で判定するので、プレビューからは申し込めない。
import { createHmac, timingSafeEqual } from 'node:crypto';

function key(): string {
  const base = process.env.PARTY_TICKET_SECRET || process.env.TURSO_AUTH_TOKEN || process.env.ADMIN_PASSWORD || 'local-dev';
  return createHmac('sha256', 'party-preview').update(base).digest('hex');
}

export function xmasPreviewKey(eventKey: string): string {
  return createHmac('sha256', key()).update(`preview:${eventKey}`).digest('hex').slice(0, 16);
}

export function isXmasPreview(eventKey: string, v: string | undefined | null): boolean {
  if (!v) return false;
  const a = Buffer.from(xmasPreviewKey(eventKey));
  const b = Buffer.from(String(v));
  return a.length === b.length && timingSafeEqual(a, b);
}
