'use client';

// BW6 発表会のスタッフの「作品」を足す・直す（同じ形）。W番号はサーバが登録順に付け、ここでは変えない。
// クラスと担当は行を足せる（今ある表から選ぶか、「外部（手で入れる）」で名前を打つ）。
// 取りやめは2段階（1回目に画面に出した申込の人数をそのままサーバへ渡す）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import type { WorkInput } from '@/lib/recitalDb';
import { WORK_ENTRY_MODE_LABEL, WORK_FEE_TYPE_LABEL, WORK_KIND_LABEL, WORK_ROLE_LABEL, WORK_STATUS_LABEL } from '../labels';
import { dropWorkAction, saveWorkAction } from './actions';

export type WorkFormValue = WorkInput & { id: number; work_code: string };
export type WorkPickOptions = { classes: { id: number; label: string }[]; instructors: { id: number; name: string }[] };

type Role = WorkInput['instructors'][number]['role'];
type ClassRow = { pick: string; label: string };
type InstructorRow = { pick: string; name: string; role: Role };

const EXT = 'ext';
const EDITABLE_STATUSES = ['draft', 'open', 'fixed'] as const;
const SMALL_INPUT_CLS = 'rounded-lg border border-sand-300 bg-white px-3 py-2 text-base text-navy-900';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-navy-700">{label}</span>
      {children}
    </label>
  );
}

/** '' は null、数字なら整数、ほかは NaN（サーバで弾く） */
function toIntOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

export default function WorkForm(props: {
  ev: string;
  initial: WorkFormValue | null;
  options: WorkPickOptions;
  applied: number;
  nextSortOrder: number;
  listHref: string;
}) {
  const { ev, initial, options, applied, nextSortOrder, listHref } = props;
  const router = useRouter();
  const isDropped = initial?.status === 'dropped';

  const [kind, setKind] = useState(initial?.kind ?? 'class');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [classLabel, setClassLabel] = useState(initial?.class_label ?? '');
  const [slotLabel, setSlotLabel] = useState(initial?.slot_label ?? '');
  const [targetLabel, setTargetLabel] = useState(initial?.target_label ?? '');
  const [genre, setGenre] = useState(initial?.genre ?? '');
  const [entryMode, setEntryMode] = useState<WorkInput['entry_mode']>(initial?.entry_mode ?? 'form');
  const [feeType, setFeeType] = useState<WorkInput['fee_type']>(initial?.fee_type ?? 'counted');
  const [extraFee, setExtraFee] = useState(initial?.extra_fee == null ? '' : String(initial.extra_fee));
  const [capacity, setCapacity] = useState(initial?.capacity == null ? '' : String(initial.capacity));
  const [status, setStatus] = useState<WorkInput['status']>(initial?.status ?? 'draft');
  const [publicNote, setPublicNote] = useState(initial?.public_note ?? '');
  const [staffNote, setStaffNote] = useState(initial?.staff_note ?? '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? nextSortOrder));
  const [classes, setClasses] = useState<ClassRow[]>(
    (initial?.classes ?? []).map((c) => ({ pick: c.lesson_master_id == null ? EXT : String(c.lesson_master_id), label: c.label })),
  );
  const [instructors, setInstructors] = useState<InstructorRow[]>(
    (initial?.instructors ?? []).map((i) => ({ pick: i.instructor_id == null ? EXT : String(i.instructor_id), name: i.display_name, role: i.role })),
  );
  const [staffName, setStaffName] = useState('');
  const [error, setError] = useState('');
  const [dropOpen, setDropOpen] = useState(false);
  const [dropError, setDropError] = useState('');
  const [pending, startTransition] = useTransition();

  // 今の表に無い（休みになった）クラス・イントラを選んでいた行も、選び肢に残す
  const classOptions = [...options.classes];
  for (const c of initial?.classes ?? []) {
    if (c.lesson_master_id != null && !classOptions.some((o) => o.id === c.lesson_master_id)) classOptions.push({ id: c.lesson_master_id, label: c.label });
  }
  const instructorOptions = [...options.instructors];
  for (const i of initial?.instructors ?? []) {
    if (i.instructor_id != null && !instructorOptions.some((o) => o.id === i.instructor_id)) instructorOptions.push({ id: i.instructor_id, name: i.display_name });
  }

  const setClassRow = (k: number, row: Partial<ClassRow>) => setClasses((xs) => xs.map((x, j) => (j === k ? { ...x, ...row } : x)));
  const setInstructorRow = (k: number, row: Partial<InstructorRow>) => setInstructors((xs) => xs.map((x, j) => (j === k ? { ...x, ...row } : x)));

  const save = () => {
    if (!staffName) { setError('名前を選んでください'); return; }
    const w: WorkInput & { id?: number } = {
      id: initial?.id,
      kind, title, class_label: classLabel, slot_label: slotLabel, target_label: targetLabel, genre,
      entry_mode: entryMode, fee_type: feeType,
      extra_fee: feeType === 'extra' ? toIntOrNull(extraFee) : null,
      capacity: toIntOrNull(capacity),
      status,
      merged_into: initial?.merged_into ?? null,
      public_note: publicNote, staff_note: staffNote,
      sort_order: toIntOrNull(sortOrder) ?? 0,
      classes: classes.map((c) => ({ lesson_master_id: c.pick === EXT || c.pick === '' ? null : Number(c.pick), label: c.label })),
      instructors: instructors.map((i, k) => ({
        instructor_id: i.pick === EXT || i.pick === '' ? null : Number(i.pick), display_name: i.name, role: i.role, sort_order: k + 1,
      })),
    };
    startTransition(async () => {
      const r = await saveWorkAction(ev, w, staffName);
      if (!r.ok) { setError(r.error); return; }
      setError('');
      router.push(`${listHref}&saved=${encodeURIComponent(r.workCode)}`);
    });
  };

  const drop = () => {
    if (!initial) return;
    if (!staffName) { setDropError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await dropWorkAction(initial.id, applied, staffName);
      if (!r.ok) { setDropError(r.error); return; }
      setDropError('');
      router.push(`${listHref}&saved=${encodeURIComponent(initial.work_code)}`);
    });
  };

  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">
        {initial ? `${initial.work_code} を直す` : '作品を足す'}
        {!initial && <span className="ml-2 text-sm font-normal text-sand-700">W番号は保存した時に、登録の順で付きます</span>}
      </h2>
      {initial && applied > 0 && (
        <p className="mt-2 rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-sm text-sand-800">
          この作品には申込が {applied}人あります。料金の扱いと別料金の額は変えられません。
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="種類">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={RECITAL_INPUT_CLS}>
            {Object.entries(WORK_KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="作品の名前（仮でよい）">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={RECITAL_INPUT_CLS} />
        </Field>
        <Field label="見せるクラスの名前">
          <input value={classLabel} onChange={(e) => setClassLabel(e.target.value)} className={RECITAL_INPUT_CLS} />
        </Field>
        <Field label="曜日・時間・会場（1行）">
          <input value={slotLabel} onChange={(e) => setSlotLabel(e.target.value)} className={RECITAL_INPUT_CLS} />
        </Field>
        <Field label="対象（1行。例：小学生）">
          <input value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)} className={RECITAL_INPUT_CLS} />
        </Field>
        <Field label="ジャンル">
          <input value={genre} onChange={(e) => setGenre(e.target.value)} className={RECITAL_INPUT_CLS} />
        </Field>
        <Field label="受け方">
          <select value={entryMode} onChange={(e) => setEntryMode(e.target.value as WorkInput['entry_mode'])} className={RECITAL_INPUT_CLS}>
            {Object.entries(WORK_ENTRY_MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="料金の扱い">
          <select
            value={feeType}
            onChange={(e) => setFeeType(e.target.value as WorkInput['fee_type'])}
            disabled={applied > 0}
            className={`${RECITAL_INPUT_CLS} disabled:bg-sand-50`}
          >
            {Object.entries(WORK_FEE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {feeType === 'extra' && (
          <Field label="別料金の額（円）">
            <input
              value={extraFee}
              onChange={(e) => setExtraFee(e.target.value)}
              inputMode="numeric"
              disabled={applied > 0}
              className={`${RECITAL_INPUT_CLS} disabled:bg-sand-50`}
            />
          </Field>
        )}
        <Field label="定員（空＝なし。超えても止めない）">
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} inputMode="numeric" className={RECITAL_INPUT_CLS} />
        </Field>
        <Field label="状態">
          {isDropped ? (
            <p className="rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-base text-navy-900">
              {WORK_STATUS_LABEL.dropped}（戻せません）
            </p>
          ) : (
            <select value={status} onChange={(e) => setStatus(e.target.value as WorkInput['status'])} className={RECITAL_INPUT_CLS}>
              {EDITABLE_STATUSES.map((v) => <option key={v} value={v}>{WORK_STATUS_LABEL[v]}</option>)}
            </select>
          )}
        </Field>
        <Field label="並び（フォームでの順。小さい方が上）">
          <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} inputMode="numeric" className={RECITAL_INPUT_CLS} />
        </Field>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="注意書き（フォームのカードに出す1行）">
          <input value={publicNote} onChange={(e) => setPublicNote(e.target.value)} className={RECITAL_INPUT_CLS} />
        </Field>
        <Field label="スタッフのメモ">
          <textarea value={staffNote} onChange={(e) => setStaffNote(e.target.value)} rows={2} className={RECITAL_INPUT_CLS} />
        </Field>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-bold text-navy-700">クラス</legend>
        <ul className="mt-2 space-y-2">
          {classes.map((c, k) => (
            <li key={k} className="flex flex-wrap items-center gap-2">
              <select
                value={c.pick}
                onChange={(e) => {
                  const pick = e.target.value;
                  const o = classOptions.find((x) => String(x.id) === pick);
                  setClassRow(k, { pick, label: o ? o.label : pick === EXT ? '' : c.label });
                }}
                className={`${SMALL_INPUT_CLS} min-w-0 flex-1`}
                aria-label="クラスを選ぶ"
              >
                <option value="">選んでください</option>
                {classOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
                <option value={EXT}>外部（手で入れる）</option>
              </select>
              {c.pick === EXT && (
                <input
                  value={c.label}
                  onChange={(e) => setClassRow(k, { label: e.target.value })}
                  placeholder="クラスの名前"
                  className={`${SMALL_INPUT_CLS} min-w-0 flex-1 placeholder:text-[#7a7a86]`}
                />
              )}
              <button type="button" onClick={() => setClasses((xs) => xs.filter((_, j) => j !== k))} className="px-2 py-1 text-sm text-sand-700 underline">
                この行を消す
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setClasses((xs) => [...xs, { pick: '', label: '' }])}
          className="mt-2 rounded-md border border-sand-300 bg-white px-3 py-1 text-sm text-brand-700"
        >
          クラスの行を足す
        </button>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-bold text-navy-700">担当</legend>
        <ul className="mt-2 space-y-2">
          {instructors.map((i, k) => (
            <li key={k} className="flex flex-wrap items-center gap-2">
              <select
                value={i.pick}
                onChange={(e) => {
                  const pick = e.target.value;
                  const o = instructorOptions.find((x) => String(x.id) === pick);
                  setInstructorRow(k, { pick, name: o ? o.name : pick === EXT ? '' : i.name });
                }}
                className={`${SMALL_INPUT_CLS} min-w-0 flex-1`}
                aria-label="担当を選ぶ"
              >
                <option value="">選んでください</option>
                {instructorOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
                <option value={EXT}>外部（手で入れる）</option>
              </select>
              {i.pick === EXT && (
                <input
                  value={i.name}
                  onChange={(e) => setInstructorRow(k, { name: e.target.value })}
                  placeholder="見せる名前"
                  className={`${SMALL_INPUT_CLS} min-w-0 flex-1 placeholder:text-[#7a7a86]`}
                />
              )}
              <select
                value={i.role}
                onChange={(e) => setInstructorRow(k, { role: e.target.value as Role })}
                className={SMALL_INPUT_CLS}
                aria-label="役目"
              >
                {Object.entries(WORK_ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button type="button" onClick={() => setInstructors((xs) => xs.filter((_, j) => j !== k))} className="px-2 py-1 text-sm text-sand-700 underline">
                この行を消す
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setInstructors((xs) => [...xs, { pick: '', name: '', role: 'choreo' }])}
          className="mt-2 rounded-md border border-sand-300 bg-white px-3 py-1 text-sm text-brand-700"
        >
          担当の行を足す
        </button>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-sand-100 pt-4">
        <StaffNamePicker value={staffName} onChange={setStaffName} />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand-600 px-5 py-2 font-bold text-white disabled:opacity-50"
        >
          保存
        </button>
        <Link href={listHref} className="px-2 py-2 text-sm text-sand-700 underline">やめる</Link>
        {error && <p className="w-full text-sm text-red-700">{error}</p>}
      </div>

      {initial && !isDropped && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {!dropOpen ? (
            <button type="button" onClick={() => setDropOpen(true)} className="rounded-md border border-red-300 bg-white px-3 py-1 font-bold text-red-800">
              この作品を取りやめる
            </button>
          ) : (
            <div className="space-y-2">
              <p className="font-bold">この作品に申込が {applied}人あります。取りやめますか</p>
              <p>お支払いずみの世帯がいる作品は、今は取りやめられません（TARO に知らせてください）。家庭へのメールは出ません。</p>
              <div className="flex flex-wrap items-center gap-2">
                <StaffNamePicker value={staffName} onChange={setStaffName} />
                <button
                  type="button"
                  onClick={drop}
                  disabled={pending}
                  className="rounded-md bg-red-700 px-3 py-1 font-bold text-white disabled:opacity-50"
                >
                  取りやめる
                </button>
                <button type="button" onClick={() => { setDropOpen(false); setDropError(''); }} className="px-2 py-1 text-red-800 underline">
                  やめる
                </button>
              </div>
              {dropError && <p className="text-red-700">{dropError}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
