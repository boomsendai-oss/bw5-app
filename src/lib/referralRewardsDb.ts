// 紹介特典のDB層(2026-11-09)。判定は referralRewards.ts(純粋関数)。
// ⚠️ 氏名はログに出さない(公開リポジトリ・Vercelログ)。通知(Pushover=TARO本人の端末)にだけ載せる。
import { getAll, execute } from './db';
import { decideNewRewards, decideReferralTagTargets, buildRewardNotice, type ReferralTrial, type ActiveMember, type TagTargets } from './referralRewards';
import { pushoverTarget } from './notify';
import { sendPushover } from './inboxAlert/pushover';
import { todayJst } from './dateJst';

async function loadReferralTrials(): Promise<ReferralTrial[]> {
  return (await getAll(
    `SELECT id, lstep_id, reserved_at, status, referrer_kana, enrolled_member_id
       FROM trial_records
      WHERE referrer_kana IS NOT NULL AND TRIM(referrer_kana) <> ''`,
  )) as ReferralTrial[];
}

async function loadActiveMembers(): Promise<ActiveMember[]> {
  return (await getAll(
    `SELECT id, full_name_kana, hacomono_member_id FROM boom_members WHERE status = 'active'`,
  )) as ActiveMember[];
}

/** 「紹介で体験」タグの対象(Lステップ側のジョブが読む) */
export async function getReferralTagTargets(): Promise<TagTargets> {
  const [trials, members] = await Promise.all([loadReferralTrials(), loadActiveMembers()]);
  return decideReferralTagTargets(trials, members, todayJst());
}

export type RewardRunSummary = { ok: true; added: number; pending: number; needs_review: number; notified: number; notify_skipped: boolean };

/** 入会が成立した紹介予約を台帳に追加し、追加分をTAROへ通知する。冪等。 */
export async function runReferralRewards(opts: { notify?: boolean } = {}): Promise<RewardRunSummary> {
  const [trials, members, existing] = await Promise.all([
    loadReferralTrials(),
    loadActiveMembers(),
    getAll(`SELECT trial_record_id, referee_member_id FROM referral_rewards`) as Promise<{ trial_record_id: number; referee_member_id: number | null }[]>,
  ]);
  const rows = decideNewRewards(
    trials,
    members,
    new Set(existing.map((e) => e.trial_record_id)),
    new Set(existing.map((e) => e.referee_member_id).filter((x): x is number => x != null)),
  );
  const summary: RewardRunSummary = { ok: true, added: 0, pending: 0, needs_review: 0, notified: 0, notify_skipped: false };
  if (rows.length === 0) return summary;

  const target = opts.notify === false ? null : pushoverTarget(process.env);
  if (!target) summary.notify_skipped = true;
  const trialById = new Map(trials.map((t) => [t.id, t]));
  const ids = [...new Set(rows.flatMap((r) => [r.referee_member_id, r.referrer_member_id]).filter((x): x is number => x != null))];
  const people = ids.length
    ? ((await getAll(
        `SELECT id, hacomono_member_id, full_name FROM boom_members WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )) as { id: number; hacomono_member_id: string | null; full_name: string | null }[])
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  for (const r of rows) {
    const res = await execute(
      `INSERT OR IGNORE INTO referral_rewards (trial_record_id, referee_member_id, referrer_member_id, referrer_kana, status, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [r.trial_record_id, r.referee_member_id, r.referrer_member_id, r.referrer_kana, r.status, r.note],
    );
    if (!res || (res as { rowsAffected?: number }).rowsAffected === 0) continue;
    summary.added += 1;
    if (r.status === 'pending') summary.pending += 1; else summary.needs_review += 1;
    if (!target) continue;
    const referee = byId.get(r.referee_member_id);
    const referrer = r.referrer_member_id != null ? byId.get(r.referrer_member_id) : undefined;
    const notice = buildRewardNotice({
      status: r.status,
      refereeNo: referee?.hacomono_member_id ?? null,
      referrerNo: referrer?.hacomono_member_id ?? null,
      trialDate: (trialById.get(r.trial_record_id)?.reserved_at ?? '').slice(0, 10),
      note: r.note,
      refereeName: referee?.full_name ?? null,
      referrerKana: r.referrer_kana,
    });
    try {
      await sendPushover(target.appToken, target.userKey, notice);
      await execute(`UPDATE referral_rewards SET notified_at = datetime('now') WHERE trial_record_id = ?`, [r.trial_record_id]);
      summary.notified += 1;
    } catch (e) {
      console.warn(`[referralRewards] 通知失敗 trial=${r.trial_record_id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return summary;
}

export type PendingReward = {
  id: number;
  trial_record_id: number;
  referrer_member_id: number;
  referrer_hacomono_id: string | null;
  referee_hacomono_id: string | null;
  created_at: string;
};

/** チケット付与待ち(M1のスクリプトが読む)。氏名は返さない。 */
export async function getPendingRewards(): Promise<PendingReward[]> {
  return (await getAll(
    `SELECT r.id, r.trial_record_id, r.referrer_member_id, r.created_at,
            ref.hacomono_member_id AS referrer_hacomono_id, ee.hacomono_member_id AS referee_hacomono_id
       FROM referral_rewards r
       LEFT JOIN boom_members ref ON ref.id = r.referrer_member_id
       LEFT JOIN boom_members ee ON ee.id = r.referee_member_id
      WHERE r.status = 'pending' AND r.referrer_member_id IS NOT NULL
      ORDER BY r.id`,
  )) as PendingReward[];
}

/** 付与結果の書き戻し。status は granted / skipped / needs_review のみ。 */
export async function markReward(id: number, status: 'granted' | 'skipped' | 'needs_review', ticketExpiresOn: string | null, note: string | null): Promise<boolean> {
  const res = await execute(
    `UPDATE referral_rewards
        SET status = ?, ticket_expires_on = COALESCE(?, ticket_expires_on),
            granted_at = CASE WHEN ? = 'granted' THEN datetime('now') ELSE granted_at END,
            note = COALESCE(?, note)
      WHERE id = ? AND status = 'pending'`,
    [status, ticketExpiresOn, status, note, id],
  );
  return ((res as { rowsAffected?: number })?.rowsAffected ?? 0) > 0;
}
