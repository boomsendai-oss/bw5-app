// スタッフ: メロジョイ在庫見張りの記録(読むだけ)。/staff/* 配下のためproxy認証で保護(規約4.5)。
// 見張り本体は /api/cron/mellojoy-watch(boom-cron が毎日 11:56〜12:30 は毎分・12:45・13:30)。
// 入荷パターンを学ぶため、今の在庫と直近50件の記録(入荷→売り切れまでの時間)を出す。
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import {
  MELLOJOY_ALL_URL,
  availableSecondsOf,
  formatDuration,
  formatPrice,
  productUrl,
  shortTitle,
  type EventKind,
} from '@/lib/mellojoyWatch';
import { listMellojoyEvents, loadMellojoyState } from '@/lib/mellojoyWatchDb';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<EventKind, string> = {
  restock: '入荷',
  soldout: '売り切れ',
  new_product: '新しく見た',
  updated_while_soldout: '売り切れのまま更新',
  fetch_error: '取得失敗',
};

const KIND_CLASS: Record<EventKind, string> = {
  restock: 'bg-brand-600 text-white',
  soldout: 'bg-navy-800 text-white',
  new_product: 'bg-sand-200 text-navy-900',
  updated_while_soldout: 'bg-sand-100 text-navy-800',
  fetch_error: 'bg-neutral-200 text-neutral-700',
};

function jst(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return iso || '—';
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default async function StaffMellojoyPage() {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const [states, events] = await Promise.all([loadMellojoyState(), listMellojoyEvents(50)]);
  const latestSeen = states.reduce((m, s) => (s.lastSeenAt > m ? s.lastSeenAt : m), '');
  const availableNow = states.filter((s) => s.available).length;

  return (
    <div>
      <StaffPageHeader
        title="メロジョイ 在庫見張り"
        description={`公式ストアの在庫を毎日 11:56〜12:30 は毎分・12:45・13:30 に確認。入荷したらPushoverで通知(読むだけ・購入はしない)。最終確認 ${latestSeen ? jst(latestSeen) : '未実行'}`}
        rightExtra={
          <a
            href={MELLOJOY_ALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-brand-600 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50"
          >
            ストアを開く
          </a>
        }
      />
      <div className="mx-auto max-w-5xl space-y-6 p-4">
        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">
            今の在庫({availableNow} / {states.length})
          </h2>
          {states.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">まだ一度も確認していません</p>
          ) : (
            <ul className="mt-3 divide-y divide-sand-100">
              {states.map((s) => {
                const gone = latestSeen && s.lastSeenAt < latestSeen;
                return (
                  <li key={s.variantId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm text-navy-900">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${s.available ? 'bg-brand-600 text-white' : 'bg-sand-100 text-navy-800'}`}
                    >
                      {s.available ? '在庫あり' : '在庫なし'}
                    </span>
                    <a href={productUrl(s.handle)} target="_blank" rel="noopener noreferrer" className="text-navy-900 underline-offset-2 hover:underline">
                      {shortTitle(s.productTitle)}
                    </a>
                    <span className="tabular-nums text-neutral-600">{formatPrice(s.price)}</span>
                    <span className="text-xs text-neutral-500">
                      {s.available ? '在庫ありになった' : '在庫なしになった'} {jst(s.lastChangeAt)}
                      {gone ? ' ・ 今は一覧に無い' : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">記録(直近50件)</h2>
          <p className="mt-1 text-xs text-neutral-500">
            「売り切れ」の在庫あり時間 = 見張りが在庫ありを見た時刻から売り切れを見た時刻まで(1分おきに見ているので最大1分ほどずれる)。
            「売り切れのまま更新」= 見張りの間に入荷→売り切れした可能性
          </p>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">まだありません</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm text-navy-900">
                <thead>
                  <tr className="border-b border-sand-200 text-left text-xs text-neutral-500">
                    <th className="py-1 pr-2">時刻(JST)</th>
                    <th className="py-1 pr-2">内容</th>
                    <th className="py-1 pr-2">商品</th>
                    <th className="py-1 pr-2 text-right">価格</th>
                    <th className="py-1">在庫あり時間・詳細</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const sec = e.kind === 'soldout' ? availableSecondsOf(e.detail) : null;
                    return (
                      <tr key={e.id} className="border-b border-sand-100 align-top">
                        <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">{jst(e.at)}</td>
                        <td className="py-1.5 pr-2">
                          <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold ${KIND_CLASS[e.kind] ?? 'bg-neutral-200 text-neutral-700'}`}>
                            {KIND_LABEL[e.kind] ?? e.kind}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2">{e.productTitle ? shortTitle(e.productTitle) : '—'}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{formatPrice(e.price)}</td>
                        <td className="py-1.5 text-xs text-neutral-600">
                          {sec != null ? <span className="font-bold text-navy-900">{formatDuration(sec)}</span> : e.detail}
                          {sec != null && e.detail.includes('一覧から消えた') ? ' ・ 一覧から消えた' : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
