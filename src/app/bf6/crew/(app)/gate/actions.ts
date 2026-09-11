'use server';

// 観覧のお客さんの入場受付と当日券。/bf6/crew 配下(クルーPIN or 本部ログインで認証済み)。
//
// ⚠️ ここでは revalidatePath を呼ばない。受け取り直後に明細が「受け取る→渡す」に切り替わる最中に
//    ルーターの再描画が重なり、React が removeChild で落ちて操作できなくなる(本番実機で再現・2026-09-11)。
//    メニューは動的ページでクライアントに残らないので、戻れば最新の数が出る。
import { isCrewAuthorized } from '@/lib/bf6CrewDb';
import { collectBf6Cash } from '@/lib/bf6CashDb';
import { addBf6GateHanded, addBf6WalkinSale, deleteBf6WalkinSale } from '@/lib/bf6GateDb';
import { validateWalkin, type WalkinSale } from '@/lib/bf6Gate';

type Result = { ok: true } | { ok: false; error: string };

/** 入場口で当日現金を受け取る。集金画面と同じ処理なので、全画面に支払い済みが共有される。 */
export async function crewGateCollect(orderId: number, by: string): Promise<Result> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, error: '申込が特定できません' };
  const r = await collectBf6Cash(orderId, by || '入場受付');
  if (!r.ok) return { ok: false, error: r.error };
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

/** 当日券を売る。金額はサーバで料金設定から計算する(画面の数字は信用しない)。 */
export async function crewWalkinSell(
  adult: number,
  child: number,
  by: string
): Promise<{ ok: true; sale: WalkinSale } | { ok: false; error: string }> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  const invalid = validateWalkin({ adult, child });
  if (invalid) return { ok: false, error: invalid };
  const sale = await addBf6WalkinSale(adult, child, by);
  return { ok: true, sale };
}

export async function crewWalkinUndo(id: number): Promise<Result> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: '記録が特定できません' };
  await deleteBf6WalkinSale(id);
  return { ok: true };
}
