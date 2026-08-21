// スタッフ: BF6 エントリー者への一斉メール。/staff/* 配下のためproxy認証で保護(規約4.5)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { BF6_BROADCAST_TEMPLATES, getBf6BroadcastRecipients, listBf6Broadcasts } from '@/lib/bf6Broadcast';
import { SendButton } from './SendButton';

export const dynamic = 'force-dynamic';

export default async function StaffBf6BroadcastPage() {
  const [recipients, history] = await Promise.all([getBf6BroadcastRecipients(), listBf6Broadcasts()]);
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
          <p className="text-sm font-bold text-navy-900">宛先 {recipients.length} 名</p>
          <p className="mt-1 text-xs text-neutral-500">
            バトルエントリーを含む有効な注文(決済済み・当日現金)のメールアドレス。重複は除いています。
            観覧チケットのみ・配信チケットのみの購入者には送りません。
          </p>
        </section>

        {BF6_BROADCAST_TEMPLATES.map((t) => (
          <section key={t.key} className="rounded-2xl border border-sand-200 bg-white p-4">
            <p className="text-xs font-bold tracking-widest text-brand-600">{t.label}</p>
            <p className="mt-1 text-sm font-black text-navy-900">{t.subject}</p>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-sand-50 p-3 text-xs leading-relaxed text-neutral-700">
              {t.body}
            </pre>
            <div className="mt-4">
              <SendButton templateKey={t.key} count={recipients.length} alreadySent={sentKeys.has(t.key)} />
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
