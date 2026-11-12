// スタッフ：BW6 発表会の世帯の画面（04 4-4）。上から：金額と状態／お支払い／中身（人と出演）／入金の行／返す分／送ったメール／変えた記録／ボタン。
// 個人情報を出すので、proxy の cookie の確認に加えてセッションを本検証する（規約4.5）。
// 発表会の設定は世帯の event_key で読む（?ev= は使わない）。鍵（edit_token）とメールアドレスは画面にも client の部品にも渡さない。
// 「お支払い」の欄は StaffPaySection、入金の行は PaymentRows にまとめてある（23 が「振り込みましたの印を付ける」を StaffPaySection に足した。
// 28 が「この入金を取り消す」を PaymentRows の行の横に足す。家庭の部品 src/app/bw6/my/PaySection.tsx とは別の物）。
// 20 が「特別な料金」（FeeClassPanel）・「世帯をまとめる」（MergePanel）を操作の欄に、「照合を決める」（MatchPanel）を人の横に足した。
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { todayJst } from '@/lib/dateJst';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { householdViewLabel, schoolGrade } from '@/lib/recital';
import { getRecitalEvent, getRecitalSettings, listWorks, loadHouseholdDetail, loadMembersLite, type HouseholdDetail, type WorkRow } from '@/lib/recitalDb';
import { memberWarn } from '@/lib/recitalMatch';
import { countRecitalMailsToday } from '@/lib/recitalMail';
import { maybeDoubleRecord } from '@/lib/recitalMoneyDb';
import {
  BANK_TOLD_BY_LABEL, CAST_STATUS_LABEL, FEE_CLASS_LABEL, MAIL_KIND_LABEL, MATCH_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_SOURCE_LABEL,
  PAY_METHOD_EMPTY, PAY_METHOD_LABEL, REFUND_STATUS_LABEL, labelOf, mailStatusLabel,
} from '../../labels';
import CopyButtons from './CopyButtons';
import HouseholdEditor from './HouseholdEditor';
import type { CastValue, EditorContact, EditorPerson } from './editorModel';
import FeeClassPanel, { type AdjustRow, type FeePanelPerson } from './FeeClassPanel';
import MatchPanel from './MatchPanel';
import MergePanel, { type MergePerson } from './MergePanel';
import MoneyButtons, { BankToldButton, RefundCancelButton } from './MoneyButtons';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const s = (v: string | null | undefined) => v ?? '';

/** UTC ISO → JST の 'YYYY/M/D HH:MM' */
function jstAt(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-sand-700">{children}</p>;

/** 「お支払い」の欄（払い方と「振り込みました」の印）。有効な世帯で残りがある間だけ「振り込みましたの印を付ける」（Task 23） */
function StaffPaySection({ d }: { d: HouseholdDetail }) {
  const h = d.household;
  return (
    <Section title="お支払い">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-sand-700">払い方</dt>
        <dd>{labelOf(PAY_METHOD_LABEL, h.pay_method, PAY_METHOD_EMPTY)}</dd>
        <dt className="text-sand-700">振り込みました</dt>
        <dd>
          {h.bank_told_at == null ? (
            'まだ'
          ) : (
            <span className="break-words">
              <span className="mr-2 rounded bg-navy-50 px-2 py-0.5 text-xs font-bold text-navy-700">確認中</span>
              日 {s(h.bank_told_date)}・お名前 {s(h.bank_told_name)}・金額 {h.bank_told_amount == null ? '' : yen(Number(h.bank_told_amount))}
              ・押した時 {jstAt(h.bank_told_at)}・押した人 {labelOf(BANK_TOLD_BY_LABEL, h.bank_told_by)}
            </span>
          )}
        </dd>
      </dl>
      {h.status === 'active' && d.money.remaining > 0 && (
        <BankToldButton
          householdId={h.id}
          remaining={d.money.remaining}
          toldAmount={h.bank_told_at == null ? null : Number(h.bank_told_amount ?? 0)}
          today={todayJst()}
        />
      )}
    </Section>
  );
}

/** 入金の行。28 はここの行の横に「この入金を取り消す」を足す */
function PaymentRows({ d }: { d: HouseholdDetail }) {
  return (
    <Section title="入金">
      {d.payments.length === 0 ? (
        <Empty>まだありません</Empty>
      ) : (
        <ul className="divide-y divide-sand-100">
          {d.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              <span className="font-mono">{p.paid_on}</span>
              <span className={`font-bold ${p.amount < 0 ? 'text-red-700' : ''}`}>{yen(p.amount)}</span>
              <span>{labelOf(PAYMENT_METHOD_LABEL, p.method)}</span>
              <span className="text-sand-700">{labelOf(PAYMENT_SOURCE_LABEL, p.source)}</span>
              {p.memo && <span className="min-w-0 break-words text-sand-700">{p.memo}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const MEMBER_WARN_LABEL: Record<string, string> = { leave: '休会の会員と合った', withdrawn: '退会の会員と合った' };

function PeopleSection(props: {
  d: HouseholdDetail; works: Map<number, WorkRow>; showDate: string; warnByMember: Map<number, 'leave' | 'withdrawn' | null>;
}) {
  const { d, works, showDate, warnByMember } = props;
  const canAct = d.household.status === 'active';
  return (
    <Section title="中身">
      {d.people.length === 0 ? (
        <Empty>人がいません</Empty>
      ) : (
        <ul className="space-y-3">
          {d.people.map((p) => {
            const casts = d.casts.filter((c) => c.person_id === p.id);
            const grade = p.birthday ? schoolGrade(p.birthday, showDate) : '';
            const warn = p.member_id == null ? null : warnByMember.get(Number(p.member_id)) ?? null;
            // 照合を決める：照合の確認待ち・合わない人と、休会・退会の会員と合った人の横（有効な世帯の生きている人だけ）
            const showMatch = canAct && p.status === 'active' && (p.match_status === 'pending' || p.match_status === 'unmatched' || warn != null);
            return (
              <li key={p.id} className="rounded-lg border border-sand-200 p-3 text-sm">
                <p className="text-base font-bold">
                  {p.last_name} {s(p.first_name)}
                  <span className="ml-2 text-sm font-normal text-sand-700">{s(p.last_kana)} {s(p.first_kana)}</span>
                  {p.status !== 'active' && <span className="ml-2 rounded bg-sand-100 px-2 text-xs text-sand-800">{p.status}</span>}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>生年月日 {s(p.birthday)}{grade && `（${grade}）`}</span>
                  {p.fee_class_override && <span className="rounded bg-brand-50 px-2 font-bold text-brand-700">{labelOf(FEE_CLASS_LABEL, p.fee_class_override)}</span>}
                  <span>会員との照合 {labelOf(MATCH_STATUS_LABEL, p.match_status, '—')}</span>
                  {warn && <span className="font-bold text-red-700">{MEMBER_WARN_LABEL[warn]}</span>}
                  {p.insta_handle && <span className="break-all">インスタ {p.insta_handle}</span>}
                  {p.display_name && <span>載せる名前 {p.display_name}</span>}
                  <span>名前 {p.name_ok ? '○' : '×'}・写真 {p.photo_ok ? '○' : '×'}・SNS {p.sns_ok ? '○' : '×'}</span>
                  <span>Tシャツ {s(p.tshirt_size) || 'なし'}</span>
                </div>
                {p.staff_note && <p className="mt-1 break-words text-sand-700">メモ：{p.staff_note}</p>}
                {showMatch && <MatchPanel personId={p.id} personLabel={`${p.last_name} ${s(p.first_name)}`.trim()} />}
                <ul className="mt-2 space-y-1">
                  {casts.length === 0 && <li className="text-sand-700">出演の行はありません</li>}
                  {casts.map((c) => {
                    const w = works.get(c.work_id);
                    return (
                      <li key={c.id} className="flex flex-wrap gap-x-2">
                        <span className="font-mono">{w?.work_code ?? '?'}</span>
                        <span className="min-w-0 break-words">{w?.title ?? ''}{w?.status === 'dropped' && '（取りやめの作品）'}</span>
                        <span className="font-bold">{labelOf(CAST_STATUS_LABEL, c.status)}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export default async function StaffBw6HouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const { id: idText } = await params;
  const id = /^\d+$/.test(idText) ? Number(idText) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const d = await loadHouseholdDetail(id);
  if (!d) notFound();
  const h = d.household;
  const ev = h.event_key;

  const [event, settings, workList, mailsToday, mergedTo, members] = await Promise.all([
    getRecitalEvent(ev),
    getRecitalSettings(ev),
    listWorks(ev),
    countRecitalMailsToday(),
    h.status === 'merged' && h.merged_into != null ? loadHouseholdDetail(Number(h.merged_into)) : Promise.resolve(null),
    d.people.some((p) => p.member_id != null) ? loadMembersLite() : Promise.resolve([]),
  ]);
  const memberIds = new Set(d.people.map((p) => p.member_id).filter((x): x is number => x != null).map(Number));
  const warnByMember = new Map(members.filter((m) => memberIds.has(m.id)).map((m) => [m.id, memberWarn(m)] as const));
  const works = new Map(workList.map((w) => [w.id, w]));
  const liveWorks = workList.filter((w) => w.status !== 'dropped').map((w) => ({ id: w.id, work_code: w.work_code, title: w.title }));
  const activePeople = d.people.filter((p) => p.status === 'active');
  const listHref = `/staff/bw6/entries?ev=${encodeURIComponent(ev)}`;
  const payDue = h.pay_due_override ?? settings.pay_due;

  const editorPeople: EditorPerson[] = activePeople.map((p) => ({
    id: p.id, last_name: p.last_name, first_name: s(p.first_name), last_kana: s(p.last_kana), first_kana: s(p.first_kana),
    birthday: s(p.birthday), display_name: s(p.display_name), tshirt_size: s(p.tshirt_size), insta_handle: s(p.insta_handle),
    name_ok: Number(p.name_ok), photo_ok: Number(p.photo_ok), sns_ok: Number(p.sns_ok), staff_note: s(p.staff_note),
  }));
  // 特別な料金・世帯をまとめる（Task 20）に渡す物。手の調整の行の理由は adjust_add の記録から引く
  const feePeople: FeePanelPerson[] = activePeople.map((p) => ({
    id: p.id, name: `${p.last_name} ${s(p.first_name)}`.trim(), feeClass: p.fee_class_override === 'no_coop' || p.fee_class_override === 'tshirt_only' || p.fee_class_override === 'free' ? p.fee_class_override : null,
  }));
  const adjustReason = new Map<number, string>();
  for (const c of d.changes) {
    if (c.action !== 'adjust_add' || !c.after_json) continue;
    try {
      const id = Number((JSON.parse(c.after_json) as { chargeId?: unknown }).chargeId);
      if (Number.isInteger(id) && !adjustReason.has(id)) adjustReason.set(id, c.reason ?? '');
    } catch { /* 読めない記録は飛ばす */ }
  }
  const activeCharges = d.charges.filter((c) => c.status === 'active');
  const adjusts: AdjustRow[] = activeCharges.filter((c) => c.item_code === 'adjust').map((c) => ({ id: c.id, amount: Number(c.amount), reason: adjustReason.get(c.id) ?? '' }));
  const rowsBelowZero = activeCharges.reduce((a, c) => a + Number(c.amount), 0) < 0;
  const mergePeople: MergePerson[] = activePeople.map((p) => ({
    id: p.id, name: `${p.last_name} ${s(p.first_name)}`.trim(), kana: `${s(p.last_kana)} ${s(p.first_kana)}`.trim(), birthday: s(p.birthday),
  }));

  const editorCasts: Record<string, CastValue> = {};
  for (const c of d.casts) {
    if (!activePeople.some((p) => p.id === c.person_id)) continue;
    const k = `${c.person_id}:${c.work_id}`;
    if (!(k in editorCasts)) editorCasts[k] = c.status as CastValue;
  }
  const editorContact: EditorContact = {
    contact_last_name: s(h.contact_last_name), contact_first_name: s(h.contact_first_name),
    contact_last_kana: s(h.contact_last_kana), contact_first_kana: s(h.contact_first_kana), phone: s(h.phone), staff_note: s(h.staff_note),
  };

  return (
    <div>
      <StaffPageHeader
        title={`申込 ${h.ref_code}`}
        description={event ? `${event.title}（${ev}）` : ev}
        backHref={listHref}
        backLabel="申込の一覧"
        rightExtra={
          <span className="text-xs text-sand-700">
            今日の送信 {mailsToday.count}通{mailsToday.warn && <span className="ml-1 font-bold text-red-700">（上限に近いです）</span>}
          </span>
        }
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
          <p className="font-mono text-4xl font-bold text-brand-700">{h.ref_code}</p>
          <p className="mt-1 break-words text-sm text-sand-700">{s(h.contact_last_name)} {s(h.contact_first_name)}</p>
          <p className="mt-2 text-lg font-bold">{householdViewLabel(d.view, d.money.remaining)}</p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            <span>合計 {yen(d.money.total)}</span>
            <span>払った額 {yen(d.money.paid)}</span>
          </div>
          <p className="mt-1 text-3xl font-bold">残り {yen(d.money.remaining)}</p>
          {d.money.overpaid > 0 && <p className="mt-1 text-sm">お支払いずみの分 {yen(d.money.overpaid)}</p>}
          {h.status === 'merged' && (
            <p className="mt-2 rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-sm">
              まとめた（まとめ先：
              {mergedTo ? (
                <Link href={`/staff/bw6/entries/${mergedTo.household.id}`} className="font-bold text-brand-700 underline">{mergedTo.household.ref_code}</Link>
              ) : (
                '見つかりません'
              )}
              ）
            </p>
          )}
          {maybeDoubleRecord(d.payments) && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-900">二重の記録かもしれません</p>
          )}
        </section>

        <StaffPaySection d={d} />
        <PeopleSection d={d} works={works} showDate={event?.show_date ?? ''} warnByMember={warnByMember} />
        <PaymentRows d={d} />

        <Section title="返す分">
          {d.refunds.length === 0 ? (
            <Empty>ありません</Empty>
          ) : (
            <ul className="divide-y divide-sand-100">
              {d.refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="font-bold">{yen(r.amount)}</span>
                  <span className="min-w-0 break-words">{r.reason}</span>
                  <span className="text-sand-700">{labelOf(REFUND_STATUS_LABEL, r.status)}</span>
                  {r.status === 'todo' && <RefundCancelButton householdId={h.id} refundId={r.id} />}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="送ったメール">
          {d.mails.length === 0 ? (
            <Empty>まだありません</Empty>
          ) : (
            <ul className="divide-y divide-sand-100">
              {d.mails.map((m) => {
                const st = mailStatusLabel(m);
                const bad = m.status === 'failed' || st === '送れたか不明';
                return (
                  <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                    <span>{labelOf(MAIL_KIND_LABEL, m.mail_kind)}</span>
                    <span className={bad ? 'font-bold text-red-700' : 'text-sand-700'}>{st}</span>
                    <span className="font-mono text-xs text-sand-700">{jstAt(m.sent_at ?? m.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="変えた記録">
          {d.changes.length === 0 ? (
            <Empty>まだありません</Empty>
          ) : (
            <ul className="divide-y divide-sand-100">
              {d.changes.map((c) => (
                <li key={c.id} className="py-2 text-sm">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-sand-700">{jstAt(c.created_at)}</span>
                    <span className="font-mono">{c.action}</span>
                    <span>{c.actor}</span>
                    {c.is_exception === 1 && <span className="rounded bg-sand-100 px-2 text-xs text-sand-800">決まりの外</span>}
                  </div>
                  {c.reason && <p className="mt-1 break-words">理由：{c.reason}</p>}
                  {c.received_at && <p className="text-xs text-sand-700">家庭から聞いた日時 {jstAt(c.received_at)}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="操作">
          <div className="space-y-3">
            {h.status === 'active' ? (
              <HouseholdEditor
                householdId={h.id}
                people={editorPeople}
                contact={editorContact}
                works={liveWorks}
                casts={editorCasts}
                tshirtSizes={settings.tshirt_sizes}
              />
            ) : (
              <Empty>この世帯は「{h.status}」なので、代わりに直す・手で入金を記録・控えを送り直す・メールアドレスを直す・特別な料金・世帯をまとめるはできません。</Empty>
            )}
            {h.status === 'active' && <MoneyButtons householdId={h.id} remaining={d.money.remaining} today={todayJst()} />}
            {h.status === 'active' && activePeople.length > 0 && (
              <FeeClassPanel householdId={h.id} people={feePeople} adjusts={adjusts} rowsBelowZero={rowsBelowZero} />
            )}
            {h.status === 'active' && <MergePanel householdId={h.id} eventKey={ev} seq={h.seq} refCode={h.ref_code} people={mergePeople} />}
            <CopyButtons householdId={h.id} refCode={h.ref_code} remaining={d.money.remaining} payDue={payDue} active={h.status === 'active'} />
          </div>
        </Section>
      </div>
    </div>
  );
}
