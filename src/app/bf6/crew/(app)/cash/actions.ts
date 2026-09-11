'use server';

// 当日現金の集金記録。/bf6/crew 配下(クルーPIN or 本部ログインで認証済み)。
import { isCrewAuthorized } from '@/lib/bf6CrewDb';
import { collectBf6Cash, undoBf6Cash } from '@/lib/bf6CashDb';

type Result = { ok: true } | { ok: false; error: string };

export async function crewRecordCash(orderId: number, amount: number, by: string): Promise<Result> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, error: '注文が特定できません' };
  // 受け取る額は申込の合計で固定(分割払いは扱わない)。amount は画面表示との整合確認のためだけに受ける
  void amount;
  const r = await collectBf6Cash(orderId, by);
  if (!r.ok) return { ok: false, error: r.error };
  // ⚠️ revalidatePath は呼ばない。受け取り直後に明細が「受け取る→渡す」に切り替わる最中に
  //    ルーターの再描画が重なり、React が removeChild で落ちて操作できなくなる(本番実機で再現・2026-09-11)。
  //    メニューは動的ページでクライアントに残らないので、戻れば最新の数が出る。
  return { ok: true };
}

export async function crewUndoCash(orderId: number): Promise<Result> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  await undoBf6Cash(orderId);
  return { ok: true };
}
