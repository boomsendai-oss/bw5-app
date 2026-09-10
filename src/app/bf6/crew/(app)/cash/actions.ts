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
  // ⚠️ 表示中の /bf6/crew/cash は revalidate しない。
  // 集金の途中でツリーが差し替わると、開いていた明細と一覧の並べ替えがぶつかり
  // React が removeChild で落ちて、以後タップが効かなくなる(実機で再現・2026-09-10)。
  // 画面は client 側で即時に更新しているので、サーバからの再取得は要らない。
  revalidatePath('/bf6/crew');
  return { ok: true };
}

export async function crewUndoCash(orderId: number): Promise<Result> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  await undoBf6Cash(orderId);
  revalidatePath('/bf6/crew');
  return { ok: true };
}
