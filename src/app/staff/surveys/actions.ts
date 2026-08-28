'use server';

// アンケート管理のスタッフ専用Server Actions。/staff/* 配下でproxy認証に加え、
// 直接POST対策で毎回 isAuthorizedServer を検証する(review-outreachと同方針)。
import { revalidatePath } from 'next/cache';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { validateSurveyDefinition } from '@/lib/survey';
import {
  createSurvey,
  updateSurvey,
  setSurveyStatus,
  resolveMatch,
  searchMembersForLink,
} from '@/lib/surveyDb';

type ActionResult = { ok: true; id?: number } | { ok: false; error: string };

export async function staffCreateSurvey(input: unknown): Promise<ActionResult> {
  if (!(await isAuthorizedServer())) return { ok: false, error: 'ログインが必要です' };
  const v = validateSurveyDefinition(input);
  if (typeof v === 'string') return { ok: false, error: v };
  const id = await createSurvey(v);
  revalidatePath('/staff/surveys');
  return { ok: true, id };
}

export async function staffUpdateSurvey(id: number, input: unknown): Promise<ActionResult> {
  if (!(await isAuthorizedServer())) return { ok: false, error: 'ログインが必要です' };
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: '不正なIDです' };
  const v = validateSurveyDefinition(input);
  if (typeof v === 'string') return { ok: false, error: v };
  const err = await updateSurvey(id, v);
  if (err) return { ok: false, error: err };
  revalidatePath('/staff/surveys');
  revalidatePath(`/staff/surveys/${id}`);
  return { ok: true, id };
}

export async function staffSetSurveyStatus(id: number, next: 'open' | 'closed'): Promise<ActionResult> {
  if (!(await isAuthorizedServer())) return { ok: false, error: 'ログインが必要です' };
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: '不正なIDです' };
  const err = await setSurveyStatus(id, next);
  if (err) return { ok: false, error: err };
  revalidatePath('/staff/surveys');
  revalidatePath(`/staff/surveys/${id}`);
  return { ok: true, id };
}

export async function staffResolveMatch(responseId: number, memberId: number | null): Promise<ActionResult> {
  if (!(await isAuthorizedServer())) return { ok: false, error: 'ログインが必要です' };
  if (!Number.isInteger(responseId) || responseId <= 0) return { ok: false, error: '不正なIDです' };
  if (memberId !== null && (!Number.isInteger(memberId) || memberId <= 0)) return { ok: false, error: '不正な会員IDです' };
  const err = await resolveMatch(responseId, memberId);
  if (err) return { ok: false, error: err };
  return { ok: true };
}

export type MemberHit = { id: number; name: string; kaiinNo: string | null; status: string };

/** 手動紐付け用の会員検索(スタッフ認証配下のみ)。 */
export async function staffSearchMembers(q: string): Promise<MemberHit[]> {
  if (!(await isAuthorizedServer())) return [];
  if (typeof q !== 'string') return [];
  return searchMembersForLink(q);
}
