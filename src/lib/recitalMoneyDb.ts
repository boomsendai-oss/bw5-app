// 仮のファイル：Task 9（お金の核）がこのファイルを丸ごと置きかえる。Task 8 が import する afterMoneyChanged だけを置く。
// 形は split.md ③ のまま（recitalMail.ts の仮のファイルと同じ扱い）。試験では mock する。
export async function afterMoneyChanged(householdId: number, cause: 'total' | 'payment'): Promise<void> {
  void householdId;
  void cause;
  throw new Error('recitalMoneyDb: not implemented until Task 9');
}
