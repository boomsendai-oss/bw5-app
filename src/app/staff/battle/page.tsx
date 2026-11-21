// スタッフ: 月1プチバトルの回ごとの申込一覧(支払い状態つき)・CSV・イベント設定。
// /staff/* 配下なのでproxy認証で保護。個人情報を出す前にセッションを本検証する(規約4.5)。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { BATTLE_STATUS_LABEL, ageOn, formatBattleReceiptNo, formatJpDateLong, formatJpDateTime, isBattleAccepting, nowJstMinute, yen } from '@/lib/battle';
import { getBattleRemaining, getCurrentBattleEvent, getBattleEvent, listBattleEntriesStaff, listBattleEvents } from '@/lib/battleDb';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { createNextBattleEvent, markOnsitePaid, saveBattleEventSettings } from './actions';

export const dynamic = 'force-dynamic';

const inputCls = 'w-full rounded-lg border border-sand-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none';

export default async function StaffBattlePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; saved?: string; created?: string; err?: string }>;
}) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const now = nowJstMinute();
  const events = await listBattleEvents();
  const ev = sp.e ? await getBattleEvent(sp.e) : await getCurrentBattleEvent(now.slice(0, 10));

  if (!ev) {
    return (
      <div>
        <StaffPageHeader title="月1プチバトル 申込" description="回がまだ登録されていません(マイグレーション 20261119_battle_tables.sql 未適用の可能性)" />
      </div>
    );
  }

  const [entries, remaining] = await Promise.all([listBattleEntriesStaff(ev.eventKey), getBattleRemaining(ev)]);
  const accepting = isBattleAccepting(ev, now);
  const confirmed = entries.filter((x) => x.paymentStatus === 'paid' || x.paymentStatus === 'onsite');
  const paid = confirmed;
  const paidTotal = entries.filter((x) => x.paymentStatus === 'paid').reduce((s, x) => s + x.amountTotal, 0);
  const onsite = entries.filter((x) => x.paymentStatus === 'onsite');
  const onsiteTotal = onsite.reduce((s, x) => s + x.amountTotal, 0);
  const pending = entries.filter((x) => x.paymentStatus === 'pending').length;
  const spectators = paid.reduce((s, x) => s + x.spectators, 0);
  const preschool = paid.reduce((s, x) => s + x.spectatorsPreschool, 0);
  const divName = (k: string) => ev.divisions.find((d) => d.key === k)?.name ?? k;
  const divRows = [...ev.divisions, { key: '', name: '', note: '', capacity: 16, maxAge: null }];
  const castRows = [...ev.cast, { role: '', mark: '', name: '', photo: '', note: '', instagram: '', announced: false }];

  return (
    <div>
      <StaffPageHeader
        title="月1プチバトル 申込"
        description={`${ev.title} / ${formatJpDateLong(ev.eventDate)} / ${accepting ? '受付中' : '受付していません'}${ev.entryDeadline ? `(締切 ${formatJpDateTime(ev.entryDeadline)})` : ''}`}
        rightExtra={
          <div className="flex gap-2">
            <a href={`/api/staff/battle/csv?e=${encodeURIComponent(ev.eventKey)}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700">
              CSV書き出し
            </a>
            <Link href={`/dojo?e=${encodeURIComponent(ev.eventKey)}`} target="_blank" className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-sand-50">
              申込ページ ↗
            </Link>
            <Link href={`/dojo/entries?e=${encodeURIComponent(ev.eventKey)}`} target="_blank" className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-sand-50">
              エントリー一覧 ↗
            </Link>
          </div>
        }
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4">
        {sp.saved && <p className="rounded-lg bg-brand-50 p-3 text-sm font-bold text-brand-800">設定を保存しました。</p>}
        {sp.created && <p className="rounded-lg bg-brand-50 p-3 text-sm font-bold text-brand-800">新しい回を作りました(受付は「閉」です。設定を確認してから開けてください)。</p>}
        {sp.err === 'exists' && <p className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">その日付の回はもうあります。</p>}
        {sp.err === 'date' && <p className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">日付を正しく入れてください。</p>}

        <nav className="flex flex-wrap gap-2">
          {events.map((x) => (
            <Link
              key={x.eventKey}
              href={`/staff/battle?e=${encodeURIComponent(x.eventKey)}`}
              className={`rounded-full px-3 py-1 text-xs font-bold ${x.eventKey === ev.eventKey ? 'bg-navy-800 text-white' : 'border border-sand-300 bg-white text-navy-700'}`}
            >
              {x.eventKey}
            </Link>
          ))}
        </nav>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="確定" value={`${paid.length}人`} note={pending > 0 ? `決済待ち ${pending}件` : undefined} />
          <Summary label="受け取り済み" value={yen(paidTotal)} />
          <Summary label="当日払い(未収)" value={yen(onsiteTotal)} note={onsite.length > 0 ? `${onsite.length}件` : undefined} />
          <Summary label="同行の観覧" value={`${spectators}名`} note={preschool > 0 ? `ほか未就学児 ${preschool}名` : undefined} />
          <Summary label="申込(全状態)" value={`${entries.length}件`} />
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {ev.divisions.map((d) => (
            <div key={d.key} className="rounded-xl border border-sand-200 bg-white p-3">
              <p className="text-xs font-bold text-neutral-500">{d.name}</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-navy-800">
                {paid.filter((x) => x.divisions.includes(d.key)).length}
                <span className="text-xs text-neutral-500"> 確定 / 定員 {d.capacity}(残り{remaining[d.key] ?? 0}枠)</span>
              </p>
            </div>
          ))}
        </section>

        {entries.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white p-6 text-sm font-bold text-neutral-500">まだ申込はありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-sand-100 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">受付番号</th>
                  <th className="px-3 py-2 text-left font-bold">状態</th>
                  <th className="px-3 py-2 text-left font-bold">ダンサー名</th>
                  <th className="px-3 py-2 text-left font-bold">本名・連絡先</th>
                  <th className="px-3 py-2 text-left font-bold">部門</th>
                  <th className="px-3 py-2 text-right font-bold">観覧</th>
                  <th className="px-3 py-2 text-right font-bold">金額</th>
                  <th className="px-3 py-2 text-left font-bold">申込日時</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((x) => (
                  <tr key={x.entryId} className={`border-t border-sand-200 align-top text-navy-900 ${x.paymentStatus === 'paid' || x.paymentStatus === 'onsite' ? '' : 'opacity-60'}`}>
                    <td className="px-3 py-2 font-bold tabular-nums">{formatBattleReceiptNo(x.entryId, x.eventKey)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${x.paymentStatus === 'paid' ? 'bg-brand-100 text-brand-800' : x.paymentStatus === 'onsite' ? 'bg-red-100 text-red-800' : x.paymentStatus === 'test' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-600'}`}>
                        {BATTLE_STATUS_LABEL[x.paymentStatus] ?? x.paymentStatus}
                      </span>
                      {x.paymentStatus === 'onsite' && (
                        <form action={markOnsitePaid} className="mt-1.5">
                          <input type="hidden" name="entryId" value={x.entryId} />
                          <input type="hidden" name="e" value={ev.eventKey} />
                          <button className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-bold text-red-700">現金を受け取った</button>
                        </form>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-bold">{x.dancerName}</p>
                      <p className="text-xs text-neutral-500">{x.dancerKana} / {x.rep} / {x.genre}</p>
                      {x.instagram && <p className="text-xs text-neutral-500">{x.instagram}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-700">
                      <p className="text-sm font-bold text-navy-900">{x.realName}</p>
                      <p>{x.birthdate}(開催日{ageOn(x.birthdate, ev.eventDate)}歳)</p>
                      <p>{x.email} / {x.phone}</p>
                      {x.guardianName && <p>保護者: {x.guardianName}{x.guardianConsent ? '(同意)' : ''}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-700">{x.divisions.map(divName).map((n) => <p key={n}>{n}</p>)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.spectators}{x.spectatorsPreschool > 0 && <span className="text-xs text-neutral-500">+幼{x.spectatorsPreschool}</span>}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{yen(x.amountTotal)}</td>
                    <td className="px-3 py-2 text-xs tabular-nums text-neutral-500">{toJst(x.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="rounded-xl border border-sand-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold text-navy-800">この回の設定(名前・説明・日時・部門・料金・定員・受付の開閉)</summary>
          <form action={saveBattleEventSettings} className="mt-4 space-y-4 text-sm text-navy-900">
            <input type="hidden" name="event_key" value={ev.eventKey} />
            <label className="flex items-center gap-2 rounded-lg bg-sand-50 p-3 font-bold">
              <input type="checkbox" name="entry_open" value="1" defaultChecked={ev.entryOpen} className="h-4 w-4 accent-brand-600" />
              受付を開ける(チェックを外すと一般の人は申し込めません。締切を過ぎると自動で閉じます)
            </label>
            <Grid>
              <F label="イベント名"><input name="title" defaultValue={ev.title} className={inputCls} /></F>
              <F label="サブタイトル"><input name="subtitle" defaultValue={ev.subtitle} className={inputCls} /></F>
            </Grid>
            <F label="説明文"><textarea name="description" defaultValue={ev.description} rows={3} className={inputCls} /></F>
            <Grid>
              <F label="開催日"><input type="date" name="event_date" defaultValue={ev.eventDate} className={inputCls} /></F>
              <F label="受付開始・開始・終了(HH:MM)">
                <div className="flex gap-1">
                  <input name="open_time" defaultValue={ev.openTime} className={inputCls} />
                  <input name="start_time" defaultValue={ev.startTime} className={inputCls} />
                  <input name="end_time" defaultValue={ev.endTime} className={inputCls} />
                </div>
              </F>
              <F label="会場"><input name="venue" defaultValue={ev.venue} className={inputCls} /></F>
              <F label="会場の住所"><input name="venue_address" defaultValue={ev.venueAddress} className={inputCls} /></F>
              <F label="1ムーブの秒数"><input type="number" name="move_seconds" defaultValue={ev.moveSeconds} className={inputCls} /></F>
            </Grid>
            <div>
              <p className="mb-1 text-xs font-bold text-neutral-500">部門(名前を空にすると消えます。最後の空の行に書くと追加)</p>
              <div className="space-y-2">
                {divRows.map((d, i) => (
                  <div key={i} className="grid grid-cols-[2fr_1.5fr_5rem_5rem] gap-1">
                    <input type="hidden" name={`div_key_${i}`} value={d.key} />
                    <input name={`div_name_${i}`} defaultValue={d.name} placeholder="部門名" className={inputCls} />
                    <input name={`div_note_${i}`} defaultValue={d.note} placeholder="補足(例: 開催日に12歳以下)" className={inputCls} />
                    <input type="number" name={`div_capacity_${i}`} defaultValue={d.capacity} title="定員" className={inputCls} />
                    <input type="number" name={`div_maxage_${i}`} defaultValue={d.maxAge ?? ''} placeholder="年齢上限" title="開催日の満年齢の上限(空=制限なし)" className={inputCls} />
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-500">右の2つ = 定員 / 開催日の満年齢の上限(空なら制限なし)</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-neutral-600">出演者(ジャッジ・DJ・MC)</p>
              <div className="space-y-1">
                {castRows.map((c, i) => (
                  <div key={i} className="grid grid-cols-[7rem_3rem_1fr_1fr_1fr_1fr_5.5rem] items-center gap-1">
                    <input name={`cast_role_${i}`} defaultValue={c.role} placeholder="役割(JUDGE)" className={inputCls} />
                    <input name={`cast_mark_${i}`} defaultValue={c.mark} placeholder="字" title="木札に大きく入れる漢字1文字" maxLength={2} className={inputCls} />
                    <input name={`cast_name_${i}`} defaultValue={c.name} placeholder="名前" className={inputCls} />
                    <input name={`cast_photo_${i}`} defaultValue={c.photo} placeholder="写真のURL" className={inputCls} />
                    <input name={`cast_note_${i}`} defaultValue={c.note} placeholder="ジャンル・所属など" className={inputCls} />
                    <input name={`cast_ig_${i}`} defaultValue={c.instagram} placeholder="Instagram(@なし)" className={inputCls} />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" name={`cast_on_${i}`} value="1" defaultChecked={c.announced} />公開する</label>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-500">「公開する」にチェックが無い人は、申込ページで「近日発表」と出ます。役割を空にすると消えます。</p>
            </div>
            <Grid>
              <F label="エントリー料(1部門)"><input type="number" name="entry_fee" defaultValue={ev.entryFee} className={inputCls} /></F>
              <F label="遅い時間のエントリー料"><input type="number" name="entry_fee_late" defaultValue={ev.entryFeeLate} className={inputCls} /></F>
              <F label="この日時からは遅い料金"><input type="datetime-local" name="late_fee_from" defaultValue={ev.lateFeeFrom} className={inputCls} /></F>
              <F label="事前申込の締切"><input type="datetime-local" name="entry_deadline" defaultValue={ev.entryDeadline} className={inputCls} /></F>
              <F label="観覧料(小学生以上)"><input type="number" name="spectator_fee" defaultValue={ev.spectatorFee} className={inputCls} /></F>
              <F label="観覧の補足"><input name="spectator_note" defaultValue={ev.spectatorNote} className={inputCls} /></F>
            </Grid>
            <F label="参加条件"><textarea name="rules" defaultValue={ev.rules} rows={3} className={inputCls} /></F>
            <F label="キャンセル規定"><textarea name="cancel_policy" defaultValue={ev.cancelPolicy} rows={2} className={inputCls} /></F>
            <button className="rounded-lg bg-brand-600 px-4 py-2 font-bold text-white hover:bg-brand-700">保存する</button>
          </form>
        </details>

        <details className="rounded-xl border border-sand-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold text-navy-800">次の回を作る(この回の設定をコピー)</summary>
          <form action={createNextBattleEvent} className="mt-3 flex flex-wrap items-end gap-2 text-sm text-navy-900">
            <input type="hidden" name="src_key" value={ev.eventKey} />
            <F label="開催日"><input type="date" name="new_date" required className={inputCls} /></F>
            <button className="rounded-lg bg-brand-600 px-4 py-2 font-bold text-white hover:bg-brand-700">作る</button>
            <p className="w-full text-xs text-neutral-500">締切は開催前日18:00で作ります。受付は「閉」で作るので、設定を見直してから開けてください。</p>
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
