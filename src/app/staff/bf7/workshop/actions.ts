'use server';

// HIRO ワークショップ スタッフ専用 Server Actions。/staff/* はproxy(cookie存在チェック)で覆われているが、
// proxyはDBを見られないため isAuthorizedServer() による本検証をここで必ず行う(規約4.5)。
import { revalidatePath } from 'next/cache';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { buildBf7WsEmail } from '@/lib/bf7Workshop';
import { cancelBf7WsOrder, getBf7WsOrderById, setBf7WsMemberCheck, setBf7WsStaffNote, setBf7WsTransferReceived } from '@/lib/bf7WorkshopDb';
import { sendEmail } from '@/lib/email';

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
  if (res.ok && received) {
    // 入金を確認したら、申込が確定したことを本人に知らせる(テスト申込には送らない)
    try {
      const o = await getBf7WsOrderById(id);
      if (o && !o.isTest) {
        const mail = buildBf7WsEmail({ id: o.id, name: o.name, first: o.first, second: o.second, amountTotal: o.amountTotal, payMethod: o.payMethod, isMember: o.isMember, paid: true, appliedOn: o.appliedOn });
        await sendEmail({ to: o.email, subject: mail.subject, text: mail.text });
      }
    } catch (e) {
      console.error('[bf7ws] paid mail failed. order:', id, e instanceof Error ? e.message : e);
      return { ok: false, error: '入金確認は保存しましたが、確定メールを送れませんでした。本人に連絡してください' };
    }
  }
  return res;
}

export async function cancelOrderAction(id: number): Promise<Result> {
  return run(() => cancelBf7WsOrder(id));
}

export async function saveStaffNoteAction(id: number, note: string): Promise<Result> {
  return run(() => setBf7WsStaffNote(id, note));
}
