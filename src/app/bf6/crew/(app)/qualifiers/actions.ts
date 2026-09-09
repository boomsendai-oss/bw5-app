'use server';

// 予選通過者の出し入れ。/bf6/crew 配下(クルーPIN or 本部ログインで認証済み)。
import { revalidatePath } from 'next/cache';
import { isCrewAuthorized } from '@/lib/bf6CrewDb';
import { hasQualifierStage } from '@/lib/bf6Qualifier';
import { setBf6Qualifier } from '@/lib/bf6QualifierDb';

export async function crewSetQualifier(
  division: string,
  itemId: number,
  on: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isCrewAuthorized())) return { ok: false, error: 'ログインが切れています' };
  if (!hasQualifierStage(division)) return { ok: false, error: 'この部門に予選はありません' };
  await setBf6Qualifier(division, itemId, on);
  revalidatePath('/bf6/crew/qualifiers');
  revalidatePath('/bf6/crew/reception');
  revalidatePath('/bf6/crew/photo');
  revalidatePath('/staff/bf6/reception');
  return { ok: true };
}
