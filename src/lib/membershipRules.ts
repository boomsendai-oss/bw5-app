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
import { todayJst, shiftMonthsClamped, shiftDays, isIsoDate } from './dateJst';

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
  // 家族アカウント保護: 現役で通う家族(代表/家族メンバー)とリンクしている場合その氏名
  family_active_link: string | null;
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
  candidates: WithdrawalCandidate[]; // 今すでに退会条件を満たす(家族保護済み)
  pre_notice: WithdrawalCandidate[]; // あと notice_window_days 日で条件到達 (= 1ヶ月前事前通知の対象)
  family_review: WithdrawalCandidate[]; // 本人は未受講だが現役の家族とリンク → 自動退会から除外・要手動確認
  warnings: string[]; // データ異常の防御的検出 (M9: 不正な extended_until 等。member_id 付き)
};

const REASON_LABELS: Record<WithdrawalReason, string> = {
  inactive_6mo: '最終受講から6ヶ月超',
  never_attended_3mo: '入会3ヶ月・未受講',
  long_dormant_nodata: '長期未受講(受講データ全期間で0回)',
};

// 日付シフトは dateJst.ts の shiftMonthsClamped / shiftDays を使う (M8/PR-1)。
// 旧ローカル shiftMonths は月末で膨張ロールオーバーし(例: 2026-08-31 の6ヶ月前が
// 2026-03-03 になる)、早すぎる候補化を起こしていたため月末クランプ版へ移設・置換した。

function dateOnly(s: string | null): string | null {
  if (!s) return null;
  // 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DDTHH...' → 'YYYY-MM-DD'
  return s.slice(0, 10);
}

// ============================================================
// L1: 退会判定コア (純関数) — DBに触らない。vitest はここを叩く。
// assessTicketWithdrawals はデータ取得・家族グラフ構築・整形のみを担い、
// 「誰が退会対象か」の判断はすべて classifyWithdrawal に集約する。
// ============================================================

/** classifyWithdrawal に渡す1会員分の観測値 */
export type ClassifyRow = {
  checkin_count: number;
  last_checkin: string | null; // 生値可 ('YYYY-MM-DD HH:MM:SS' 等)。内部で日付に正規化
  enrolled_at: string | null;
  extended_until: string | null;
  notice_status: string | null;
  /** 現役家族とのリンク先氏名 (assess側で家族グラフから算出)。非null なら家族保護 */
  family_active_link: string | null;
  /** boom_members.created_at (この会員の行が初めて同期された日時)。M11の member_since 算出用 */
  member_created_at: string | null;
};

/** 判定パラメータ (buildWithdrawalParams で算出) */
export type ClassifyParams = {
  today: string;
  sixMonthsAgo: string;
  threeMonthsAgo: string;
  noticeUpper: string; // 事前通知帯の下限 (= sixMonthsAgo)
  noticeLower: string; // 事前通知帯の上限 (= sixMonthsAgo + noticeWindowDays)
  reliableEnrollCutoff: string;
  dataFloor: string | null;
  dataSpanOk: boolean; // 受講データ全期間が normalMonths 以上あるか
};

export type ClassifyBucket = 'candidate' | 'pre_notice' | 'family_review' | 'none';

export type Classification = {
  bucket: ClassifyBucket;
  reason: WithdrawalReason | null; // bucket='none' のとき null
  warnings: string[]; // データ異常の防御的検出 (M9読み側等)
};

/** enrolled_at が移行クラスタ(2025-08一括登録)より後で信頼できるか */
export function isEnrollReliable(enrolledAt: string | null, reliableEnrollCutoff: string): boolean {
  const d = dateOnly(enrolledAt);
  return !!d && d >= reliableEnrollCutoff;
}

/**
 * 1会員の退会判定 (純関数)。
 * - 延長中(extended_until が未来) / 退会処理済み → none
 *   ★M9読み側: extended_until が不正形式なら「延長無効 + warning」(黙って延長扱いにしない)。
 *     旧実装は生文字列比較だったため '2026/08/01' 等の不正値が「未来の延長」と誤解釈され
 *     退会候補を恒久的に隠しうる('/' > '-' の辞書順)。
 * - 受講あり: 最終受講6ヶ月超 → candidate、事前通知帯 → pre_notice
 * - 0回受講: 入会日が信頼できれば3ヶ月例外、信頼不可なら観測事実(long_dormant_nodata)
 *   ★M11(a): long_dormant_nodata は member_since(=enrolled_at ?? created_at ?? dataFloor)が
 *     6ヶ月以上前の会員のみ。enrolled_at 不明の新規会員(同期されたばかり)を
 *     「移行組の長期休眠」と誤判定して退会させない。
 * - candidate 相当でも家族保護(family_active_link)に該当すれば family_review
 */
export function classifyWithdrawal(row: ClassifyRow, p: ClassifyParams): Classification {
  const warnings: string[] = [];
  const none: Classification = { bucket: 'none', reason: null, warnings };
  const lastCheckin = dateOnly(row.last_checkin);
  const enrolledDate = dateOnly(row.enrolled_at);
  const enrollReliable = isEnrollReliable(row.enrolled_at, p.reliableEnrollCutoff);

  // 延長中(extended_until が未来)はスキップ — スタッフがタイマーリセット済み (M9読み側防御込み)
  if (row.extended_until) {
    if (!isIsoDate(row.extended_until)) {
      warnings.push(
        `extended_until '${row.extended_until}' は不正な日付形式のため延長を無効として扱いました`
      );
      // 延長無効 → 通常判定を続行
    } else if (row.extended_until > p.today) {
      return none;
    }
  }
  // 既に退会処理済みはスキップ
  if (row.notice_status === 'withdrawn') return none;

  // 家族保護: candidate 相当は family_review へ回す (pre_notice は通知のみなので分けない)
  const candidateBucket: ClassifyBucket = row.family_active_link ? 'family_review' : 'candidate';

  if (row.checkin_count >= 1) {
    // 通常ルール
    if (lastCheckin && lastCheckin < p.sixMonthsAgo) {
      return { bucket: candidateBucket, reason: 'inactive_6mo', warnings };
    }
    if (lastCheckin && lastCheckin >= p.noticeUpper && lastCheckin < p.noticeLower) {
      // あと noticeWindowDays 日で6ヶ月到達 → 事前通知対象
      return { bucket: 'pre_notice', reason: 'inactive_6mo', warnings };
    }
    return none;
  }

  // 0回受講
  if (enrollReliable) {
    // 信頼できる入会日: 入会3ヶ月例外
    if (enrolledDate! < p.threeMonthsAgo) {
      return { bucket: candidateBucket, reason: 'never_attended_3mo', warnings };
    }
    return none;
  }
  if (p.dataSpanOk) {
    // 移行組で0回: 偽の入会日に頼らず観測事実で判定。
    // ★M11(a): この会員を6ヶ月以上前から把握している場合のみ (新規混入の保護)
    const memberSince = enrolledDate ?? dateOnly(row.member_created_at) ?? p.dataFloor;
    if (memberSince != null && memberSince <= p.sixMonthsAgo) {
      return { bucket: candidateBucket, reason: 'long_dormant_nodata', warnings };
    }
    return none;
  }
  return none;
}

/** 判定パラメータの算出 (純関数)。基準日まわりの日付計算はすべてここに集約する。 */
export function buildWithdrawalParams(opts: {
  today: string;
  normalMonths: number;
  exceptionMonths: number;
  reliableEnrollCutoff: string;
  noticeWindowDays: number;
  dataFloor: string | null;
}): ClassifyParams {
  const { today, normalMonths, exceptionMonths, reliableEnrollCutoff, noticeWindowDays, dataFloor } = opts;
  // M8: 月末クランプ版 (2026-08-31 の6ヶ月前 = 2026-02-28。旧実装は 2026-03-03 に膨張し早すぎ候補化)
  const sixMonthsAgo = shiftMonthsClamped(today, -normalMonths);
  const threeMonthsAgo = shiftMonthsClamped(today, -exceptionMonths);
  // 事前通知の対象帯: 最終受講が [sixMonthsAgo, sixMonthsAgo + noticeWindowDays) の人。
  // = まだ6ヶ月未満だが、あと noticeWindowDays 日で6ヶ月に到達する人。
  const noticeUpper = sixMonthsAgo;
  const noticeLower = shiftDays(sixMonthsAgo, noticeWindowDays);
  // データ全期間が normalMonths 以上あるか (long_dormant_nodata 判定の前提)
  const dataSpanOk = dataFloor ? dataFloor <= sixMonthsAgo : false;
  return { today, sixMonthsAgo, threeMonthsAgo, noticeUpper, noticeLower, reliableEnrollCutoff, dataFloor, dataSpanOk };
}

type Row = {
  member_id: number;
  full_name: string;
  full_name_kana: string | null;
  enrolled_at: string | null;
  member_created_at: string | null;
  email: string | null;
  rep_name: string | null;
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
  // M10: 基準日はJST。旧実装の new Date().toISOString() はUTCで、JSTの朝9時前に
  // 実行すると前日扱いになり月末月初で候補リストがズレていた。
  const today = opts?.todayIso ?? todayJst();
  const normalMonths = opts?.normalMonths ?? 6;
  const exceptionMonths = opts?.exceptionMonths ?? 3;
  // 移行クラスタ(2025-08)より後を「信頼できる入会日」とみなす
  const reliableEnrollCutoff = opts?.reliableEnrollCutoff ?? '2025-09-01';
  const noticeWindowDays = opts?.noticeWindowDays ?? 30;

  // 受講データの最古日 (long_dormant_nodata 判定に使う)
  const floorRow = await getOne(
    `SELECT MIN(lesson_date) AS floor FROM hacomono_reservations WHERE status = 'チェックイン'`
  );
  const dataFloor: string | null = floorRow?.floor ?? null;

  const params = buildWithdrawalParams({
    today,
    normalMonths,
    exceptionMonths,
    reliableEnrollCutoff,
    noticeWindowDays,
    dataFloor,
  });
  const { sixMonthsAgo } = params;

  const rows = (await getAll(
    `SELECT
       m.id            AS member_id,
       m.full_name     AS full_name,
       m.full_name_kana AS full_name_kana,
       m.enrolled_at   AS enrolled_at,
       m.created_at    AS member_created_at,
       m.email         AS email,
       m.rep_name      AS rep_name,
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
  const familyReview: WithdrawalCandidate[] = [];
  const warnings: string[] = []; // M9読み側等のデータ異常検出 (member_id 付き)

  // 家族アカウント保護用のグラフを作る。
  //   現役で通っている会員(=直近 normalMonths 内にチェックイン有り)の氏名を集め、
  //   退会候補が「現役会員と家族リンク(rep_name どちらか向き)」している場合は
  //   自動退会から外して family_review に回す。代表者を退会させると家族メンバーの
  //   運用に影響しうるため(例: 親が代表で子が現役)。
  const famRows = await getAll(
    `SELECT m.full_name AS full_name, m.rep_name AS rep_name,
       (SELECT MAX(r.lesson_date) FROM hacomono_reservations r
          WHERE r.boom_member_id = m.id AND r.status = 'チェックイン') AS last_checkin,
       (SELECT COUNT(*) FROM hacomono_reservations r
          WHERE r.boom_member_id = m.id AND r.status = 'チェックイン') AS cc
     FROM boom_members m WHERE m.status = 'active'`
  );
  const activeAttendeeNames = new Set<string>(); // 現役で通っている会員の氏名
  const repNamesOfActiveAttendees = new Set<string>(); // 現役会員が「代表」に指している氏名
  for (const f of famRows) {
    const lc = dateOnly(f.last_checkin);
    const attending = f.cc > 0 && lc !== null && lc >= sixMonthsAgo;
    if (!attending) continue;
    if (f.full_name) activeAttendeeNames.add(String(f.full_name).trim());
    if (f.rep_name && String(f.rep_name).trim()) repNamesOfActiveAttendees.add(String(f.rep_name).trim());
  }
  // 候補が現役家族とリンクしているか → リンク先の氏名(なければ null)
  const familyActiveLink = (fullName: string, repName: string | null): string | null => {
    const rep = repName ? repName.trim() : '';
    if (rep && activeAttendeeNames.has(rep)) return rep; // 自分の代表が現役
    if (fullName && repNamesOfActiveAttendees.has(fullName.trim())) return fullName; // 自分を代表とする現役家族がいる
    return null;
  };

  for (const r of rows) {
    const base = {
      member_id: r.member_id,
      full_name: r.full_name,
      full_name_kana: r.full_name_kana,
      enrolled_at: r.enrolled_at,
      enrolled_reliable: isEnrollReliable(r.enrolled_at, reliableEnrollCutoff),
      last_checkin: dateOnly(r.last_checkin),
      checkin_count: r.checkin_count,
      has_email: !!(r.email && r.email.trim()),
      has_line: r.has_line > 0,
      family_active_link: familyActiveLink(r.full_name, r.rep_name),
      notice_status: r.notice_status,
      notified_at: r.notified_at,
      extended_until: r.extended_until,
    };

    // 判定は純関数 classifyWithdrawal に集約 (L1)
    const cls = classifyWithdrawal(
      {
        checkin_count: r.checkin_count,
        last_checkin: r.last_checkin,
        enrolled_at: r.enrolled_at,
        extended_until: r.extended_until,
        notice_status: r.notice_status,
        family_active_link: base.family_active_link,
        member_created_at: r.member_created_at,
      },
      params
    );
    for (const w of cls.warnings) warnings.push(`member_id=${r.member_id}: ${w}`);
    if (cls.bucket === 'none') continue;

    const c: WithdrawalCandidate = { ...base, reason: cls.reason!, reason_label: REASON_LABELS[cls.reason!] };
    if (cls.bucket === 'candidate') candidates.push(c);
    else if (cls.bucket === 'family_review') familyReview.push(c);
    else preNotice.push(c);
  }

  // 氏名カナ順で安定ソート
  const byKana = (a: WithdrawalCandidate, b: WithdrawalCandidate) =>
    (a.full_name_kana || a.full_name).localeCompare(b.full_name_kana || b.full_name, 'ja');
  candidates.sort(byKana);
  preNotice.sort(byKana);
  familyReview.sort(byKana);

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
    family_review: familyReview,
    warnings,
  };
}
