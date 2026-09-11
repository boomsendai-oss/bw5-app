'use server';

// 観覧のお客さんの入場受付。/bf6/crew 配下(クルーPIN or 本部ログインで認証済み)。
import { revalidatePath } from 'next/cache';
import { isCrewAuthorized } from '@/lib/bf6CrewDb';
import { collectBf6Cash } from '@/lib/bf6CashDb';
import { addBf6GateHanded } from '@/lib/bf6GateDb';

type Result = { ok: true } | { ok: false; error: string };

/** 入場口で当日現金を受け取る。集金画面と同じ処理なので、全画面に支払い済みが共有される。 */
export async function crewGateCollect(orderId: number, by: string): Promise<Result> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, error: '申込が特定できません' };
  const r = await collectBf6Cash(orderId, by || '入場受付');
  if (!r.ok) return { ok: false, error: r.error };
  // ⚠️ 表示中の /bf6/crew/gate は revalidate しない(開いている明細と並べ替えがぶつかる・集金画面で実証済)
  revalidatePath('/bf6/crew');
  return { ok: true };
}

/** リストバンドを渡した数を足す。取り消しは負の数。 */
export async function crewGateHand(
  orderId: number,
  delta: number,
  by: string
): Promise<{ ok: true; handed: number } | { ok: false; error: string }> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, error: '申込が特定できません' };
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: '枚数が正しくありません' };
  const r = await addBf6GateHanded(orderId, delta, by);
  if (r.ok) revalidatePath('/bf6/crew');
  return r;
}
