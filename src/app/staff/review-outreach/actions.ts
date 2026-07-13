'use server';

// クチコミ声がけリストの進捗トグル (Server Actions)。
// 認証: eventAuth のセッションcookie検証を流用 (直接POSTされる可能性があるため毎回検証する)。
import { revalidatePath } from 'next/cache';
import { execute } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';

type ToggleResult = { ok: boolean; error?: string };

async function toggleColumn(
  familyKey: number,
  column: 'asked_at' | 'posted_at',
  on: boolean
): Promise<ToggleResult> {
  if (!(await isAuthorizedServer())) return { ok: false, error: 'Unauthorized' };
  if (!Number.isInteger(familyKey) || familyKey <= 0) return { ok: false, error: 'bad key' };

  const value = on ? new Date().toISOString() : null;
  await execute(
    `INSERT INTO review_outreach (family_key, ${column}, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(family_key) DO UPDATE SET ${column} = excluded.${column}, updated_at = datetime('now')`,
    [familyKey, value]
  );
  revalidatePath('/staff/review-outreach');
  return { ok: true };
}

export async function setAsked(familyKey: number, on: boolean): Promise<ToggleResult> {
  return toggleColumn(familyKey, 'asked_at', on);
}

export async function setPosted(familyKey: number, on: boolean): Promise<ToggleResult> {
  return toggleColumn(familyKey, 'posted_at', on);
}
