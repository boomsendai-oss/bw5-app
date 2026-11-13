// Lstep友だちCSV(取込時に lstep_csv_snapshots へ全文保存されているもの)から
// 友だち数(ブロック除く)を数える純関数。
//
// lstep_friends テーブルは「今」の状態しか持たず、1週間前の友だち数が分からない。
// 取込のたびにCSV原本が残っているので、それを数え直して週次の増減を出す(2026-11-13)。
// 判定は取込(operations/sync)と同じ: 2行目がヘッダ・IDが数字の行だけ・ブロック列の値で判定。

import { parseCSV, rowsToDicts } from './csvUtil';

const BLOCKED_VALUES = ['1', 'ブロック', 'ブロック中', 'TRUE', 'true'];

export type LstepFriendCount = {
  total: number;
  blocked: number;
  active: number;
  /** CSVにブロック列があるか。2026-11-10より前の取込CSVには無く、ブロックも友だちに数えていた */
  has_block_column: boolean;
};

export function countLstepFriends(csvText: string): LstepFriendCount {
  const dicts = rowsToDicts(parseCSV(csvText), 1);
  const rows = dicts.filter((r) => /^\d+$/.test((r['ID'] ?? '').trim()));
  const hasBlock = rows.some((r) => 'ユーザーブロック' in r);
  const blocked = rows.filter((r) => BLOCKED_VALUES.includes((r['ユーザーブロック'] ?? '').trim())).length;
  return { total: rows.length, blocked, active: rows.length - blocked, has_block_column: hasBlock };
}

/**
 * 2つの時点の友だち数を「同じ物差し」で比べる値を返す。
 * 両方にブロック列があればブロック除く人数、片方でも無ければ総数どうしで比べる
 * (列が増えた日に、ブロック済みの人数ぶん「急減」したように見える誤報を防ぐ)。
 */
export function comparableFriendCounts(now: LstepFriendCount, prev: LstepFriendCount): { now: number; prev: number; basis: 'active' | 'total' } {
  if (now.has_block_column && prev.has_block_column) return { now: now.active, prev: prev.active, basis: 'active' };
  return { now: now.total, prev: prev.total, basis: 'total' };
}
