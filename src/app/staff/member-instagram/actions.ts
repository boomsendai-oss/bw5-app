'use server';

// スタッフ専用Server Actions(要認証)。会員Instagramの承認キュー。
// 各アクションの先頭で isAuthorizedServer() を必ず確認する
// (/staff/* は proxy でも守られているが、Server Actions は独自のエンドポイントを持つため二重に弾く)。

import { isAuthorizedServer } from '@/lib/eventAuth';
import {
  listForStaff,
  summary,
  approveEntry,
  rejectEntry,
  unlinkEntry,
  resolveSettings,
  saveSettings,
  type StaffEntry,
  type CollectSettings,
} from '@/lib/instagramCollectDb';

type Denied = { ok: false; error: string };
const denied: Denied = { ok: false, error: 'Unauthorized' };

export type BoardResult =
  | { ok: true; entries: StaffEntry[]; summary: Awaited<ReturnType<typeof summary>>; settings: CollectSettings }
  | Denied;

export async function loadBoard(): Promise<BoardResult> {
  if (!(await isAuthorizedServer())) return denied;
  const [entries, s, settings] = await Promise.all([listForStaff(), summary(), resolveSettings()]);
  return { ok: true, entries, summary: s, settings };
}

export type ActionResult = { ok: true } | Denied;

/** 承認して boom_members へ紐付ける。会員IDはスタッフが画面で選んだものを明示的に受け取る。 */
export async function approve(entryId: number, memberId: number): Promise<ActionResult> {
  if (!(await isAuthorizedServer())) return denied;
  if (!Number.isFinite(entryId) || !Number.isFinite(memberId)) return { ok: false, error: 'bad request' };
  return approveEntry(entryId, memberId, 'staff');
}

export async function reject(entryId: number): Promise<ActionResult> {
  if (!(await isAuthorizedServer())) return denied;
  if (!Number.isFinite(entryId)) return { ok: false, error: 'bad request' };
  return rejectEntry(entryId);
}

export async function unlink(entryId: number): Promise<ActionResult> {
  if (!(await isAuthorizedServer())) return denied;
  if (!Number.isFinite(entryId)) return { ok: false, error: 'bad request' };
  return unlinkEntry(entryId);
}

export async function updateSettings(settings: CollectSettings): Promise<ActionResult> {
  if (!(await isAuthorizedServer())) return denied;
  await saveSettings({ isOpen: !!settings.isOpen, introMd: String(settings.introMd ?? '').slice(0, 4000) });
  return { ok: true };
}
