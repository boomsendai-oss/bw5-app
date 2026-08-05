'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: BF6オンライン配信の視聴ページ(購入者向け)が叩くため。
// 認可は「メールアドレス+視聴キーの完全一致」で行い、キーはIPレート制限つきで照合する。
// 再生URLは短寿命の署名付きトークン。名簿・キー一覧を返す公開経路は作らない。
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { isPastDeadlineJst } from '@/lib/bf6';
import { normalizeStreamKey } from '@/lib/bf6Stream';
import {
  getBf6StreamConfig,
  streamHeartbeat,
  streamLogin,
  type StreamHeartbeatResult,
  type StreamLoginResult,
} from '@/lib/bf6StreamDb';
import { getBf6Settings } from '@/lib/bf6Db';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export interface Bf6StreamContext {
  open: boolean;
  price: number;
  archiveUntil: string;
}

// 公開: 配信の販売状態と価格(公開情報のみ)。
export async function getBf6StreamContext(): Promise<Bf6StreamContext> {
  const [cfg, settings] = await Promise.all([getBf6StreamConfig(), getBf6Settings()]);
  return { open: cfg.open, price: settings.pricing.stream, archiveUntil: cfg.archiveUntil };
}

export async function loginBf6Stream(
  email: string,
  key: string,
  sessionId: string
): Promise<StreamLoginResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf6stream:${ip}`, 30, 3600))) {
    return { ok: false, reason: 'invalid' };
  }
  const cfg = await getBf6StreamConfig();
  if (cfg.archiveUntil && isPastDeadlineJst(cfg.archiveUntil)) {
    return { ok: false, reason: 'closed' };
  }
  const h = await headers();
  const ua = h.get('user-agent') ?? '';
  return streamLogin(email, normalizeStreamKey(key), sessionId, ua);
}

export async function heartbeatBf6Stream(key: string, sessionId: string): Promise<StreamHeartbeatResult> {
  const ip = await clientIp();
  // 20秒間隔×1端末で1時間180回。多端末の張り付きだけ弾く緩い制限
  if (!(await checkRateLimit(`bf6hb:${ip}`, 400, 3600))) {
    return { ok: false, reason: 'invalid' };
  }
  return streamHeartbeat(normalizeStreamKey(key), sessionId);
}
