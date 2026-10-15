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
  findEntriesForAudio,
  savePartyAudioById,
  getPartySettings,
  loadPartyOrderByToken,
  savePartyStripeSession,
  extendPartyHold,
} from '@/lib/partyDb';
import { buildPartyCheckoutParams, buildPartyLineItems, retrieveCheckoutSession } from '@/lib/partyStripe';
import { createBf6CheckoutSession } from '@/lib/bf6Stripe';
import { buildAudioReceivedEmail, sendPartyMail, sendPartyOrderEmail } from '@/lib/partyEmail';
import { makeAudioTicket } from '@/lib/partyAudioTicket';
import { resolveAudioCredential } from '@/lib/partyAudio';
import { isXmasPreview } from '@/lib/partyPreview';

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
  preview: boolean;
  /** 表示の基準時刻(サーバ) */
  nowMs: number;
}

/** 公開: 料金・受付状態・残りチーム数(いずれも公開情報)。名簿・PIIは含まない。 */
export async function getXmasContext(preview?: string): Promise<XmasPublicContext> {
  const settings = await getPartySettings(EV);
  const holding = await countHoldingTeams(EV);
  const now = new Date();
  // プレビュー鍵つきのときだけ、受付開始前でも「受付中の画面」を表示する(表示のみ。申込の判定は本物の設定で行う)
  const isPreview = isXmasPreview(EV, preview);
  const gateSettings = isPreview ? { ...settings, openAt: '2000-01-01T00:00', suspended: false } : settings;
  return {
    settings,
    ticketCard: ticketCardState(gateSettings, now),
    ticketCash: ticketCashState(gateSettings, now),
    entry: entryState(gateSettings, now, holding),
    teamsLeft: Math.max(0, settings.teamCap - holding),
    entryUnit: entryUnitPrice(settings),
    preview: isPreview,
    nowMs: now.getTime(),
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
  // 決済ページを何度も作り直して枠を押さえ続けられないよう、申込から90分を過ぎたら受け付けない
  if (Date.now() - new Date(o.createdAt).getTime() > 90 * 60 * 1000) {
    return { ok: false, error: '申込から時間が経ったため、この申込では決済できません。お手数ですがもう一度お申し込みください' };
  }
  // 同じ申込で決済ページを作り直さない(押し直し・別タブで二重に請求されるのを防ぐ)
  if (o.stripeSessionId) {
    const prev = await retrieveCheckoutSession(o.stripeSessionId);
    if (prev.status === 'complete') {
      return { ok: false, error: 'お支払いは完了しています。反映まで少しかかることがあります。数分後にこのページを再読み込みしてください' };
    }
    if (prev.status === 'open' && prev.url && prev.expiresAtSec * 1000 > Date.now() + 60_000) {
      await extendPartyHold(o.id, new Date(prev.expiresAtSec * 1000 + 60_000).toISOString());
      return { ok: true, url: prev.url };
    }
  }
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'bw5-app.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const myUrl = `${proto}://${host}/xmas/my?t=${token}`;
  // Stripeの決済ページの有効期限は最短30分。仮押さえもその期限(+1分)まで延ばし、
  // 「仮押さえが切れて枠が空いた後に入金される」ことがないようにする
  const expiresAtEpochSec = Math.floor(Date.now() / 1000) + 30 * 60 + 5;
  try {
    const params = buildPartyCheckoutParams({
      lineItems: buildPartyLineItems(o),
      successUrl: myUrl,
      cancelUrl: myUrl,
      customerEmail: o.email,
      orderId: o.id,
      expiresAtEpochSec,
    });
    const session = await createBf6CheckoutSession(params);
    await savePartyStripeSession(o.id, session.id);
    await extendPartyHold(o.id, new Date((expiresAtEpochSec + 60) * 1000).toISOString());
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済ページの作成に失敗しました' };
  }
}

/**
 * 音源アップロード後にURLを控える。Blobの中身はアップロード用トークン発行時に
 * 申込・締切・形式・サイズを検証済み。ここではURLが自分のストアの所定の場所かを確かめる。
 */
export async function saveXmasAudio(credential: string, url: string, filename: string): Promise<{ ok: boolean; error?: string }> {
  const o = await resolveAudioCredential(credential);
  if (!o) return { ok: false, error: '時間が経ったため保存できませんでした。もう一度チームを探してからアップロードしてください' };
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
  const ok = await savePartyAudioById(o.id, url, filename);
  if (!ok) return { ok: false, error: 'エントリーが確定していないため保存できません' };
  // 提出・差し替えのたびに登録メールアドレスへ知らせる(身に覚えのない差し替えに気づけるように)
  await sendPartyMail(o.email, buildAudioReceivedEmail(o, filename), 'audio-received');
  return { ok: true };
}

export type XmasAudioLookup =
  | { ok: true; teams: { ticket: string; orderId: number; teamName: string; audioFilename: string }[] }
  | { ok: false; error: string };

/**
 * 「ショーケースに出演される方へ」ページ: エントリー時のメールアドレスかチーム名で、確定済みの
 * 出演エントリーを探す。返すのはチーム名・提出状況と、そのチームの音源を上げるための短時間の通行証だけ
 * (代表者名・メンバー名などの個人情報や、控えページを開けるトークンは返さない)。
 */
export async function findXmasEntryForAudio(query: string): Promise<XmasAudioLookup> {
  if (!(await checkRateLimit(`xmasaudiolookup:${await ip()}`, 15, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const q = String(query ?? '').trim();
  if (!q) return { ok: false, error: 'メールアドレスかチーム名を入れてください' };
  const hits = await findEntriesForAudio(EV, q);
  if (hits.length === 0) {
    return { ok: false, error: 'エントリーが見つかりません。エントリー時のメールアドレスか、チーム名をご確認ください' };
  }
  return {
    ok: true,
    teams: hits.map((o) => ({ ticket: makeAudioTicket(o.id), orderId: o.id, teamName: o.teamName, audioFilename: o.audioFilename })),
  };
}
