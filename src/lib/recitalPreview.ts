// BW6 発表会の試し用の鍵（サーバ専用。partyPreview.ts と同じ作り）。
// 表示だけ。申込のサーバ処理は本物の受付の状態で判定する（R-40）。
// 本番（bw6）の鍵は「受付中の画面を見るだけ」。is_test=1 の発表会の鍵は、その発表会へ切り替える。
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RECITAL_EVENT } from './recital';

/** 秘密の元は呼ぶたびに読む（秘密を変えたら前の鍵は通らない） */
function key(): string {
  const base =
    process.env.RECITAL_PREVIEW_SECRET ||
    process.env.PARTY_TICKET_SECRET ||
    process.env.TURSO_AUTH_TOKEN ||
    process.env.ADMIN_PASSWORD ||
    'local-dev';
  return createHmac('sha256', 'recital-preview').update(base).digest('hex');
}

/** 32けたの16進 */
export function recitalPreviewKey(eventKey: string): string {
  return createHmac('sha256', key()).update(`preview:${eventKey}`).digest('hex').slice(0, 32);
}

export function isRecitalPreview(eventKey: string, v: string | null | undefined): boolean {
  if (!v) return false;
  const a = Buffer.from(recitalPreviewKey(eventKey));
  const b = Buffer.from(String(v));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** ?ev= と ?pv= の受け方。合わなければいつも本番（bw6）の、試しでない表示にもどす */
export function resolvePreviewEvent(
  ev: string | null | undefined,
  pv: string | null | undefined,
  evIsTest: boolean,
): { eventKey: string; preview: boolean } {
  if (!ev || ev === RECITAL_EVENT.live) {
    return { eventKey: RECITAL_EVENT.live, preview: isRecitalPreview(RECITAL_EVENT.live, pv) };
  }
  if (evIsTest && isRecitalPreview(ev, pv)) return { eventKey: ev, preview: true };
  return { eventKey: RECITAL_EVENT.live, preview: false };
}
