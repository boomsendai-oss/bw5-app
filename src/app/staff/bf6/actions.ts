'use server';

// スタッフ専用Server Actions。/staff/* 配下のためproxyの認証で保護される(規約4.5)。
import { revalidatePath } from 'next/cache';
import { setBf6OrderStatusStaff, setBf6Setting } from '@/lib/bf6Db';

export async function staffSetOrderStatus(orderId: number, status: string): Promise<void> {
  await setBf6OrderStatusStaff(orderId, status);
  revalidatePath('/staff/bf6');
  revalidatePath('/staff/bf6/entries');
  revalidatePath('/staff/bf6/tickets');
}

export interface Bf6SettingsForm {
  entryOpen: boolean;
  ticketOpen: boolean;
  entryDeadline: string;
  ticketDeadline: string;
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
  await setBf6Setting('entry_deadline', form.entryDeadline);
  await setBf6Setting('ticket_deadline', form.ticketDeadline);
  await setBf6Setting('hall_capacity', String(form.hallCapacity));
  await setBf6Setting('capacity', JSON.stringify(form.capacity));
  await setBf6Setting('pricing', JSON.stringify(form.pricing));
  revalidatePath('/staff/bf6');
  revalidatePath('/bf6');
}
