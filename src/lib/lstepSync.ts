// src/lib/lstepSync.ts — Lstep友だちCSV → lstep_friends 同期のSQL組み立て
//
// 背景 (2026-07-27の事故): Lstep側のCSVエクスポート項目が「ID / 表示名」の2列だけに
// 縮んでいたため、6時間ごとの同期が system_display_name / line_register_name /
// real_name / last_message_at を null、blocked を 0 で上書きし続け、813人分の
// データが消えていた。誰も気づけなかった (エラーは出ない)。
//
// 「CSVに列が無い」と「CSVの値が空」は別物。列が無いなら DB を触らないのが正しい。
// 欠けた列は lstepMissingColumns() で運用に見せ、黙って劣化させない。

/** CSV列名 → lstep_friends の列名。ここに無いDB列は同期対象外 (role 等)。 */
const COLUMN_MAP = [
  { csv: '表示名', db: 'display_name' },
  { csv: 'システム表示名', db: 'system_display_name' },
  { csv: 'LINE登録名', db: 'line_register_name' },
  { csv: '本名', db: 'real_name' },
  { csv: 'ユーザーブロック', db: 'blocked' },
  { csv: '最終メッセージ日時', db: 'last_message_at' },
] as const;

/** CSVヘッダーに存在しない = 今回の同期では更新できない項目名を返す。 */
export function lstepMissingColumns(csvHeaders: Iterable<string>): string[] {
  const present = new Set(csvHeaders);
  return COLUMN_MAP.filter((c) => !present.has(c.csv)).map((c) => c.csv);
}

/**
 * lstep_friends の UPSERT SQL を組み立てる。
 * INSERT 側は常に全列 (新規行には消すべき既存値が無い)。
 * ON CONFLICT の UPDATE 側は **CSVに列があるものだけ** に絞る。
 */
export function buildLstepUpsertSql(csvHeaders: Iterable<string>): string {
  const present = new Set(csvHeaders);
  const sets = COLUMN_MAP.filter((c) => present.has(c.csv)).map((c) => `${c.db}=excluded.${c.db}`);
  return `
    INSERT INTO lstep_friends
      (lstep_id, display_name, system_display_name, line_register_name, real_name,
       role, blocked, last_message_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
    ON CONFLICT(lstep_id) DO UPDATE SET
      ${sets.map((s) => `${s},\n      `).join('')}updated_at=CURRENT_TIMESTAMP
  `;
}
