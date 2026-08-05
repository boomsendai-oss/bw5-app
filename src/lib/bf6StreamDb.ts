// BF6オンライン配信のDB層。src/lib/db.ts 経由のみ。
// 視聴キー発行(Webhook起点)・ログイン(同時1端末)・ハートビートを担当する。
import { execute, getAll, getOne } from '@/lib/db';
import {
  buildStreamKeyEmail,
  decideSessionTakeover,
  generateStreamKey,
  signStreamPlaybackToken,
  streamKeyDigest,
} from '@/lib/bf6Stream';
import { sendEmail } from '@/lib/email';
import { formatReceiptNo } from '@/lib/bf6';
import type { OwnBf6Order } from '@/lib/bf6Db';

const SESSION_TTL_SEC = 60;
const PLAYBACK_TOKEN_TTL_SEC = 4 * 60 * 60;

function nowIso(): string {
  return new Date().toISOString();
}

export interface Bf6StreamConfig {
  open: boolean;
  archiveUntil: string;
  customerCode: string;
  liveInputUid: string;
  signingKeyId: string;
  signingKeyPem: string;
}

/** bf_settings の stream_* / cf_* キーから配信設定を読む。 */
export async function getBf6StreamConfig(): Promise<Bf6StreamConfig> {
  const rows = await getAll(
    "SELECT key, value FROM bf_settings WHERE key IN ('stream_open','stream_archive_until','cf_customer_code','cf_live_input_uid','cf_signing_key_id','cf_signing_key_pem')"
  );
  const map = new Map<string, string>(rows.map((r) => [String(r.key), String(r.value)]));
  return {
    open: map.get('stream_open') === '1',
    archiveUntil: map.get('stream_archive_until') ?? '',
    customerCode: map.get('cf_customer_code') ?? '',
    liveInputUid: map.get('cf_live_input_uid') ?? '',
    signingKeyId: map.get('cf_signing_key_id') ?? '',
    signingKeyPem: map.get('cf_signing_key_pem') ?? '',
  };
}

/**
 * 注文に対する視聴キーを発行する(冪等: 既に必要枚数あれば再発行しない)。
 * Webhookの再送で呼ばれても増殖しない。
 */
export async function issueBf6StreamKeys(orderId: number, email: string, qty: number): Promise<string[]> {
  const existing = await getAll('SELECT stream_key FROM bf_stream_keys WHERE order_id = ? ORDER BY id', [orderId]);
  const keys = existing.map((r) => String(r.stream_key));
  const now = nowIso();
  while (keys.length < qty) {
    const key = generateStreamKey();
    try {
      await execute(
        'INSERT INTO bf_stream_keys (order_id, stream_key, email, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [orderId, key, email, 'active', now, now]
      );
      keys.push(key);
    } catch {
      // UNIQUE衝突(天文学的確率)は再生成
    }
  }
  return keys;
}

/** 決済確定した注文に配信チケットが含まれていればキーを発行しメール送付する。 */
export async function handleBf6StreamPurchase(order: OwnBf6Order): Promise<void> {
  const stream = order.items.find((i) => i.itemType === 'stream');
  if (!stream) return;
  try {
    const keys = await issueBf6StreamKeys(order.orderId, order.email, stream.qty);
    for (const key of keys) {
      const mail = buildStreamKeyEmail({
        buyerName: order.buyerName,
        streamKey: key,
        receiptNo: formatReceiptNo(order.orderId),
      });
      await sendEmail({ to: order.email, subject: mail.subject, text: mail.text });
    }
  } catch (e) {
    // キー発行失敗はWebhook自体を落とさない(ログを残しスタッフ対応)
    console.error('[bf6] stream key issue failed. order:', order.orderId, e instanceof Error ? e.message : e);
  }
}

export type StreamLoginResult =
  | { ok: true; iframeSrc: string }
  | { ok: false; reason: 'invalid' | 'busy' | 'not_ready' | 'closed' };

/**
 * 視聴ログイン。キー照合→同時1端末チェック→セッション確保→再生URL発行。
 * キーは高エントロピー(12文字・紛らわしい文字なし)なのでキー単体で認可する。
 * メール照合を課すと「購入者がキーを家族に渡す」際に購入者のメールも要求してしまうため廃止(TARO 2026-08-06)。
 * 生存TTL内の別セッションがいる場合は 'busy'。
 */
export async function streamLogin(
  normalizedKey: string,
  sessionId: string,
  userAgent: string
): Promise<StreamLoginResult> {
  const cfg = await getBf6StreamConfig();
  if (!cfg.liveInputUid || !cfg.customerCode) return { ok: false, reason: 'not_ready' };

  const row = await getOne("SELECT * FROM bf_stream_keys WHERE stream_key = ? AND status = 'active'", [
    normalizedKey,
  ]);
  if (!row) {
    console.warn('[bf6] stream login failed. key digest:', streamKeyDigest(normalizedKey));
    return { ok: false, reason: 'invalid' };
  }

  const keyId = Number(row.id);
  const nowMs = Date.now();
  const session = await getOne('SELECT * FROM bf_stream_sessions WHERE key_id = ?', [keyId]);
  const decision = decideSessionTakeover(
    session ? { sessionId: String(session.session_id), lastSeenAt: Number(session.last_seen_at) } : null,
    sessionId,
    nowMs,
    SESSION_TTL_SEC
  );
  if (!decision.allow) return { ok: false, reason: 'busy' };

  await execute(
    'INSERT INTO bf_stream_sessions (key_id, session_id, last_seen_at, user_agent, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key_id) DO UPDATE SET session_id = excluded.session_id, last_seen_at = excluded.last_seen_at, user_agent = excluded.user_agent, updated_at = excluded.updated_at',
    [keyId, sessionId, nowMs, userAgent.slice(0, 200), nowIso()]
  );

  // 署名付き再生トークン(設定があれば)。なければ素のUID(署名必須OFFのテスト用入力)
  const target =
    cfg.signingKeyId && cfg.signingKeyPem
      ? signStreamPlaybackToken(
          { signingKeyId: cfg.signingKeyId, signingKeyPem: cfg.signingKeyPem },
          cfg.liveInputUid,
          Math.floor(nowMs / 1000) + PLAYBACK_TOKEN_TTL_SEC
        )
      : cfg.liveInputUid;
  return {
    ok: true,
    iframeSrc: `https://customer-${cfg.customerCode}.cloudflarestream.com/${target}/iframe?autoplay=true`,
  };
}

export type StreamHeartbeatResult = { ok: true } | { ok: false; reason: 'taken' | 'invalid' };

/** 視聴中の生存通知(20秒ごと)。別端末に乗っ取られていたら taken を返す。 */
export async function streamHeartbeat(normalizedKey: string, sessionId: string): Promise<StreamHeartbeatResult> {
  const row = await getOne("SELECT id FROM bf_stream_keys WHERE stream_key = ? AND status = 'active'", [
    normalizedKey,
  ]);
  if (!row) return { ok: false, reason: 'invalid' };
  const session = await getOne('SELECT session_id FROM bf_stream_sessions WHERE key_id = ?', [Number(row.id)]);
  if (!session || String(session.session_id) !== sessionId) return { ok: false, reason: 'taken' };
  await execute('UPDATE bf_stream_sessions SET last_seen_at = ?, updated_at = ? WHERE key_id = ?', [
    Date.now(),
    nowIso(),
    Number(row.id),
  ]);
  return { ok: true };
}
