// スタッフ：BW6 発表会の「作品」（一覧・足す・直す・取りやめ）。列は設計書 04 4-4。
// 申込の人数とお支払いを出すので、proxy の cookie の確認に加えてセッションを本検証する（規約4.5）。
// ?ev= は pickStaffEventKey で決まった3つだけ。?add=1 で足す形、?edit=<id> で直す形を一覧の上に開く。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { RECITAL_EVENT, pickStaffEventKey } from '@/lib/recital';
import { listWorkCounts, listWorkLinks, listWorkPickOptions, listWorks, type WorkRow } from '@/lib/recitalDb';
import { WORK_ENTRY_MODE_LABEL, WORK_FEE_TYPE_LABEL, WORK_STATUS_LABEL } from '../labels';
import WorkForm, { type WorkFormValue } from './WorkForm';

export const dynamic = 'force-dynamic';

type Counts = { in: number; maybe: number; paid: number; unpaid: number; snsNg: boolean };
const ZERO: Counts = { in: 0, maybe: 0, paid: 0, unpaid: 0, snsNg: false };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function withEv(href: string, ev: string, extra = ''): string {
  return `${href}?ev=${encodeURIComponent(ev)}${extra}`;
}

const codeNo = (c: string) => {
  const m = /^W(\d+)$/.exec(c);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

/** 並びは sort_order → W番号（数の順） */
function byOrder(a: WorkRow, b: WorkRow): number {
  return a.sort_order - b.sort_order || codeNo(a.work_code) - codeNo(b.work_code) || a.work_code.localeCompare(b.work_code);
}

function toFormValue(w: WorkRow, links: { classes: WorkFormValue['classes']; instructors: WorkFormValue['instructors'] } | undefined): WorkFormValue {
  const s = (v: string | null) => v ?? '';
  return {
    id: w.id, work_code: w.work_code, kind: w.kind, title: w.title, class_label: s(w.class_label), slot_label: s(w.slot_label),
    target_label: s(w.target_label), genre: s(w.genre), entry_mode: w.entry_mode as WorkFormValue['entry_mode'],
    fee_type: w.fee_type as WorkFormValue['fee_type'], extra_fee: w.extra_fee, capacity: w.capacity,
    status: w.status as WorkFormValue['status'], merged_into: w.merged_into, public_note: s(w.public_note), staff_note: s(w.staff_note),
    sort_order: w.sort_order, classes: links?.classes ?? [], instructors: links?.instructors ?? [],
  };
}

export default async function StaffBw6WorksPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const ev = pickStaffEventKey(first(sp.ev));
  const isLive = ev === RECITAL_EVENT.live;
  const editId = Number(first(sp.edit) ?? '');
  const adding = first(sp.add) === '1';
  const saved = (first(sp.saved) ?? '').slice(0, 10);

  const [works, counts, links, options] = await Promise.all([listWorks(ev), listWorkCounts(ev), listWorkLinks(ev), listWorkPickOptions()]);
  const sorted = [...works].sort(byOrder);
  const listHref = withEv('/staff/bw6/works', ev);
  const editing = Number.isInteger(editId) && editId > 0 ? works.find((w) => w.id === editId) : undefined;
  const nextSortOrder = works.reduce((m, w) => Math.max(m, w.sort_order), 0) + 1;
  const appliedOf = (id: number) => {
    const c = counts.get(id) ?? ZERO;
    return c.in + c.maybe;
  };
  const classText = (w: WorkRow) => {
    const xs = (links.get(w.id)?.classes ?? []).map((c) => c.label).filter(Boolean);
    return xs.length > 0 ? xs.join('・') : (w.class_label ?? '');
  };
  const instructorText = (w: WorkRow) => (links.get(w.id)?.instructors ?? []).map((i) => i.display_name).join('・');

  return (
    <div>
      <StaffPageHeader
        title="作品"
        description={`BW6 発表会（${ev}）`}
        backHref={withEv('/staff/bw6', ev)}
        backLabel="BW6 発表会"
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4">
        {!isLive && (
          <p className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-700">
            試しの発表会（{ev}）の作品を見ています。
          </p>
        )}
        {saved && (
          <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{saved} を保存しました。</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Link href={withEv('/staff/bw6/works', ev, '&add=1')} className="rounded-lg bg-brand-600 px-4 py-2 font-bold text-white">
            作品を足す
          </Link>
          <Link href={withEv('/staff/bw6/works/print', ev)} className="rounded-lg border border-sand-300 bg-white px-4 py-2 font-bold text-brand-700">
            印刷用の想定一覧
          </Link>
        </div>

        {adding && !editing && (
          <WorkForm key="new" ev={ev} initial={null} options={options} applied={0} nextSortOrder={nextSortOrder} listHref={listHref} />
        )}
        {editing && (
          <WorkForm
            key={`edit-${editing.id}`}
            ev={ev}
            initial={toFormValue(editing, links.get(editing.id))}
            options={options}
            applied={appliedOf(editing.id)}
            nextSortOrder={nextSortOrder}
            listHref={listHref}
          />
        )}

        {sorted.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white p-4 text-sm text-sand-700">作品は、まだありません。</p>
        ) : (
          <>
            {/* 広い画面：表 */}
            <div className="hidden overflow-x-auto rounded-xl border border-sand-200 bg-white md:block">
              <table className="w-full text-left text-sm text-navy-700">
                <thead className="border-b border-sand-200 bg-sand-50 text-xs text-sand-800">
                  <tr>
                    <th className="px-3 py-2">W番号</th>
                    <th className="px-3 py-2">名前</th>
                    <th className="px-3 py-2">クラス</th>
                    <th className="px-3 py-2">担当</th>
                    <th className="px-3 py-2">受け方</th>
                    <th className="px-3 py-2">料金の扱い</th>
                    <th className="px-3 py-2">状態</th>
                    <th className="px-3 py-2 text-right">出る</th>
                    <th className="px-3 py-2 text-right">迷っている</th>
                    <th className="px-3 py-2">お支払い</th>
                    <th className="px-3 py-2"><span className="sr-only">直す</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100">
                  {sorted.map((w) => {
                    const c = counts.get(w.id) ?? ZERO;
                    const dropped = w.status === 'dropped';
                    return (
                      <tr key={w.id} className={dropped ? 'text-sand-700' : ''}>
                        <td className="px-3 py-2 font-mono font-bold text-brand-700">{w.work_code}</td>
                        <td className="px-3 py-2">
                          <span className="break-words">{w.title}</span>
                          {c.snsNg && <span className="ml-1 inline-block rounded bg-sand-100 px-1.5 text-xs text-sand-800">SNS に出さない人がいる</span>}
                        </td>
                        <td className="px-3 py-2">{classText(w)}</td>
                        <td className="px-3 py-2">{instructorText(w)}</td>
                        <td className="px-3 py-2">{WORK_ENTRY_MODE_LABEL[w.entry_mode] ?? w.entry_mode}</td>
                        <td className="px-3 py-2">
                          {WORK_FEE_TYPE_LABEL[w.fee_type] ?? w.fee_type}
                          {w.fee_type === 'extra' && w.extra_fee != null && `（${w.extra_fee.toLocaleString('ja-JP')}円）`}
                        </td>
                        <td className="px-3 py-2">{WORK_STATUS_LABEL[w.status] ?? w.status}</td>
                        <td className="px-3 py-2 text-right">{c.in}人</td>
                        <td className="px-3 py-2 text-right">{c.maybe}人</td>
                        <td className="px-3 py-2 whitespace-nowrap">お支払いずみ {c.paid}人・まだ {c.unpaid}人</td>
                        <td className="px-3 py-2">
                          <Link href={withEv('/staff/bw6/works', ev, `&edit=${w.id}`)} className="text-brand-700 underline">直す</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* スマホ：1作品1カード */}
            <ul className="space-y-3 md:hidden">
              {sorted.map((w) => {
                const c = counts.get(w.id) ?? ZERO;
                const dropped = w.status === 'dropped';
                return (
                  <li key={w.id} className={`rounded-xl border border-sand-200 bg-white p-3 text-sm ${dropped ? 'text-sand-700' : 'text-navy-700'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 break-words">
                        <span className="mr-2 font-mono font-bold text-brand-700">{w.work_code}</span>
                        <span className="font-bold">{w.title}</span>
                      </p>
                      <span className="shrink-0 rounded bg-sand-100 px-2 text-xs text-sand-800">{WORK_STATUS_LABEL[w.status] ?? w.status}</span>
                    </div>
                    {c.snsNg && <p className="mt-1 inline-block rounded bg-sand-100 px-1.5 text-xs text-sand-800">SNS に出さない人がいる</p>}
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt className="text-sand-700">クラス</dt><dd className="min-w-0 break-words">{classText(w) || '—'}</dd>
                      <dt className="text-sand-700">担当</dt><dd className="min-w-0 break-words">{instructorText(w) || '—'}</dd>
                      <dt className="text-sand-700">受け方</dt><dd>{WORK_ENTRY_MODE_LABEL[w.entry_mode] ?? w.entry_mode}</dd>
                      <dt className="text-sand-700">料金</dt>
                      <dd className="min-w-0 break-words">
                        {WORK_FEE_TYPE_LABEL[w.fee_type] ?? w.fee_type}
                        {w.fee_type === 'extra' && w.extra_fee != null && `（${w.extra_fee.toLocaleString('ja-JP')}円）`}
                      </dd>
                    </dl>
                    <p className="mt-2">出る {c.in}人 ／ 迷っている {c.maybe}人</p>
                    <p>お支払いずみ {c.paid}人・まだ {c.unpaid}人</p>
                    <Link href={withEv('/staff/bw6/works', ev, `&edit=${w.id}`)} className="mt-2 inline-block text-brand-700 underline">直す</Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
