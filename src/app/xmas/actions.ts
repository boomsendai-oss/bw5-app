'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: クリスマスパーティー2026は外部の子も参加できる
// イベントで、/xmas/ticket・/xmas/entry・/xmas/my の公開フォームが叩くため。
// PII対策: 申込を列挙する公開経路は作らない。個別閲覧は edit_token 完全一致の1件のみ。
// 送信はIP単位のレート制限。金額は必ずサーバ側で設定値から再計算する。
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import {
  PARTY_EVENT_KEY,
  audioOpen,
  entryState,
  entryUnitPrice,
  ticketCardState,
  ticketCashState,
  validateEntryInput,
  validateTicketInput,
  type EntryInput,
  type GateState,
  type PartySettings,
  type TicketInput,
} from '@/lib/party';
import {
  countHoldingTeams,
  createPartyEntry,
  createPartyTicket,
  findConfirmedOrdersByEmail,
  getPartySettings,
  loadPartyOrderByToken,
  savePartyAudio,
  savePartyStripeSession,
} from '@/lib/partyDb';
import { buildPartyCheckoutParams, buildPartyLineItems } from '@/lib/partyStripe';
import { createBf6CheckoutSession } from '@/lib/bf6Stripe';
import { buildLinkResendEmail, sendPartyMail, sendPartyOrderEmail } from '@/lib/partyEmail';
import { isValidEmail } from '@/lib/party';

const EV = PARTY_EVENT_KEY;

async function ip(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export interface XmasPublicContext {
  settings: PartySettings;
  ticketCard: GateState;
  ticketCash: GateState;
  entry: GateState;
  teamsLeft: number;
  entryUnit: number;
}

/** 公開: 料金・受付状態・残りチーム数(いずれも公開情報)。名簿・PIIは含まない。 */
export async function getXmasContext(): Promise<XmasPublicContext> {
  const settings = await getPartySettings(EV);
  const holding = await countHoldingTeams(EV);
  const now = new Date();
  return {
    settings,
    ticketCard: ticketCardState(settings, now),
    ticketCash: ticketCashState(settings, now),
    entry: entryState(settings, now, holding),
    teamsLeft: Math.max(0, settings.teamCap - holding),
    entryUnit: entryUnitPrice(settings),
  };
}

export type XmasSubmitResult = { ok: true; token: string; payMethod: 'card' | 'cash' } | { ok: false; error: string };

const CLOSED_MSG: Record<GateState, string> = {
  before: 'まだ受付を開始していません',
  closed: '受付は締め切りました',
  full: '定員に達したため受付を終了しました',
  suspended: '現在受付を停止しています',
  open: '',
};

export async function submitXmasTicket(input: TicketInput): Promise<XmasSubmitResult> {
  if (!(await checkRateLimit(`xmas:${await ip()}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const v = validateTicketInput(input);
  if (typeof v === 'string') return { ok: false, error: v };
  const s = await getPartySettings(EV);
  const now = new Date();
  // 締切は支払い方法ごとに別(1本のゲートにまとめない)
  const state = v.payMethod === 'card' ? ticketCardState(s, now) : ticketCashState(s, now);
  if (state !== 'open') return { ok: false, error: CLOSED_MSG[state] };
  const r = await createPartyTicket(EV, v, s);
  if (!r.ok) return r;
  if (v.payMethod === 'cash') {
    // 当日現金は申込の時点で確定=ここで控えを送る(カードはWebhookで決済確定した時に送る)
    const o = await loadPartyOrderByToken(r.token);
    if (o) await sendPartyOrderEmail(o, r.token, s);
  }
  return { ok: true, token: r.token, payMethod: v.payMethod };
}

export async function submitXmasEntry(input: EntryInput): Promise<XmasSubmitResult> {
  if (!(await checkRateLimit(`xmas:${await ip()}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const v = validateEntryInput(input);
  if (typeof v === 'string') return { ok: false, error: v };
  const s = await getPartySettings(EV);
  const state = entryState(s, new Date(), await countHoldingTeams(EV));
  if (state !== 'open') return { ok: false, error: CLOSED_MSG[state] };
  // 上限の最終判定は作成と同じトランザクションの中で行う(同時送信対策)
  const r = await createPartyEntry(EV, v, s);
  if (!r.ok) return r;
  if (v.payMethod === 'cash') {
    const o = await loadPartyOrderByToken(r.token);
    if (o) await sendPartyOrderEmail(o, r.token, s);
  }
  return { ok: true, token: r.token, payMethod: v.payMethod };
}

export type XmasCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** Stripe Checkoutへ。明細と金額はDB保存済みの注文から組み立てる。 */
export async function startXmasCheckout(token: string): Promise<XmasCheckoutResult> {
  if (!(await checkRateLimit(`xmaspay:${await ip()}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const o = await loadPartyOrderByToken(token);
  if (!o) return { ok: false, error: '申込が見つかりません' };
  if (o.status === 'paid') return { ok: false, error: 'この申込はお支払い済みです' };
  if (o.status === 'expired') {
    return { ok: false, error: '30分以内に決済が完了しなかったため、この申込は無効になりました。お手数ですがもう一度お申し込みください' };
  }
  if (o.payMethod !== 'card' || o.status !== 'pending') {
    return { ok: false, error: 'この申込はカード決済の対象ではありません' };
  }
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'bw5-app.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const myUrl = `${proto}://${host}/xmas/my?t=${token}`;
  try {
    const params = buildPartyCheckoutParams({
      lineItems: buildPartyLineItems(o),
      successUrl: myUrl,
      cancelUrl: myUrl,
      customerEmail: o.email,
      orderId: o.id,
      // Stripeの最短は30分。申込の仮押さえ期限に合わせる
      expiresAtEpochSec: Math.max(
        Math.floor(Date.now() / 1000) + 30 * 60 + 5,
        Math.floor(new Date(o.expiresAt).getTime() / 1000)
      ),
    });
    const session = await createBf6CheckoutSession(params);
    await savePartyStripeSession(o.id, session.id);
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済ページの作成に失敗しました' };
  }
}

/**
 * 音源アップロード後にURLを控える。Blobの中身はアップロード用トークン発行時に
 * 申込・締切・形式・サイズを検証済み。ここではURLが自分のストアの所定の場所かを確かめる。
 */
export async function saveXmasAudio(token: string, url: string, filename: string): Promise<{ ok: boolean; error?: string }> {
  const o = await loadPartyOrderByToken(token);
  if (!o || o.kind !== 'entry') return { ok: false, error: '申込が見つかりません' };
  const s = await getPartySettings(EV);
  if (!audioOpen(s, new Date())) return { ok: false, error: '音源の提出は締め切りました' };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, error: '保存に失敗しました' };
  }
  if (!u.hostname.endsWith('.public.blob.vercel-storage.com') || !u.pathname.startsWith(`/${EV}/audio/${o.id}-`)) {
    return { ok: false, error: '保存に失敗しました' };
  }
  const ok = await savePartyAudio(token, url, filename);
  return ok ? { ok } : { ok: false, error: 'エントリーが確定していないため保存できません' };
}

/**
 * 控えページのURLを登録メールアドレスへ送り直す(メールをなくした人・音源を後日出す人向け)。
 * 登録があるかどうかは画面に出さない(他人のメールアドレスで申込の有無を確かめられないように)。
 */
export async function requestXmasLinkResend(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await checkRateLimit(`xmasresend:${await ip()}`, 5, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const e = String(email ?? '').trim();
  if (!isValidEmail(e)) return { ok: false, error: 'メールアドレスの形式が正しくありません' };
  const items = await findConfirmedOrdersByEmail(EV, e);
  if (items.length > 0) {
    // 送り先は入力値ではなく、申込時に登録されたアドレス
    await sendPartyMail(items[0].order.email, buildLinkResendEmail(items), 'resend');
  }
  return { ok: true };
}
