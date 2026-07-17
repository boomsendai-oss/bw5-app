'use server';

// X投稿 承認キューの操作 (Server Actions)。
// 認証: eventAuth のセッションcookie検証を流用 (直接POSTされる可能性があるため毎回検証する)。
// ステータス遷移は WHERE status IN (...) 付きUPDATE + rowsAffected 検査で競合安全にする
// (cronが 'posting' に取った直後の差し戻し等を弾く)。
import { revalidatePath } from 'next/cache';
import { execute } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { jstInputToUtcIso, splitThreadText } from '@/lib/xPosts';

type ActionResult = { ok: boolean; error?: string };

const PATH = '/staff/x-posts';

function bad(error: string): ActionResult {
  return { ok: false, error };
}

async function guard(): Promise<ActionResult | null> {
  if (!(await isAuthorizedServer())) return bad('Unauthorized');
  return null;
}

/** 本文テキスト+予約日時(JST datetime-local) を検証して {partsJson, scheduledAt} に変換 */
function parseInput(text: string, scheduledAtLocal: string): { partsJson: string; scheduledAt: string | null } | string {
  const parts = splitThreadText(text);
  if (parts.length === 0) return '本文が空です';
  let scheduledAt: string | null = null;
  if (scheduledAtLocal.trim()) {
    scheduledAt = jstInputToUtcIso(scheduledAtLocal);
    if (!scheduledAt) return '予約日時の形式が不正です';
  }
  return { partsJson: JSON.stringify(parts), scheduledAt };
}

/** 新規下書きの手動追加。本文は空行2つ区切りでツリー分割する */
export async function createDraft(text: string, scheduledAtLocal: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = parseInput(text, scheduledAtLocal);
  if (typeof parsed === 'string') return bad(parsed);
  await execute(
    "INSERT INTO x_posts (account, parts, scheduled_at, status) VALUES ('boom', ?, ?, 'draft')",
    [parsed.partsJson, parsed.scheduledAt]
  );
  revalidatePath(PATH);
  return { ok: true };
}

/** 下書きの本文・予約日時を更新 (draft のみ編集可) */
export async function updateDraft(id: number, text: string, scheduledAtLocal: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!Number.isInteger(id) || id <= 0) return bad('bad id');
  const parsed = parseInput(text, scheduledAtLocal);
  if (typeof parsed === 'string') return bad(parsed);
  const r = await execute(
    "UPDATE x_posts SET parts = ?, scheduled_at = ?, updated_at = datetime('now') WHERE id = ? AND status = 'draft'",
    [parsed.partsJson, parsed.scheduledAt, id]
  );
  if (Number(r.rowsAffected) === 0) return bad('下書き状態ではないため更新できません(画面を更新してください)');
  revalidatePath(PATH);
  return { ok: true };
}

/** 承認: draft → approved。scheduled_at NULL のままなら自動投稿されない(手動トリガー待ち) */
export async function approvePost(id: number): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!Number.isInteger(id) || id <= 0) return bad('bad id');
  const r = await execute(
    "UPDATE x_posts SET status = 'approved', error = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'draft'",
    [id]
  );
  if (Number(r.rowsAffected) === 0) return bad('下書き状態ではないため承認できません(画面を更新してください)');
  revalidatePath(PATH);
  return { ok: true };
}

/** ボツ: draft → rejected */
export async function rejectPost(id: number): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!Number.isInteger(id) || id <= 0) return bad('bad id');
  const r = await execute(
    "UPDATE x_posts SET status = 'rejected', updated_at = datetime('now') WHERE id = ? AND status = 'draft'",
    [id]
  );
  if (Number(r.rowsAffected) === 0) return bad('下書き状態ではないためボツにできません(画面を更新してください)');
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * 差し戻し: approved / failed / rejected / posting → draft。
 * failed はこの経路で再編集→再承認して再試行する(自動リトライはしない)。
 * posting はcron途中クラッシュの残骸回収用 — X上に途中まで投稿されていないか確認してから使う。
 */
export async function revertToDraft(id: number): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!Number.isInteger(id) || id <= 0) return bad('bad id');
  const r = await execute(
    "UPDATE x_posts SET status = 'draft', error = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ('approved','failed','rejected','posting')",
    [id]
  );
  if (Number(r.rowsAffected) === 0) return bad('差し戻せる状態ではありません(画面を更新してください)');
  revalidatePath(PATH);
  return { ok: true };
}
