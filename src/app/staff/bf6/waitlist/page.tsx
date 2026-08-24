// スタッフ: キャンセル待ちの管理。/staff/* 配下のためproxy認証で保護(規約4.5)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { BF6_DIVISIONS } from '@/lib/bf6';
import { calcBf6Remaining, getBf6Settings, getBf6Usage } from '@/lib/bf6Db';
import { listWaitlist } from '@/lib/bf6WaitlistDb';
import { formatOfferDeadline } from '@/lib/bf6Waitlist';
import { ExpireButton, OfferButton } from './OfferButton';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  waiting: { text: '待機中', cls: 'bg-neutral-100 text-neutral-600' },
  offered: { text: '案内済み・返答待ち', cls: 'bg-amber-100 text-amber-800' },
  accepted: { text: '出場確定', cls: 'bg-emerald-100 text-emerald-800' },
  declined: { text: '辞退', cls: 'bg-neutral-100 text-neutral-400' },
  expired: { text: '期限切れ', cls: 'bg-red-100 text-red-700' },
};

export default async function StaffBf6WaitlistPage() {
  const [settings, usage] = await Promise.all([getBf6Settings(), getBf6Usage()]);
  const remaining = calcBf6Remaining(settings, usage);
  const lists = await Promise.all(BF6_DIVISIONS.map((d) => listWaitlist(d.key)));

  return (
    <div>
      <StaffPageHeader
        title="キャンセル待ち"
        description="繰り上げの通知はここから手動で送ります"
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <section className="rounded-2xl border border-sand-200 bg-white p-4">
          <p className="text-xs leading-relaxed text-neutral-600">
            キャンセル待ちは<b>満枠の部門のみ</b>受け付けます(各部門5名まで・先着順)。
            代金は預かっていません。繰り上がった方は<b>当日会場で現金払い</b>です。
            返答期限は本番7日前までは48時間、それ以降は24時間になります。
          </p>
          <div className="mt-3">
            <ExpireButton />
          </div>
        </section>

        {BF6_DIVISIONS.map((d, i) => {
          const rows = lists[i];
          const waiting = rows.filter((r) => r.status === 'waiting').length;
          const free = remaining.divisions[d.key] ?? 0;
          return (
            <section key={d.key} className="rounded-2xl border border-sand-200 bg-white p-4">
              <div className="flex items-baseline justify-between">
                <p className="font-black text-navy-900">{d.label}</p>
                <p className="text-xs text-neutral-500">
                  空き {free}枠 / 待機 {waiting}名
                </p>
              </div>

              {rows.length === 0 ? (
                <p className="mt-3 text-xs text-neutral-400">登録はありません</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {rows.map((r) => {
                    const st = STATUS_LABEL[r.status] ?? { text: r.status, cls: 'bg-neutral-100' };
                    return (
                      <li key={r.id} className="rounded-xl border border-sand-100 p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-navy-900">{r.position}.</span>
                          <span className="font-bold">{r.dancerName}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.text}</span>
                        </div>
                        <p className="mt-1 text-xs text-neutral-500">
                          {r.performerName} / {r.grade} / {r.rep} — {r.email}
                        </p>
                        {r.status === 'offered' && r.offerExpiresAt && (
                          <p className="mt-1 text-xs font-bold text-amber-700">
                            返答期限 {formatOfferDeadline(r.offerExpiresAt)}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {free > 0 && waiting > 0 && (
                <div className="mt-4">
                  <OfferButton division={d.key} label={d.label} waiting={waiting} />
                </div>
              )}
              {free === 0 && waiting > 0 && (
                <p className="mt-4 rounded-xl bg-neutral-100 p-3 text-xs font-bold text-neutral-500">
                  空きがないため繰り上げできません(キャンセルが出ると通知ボタンが出ます)
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
