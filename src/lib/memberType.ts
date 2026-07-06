// 会員の member_type を plan_name から導出する唯一の正本ロジック。
// 元々は scripts/migrations/20260607_member_type.sql の UPDATE 群でしか
// 設定されず、日次同期(sync)が member_type を更新しないため、6/7以降の
// プラン変更・休会・新規チケット会員が誤分類されるバグがあった(B-1)。
// sync の UPSERT とバックフィルの両方でこの関数を使い、常に鮮度を保つ。
//
// 分類:
//   ticket  … プラン名に「チケット」
//   staff   … 「管理者」または「インストラクター」
//   休会    … 「休会」
//   college … 「カレッジ」
//   regular … 上記以外(レギュラー/受け放題/60分/90分 等)
//
// 注: 'visitor'(課金取込の自動生成レコード)は HACOMONO 会員CSVに載らず
// sync 経路を通らないため、この関数の対象外(既存値を保持する)。
export function deriveMemberType(planName: string | null | undefined): string {
  const p = planName ?? '';
  if (p.includes('チケット')) return 'ticket';
  if (p.includes('管理者') || p.includes('インストラクター')) return 'staff';
  if (p.includes('休会')) return '休会';
  if (p.includes('カレッジ')) return 'college';
  return 'regular';
}
