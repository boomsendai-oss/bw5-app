// スタッフ: BF6 エントリー者への一斉メール。/staff/* 配下のためproxy認証で保護(規約4.5)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { BF6_BROADCAST_TEMPLATES, getBf6BroadcastRecipients, listBf6Broadcasts, listBf6BroadcastFailures } from '@/lib/bf6Broadcast';
import { SendButton } from './SendButton';
import { RetryButton } from './RetryButton';

export const dynamic = 'force-dynamic';

export default async function StaffBf6BroadcastPage() {
  // 宛先の範囲はテンプレートごとに違う(当日の段取り=エントリー者だけ / 配信の案内=全員)
  const [entrants, all, history, failures] = await Promise.all([
    getBf6BroadcastRecipients('entrants'),
    getBf6BroadcastRecipients('all'),
    listBf6Broadcasts(),
    listBf6BroadcastFailures(),
  ]);
  const failedOf = (key: string) => failures.find((f) => f.key === key)?.failed ?? 0;
  const countOf = (a: 'entrants' | 'all') => (a === 'all' ? all.length : entrants.length);
  const sentKeys = new Set(history.map((h) => h.key));

  return (
    <div>
      <StaffPageHeader
        title="一斉メール"
        description="バトルエントリー者へのお知らせ"
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <section className="rounded-2xl border border-sand-200 bg-white p-4">
          <p className="text-sm font-bold text-navy-900">宛先の候補</p>
          <ul className="mt-1 space-y-1 text-xs text-neutral-500">
            <li>エントリー者のみ … {entrants.length} 名</li>
            <li>有効な注文すべて … {all.length} 名</li>
          </ul>
          <p className="mt-2 text-xs text-neutral-500">
            重複は除いています。どちらを使うかはメールごとに決まっていて、下の各項目に書いてあります。
          </p>
        </section>

        {BF6_BROADCAST_TEMPLATES.map((t) => (
          <section key={t.key} className="rounded-2xl border border-sand-200 bg-white p-4">
            <p className="text-xs font-bold tracking-widest text-brand-600">{t.label}</p>
            <p className="mt-1 text-sm font-black text-navy-900">{t.subject}</p>
            <p className="mt-2 rounded-lg bg-sand-50 px-3 py-2 text-xs leading-relaxed text-neutral-600">
              宛先 {countOf(t.audience)} 名 — {t.audienceNote}
            </p>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-sand-50 p-3 text-xs leading-relaxed text-neutral-700">
              {t.body}
            </pre>
            <div className="mt-4">
              <SendButton templateKey={t.key} count={countOf(t.audience)} alreadySent={sentKeys.has(t.key)} />
              {failedOf(t.key) > 0 && (
                <div className="mt-3">
                  <RetryButton templateKey={t.key} failed={failedOf(t.key)} />
                </div>
              )}
            </div>
          </section>
        ))}

        {history.length > 0 && (
          <section className="rounded-2xl border border-sand-200 bg-white p-4">
            <p className="text-sm font-bold text-navy-900">送信履歴</p>
            <ul className="mt-2 space-y-2 text-xs text-neutral-600">
              {history.map((h) => (
                <li key={h.key} className="border-b border-sand-100 pb-2 last:border-b-0">
                  <span className="font-bold text-navy-900">{h.subject}</span>
                  <br />
                  成功 {h.sentCount}件 / 失敗 {h.failedCount}件 — {h.createdAt}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
