// BF6オンライン配信(PPV)の純ロジック+Cloudflare Stream連携。
// 設計: docs/superpowers/specs/2026-08-04-bf6-stream-design.md
// - 視聴キー: 購入確定(Webhook)で発行しメール送付
// - 同時1端末: ハートビート方式(生存TTL内の別セッションがいたら拒否)
// - 再生URL: Cloudflareの署名付きトークン(短寿命JWT)で保護
import { createHmac, createSign, randomBytes } from 'node:crypto';

// 紛らわしい文字(0/O/1/I/L)を除いたキー用文字集合
const KEY_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChunk(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += KEY_CHARS[bytes[i] % KEY_CHARS.length];
  return out;
}

/** 視聴キーを生成する。例: BF6-7K2M-QWNP-83RV */
export function generateStreamKey(): string {
  return `BF6-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
}

/** 入力ゆらぎ(小文字・全角・空白・ハイフン抜け)を吸収して正規形へ。 */
export function normalizeStreamKey(input: string): string {
  let s = (input ?? '')
    .replace(/[ａ-ｚＡ-Ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－ー‐]/g, '-')
    .replace(/[\s]/g, '')
    .toUpperCase();
  const compact = s.replace(/-/g, '');
  if (/^BF6[2-9A-HJ-NP-Z]{12}$/.test(compact)) {
    s = `BF6-${compact.slice(3, 7)}-${compact.slice(7, 11)}-${compact.slice(11, 15)}`;
  }
  return s;
}

export interface ActiveSession {
  sessionId: string;
  lastSeenAt: number;
}

/**
 * 同時1端末の判定。
 * - 既存なし → 接続OK
 * - 自分のセッションIDと同じ → OK(リロード・復帰)
 * - 他セッションがTTL内に生存 → 拒否
 * - 他セッションがTTL超過 → 乗っ取ってOK(切断済みとみなす)
 */
export function decideSessionTakeover(
  active: ActiveSession | null,
  requestSessionId: string,
  nowMs: number,
  ttlSec: number
): { allow: boolean; takeover: boolean } {
  if (!active) return { allow: true, takeover: false };
  if (active.sessionId === requestSessionId) return { allow: true, takeover: false };
  const aliveUntil = active.lastSeenAt + ttlSec * 1000;
  if (nowMs < aliveUntil) return { allow: false, takeover: false };
  return { allow: true, takeover: true };
}

/** 視聴キー発行メールの文面(純関数・vitest対象)。 */
export function buildStreamKeyEmail(p: {
  buyerName: string;
  streamKey: string;
  receiptNo: string;
}): { subject: string; text: string } {
  const subject = `【BOOMER'S FIGHT!!! vol.6】オンライン配信視聴キーのお知らせ(${p.receiptNo})`;
  const text = [
    `${p.buyerName} 様`,
    '',
    "BOOMER'S FIGHT!!! vol.6 オンライン配信チケットのご購入ありがとうございます。",
    'あなたの視聴キーはこちらです:',
    '',
    `■ 視聴キー: ${p.streamKey}`,
    '',
    '▼ 視聴ページ(当日はこちらから)',
    'https://bw5-app.vercel.app/bf6/stream/watch',
    '',
    '・視聴ページでメールアドレスとこの視聴キーを入力するとご覧いただけます',
    '・1つのキーで同時に視聴できるのは1台までです(視聴をやめると約1分で別の端末から視聴できます)',
    '・配信終了後も1週間、同じキーでアーカイブをご覧いただけます',
    '・視聴者様の通信環境による視聴不良は返金対象外です',
    '',
    '日時: 2026年9月26日(土) OPEN 14:30(予定)',
    '',
    'BOOM DANCE SCHOOL',
  ].join('\n');
  return { subject, text };
}

// ───────────────────────── Cloudflare Stream API ─────────────────────────
// 必要な設定(bf_settings): cf_account_id / cf_api_token / cf_live_input_uid /
// cf_stream_signing_key_id / cf_stream_signing_key_jwk(pem)
// アカウント分離(配信専用アカウント)のためboom-hp系の資格情報は使わない。

export interface CfStreamConfig {
  accountId: string;
  apiToken: string;
  liveInputUid: string;
  signingKeyId: string;
  signingKeyPem: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Cloudflare Stream の署名付き再生トークン(RS256 JWT)。
 * videoUid はライブ入力の再生用UID or 録画のUID。exp は epoch 秒。
 */
export function signStreamPlaybackToken(
  cfg: Pick<CfStreamConfig, 'signingKeyId' | 'signingKeyPem'>,
  videoUid: string,
  expEpochSec: number
): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: cfg.signingKeyId }));
  const payload = b64url(JSON.stringify({ sub: videoUid, kid: cfg.signingKeyId, exp: expEpochSec }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(cfg.signingKeyPem);
  return `${header}.${payload}.${b64url(sig)}`;
}

/** 視聴セッションIDの生成(推測不可)。 */
export function generateStreamSessionId(): string {
  return randomBytes(18).toString('base64url');
}

/** メール+キーの照合用ダイジェスト(ログにキー平文を出さないため)。 */
export function streamKeyDigest(key: string): string {
  return createHmac('sha256', 'bf6-stream-log').update(key).digest('hex').slice(0, 12);
}
