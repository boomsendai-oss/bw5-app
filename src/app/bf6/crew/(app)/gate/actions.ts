'use server';

// 観覧のお客さんの入場受付。/bf6/crew 配下(クルーPIN or 本部ログインで認証済み)。
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
  // ⚠️ revalidatePath は呼ばない。受け取り直後に明細が「受け取る→渡す」に切り替わる最中に
  //    ルーターの再描画が重なり、React が removeChild で落ちて操作できなくなる(本番実機で再現・2026-09-11)。
  //    メニューは動的ページでクライアントに残らないので、戻れば最新の数が出る。
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
  return addBf6GateHanded(orderId, delta, by);
}
