'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: 家庭のマイページ（鍵つきURL）から呼ぶため。edit_token の完全一致の1世帯だけを相手にする。
// ほかの世帯の人・中身は返さない。（21・23・15 がこのファイルに足す）
import { updateInstaHandle } from '@/lib/recitalEntryDb';

/** インスタの欄を変える。確かめ（鍵・その世帯の人か・100字・止めている間）は updateInstaHandle の中 */
export async function updateInstaAction(token: string, personId: number, handle: string): Promise<{ ok: boolean }> {
  if (typeof token !== 'string' || !Number.isInteger(personId) || typeof handle !== 'string') return { ok: false };
  return updateInstaHandle(token, personId, handle);
}
