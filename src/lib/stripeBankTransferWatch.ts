// Stripe の銀行振込(jp_bank_transfer_payments)が使えるようになったかを毎朝確かめ、変わったら1回だけTAROに知らせる。
// 背景(2026-11-06): HIRO WS の振込を Stripe の銀行振込に切り替えたが、有効化に本人確認の審査(数日)が要る。
// 審査が通るまでは WS の振込は固定の口座(BF7_WS_BANK)に切り替わるので、通ったら¥100の本番テストをしたい。
// /api/cron/mail-health(毎朝 07:30)から呼ぶ。12/1 を過ぎたら何もしない。
import { execute, getOne } from '@/lib/db';
import { todayJst } from '@/lib/dateJst';

const NOTIFIED_KEY = 'stripe_jp_bank_transfer_notified';
const WATCH_UNTIL = '2026-12-01';

export type BankTransferWatchDecision = { notify: false } | { notify: true; state: 'active' | 'action_needed'; subject: string; body: string };

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeの応答は動的構造 */
/** Stripe の account から、知らせるべきかを決める(前回知らせた状態と同じなら知らせない) */
export function decideBankTransferNotice(account: any, lastNotified: string): BankTransferWatchDecision {
  const cap = account?.capabilities?.jp_bank_transfer_payments;
  if (cap === 'active') {
    if (lastNotified === 'active') return { notify: false };
    return {
      notify: true,
      state: 'active',
      subject: 'Stripeの銀行振込が使えるようになりました',
      body: 'HIRO WSの振込は、Stripeの専用振込先で入金が自動で確認されるようになりました。¥100の本番テストをBF7のセッションに頼んでください。',
    };
  }
  const due = [...(account?.requirements?.past_due ?? []), ...(account?.requirements?.currently_due ?? [])];
  if (due.length > 0 && lastNotified !== 'action_needed' && lastNotified !== 'active') {
    return {
      notify: true,
      state: 'action_needed',
      subject: 'Stripeの本人確認で対応が必要です',
      body: 'Stripeの管理画面に、本人確認などの対応待ちの項目があります。Stripeからのメールか管理画面のお知らせを確認してください。',
    };
  }
  return { notify: false };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function runStripeBankTransferWatch(notify: (o: { subject: string; body: string }) => Promise<void>): Promise<void> {
  if (todayJst() >= WATCH_UNTIL) return;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;
  const last = String((await getOne('SELECT value FROM settings WHERE key = ?', [NOTIFIED_KEY]))?.value ?? '');
  if (last === 'active') return;
  const res = await fetch('https://api.stripe.com/v1/account', { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error('[stripe-bank-transfer-watch] account fetch failed', res.status);
    return;
  }
  const d = decideBankTransferNotice(await res.json(), last);
  if (!d.notify) return;
  await notify({ subject: d.subject, body: d.body });
  await execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [NOTIFIED_KEY, d.state]);
}
