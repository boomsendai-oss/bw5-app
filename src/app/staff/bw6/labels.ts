// BW6 発表会のスタッフの画面の言葉。世帯の見え方の言葉は Task 2 の householdViewLabel を使い、ここに表を作らない。
export const MATCH_STATUS_LABEL: Record<string, string> = {
  auto: '自動で合った',
  pending: '会員との照合の確認待ち',
  unmatched: '合わない',
  none: '会員ではない',
  manual: 'スタッフが決めた',
};

// 作品の画面（Task 17）の言葉
export const WORK_KIND_LABEL: Record<string, string> = {
  class: 'クラス作品',
  instructor: 'イントラナンバー',
  guest: 'ゲスト',
  club: 'ダンス部',
  special: 'スペシャル',
  ending: 'エンディング',
  external: '外部振付',
};

export const WORK_ENTRY_MODE_LABEL: Record<string, string> = {
  form: 'フォームで受ける',
  staff: 'スタッフが入れる',
  none: '受けない',
};

export const WORK_FEE_TYPE_LABEL: Record<string, string> = {
  counted: '作品の数に数える',
  not_counted: '数えない（お金なし）',
  extra: '別料金',
  separate: '別建て（MOCCHIN）',
};

export const WORK_STATUS_LABEL: Record<string, string> = {
  draft: '準備中',
  open: '受付中',
  fixed: '確定',
  dropped: '取りやめ',
};

export const WORK_ROLE_LABEL: Record<string, string> = {
  choreo: '振付',
  perform: '出演もする',
  assist: '補助',
};

// 申込の一覧と世帯の画面（Task 19）の言葉。知らない値は、そのまま出す（labelOf）。

/** 表にない値は、そのままの字で出す */
export function labelOf(table: Record<string, string>, v: string | null | undefined, empty = ''): string {
  if (v == null || v === '') return empty;
  return Object.hasOwn(table, v) ? table[v] : v;
}

/** 世帯の払い方（recital_households.pay_method）。空は「まだ選んでいない」 */
export const PAY_METHOD_LABEL: Record<string, string> = {
  card: 'カード',
  bank: '銀行振込',
  cash: '現金',
};
export const PAY_METHOD_EMPTY = 'まだ選んでいない';

/** 「振り込みました」の印を押したのはだれか（bank_told_by） */
export const BANK_TOLD_BY_LABEL: Record<string, string> = {
  family: '家庭',
  staff: 'スタッフ',
};

/** 入金の行の払い方（recital_payments.method） */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank: '銀行振込',
  card: 'カード',
  cash: '現金',
  adjust: '調整',
};

/** 入金の行のどこから（recital_payments.source）。stripe_recheck はカードの確かめ直しで入った行 */
export const PAYMENT_SOURCE_LABEL: Record<string, string> = {
  bank_auto: '自動で当てた',
  bank_staff: '人が当てた',
  stripe_webhook: 'カード',
  stripe_recheck: 'カード',
  manual: '手で',
};

/** 返す分の状態（recital_refunds.status） */
export const REFUND_STATUS_LABEL: Record<string, string> = {
  todo: '返金の待ち',
  done: '返した',
  cancelled: '取り消した',
};

/** 送ったメールの種類（recital_mail_log.mail_kind） */
export const MAIL_KIND_LABEL: Record<string, string> = {
  receipt: '受付の控え',
  change: '変更の控え',
  complete: '申込完了',
  extra_complete: '追加分のお支払い完了',
  remaining: 'あと◯円のお知らせ',
  resend_url: 'URLの送り直し',
  bank_guide: 'お振込みのご案内',
};

/** 送ったメールの状態（recital_mail_log.status） */
export const MAIL_STATUS_LABEL: Record<string, string> = {
  sent: '送った',
  failed: '失敗',
  waiting: '待ち',
  cancelled: '取りやめ',
};

/**
 * メールの行の状態の言葉。waiting なのに sent_at がある行は、送る係が取ったあとで止まった行（Task 10）で、
 * 送れたかどうか分からないので「送れたか不明」と出す（「待ち」と出さない）。
 */
export function mailStatusLabel(row: { status: string; sent_at: string | null }): string {
  if (row.status === 'waiting' && row.sent_at != null && row.sent_at !== '') return '送れたか不明';
  return labelOf(MAIL_STATUS_LABEL, row.status);
}

/** 特別な料金の印（recital_people.fee_class_override） */
export const FEE_CLASS_LABEL: Record<string, string> = {
  no_coop: '協力チケットなし',
  tshirt_only: 'Tシャツ代だけ',
  free: '参加費なし',
};

/** 出演の状態（recital_casts.status） */
export const CAST_STATUS_LABEL: Record<string, string> = {
  in: '出る',
  maybe: '迷っている',
  out: 'やめた',
  passed: '見送り',
};

/** 代わりに直すの失敗の文（applyHouseholdEdits の code） */
export const EDIT_FAIL_LABEL: Record<string, string> = {
  closed: '締切のあとです',
  max_works: '5作品をこえます',
  paid_no_maybe: 'お支払いのあとは『迷っている』に戻せません',
  last_work: '最後の1作品です。公式LINEで家庭に確かめてください',
  invalid: '入れた値を確かめてください',
};
