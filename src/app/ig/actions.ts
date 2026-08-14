'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: 会員向けInstagram収集の公開フォーム
// src/app/ig/page.tsx を会員/保護者がURLから直接開いて叩くため。
//
// PII対策(太白まつり出演者募集 src/app/entry/[code]/actions.ts と同じ方針):
//   - 名簿を列挙するアクションは提供しない(候補・会員一覧はスタッフ画面側にしか無い)
//   - 閲覧・編集・取り消しはトークン一致の自分の1件のみ
//   - 送信/編集はIP単位でレート制限する
//   - 氏名・アカウント名をログに出さない

import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { validateCollectInput, generateEditToken, type CollectInput } from '@/lib/instagramCollect';
import {
  resolveSettings,
  createSubmission,
  loadByToken,
  updateByToken,
  deleteByToken,
  type OwnSubmission,
  type CollectSettings,
} from '@/lib/instagramCollectDb';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

async function rateLimited(): Promise<boolean> {
  const ip = await clientIp();
  return !(await checkRateLimit(`igcollect:${ip}`, 20, 3600));
}

export type PublicView = { settings: CollectSettings };

/** 公開: 受付状態と説明文だけを返す。名簿・回答一覧は返さない。 */
export async function getPublicView(): Promise<PublicView> {
  return { settings: await resolveSettings() };
}

export type SubmitResult = { ok: true; token: string } | { ok: false; error: string };

export async function submit(payload: CollectInput): Promise<SubmitResult> {
  if (await rateLimited()) return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  const settings = await resolveSettings();
  if (!settings.isOpen) return { ok: false, error: '現在は受付を停止しています' };
  const validated = validateCollectInput(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const token = generateEditToken();
  await createSubmission(token, validated);
  return { ok: true, token };
}

export type LoadOwnResult = { ok: true; submission: OwnSubmission } | { ok: false; error: string };

export async function loadOwn(token: string): Promise<LoadOwnResult> {
  if (!token) return { ok: false, error: 'トークンがありません' };
  const submission = await loadByToken(token);
  if (!submission) return { ok: false, error: '回答が見つかりません' };
  return { ok: true, submission };
}

export type UpdateResult = { ok: true } | { ok: false; error: string };

export async function updateOwn(token: string, payload: CollectInput): Promise<UpdateResult> {
  if (await rateLimited()) return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  if (!token) return { ok: false, error: 'トークンがありません' };
  const settings = await resolveSettings();
  if (!settings.isOpen) return { ok: false, error: '現在は受付を停止しています' };
  const validated = validateCollectInput(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const ok = await updateByToken(token, validated);
  if (!ok) return { ok: false, error: '回答が見つかりません' };
  return { ok: true };
}

/**
 * 本人による取り消し。受付停止中でも通す — 任意でお預かりしている以上、
 * 「消したいときに消せない」状態を作らないため。
 */
export async function deleteOwn(token: string): Promise<UpdateResult> {
  if (await rateLimited()) return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  if (!token) return { ok: false, error: 'トークンがありません' };
  const ok = await deleteByToken(token);
  if (!ok) return { ok: false, error: '回答が見つかりません' };
  return { ok: true };
}
