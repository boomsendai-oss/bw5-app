'use server';

// スタッフ専用Server Actions。/staff/* 配下のためproxyの認証で保護される(規約4.5)。
import { revalidatePath } from 'next/cache';
import { setBf6OrderStatusStaff, setBf6Setting, updateBf6EntryItemStaff } from '@/lib/bf6Db';
import { validateBf6EntryEdit, type Bf6EntryEditInput } from '@/lib/bf6';

export async function staffSetOrderStatus(orderId: number, status: string): Promise<void> {
  await setBf6OrderStatusStaff(orderId, status);
  revalidatePath('/staff/bf6');
  revalidatePath('/staff/bf6/entries');
  revalidatePath('/staff/bf6/tickets');
}

/** 出場者情報の修正。検証NGならエラー文言を返し、DBは触らない。 */
export async function staffUpdateEntryItem(
  itemId: number,
  input: Bf6EntryEditInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = validateBf6EntryEdit(input);
  if (typeof v === 'string') return { ok: false, error: v };
  await updateBf6EntryItemStaff(itemId, v);
  revalidatePath('/staff/bf6/entries');
  revalidatePath('/bf6/entries');
  revalidatePath('/bf6');
  return { ok: true };
}

export interface Bf6SettingsForm {
  entryOpen: boolean;
  ticketOpen: boolean;
  streamOpen: boolean;
  entryDeadline: string;
  ticketDeadline: string;
  streamArchiveUntil: string;
  cfCustomerCode: string;
  cfLiveInputUid: string;
  cfSigningKeyId: string;
  cfSigningKeyPem: string;
  hallCapacity: number;
  capacity: { beginner: number; kids: number; general: number };
  pricing: {
    entryBase: number;
    entryPerExtraDivision: number;
    prepaidDiscount: number;
    ticketAdultPrepaid: number;
    ticketAdultOnsite: number;
    ticketChild: number;
    stream: number;
    showcase: number;
  };
}

export async function staffSaveSettings(form: Bf6SettingsForm): Promise<void> {
  await setBf6Setting('entry_open', form.entryOpen ? '1' : '0');
  await setBf6Setting('ticket_open', form.ticketOpen ? '1' : '0');
  await setBf6Setting('stream_open', form.streamOpen ? '1' : '0');
  await setBf6Setting('entry_deadline', form.entryDeadline);
  await setBf6Setting('ticket_deadline', form.ticketDeadline);
  await setBf6Setting('stream_archive_until', form.streamArchiveUntil);
  await setBf6Setting('cf_customer_code', form.cfCustomerCode.trim());
  await setBf6Setting('cf_live_input_uid', form.cfLiveInputUid.trim());
  await setBf6Setting('cf_signing_key_id', form.cfSigningKeyId.trim());
  await setBf6Setting('cf_signing_key_pem', form.cfSigningKeyPem.trim());
  await setBf6Setting('hall_capacity', String(form.hallCapacity));
  await setBf6Setting('capacity', JSON.stringify(form.capacity));
  await setBf6Setting('pricing', JSON.stringify(form.pricing));
  revalidatePath('/staff/bf6');
  revalidatePath('/bf6');
}
