/**
 * 体験予約(trial_records)の重複判定キー。
 *
 * 2026-11-15: 従来は (lstep_id, reserved_at) で突合していたため、1つのLINEアカウントから
 * 同じ枠に複数人(兄弟など)を予約すると、2人目が1人目の行をUPSERTで潰して消えていた。
 * 申込者名(applicant_name)もキーに含め、1アカウント複数人を別の行として取り込む。
 *
 * 注: 同じ予約に対する再取込では名前は同じCSV源から来るので安定し、更新に回る(冪等)。
 * UNIQUEインデックス uq_trial_lstep_reserved_name(lstep_id, reserved_at, applicant_name) と対。
 */
export function trialDedupKey(
  lstepId: string | null | undefined,
  reservedAt: string,
  applicantName: string | null | undefined,
): string {
  return `${lstepId ?? ''}|${reservedAt}|${applicantName ?? ''}`;
}

/** INSERT ... ON CONFLICT(...) の対象列。上記の UNIQUE インデックスと一致させること。 */
export const TRIAL_CONFLICT_TARGET = 'lstep_id, reserved_at, applicant_name';
