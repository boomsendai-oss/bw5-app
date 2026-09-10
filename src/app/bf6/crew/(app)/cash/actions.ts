'use server';

// 当日現金の集金記録。/bf6/crew 配下(クルーPIN or 本部ログインで認証済み)。
import { revalidatePath } from 'next/cache';
import { isCrewAuthorized } from '@/lib/bf6CrewDb';
import { recordBf6Cash, undoBf6Cash } from '@/lib/bf6CashDb';

type Result = { ok: true } | { ok: false; error: string };

export async function crewRecordCash(orderId: number, amount: number, by: string): Promise<Result> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, error: '注文が特定できません' };
  if (!Number.isInteger(amount) || amount < 0) return { ok: false, error: '金額が正しくありません' };
  await recordBf6Cash(orderId, amount, by);
  revalidatePath('/bf6/crew/cash');
  revalidatePath('/bf6/crew');
  return { ok: true };
}

export async function crewUndoCash(orderId: number): Promise<Result> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  await undoBf6Cash(orderId);
  revalidatePath('/bf6/crew/cash');
  revalidatePath('/bf6/crew');
  return { ok: true };
}
