'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: 太白まつり出演者募集の公開フォーム
// src/app/entry/[code]/page.tsx が生徒/保護者用に叩くため。
// PII対策: 名簿を列挙するアクションは提供しない。閲覧はトークン一致の自分の1件のみ。
// 送信/編集はIP単位でレート制限する。
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { validateSignupInput, generateEditToken, type SignupInput, type ResolvedSettings } from '@/lib/eventSignup';
import {
  findEventByCode,
  resolveSettings,
  createSignup,
  loadByToken,
  updateByToken,
  type OwnSignup,
} from '@/lib/eventSignupDb';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export type PublicView =
  | { ok: true; eventName: string; settings: ResolvedSettings }
  | { ok: false; error: string };

// 公開: イベント名と設定(パート/参加費/説明/カレンダー/受付状態)を返す。名簿は返さない。
export async function getPublicView(code: string): Promise<PublicView> {
  const ev = await findEventByCode(code);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };
  const settings = await resolveSettings(ev.id);
  return { ok: true, eventName: ev.name, settings };
}

export type SubmitResult = { ok: true; token: string } | { ok: false; error: string };

export async function submitSignup(code: string, payload: SignupInput): Promise<SubmitResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`signup:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const ev = await findEventByCode(code);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };
  const settings = await resolveSettings(ev.id);
  if (!settings.isOpen) return { ok: false, error: '現在は受付を停止しています' };
  const validated = validateSignupInput(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const token = generateEditToken();
  await createSignup(ev.id, token, validated);
  return { ok: true, token };
}

export type LoadOwnResult = { ok: true; signup: OwnSignup } | { ok: false; error: string };

export async function loadOwnSignup(code: string, token: string): Promise<LoadOwnResult> {
  if (!token) return { ok: false, error: 'トークンがありません' };
  const ev = await findEventByCode(code);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };
  const signup = await loadByToken(ev.id, token);
  if (!signup) return { ok: false, error: '申込が見つかりません' };
  return { ok: true, signup };
}

export type UpdateResult = { ok: true } | { ok: false; error: string };

export async function updateOwnSignup(code: string, token: string, payload: SignupInput): Promise<UpdateResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`signup:${ip}`, 20, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const ev = await findEventByCode(code);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };
  const validated = validateSignupInput(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const ok = await updateByToken(ev.id, token, validated);
  if (!ok) return { ok: false, error: '申込が見つかりません' };
  return { ok: true };
}
