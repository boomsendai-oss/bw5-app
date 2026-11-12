// BW6 発表会（段階1）の守りを1か所に（split.md ③）。サーバ専用（DB を読む）。
// Task 14 が先に作った：家庭のマイページの鍵（edit_token）で世帯を引く2つ。スタッフの守り requireRecitalStaff は Task 16 が足した。
// 鍵の形（16進48けた・小文字）が合わなければ DB を引かない。合えば edit_token の完全一致で1世帯だけを引く。
import { getOne } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { loadHouseholdDetail, type HouseholdDetail } from '@/lib/recitalDb';

/** スタッフの Server Action・画面の頭で呼ぶ。ログインしていなければ throw（画面だけの守りにしない） */
export async function requireRecitalStaff(): Promise<void> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
}

const TOKEN_RE = /^[0-9a-f]{48}$/;

export function isTokenShape(t: unknown): t is string {
  return typeof t === 'string' && TOKEN_RE.test(t);
}

/** 鍵の世帯の中身。形ちがい・見つからない時は null（どちらかは返さない）。status（merged など）は呼ぶ側が見る */
export async function requireHouseholdByToken(t: string | null | undefined): Promise<HouseholdDetail | null> {
  if (!isTokenShape(t)) return null;
  const row = await getOne('SELECT id FROM recital_households WHERE edit_token = ?', [t]);
  if (!row) return null;
  return loadHouseholdDetail(Number(row.id));
}
