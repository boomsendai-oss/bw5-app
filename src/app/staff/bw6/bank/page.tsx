// スタッフ：BW6 発表会の「見てほしい入金」（Task 29。決まりの紙 2-19・2-20・2-24）。
// 上から ①「振り込みました」のまま3日の世帯 ② 人が決める入金（カード）③ 候補の無い入金 ④ 片づいた入金（たたむ）。
// 名義・世帯の名前を出すので、proxy の cookie の確認に加えてセッションを本検証する（規約4.5）。?ev= は pickStaffEventKey の3つだけ。
// 残高と、出金の行は出さない（listReviewRows が返すのは入金の振込の行だけで、残高を返さない）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { RECITAL_EVENT, pickStaffEventKey } from '@/lib/recital';
import { listReviewRows, listToldWaiting } from '@/lib/recitalBankDb';
import { getRecitalEvent } from '@/lib/recitalDb';
import ReviewCards from './ReviewCards';

export const dynamic = 'force-dynamic';
// 当てる処理（メール・お金が変わったあとの仕事）が、ふつうの時間で切れないように（Server Action はこの画面の時間を使う）
export const maxDuration = 60;

const EVENT_TABS: { key: string; label: string }[] = [
  { key: RECITAL_EVENT.live, label: '本番' },
  { key: RECITAL_EVENT.test, label: '試し' },
  { key: RECITAL_EVENT.smoke, label: '動作確認' },
];

function withEv(href: string, ev: string): string {
  return `${href}?ev=${encodeURIComponent(ev)}`;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 'YYYY-MM-DD' → 'M月D日'（読めなければそのまま） */
function mdJa(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd ?? '';
  return `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
}

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

export default async function StaffBw6BankPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const ev = pickStaffEventKey(first(sp.ev));
  const isLive = ev === RECITAL_EVENT.live;

  const [event, told, rows] = await Promise.all([getRecitalEvent(ev), listToldWaiting(ev), listReviewRows(ev)]);

  return (
    <div>
      <StaffPageHeader
        title="見てほしい入金"
        description={`BW6 発表会（${ev}）`}
        backHref={withEv('/staff/bw6', ev)}
        backLabel="BW6 発表会"
        rightExtra={
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="発表会の切りかえ">
            {EVENT_TABS.map((t) => (
              <Link
                key={t.key}
                href={withEv('/staff/bw6/bank', t.key)}
                className={
                  t.key === ev
                    ? 'rounded-md bg-brand-600 px-3 py-1 font-bold text-white'
                    : 'rounded-md border border-sand-200 bg-white px-3 py-1 text-brand-700'
                }
              >
                {t.label}
              </Link>
            ))}
          </nav>
        }
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        {!isLive && (
          <p className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-700">
            試しの発表会（{ev}）を見ています。
          </p>
        )}
        {!event && (
          <p className="rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-sm text-sand-800">
            この発表会（{ev}）は、まだ作られていません。
          </p>
        )}
        <p className="text-sm">
          <Link href={withEv('/staff/bw6/bank/import', ev)} className="font-bold text-brand-700 underline">
            入金の取り込みの画面へ
          </Link>
        </p>

        {/* ① 「振り込みました」のまま3日 */}
        <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
          <h2 className="text-lg font-bold">「振り込みました」のまま3日 {told.length}件</h2>
          {told.length === 0 ? (
            <p className="mt-2 text-sm text-sand-700">ありません</p>
          ) : (
            <ul className="mt-2 divide-y divide-sand-100">
              {told.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                  <Link href={withEv(`/staff/bw6/entries/${h.id}`, ev)} className="font-mono font-bold text-brand-700 underline">
                    {h.ref_code}
                  </Link>
                  <span className="min-w-0 break-words">{`${h.contact_last_name ?? ''} ${h.contact_first_name ?? ''}`.trim()}</span>
                  <span>お振込みの日 {mdJa(h.bank_told_date)}</span>
                  <span className="min-w-0 break-words">お名前 {h.bank_told_name ?? '（なし）'}</span>
                  <span>{h.bank_told_amount == null ? '' : yen(Number(h.bank_told_amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ②③④ 見てほしい入金・候補の無い入金・片づいた入金 */}
        <ReviewCards rows={rows} ev={ev} />
      </div>
    </div>
  );
}
