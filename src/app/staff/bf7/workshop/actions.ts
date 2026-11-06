'use server';

// HIRO ワークショップ スタッフ専用 Server Actions。/staff/* はproxy(cookie存在チェック)で覆われているが、
// proxyはDBを見られないため isAuthorizedServer() による本検証をここで必ず行う(規約4.5)。
import { revalidatePath } from 'next/cache';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { cancelBf7WsOrder, setBf7WsMemberCheck, setBf7WsStaffNote, setBf7WsTransferReceived } from '@/lib/bf7WorkshopDb';
import { sendBf7WsPaidMail } from '@/lib/bf7WorkshopPaidMail';

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<boolean>): Promise<Result> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
  if (!(await fn())) return { ok: false, error: '更新できませんでした(すでに変更されている可能性があります)' };
  revalidatePath('/staff/bf7/workshop');
  return { ok: true };
}

export async function setMemberCheckAction(id: number, check: 'confirmed' | 'rejected'): Promise<Result> {
  return run(() => setBf7WsMemberCheck(id, check));
}

export async function setTransferReceivedAction(id: number, received: boolean): Promise<Result> {
  const res = await run(() => setBf7WsTransferReceived(id, received));
  if (res.ok && received && !(await sendBf7WsPaidMail(id))) {
    return { ok: false, error: '入金確認は保存しましたが、確定メールを送れませんでした。本人に連絡してください' };
  }
  return res;
}

export async function cancelOrderAction(id: number): Promise<Result> {
  return run(() => cancelBf7WsOrder(id));
}

export async function saveStaffNoteAction(id: number, note: string): Promise<Result> {
  return run(() => setBf7WsStaffNote(id, note));
}
