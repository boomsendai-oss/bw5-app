// スタッフ: 特設ワークショップの申込一覧(支払い状態つき)・当日払いの受け取り・CSV・設定。
// /staff/* 配下なのでproxy認証で保護。個人情報を出す前にセッションを本検証する(規約4.5)。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { SP_WS_STATUS_LABEL, formatJpDateLong, formatJpDateTime, formatSpWsReceiptNo, isSpWsAccepting, nowJstMinute, venueLabel, yen } from '@/lib/spWs';
import { getSpWsEvent, getSpWsRemaining, listSpWsEntriesStaff, listSpWsEvents } from '@/lib/spWsDb';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { markSpWsPaid, saveSpWsSettings } from './actions';

export const dynamic = 'force-dynamic';

const inputCls = 'w-full rounded-lg border border-sand-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none';

export default async function StaffWsPage({ searchParams }: { searchParams: Promise<{ e?: string; saved?: string }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const events = await listSpWsEvents();
  const ev = sp.e ? await getSpWsEvent(sp.e) : events[0] ?? null;

  if (!ev) {
    return (
      <div>
        <StaffPageHeader title="特設ワークショップ 申込" description="ワークショップがまだ登録されていません(マイグレーション 20261124_sp_ws_tables.sql 未適用の可能性)" />
      </div>
    );
  }

  const now = nowJstMinute();
  const [entries, remaining] = await Promise.all([listSpWsEntriesStaff(ev.slug), getSpWsRemaining(ev)]);
  const accepting = isSpWsAccepting(ev, now, remaining);
  const confirmed = entries.filter((x) => x.paymentStatus === 'paid' || x.paymentStatus === 'onsite');
  const paidTotal = entries.filter((x) => x.paymentStatus === 'paid').reduce((s, x) => s + x.amountTotal, 0);
  const onsite = entries.filter((x) => x.paymentStatus === 'onsite');
  const onsiteTotal = onsite.reduce((s, x) => s + x.amountTotal, 0);
  const pending = entries.filter((x) => x.paymentStatus === 'pending').length;
  const members = confirmed.filter((x) => x.isMember).length;

  return (
    <div>
      <StaffPageHeader
        title="特設ワークショップ 申込"
        description={`${ev.title} / ${formatJpDateLong(ev.eventDate)} ${ev.startTime}〜${ev.endTime} / ${accepting ? '受付中' : '受付していません'}${ev.entryDeadline ? `(締切 ${formatJpDateTime(ev.entryDeadline)})` : ''}`}
        rightExtra={
          <div className="flex gap-2">
            <a href={`/api/staff/ws/csv?e=${encodeURIComponent(ev.slug)}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700">
              CSV書き出し
            </a>
            <Link href={`/ws/${encodeURIComponent(ev.slug)}`} target="_blank" className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-sand-50">
              申込ページ ↗
            </Link>
          </div>
        }
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4">
        {sp.saved && <p className="rounded-lg bg-brand-50 p-3 text-sm font-bold text-brand-800">設定を保存しました。</p>}

        {events.length > 1 && (
          <nav className="flex flex-wrap gap-2">
            {events.map((x) => (
              <Link
                key={x.slug}
                href={`/staff/ws?e=${encodeURIComponent(x.slug)}`}
                className={`rounded-full px-3 py-1 text-xs font-bold ${x.slug === ev.slug ? 'bg-navy-800 text-white' : 'border border-sand-300 bg-white text-navy-700'}`}
              >
                {x.title}
              </Link>
            ))}
          </nav>
        )}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Summary label="確定" value={`${confirmed.length}人`} note={`定員 ${ev.capacity}・残り${remaining}枠${pending > 0 ? `(決済待ち ${pending}件)` : ''}`} />
          <Summary label="会員 / 一般" value={`${members} / ${confirmed.length - members}`} note="自己申告" />
          <Summary label="受け取り済み" value={yen(paidTotal)} />
          <Summary label="当日払い(未収)" value={yen(onsiteTotal)} note={onsite.length > 0 ? `${onsite.length}件` : undefined} />
          <Summary label="会場" value={ev.venue ? '決定' : '調整中'} note={venueLabel(ev)} />
        </section>

        {entries.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white p-6 text-sm font-bold text-neutral-500">まだ申込はありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-sand-100 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">受付番号</th>
                  <th className="px-3 py-2 text-left font-bold">状態</th>
                  <th className="px-3 py-2 text-left font-bold">お名前</th>
                  <th className="px-3 py-2 text-left font-bold">連絡先</th>
                  <th className="px-3 py-2 text-right font-bold">金額</th>
                  <th className="px-3 py-2 text-left font-bold">申込日時</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((x) => (
                  <tr key={x.entryId} className={`border-t border-sand-200 align-top text-navy-900 ${x.paymentStatus === 'paid' || x.paymentStatus === 'onsite' ? '' : 'opacity-60'}`}>
                    <td className="px-3 py-2 font-bold tabular-nums">{formatSpWsReceiptNo(x, ev.slug)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${x.paymentStatus === 'paid' ? 'bg-brand-100 text-brand-800' : x.paymentStatus === 'onsite' ? 'bg-red-100 text-red-800' : x.paymentStatus === 'test' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'}`}>
                        {SP_WS_STATUS_LABEL[x.paymentStatus] ?? x.paymentStatus}
                      </span>
                      {x.paymentStatus === 'onsite' && (
                        <form action={markSpWsPaid} className="mt-1.5">
                          <input type="hidden" name="entryId" value={x.entryId} />
                          <button className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-bold text-red-700">現金を受け取った</button>
                        </form>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-bold">{x.name}</p>
                      <p className="text-xs text-neutral-500">{x.kana} / {x.age ?? '?'}歳 / {x.isMember ? '会員' : '一般'}</p>
                      {x.guardianName && <p className="text-xs text-neutral-500">保護者: {x.guardianName}{x.guardianConsent ? '(同意)' : ''}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-700">
                      <p>{x.email}</p>
                      <p>{x.phone}</p>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">
                      {yen(x.amountTotal)}
                      <p className="text-xs font-normal text-neutral-500">{x.payMethod === 'onsite' ? '当日現金' : 'カード'}</p>
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-neutral-500">{toJst(x.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="rounded-xl border border-sand-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold text-navy-800">設定(会場・講師紹介・写真・料金・定員・締切・受付の開閉)</summary>
          <form action={saveSpWsSettings} className="mt-4 space-y-4 text-sm text-navy-900">
            <input type="hidden" name="slug" value={ev.slug} />
            <label className="flex items-center gap-2 rounded-lg bg-sand-50 p-3 font-bold">
              <input type="checkbox" name="entry_open" value="1" defaultChecked={ev.entryOpen} className="h-4 w-4 accent-brand-600" />
              受付を開ける(締切を過ぎるか定員になると自動で閉じます)
            </label>
            <Grid>
              <F label="タイトル"><input name="title" defaultValue={ev.title} className={inputCls} /></F>
              <F label="サブタイトル"><input name="subtitle" defaultValue={ev.subtitle} className={inputCls} /></F>
              <F label="講師名"><input name="instructor_name" defaultValue={ev.instructorName} className={inputCls} /></F>
              <F label="講師名のよみ"><input name="instructor_kana" defaultValue={ev.instructorKana} className={inputCls} /></F>
              <F label="拠点(例: from KOREA)"><input name="instructor_from" defaultValue={ev.instructorFrom} className={inputCls} /></F>
              <F label="ジャンル"><input name="instructor_genre" defaultValue={ev.instructorGenre} className={inputCls} /></F>
              <F label="Instagram(@なし)"><input name="instructor_instagram" defaultValue={ev.instructorInstagram} className={inputCls} /></F>
              <F label="写真のURL(https://〜。空なら写真なしのデザイン)"><input name="photo_url" defaultValue={ev.photoUrl} className={inputCls} /></F>
            </Grid>
            <F label="講師紹介"><textarea name="instructor_bio" defaultValue={ev.instructorBio} rows={3} className={inputCls} /></F>
            <F label="ワークショップの説明"><textarea name="description" defaultValue={ev.description} rows={3} className={inputCls} /></F>
            <Grid>
              <F label="開催日"><input type="date" name="event_date" defaultValue={ev.eventDate} className={inputCls} /></F>
              <F label="開始・終了(HH:MM)">
                <div className="flex gap-1">
                  <input name="start_time" defaultValue={ev.startTime} className={inputCls} />
                  <input name="end_time" defaultValue={ev.endTime} className={inputCls} />
                </div>
              </F>
              <F label="会場(空なら「調整中」と出ます)"><input name="venue" defaultValue={ev.venue} className={inputCls} /></F>
              <F label="会場の住所"><input name="venue_address" defaultValue={ev.venueAddress} className={inputCls} /></F>
              <F label="参加費(円)"><input type="number" name="fee" defaultValue={ev.fee} className={inputCls} /></F>
              <F label="定員"><input type="number" name="capacity" defaultValue={ev.capacity} className={inputCls} /></F>
              <F label="申込の締切"><input type="datetime-local" name="entry_deadline" defaultValue={ev.entryDeadline} className={inputCls} /></F>
              <F label="対象(空なら出しません)"><input name="target" defaultValue={ev.target} className={inputCls} /></F>
              <F label="お問い合わせ先"><input name="contact" defaultValue={ev.contact} className={inputCls} /></F>
            </Grid>
            <F label="持ち物(1行に1つ)"><textarea name="belongings" defaultValue={ev.belongings} rows={3} className={inputCls} /></F>
            <F label="キャンセルについて"><textarea name="cancel_policy" defaultValue={ev.cancelPolicy} rows={2} className={inputCls} /></F>
            <button className="rounded-lg bg-brand-600 px-4 py-2 font-bold text-white hover:bg-brand-700">保存する</button>
          </form>
        </details>
      </div>
    </div>
  );
}

function toJst(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function Summary({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-3">
      <p className="text-xs font-bold text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-navy-800">{value}</p>
      {note && <p className="text-xs text-neutral-500">{note}</p>}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
