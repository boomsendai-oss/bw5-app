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
