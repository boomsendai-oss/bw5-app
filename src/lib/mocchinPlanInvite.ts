// MOCCHINナンバー: 参加費の入金を確認したら、すぐレッスン代の払い方の案内を送る(2026-11-08 TARO・締切を待たない)。
// 銀行振込=スタッフ画面で「入金済み」にしたとき / カード=決済完了メールに案内を含めるので印だけ付ける。
// 送れなかった分は、毎朝のcron(mocchin-reminder)が拾って送る。
import { sendEmail } from '@/lib/email';
import { MOCCHIN_MARK_PLAN_INVITE, buildMocchinPlanEmail, mocchinNeedsLessonPlan, parseSteps } from '@/lib/mocchinEntry';
import { listMocchinEntries, markMocchinReminded, type MocchinEntry } from '@/lib/mocchinEntryDb';

function alreadyInvited(e: MocchinEntry): boolean {
  return parseSteps(e.reminded).includes(MOCCHIN_MARK_PLAN_INVITE);
}

/** 案内を送った印だけ付ける(カード決済の完了メールに案内を入れたとき) */
export async function markMocchinPlanInvited(e: MocchinEntry): Promise<void> {
  if (!alreadyInvited(e)) await markMocchinReminded(e.id, e.reminded, [MOCCHIN_MARK_PLAN_INVITE]);
}

/** 必要なら案内メールを送る。送ったら true(送れなくても例外は投げない) */
export async function sendMocchinPlanInviteIfNeeded(id: number): Promise<boolean> {
  const e = (await listMocchinEntries()).find((x) => x.id === id);
  if (!e || e.status !== 'active' || !mocchinNeedsLessonPlan(e) || alreadyInvited(e)) return false;
  try {
    const mail = buildMocchinPlanEmail({ id: e.id, name: e.name, payToken: e.payToken, isMember: e.isMember, kind: 'invite' });
    await sendEmail({ to: e.email, subject: mail.subject, text: mail.text });
    await markMocchinReminded(e.id, e.reminded, [MOCCHIN_MARK_PLAN_INVITE]);
    return true;
  } catch (err) {
    console.error('[mocchin] plan invite failed', id, err instanceof Error ? err.message : err);
    return false;
  }
}
