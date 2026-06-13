// 会員ルール v1 — チケット会員の自動退会 判定ロジック (読み取り専用・算出のみ)
//
// 合意ルール (boom-events-hub/docs/decisions/2026-06-12_membership-rules-v1.md):
//   - 対象: member_type='ticket' かつ status='active' のみ (月謝/学割/休会/staffは対象外)
//   - 通常: 最終チェックインから6ヶ月で退会対象
//   - 例外: 入会から3ヶ月、1度もチェックインが無ければ退会対象 (ノリ入会の早期整理)
//   - 「受講」= hacomono_reservations.status='チェックイン' のみ (無断キャンセル/予約のみは除外)
//
// ★データ実態への対応 (2026-06-14 実データ調査で判明):
//   1. 受講履歴(チェックイン)は 2025-09-01 が最古。それ以前のデータは存在しない。
//   2. ticket会員72名中59名の enrolled_at が 2025-08 に固まっている
//      = HACOMONO移行時の一括登録日であり、実際の入会日ではない。
//   → 「入会3ヶ月例外」を 2025-08 の偽enrolled_atで回すと、実際は長期在籍の人を
//      移行日基準で誤って退会させてしまう。これを防ぐため:
//      - 例外(never_attended_3mo)は enrolled_at が信頼できる(移行クラスタより後)場合のみ適用
//      - enrolled_atが信頼不可で0回受講の場合は、偽の入会日に頼らず
//        「受講データ全期間(最古チェックイン〜現在)で0回」という観測事実で判定
//        (この期間が6ヶ月以上あれば長期休眠とみなす) → reason='long_dormant_nodata'
//
// 退会の「実行」はしない。HACOMONO上で人手処理する不可逆操作のため、本モジュールは
// 「今月退会対象リスト」を算出するだけ。事前通知の送信・退会処理はスタッフが行う。

import { getAll, getOne } from './db';

export type WithdrawalReason = 'inactive_6mo' | 'never_attended_3mo' | 'long_dormant_nodata';

export type WithdrawalCandidate = {
  member_id: number;
  full_name: string;
  full_name_kana: string | null;
  enrolled_at: string | null;
  enrolled_reliable: boolean; // enrolled_at が移行クラスタより後で信頼できるか
  last_checkin: string | null;
  checkin_count: number;
  reason: WithdrawalReason;
  reason_label: string;
  // 連絡手段カバレッジ
  has_email: boolean;
  has_line: boolean;
  // 進行状態 (withdrawal_notices より)
  notice_status: string | null; // candidate / notified / extended / withdrawn / reactivated
  notified_at: string | null;
  extended_until: string | null;
};

export type WithdrawalAssessment = {
  params: {
    today: string;
    normal_months: number;
    exception_months: number;
    reliable_enroll_cutoff: string;
    data_floor: string | null; // 受講データの最古日
    notice_window_days: number;
  };
  candidates: WithdrawalCandidate[]; // 今すでに退会条件を満たす
  pre_notice: WithdrawalCandidate[]; // あと notice_window_days 日で条件到達 (= 1ヶ月前事前通知の対象)
};

const REASON_LABELS: Record<WithdrawalReason, string> = {
  inactive_6mo: '最終受講から6ヶ月超',
  never_attended_3mo: '入会3ヶ月・未受講',
  long_dormant_nodata: '長期未受講(受講データ全期間で0回)',
};

// YYYY-MM-DD の日付文字列を N ヶ月ずらす
function shiftMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

// YYYY-MM-DD の日付文字列を N 日ずらす
function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function dateOnly(s: string | null): string | null {
  if (!s) return null;
  // 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DDTHH...' → 'YYYY-MM-DD'
  return s.slice(0, 10);
}

type Row = {
  member_id: number;
  full_name: string;
  full_name_kana: string | null;
  enrolled_at: string | null;
  email: string | null;
  last_checkin: string | null;
  checkin_count: number;
  has_line: number;
  notice_status: string | null;
  notified_at: string | null;
  extended_until: string | null;
};

/**
 * チケット会員の退会判定を算出する (DBは一切変更しない)。
 * @param todayIso 基準日 'YYYY-MM-DD' (省略時はサーバ現在日)
 */
export async function assessTicketWithdrawals(opts?: {
  todayIso?: string;
  normalMonths?: number;
  exceptionMonths?: number;
  reliableEnrollCutoff?: string;
  noticeWindowDays?: number;
}): Promise<WithdrawalAssessment> {
  const today = opts?.todayIso ?? new Date().toISOString().slice(0, 10);
  const normalMonths = opts?.normalMonths ?? 6;
  const exceptionMonths = opts?.exceptionMonths ?? 3;
  // 移行クラスタ(2025-08)より後を「信頼できる入会日」とみなす
  const reliableEnrollCutoff = opts?.reliableEnrollCutoff ?? '2025-09-01';
  const noticeWindowDays = opts?.noticeWindowDays ?? 30;

  const sixMonthsAgo = shiftMonths(today, -normalMonths);
  const threeMonthsAgo = shiftMonths(today, -exceptionMonths);
  // 事前通知の対象帯: 最終受講が [sixMonthsAgo, sixMonthsAgo + noticeWindowDays) の人。
  // = まだ6ヶ月未満だが、あと noticeWindowDays 日で6ヶ月に到達する人。
  const noticeUpper = sixMonthsAgo;
  const noticeLower = shiftDays(sixMonthsAgo, noticeWindowDays);

  // 受講データの最古日 (long_dormant_nodata 判定に使う)
  const floorRow = await getOne(
    `SELECT MIN(lesson_date) AS floor FROM hacomono_reservations WHERE status = 'チェックイン'`
  );
  const dataFloor: string | null = floorRow?.floor ?? null;

  const rows = (await getAll(
    `SELECT
       m.id            AS member_id,
       m.full_name     AS full_name,
       m.full_name_kana AS full_name_kana,
       m.enrolled_at   AS enrolled_at,
       m.email         AS email,
       (SELECT MAX(r.lesson_date) FROM hacomono_reservations r
          WHERE r.boom_member_id = m.id AND r.status = 'チェックイン') AS last_checkin,
       (SELECT COUNT(*) FROM hacomono_reservations r
          WHERE r.boom_member_id = m.id AND r.status = 'チェックイン') AS checkin_count,
       (SELECT COUNT(*) FROM member_lstep_links l WHERE l.member_id = m.id) AS has_line,
       wn.status       AS notice_status,
       wn.notified_at  AS notified_at,
       wn.extended_until AS extended_until
     FROM boom_members m
     LEFT JOIN withdrawal_notices wn ON wn.member_id = m.id
     WHERE m.member_type = 'ticket' AND m.status = 'active'`
  )) as Row[];

  const candidates: WithdrawalCandidate[] = [];
  const preNotice: WithdrawalCandidate[] = [];

  // データ全期間が normalMonths 以上あるか (long_dormant_nodata 判定の前提)
  const dataSpanOk = dataFloor ? dataFloor <= sixMonthsAgo : false;

  for (const r of rows) {
    const lastCheckin = dateOnly(r.last_checkin);
    const enrolledDate = dateOnly(r.enrolled_at);
    const enrollReliable = !!enrolledDate && enrolledDate >= reliableEnrollCutoff;

    const base = {
      member_id: r.member_id,
      full_name: r.full_name,
      full_name_kana: r.full_name_kana,
      enrolled_at: r.enrolled_at,
      enrolled_reliable: enrollReliable,
      last_checkin: lastCheckin,
      checkin_count: r.checkin_count,
      has_email: !!(r.email && r.email.trim()),
      has_line: r.has_line > 0,
      notice_status: r.notice_status,
      notified_at: r.notified_at,
      extended_until: r.extended_until,
    };

    // 延長中(extended_until が未来)はスキップ — スタッフがタイマーリセット済み
    if (r.extended_until && r.extended_until > today) continue;
    // 既に退会処理済みはスキップ
    if (r.notice_status === 'withdrawn') continue;

    if (r.checkin_count >= 1) {
      // 通常ルール
      if (lastCheckin && lastCheckin < sixMonthsAgo) {
        candidates.push({ ...base, reason: 'inactive_6mo', reason_label: REASON_LABELS.inactive_6mo });
      } else if (lastCheckin && lastCheckin >= noticeUpper && lastCheckin < noticeLower) {
        // あと noticeWindowDays 日で6ヶ月到達 → 事前通知対象
        preNotice.push({ ...base, reason: 'inactive_6mo', reason_label: REASON_LABELS.inactive_6mo });
      }
    } else {
      // 0回受講
      if (enrollReliable) {
        // 信頼できる入会日: 入会3ヶ月例外
        if (enrolledDate! < threeMonthsAgo) {
          candidates.push({ ...base, reason: 'never_attended_3mo', reason_label: REASON_LABELS.never_attended_3mo });
        }
      } else if (dataSpanOk) {
        // 移行組で0回: 偽の入会日に頼らず観測事実で判定
        candidates.push({ ...base, reason: 'long_dormant_nodata', reason_label: REASON_LABELS.long_dormant_nodata });
      }
    }
  }

  // 氏名カナ順で安定ソート
  const byKana = (a: WithdrawalCandidate, b: WithdrawalCandidate) =>
    (a.full_name_kana || a.full_name).localeCompare(b.full_name_kana || b.full_name, 'ja');
  candidates.sort(byKana);
  preNotice.sort(byKana);

  return {
    params: {
      today,
      normal_months: normalMonths,
      exception_months: exceptionMonths,
      reliable_enroll_cutoff: reliableEnrollCutoff,
      data_floor: dataFloor,
      notice_window_days: noticeWindowDays,
    },
    candidates,
    pre_notice: preNotice,
  };
}
