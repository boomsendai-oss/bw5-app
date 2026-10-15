// 音源アップロードの「誰のチームか」を決める(サーバ専用)。
// 受け付けるのは2種類: 控えページのトークン(edit_token) / 提出ページで発行した短時間の通行証。
import { verifyAudioTicket } from '@/lib/partyAudioTicket';
import { loadConfirmedEntryById, loadPartyOrderByToken, type PartyOrder } from '@/lib/partyDb';

export async function resolveAudioCredential(credential: string): Promise<PartyOrder | null> {
  const id = verifyAudioTicket(credential);
  if (id != null) return loadConfirmedEntryById(id);
  const o = await loadPartyOrderByToken(credential);
  return o && o.kind === 'entry' && (o.status === 'paid' || o.status === 'cash_due') ? o : null;
}
