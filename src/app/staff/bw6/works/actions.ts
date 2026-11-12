'use server';

// BW6 発表会のスタッフの「作品」の画面の Server Actions。/staff/* は proxy（cookie の有無）で覆われているが、
// proxy は DB を見られないので requireRecitalStaff() でセッションを必ず本検証する（規約4.5）。
// W番号は saveWork が登録順に付け、ここからは変えない。取りやめは dropWorkAction だけ（saveWork で dropped にしない）。
import { revalidatePath } from 'next/cache';
import { RECITAL_STAFF_NAMES, pickStaffEventKey } from '@/lib/recital';
import { listWorkCounts, listWorks, saveWork, type WorkInput } from '@/lib/recitalDb';
import { dropWork } from '@/lib/recitalEntryDb';
import { requireRecitalStaff } from '@/lib/recitalGuard';
import { WORK_KIND_LABEL } from '../labels';

const ENTRY_MODES: readonly string[] = ['form', 'staff', 'none'];
const FEE_TYPES: readonly string[] = ['counted', 'not_counted', 'extra', 'separate'];
const EDITABLE_STATUSES: readonly string[] = ['draft', 'open', 'fixed'];
const ROLES: readonly string[] = ['choreo', 'perform', 'assist'];

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 画面から来た作品を、saveWork に渡す形にそろえる（形がちがえば文を返す）。merged_into と status は呼ぶ側が決める */
function cleanWork(w: WorkInput): { ok: true; w: Omit<WorkInput, 'merged_into'> } | { ok: false; error: string } {
  if (!w || typeof w !== 'object') return { ok: false, error: '入力を確かめてください' };
  const title = text(w.title);
  if (!title) return { ok: false, error: '作品の名前を入れてください' };
  if (!Object.hasOwn(WORK_KIND_LABEL, text(w.kind))) return { ok: false, error: '種類を選んでください' };
  if (!ENTRY_MODES.includes(w.entry_mode)) return { ok: false, error: '受け方を選んでください' };
  if (!FEE_TYPES.includes(w.fee_type)) return { ok: false, error: '料金の扱いを選んでください' };
  let extraFee: number | null = null;
  if (w.fee_type === 'extra') {
    if (!isNonNegInt(w.extra_fee) || w.extra_fee === 0) return { ok: false, error: '別料金の額を入れてください（1円以上の整数）' };
    extraFee = w.extra_fee;
  }
  if (w.capacity !== null && (!isNonNegInt(w.capacity) || w.capacity === 0)) return { ok: false, error: '定員は1以上の整数か、空にしてください' };
  if (!isNonNegInt(w.sort_order)) return { ok: false, error: '並びは0以上の整数にしてください' };
  if (!Array.isArray(w.classes) || !Array.isArray(w.instructors)) return { ok: false, error: '入力を確かめてください' };
  const classes: WorkInput['classes'] = [];
  for (const c of w.classes) {
    const label = text(c?.label);
    if (!label) return { ok: false, error: 'クラスの行の名前が空です' };
    const id = c.lesson_master_id;
    if (id !== null && !(Number.isInteger(id) && id > 0)) return { ok: false, error: '入力を確かめてください' };
    classes.push({ lesson_master_id: id, label });
  }
  const instructors: WorkInput['instructors'] = [];
  for (const [k, i] of w.instructors.entries()) {
    const name = text(i?.display_name);
    if (!name) return { ok: false, error: '担当の行の名前が空です' };
    const id = i.instructor_id;
    if (id !== null && !(Number.isInteger(id) && id > 0)) return { ok: false, error: '入力を確かめてください' };
    if (!ROLES.includes(i.role)) return { ok: false, error: '担当の役目を選んでください' };
    instructors.push({ instructor_id: id, display_name: name, role: i.role, sort_order: k + 1 });
  }
  return {
    ok: true,
    w: {
      kind: text(w.kind), title, class_label: text(w.class_label), slot_label: text(w.slot_label), target_label: text(w.target_label),
      genre: text(w.genre), entry_mode: w.entry_mode, fee_type: w.fee_type, extra_fee: extraFee, capacity: w.capacity,
      status: w.status, public_note: text(w.public_note), staff_note: text(w.staff_note), sort_order: w.sort_order, classes, instructors,
    },
  };
}

/** 作品を足す／直す。申込がある作品の料金の扱い（fee_type・extra_fee）は変えない（請求が作り直されないため） */
export async function saveWorkAction(
  ev: string,
  w: WorkInput & { id?: number },
  staffName: string,
): Promise<{ ok: true; workCode: string } | { ok: false; error: string }> {
  await requireRecitalStaff();
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: '名前を選んでください' };
  const eventKey = pickStaffEventKey(ev);
  const c = cleanWork(w);
  if (!c.ok) return c;

  let mergedInto: number | null = null;
  if (w.id != null) {
    const cur = (await listWorks(eventKey)).find((x) => x.id === w.id);
    if (!cur) return { ok: false, error: '作品が見つかりません。画面を開き直してください' };
    if (cur.status === 'dropped') {
      // 取りやめを戻すのは後の計画。取りやめた作品は状態だけ変えられない（ほかの欄は直せる）
      if (w.status !== 'dropped') return { ok: false, error: '取りやめた作品の状態は変えられません' };
    } else if (!EDITABLE_STATUSES.includes(w.status)) {
      return { ok: false, error: w.status === 'dropped' ? '取りやめは「取りやめる」のボタンから行ってください' : '状態を選んでください' };
    }
    const n = (await listWorkCounts(eventKey)).get(cur.id);
    const applied = n ? n.in + n.maybe : 0;
    // 別料金の額は extra の時だけ意味を持つ（ほかの扱いで列に古い値が残っていても「変えた」としない）
    const curExtra = cur.fee_type === 'extra' ? cur.extra_fee ?? null : null;
    const feeChanged = cur.fee_type !== c.w.fee_type || curExtra !== c.w.extra_fee;
    if (applied > 0 && feeChanged) return { ok: false, error: '申込がある作品の料金の扱いは、変えられません' };
    mergedInto = cur.merged_into;
  } else if (!EDITABLE_STATUSES.includes(w.status)) {
    return { ok: false, error: w.status === 'dropped' ? '取りやめは「取りやめる」のボタンから行ってください' : '状態を選んでください' };
  }

  let workCode: string;
  try {
    ({ workCode } = await saveWork(eventKey, { ...c.w, id: w.id ?? undefined, merged_into: mergedInto }, staffName));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return { ok: false, error: msg.includes('not_found') ? '作品が見つかりません。画面を開き直してください' : '保存できませんでした' };
  }
  revalidatePath('/staff/bw6/works');
  revalidatePath('/staff/bw6/works/print');
  return { ok: true, workCode };
}

/**
 * 作品を取りやめる。confirmCount は1回目に画面に出した申込の人数（サーバで数え直さない。数え直すと count_changed が出なくなる）。
 * 段階1は、お支払いずみの世帯がいる作品は取りやめない（返す分4番は後の計画）。
 */
export async function dropWorkAction(
  workId: number,
  confirmCount: number,
  staffName: string,
): Promise<{ ok: true; households: number } | { ok: false; error: string }> {
  await requireRecitalStaff();
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: '名前を選んでください' };
  if (!Number.isInteger(workId) || !isNonNegInt(confirmCount)) return { ok: false, error: '画面を開き直してください' };
  let r: Awaited<ReturnType<typeof dropWork>>;
  try {
    r = await dropWork(workId, confirmCount, staffName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return { ok: false, error: msg.includes('staff_name') ? '名前を選んでください' : '取りやめられませんでした' };
  }
  if (!r.ok) {
    if (r.code === 'paid_household') return { ok: false, error: `お支払いずみの世帯が ${r.households ?? 0}世帯あります。今は取りやめられません。TARO に知らせてください` };
    if (r.code === 'count_changed') return { ok: false, error: '人数が変わりました。画面を開き直してください' };
    return { ok: false, error: '作品が見つかりません。画面を開き直してください' };
  }
  revalidatePath('/staff/bw6/works');
  revalidatePath('/staff/bw6/works/print');
  revalidatePath('/staff/bw6');
  return { ok: true, households: r.households };
}
