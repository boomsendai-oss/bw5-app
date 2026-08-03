'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: BOOMER'S FIGHT vol.6 は外部参加者も対象の
// 公開イベントで、/bf6/entry・/bf6/ticket の公開フォームが叩くため。
// PII対策(M22): 名簿系はgetPublicBf6Entries(公開列=ダンサーネーム/ジャンル/REP/部門のみ)に限定。
// 本名・電話・メール・IGを返す公開経路は作らない。個別閲覧はedit_token完全一致の1件のみ。
// 送信はIP単位のレート制限。金額は必ずサーバ側で再計算する。
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import {
  isPastDeadlineJst,
  validateBf6Order,
  type Bf6OrderInput,
  type Bf6Pricing,
  type Bf6Division,
} from '@/lib/bf6';
import {
  calcBf6Remaining,
  createBf6Order,
  getBf6Settings,
  getBf6Usage,
  getPublicBf6Entries,
  type PublicBf6Entry,
} from '@/lib/bf6Db';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export interface Bf6PublicContext {
  entryOpen: boolean;
  ticketOpen: boolean;
  pricing: Bf6Pricing;
  capacity: Record<Bf6Division, number>;
  remaining: { divisions: Record<Bf6Division, number>; tickets: number };
  entryDeadline: string;
  ticketDeadline: string;
}

// 公開: 料金・残枠・受付状態(いずれも公開情報)を返す。名簿・PIIは含まない。
export async function getBf6Context(): Promise<Bf6PublicContext> {
  const settings = await getBf6Settings();
  const usage = await getBf6Usage();
  const remaining = calcBf6Remaining(settings, usage);
  return {
    entryOpen: settings.entryOpen && !isPastDeadlineJst(settings.entryDeadline),
    ticketOpen: settings.ticketOpen && !isPastDeadlineJst(settings.ticketDeadline),
    pricing: settings.pricing,
    capacity: settings.capacity,
    remaining,
    entryDeadline: settings.entryDeadline,
    ticketDeadline: settings.ticketDeadline,
  };
}

export type Bf6SubmitResult =
  | { ok: true; token: string; payMethod: 'prepaid' | 'onsite'; amountTotal: number }
  | { ok: false; error: string };

export async function submitBf6Order(payload: Bf6OrderInput): Promise<Bf6SubmitResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf6:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const settings = await getBf6Settings();
  const validated = validateBf6Order(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const isEntry = validated.entries.length > 0;
  if (isEntry && (!settings.entryOpen || isPastDeadlineJst(settings.entryDeadline))) {
    return { ok: false, error: '現在エントリーは受け付けていません' };
  }
  if (!isEntry && (!settings.ticketOpen || isPastDeadlineJst(settings.ticketDeadline))) {
    return { ok: false, error: '現在観覧チケットの販売は行っていません' };
  }
  const created = await createBf6Order(validated);
  if (!created.ok) return { ok: false, error: created.error };
  return {
    ok: true,
    token: created.editToken,
    payMethod: validated.payMethod,
    amountTotal: created.amountTotal,
  };
}

// 公開: エントリーリスト(ダンサーネーム/ジャンル/REP/部門のみ)。
export async function getBf6EntryList(): Promise<PublicBf6Entry[]> {
  return getPublicBf6Entries();
}

export type Bf6CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

// 決済への遷移。Stripe Checkout実装(8/5)までは準備中を返す。
export async function startBf6Checkout(token: string): Promise<Bf6CheckoutResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf6pay:${ip}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  if (!token) return { ok: false, error: '申込が見つかりません' };
  return { ok: false, error: 'カード決済は現在準備中です。恐れ入りますが、しばらくしてからこのページを開き直してください(申込は保存されています)' };
}
