'use server';

// BW6スペシャルナンバー by MOCCHIN スタッフ専用 Server Actions。/staff/* はproxy(cookie存在チェック)で
// 覆われているが、proxyはDBを見られないため isAuthorizedServer() による本検証をここで必ず行う(規約4.5)。
import { revalidatePath } from 'next/cache';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { saveMocchinCapacity, setMocchinPaid, setMocchinStaffNote, setMocchinStatus } from '@/lib/mocchinEntryDb';

async function requireStaff(): Promise<void> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
}

type Result = { ok: true } | { ok: false; error: string };

export async function togglePaidAction(id: number, paid: boolean): Promise<Result> {
  await requireStaff();
  if (!(await setMocchinPaid(id, paid))) return { ok: false, error: '見つかりません' };
  revalidatePath('/staff/mocchin');
  return { ok: true };
}

export async function setStatusAction(id: number, status: 'active' | 'cancelled'): Promise<Result> {
  await requireStaff();
  if (!(await setMocchinStatus(id, status))) return { ok: false, error: '見つかりません' };
  revalidatePath('/staff/mocchin');
  return { ok: true };
}

export async function saveStaffNoteAction(id: number, note: string): Promise<Result> {
  await requireStaff();
  if (!(await setMocchinStaffNote(id, note))) return { ok: false, error: '見つかりません' };
  revalidatePath('/staff/mocchin');
  return { ok: true };
}

export async function saveCapacityAction(n: number): Promise<Result> {
  await requireStaff();
  if (!Number.isInteger(n) || n < 1 || n > 200) return { ok: false, error: '定員は1〜200の数字で入れてください' };
  await saveMocchinCapacity(n);
  revalidatePath('/staff/mocchin');
  return { ok: true };
}
