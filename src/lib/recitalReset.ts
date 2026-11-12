// BW6 発表会：試しの発表会（is_test=1）のテストデータを消す文。
// import を1つも持たない（scripts/recital_reset_testdata.mjs が .ts のまま読むため）。
// is_test の守りを文の中に入れてある（呼ぶ側が確かめ忘れても、is_test=0 の発表会の行は数えず消さない）。
// 消す順：入金→返す分→開いている支払い→請求→出演→人→世帯→台帳→束→メール記録→変えた記録。
// 返す分と開いている支払いは split.md の8手順に無いが、世帯に付く行なので入金のすぐ後に足した。
// 設定・料金の規則・作品・特別な料金の事前登録・イントラのページの鍵は残す。

const RESET_TABLES = [
  'recital_payments',
  'recital_refunds',
  'recital_checkouts',
  'recital_charges',
  'recital_casts',
  'recital_people',
  'recital_households',
  'recital_bank_rows',
  'recital_imports',
  'recital_mail_log',
  'recital_changes',
] as const;

const TEST_GUARD = 'event_key = ? AND EXISTS (SELECT 1 FROM recital_events WHERE event_key = ? AND is_test = 1)';

export function recitalResetStatements(eventKey: string): { table: string; countSql: string; deleteSql: string; args: [string, string] }[] {
  return RESET_TABLES.map((table) => ({
    table,
    countSql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${TEST_GUARD}`,
    deleteSql: `DELETE FROM ${table} WHERE ${TEST_GUARD}`,
    args: [eventKey, eventKey],
  }));
}
