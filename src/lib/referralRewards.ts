// 紹介特典の判定(純粋関数・2026-11-09 TARO承認)。DBには触らない(DB層は referralRewardsDb.ts)。
//
// 仕様:
//  - 体験予約フォームの「ご紹介者のお名前（カタカナ）」(trial_records.referrer_kana) を
//    在籍会員の full_name_kana と照合(referral.ts の matchReferrer)。
//  - タグ対象: 紹介者が名簿で1人に決まる予約だけ「紹介で体験」タグの対象にする
//    (受付QRの自動応答でクーポンコードを返すため)。決まらないものは unmatched(要確認)。
//  - 特典台帳: 体験者が入会した(enrolled_member_id が埋まった)紹介予約を台帳に入れる。
//    紹介者が1人に決まれば pending(=チケット1回・2か月有効を付ける)、決まらなければ needs_review。
import { matchReferrer, type MemberKana } from './referral';

export type ReferralTrial = {
  id: number;
  lstep_id: string | null;
  reserved_at: string; // 'YYYY-MM-DD HH:MM:SS' (JST)
  status: string | null;
  referrer_kana: string | null;
  enrolled_member_id: number | null;
};

export type ActiveMember = MemberKana & { hacomono_member_id?: string | null };

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isCanceled = (s: string | null) => (s ?? '').trim() === 'キャンセル';

export type TagTargets = {
  targets: { lstep_id: string; trial_record_id: number; referrer_member_id: number }[];
  unmatched: { trial_record_id: number; reason: 'none' | 'ambiguous' }[];
};

/** 「紹介で体験」タグを付ける対象。体験日が (today - lookbackDays) 以降のものだけ見る。 */
export function decideReferralTagTargets(
  trials: ReferralTrial[],
  members: ActiveMember[],
  today: string,
  lookbackDays = 3,
): TagTargets {
  const from = addDays(today, -lookbackDays);
  const out: TagTargets = { targets: [], unmatched: [] };
  const seen = new Set<string>();
  for (const t of trials) {
    if (!t.referrer_kana || !t.lstep_id || isCanceled(t.status)) continue;
    if (t.reserved_at.slice(0, 10) < from) continue;
    const m = matchReferrer(t.referrer_kana, members);
    if (m.status === 'match') {
      if (seen.has(t.lstep_id)) continue; // 同じLINEに複数予約があってもタグは1回
      seen.add(t.lstep_id);
      out.targets.push({ lstep_id: t.lstep_id, trial_record_id: t.id, referrer_member_id: m.memberIds[0] });
    } else {
      out.unmatched.push({ trial_record_id: t.id, reason: m.status });
    }
  }
  return out;
}

export type NewReward = {
  trial_record_id: number;
  referee_member_id: number;
  referrer_member_id: number | null;
  referrer_kana: string;
  status: 'pending' | 'needs_review';
  note: string | null;
};

/**
 * 入会が成立した紹介予約から、台帳に新しく入れる行を決める。
 * - 既に台帳にある trial_record_id は対象外(冪等)
 * - 同じ入会者(referee)が複数の紹介予約を持っていても1件だけ(最初の予約)
 * - 自分で自分を紹介(referrer=referee)は needs_review
 */
export function decideNewRewards(
  trials: ReferralTrial[],
  members: ActiveMember[],
  existingTrialIds: Set<number>,
  existingRefereeIds: Set<number> = new Set(),
): NewReward[] {
  const out: NewReward[] = [];
  const referees = new Set(existingRefereeIds);
  const sorted = [...trials].sort((a, b) => a.reserved_at.localeCompare(b.reserved_at));
  for (const t of sorted) {
    if (!t.referrer_kana || t.enrolled_member_id == null) continue;
    if (existingTrialIds.has(t.id) || referees.has(t.enrolled_member_id)) continue;
    referees.add(t.enrolled_member_id);
    const m = matchReferrer(t.referrer_kana, members);
    if (m.status === 'match' && m.memberIds[0] !== t.enrolled_member_id) {
      out.push({ trial_record_id: t.id, referee_member_id: t.enrolled_member_id, referrer_member_id: m.memberIds[0], referrer_kana: t.referrer_kana, status: 'pending', note: null });
    } else {
      const note = m.status === 'match' ? '紹介者と入会者が同じ' : m.status === 'ambiguous' ? '同じ名前の会員が複数' : '会員名簿に見つからない';
      out.push({ trial_record_id: t.id, referee_member_id: t.enrolled_member_id, referrer_member_id: null, referrer_kana: t.referrer_kana, status: 'needs_review', note });
    }
  }
  return out;
}

/** 有効期限 = 付与日 + 2か月の同日(月末をまたぐときはその月の末日)。'YYYY-MM-DD' */
export function ticketExpiry(grantDate: string, months = 2): string {
  const [y, m, d] = grantDate.split('-').map(Number);
  const targetMonthIndex = m - 1 + months;
  const ty = y + Math.floor(targetMonthIndex / 12);
  const tm = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** TAROへの通知文(Pushover)。会員番号=hacomono_member_id。氏名は呼び出し側が渡すときだけ添える。 */
export function buildRewardNotice(r: {
  status: 'pending' | 'needs_review';
  refereeNo: string | null;
  referrerNo: string | null;
  trialDate: string; // 'YYYY-MM-DD'
  note?: string | null;
  refereeName?: string | null;
  referrerKana?: string | null;
}): { title: string; message: string } {
  const [, mm, dd] = r.trialDate.split('-');
  const trial = `体験${Number(mm)}/${Number(dd)}`;
  const referee = `会員番号${r.refereeNo ?? '?'}${r.refereeName ? `（${r.refereeName}）` : ''}`;
  if (r.status === 'pending') {
    return {
      title: '【紹介で入会】',
      message: `紹介で入会：${referee}（${trial}）／紹介者 会員番号${r.referrerNo ?? '?'} → チケット1回(2か月有効)を付けます`,
    };
  }
  return {
    title: '【紹介で入会・要確認】',
    message: `紹介で入会：${referee}（${trial}）／紹介者「${r.referrerKana ?? ''}」が名簿で決まりません・確認してください${r.note ? `（${r.note}）` : ''}`,
  };
}
