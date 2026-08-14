// 会員Instagramアカウント収集の DB 層 (2026-08-14)。純ロジックは instagramCollect.ts。
//
// ⚠️ boom_members への書き込みは approveEntry / unlinkEntry / deleteByToken からのみ行う。
//   フォームの送信・編集では絶対に boom_members を触らない(承認キュー方式)。

import { getAll, getOne, execute, withWriteTx } from './db';
import {
  suggestMatches,
  type MatchSuggestion,
  type MemberForIgMatch,
  type OwnerKind,
  type ValidatedCollect,
} from './instagramCollect';

const nowIso = () => new Date().toISOString();

// ============================================
// 設定(受付ON/OFF・説明文)
// ============================================

export const DEFAULT_INTRO_MD = [
  '会員のみなさんへ。Instagramのアカウントを教えていただけたら、というお願いです。',
  '',
  '▼ 何に使うのか',
  'BOOMの会員名簿とInstagramアカウントを結びつけて、運営側で把握できるようにしておくためです。',
  '',
  '▼ お約束',
  '・教えていただいたアカウントは、BOOMの中の名簿に紐付けるためだけに使います',
  '・ホームページやSNSに載せることはありません。外部にお渡しすることもありません',
  '',
  '▼ これは任意です',
  '答えたくない方は、答えなくてまったく問題ありません。',
  '自分のアカウントを知られたくない、というお気持ちはもっともなことなので、',
  'そのままそっとしておいていただいて大丈夫です。何かが変わることはありません。',
  '',
  'あとから気が変わったときのために、送信後に取り消し用のURLをお渡しします。',
].join('\n');

export type CollectSettings = { isOpen: boolean; introMd: string };

export async function resolveSettings(): Promise<CollectSettings> {
  const row = await getOne('SELECT is_open, intro_md FROM instagram_collect_settings WHERE id = 1');
  if (!row) return { isOpen: true, introMd: DEFAULT_INTRO_MD };
  return {
    isOpen: Number(row.is_open ?? 1) === 1,
    introMd: (row.intro_md as string) || DEFAULT_INTRO_MD,
  };
}

export async function saveSettings(s: CollectSettings): Promise<void> {
  await execute(
    `INSERT INTO instagram_collect_settings (id, is_open, intro_md, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET is_open = excluded.is_open, intro_md = excluded.intro_md, updated_at = excluded.updated_at`,
    [s.isOpen ? 1 : 0, s.introMd, nowIso()]
  );
}

// ============================================
// 会員の送信(受信箱)
// ============================================

export type OwnEntry = {
  memberName: string;
  memberNameKana: string;
  handle: string;
  ownerKind: OwnerKind;
};
export type OwnSubmission = { note: string; entries: OwnEntry[] };

export async function createSubmission(token: string, v: ValidatedCollect): Promise<void> {
  const at = nowIso();
  await withWriteTx(async (tx) => {
    const r = await tx.execute({
      sql: 'INSERT INTO instagram_submissions (edit_token, note, created_at, updated_at) VALUES (?, ?, ?, ?)',
      args: [token, v.note, at, at],
    });
    const submissionId = Number(r.lastInsertRowid);
    let i = 0;
    for (const e of v.entries) {
      await tx.execute({
        sql: `INSERT INTO instagram_entries
              (submission_id, member_name, member_name_kana, handle, owner_kind, match_state, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        args: [submissionId, e.memberName, e.memberNameKana, e.handle, e.ownerKind, i++, at, at],
      });
    }
  });
}

async function findSubmissionIdByToken(token: string): Promise<number | null> {
  if (!token) return null;
  const row = await getOne('SELECT id FROM instagram_submissions WHERE edit_token = ?', [token]);
  return row ? Number(row.id) : null;
}

export async function loadByToken(token: string): Promise<OwnSubmission | null> {
  const id = await findSubmissionIdByToken(token);
  if (id === null) return null;
  const head = await getOne('SELECT note FROM instagram_submissions WHERE id = ?', [id]);
  const rows = await getAll(
    `SELECT member_name, member_name_kana, handle, owner_kind
     FROM instagram_entries WHERE submission_id = ? ORDER BY sort_order, id`,
    [id]
  );
  return {
    note: (head?.note as string) ?? '',
    entries: rows.map((r) => ({
      memberName: r.member_name as string,
      memberNameKana: r.member_name_kana as string,
      handle: r.handle as string,
      ownerKind: r.owner_kind as OwnerKind,
    })),
  };
}

/**
 * 本人による差し替え。行を作り直すため、既に承認済みだった行の紐付けは
 * boom_members からいったん外す(古いアカウントが会員に残り続けるのを防ぐ)。
 * 差し替え後の行は pending に戻り、スタッフがもう一度承認する。
 */
export async function updateByToken(token: string, v: ValidatedCollect): Promise<boolean> {
  const id = await findSubmissionIdByToken(token);
  if (id === null) return false;
  const at = nowIso();
  await withWriteTx(async (tx) => {
    await tx.execute({
      sql: `UPDATE boom_members SET instagram_handle = NULL, instagram_owner_kind = NULL, instagram_linked_at = NULL
            WHERE id IN (SELECT matched_member_id FROM instagram_entries
                         WHERE submission_id = ? AND match_state = 'approved' AND matched_member_id IS NOT NULL)`,
      args: [id],
    });
    await tx.execute({ sql: 'DELETE FROM instagram_entries WHERE submission_id = ?', args: [id] });
    let i = 0;
    for (const e of v.entries) {
      await tx.execute({
        sql: `INSERT INTO instagram_entries
              (submission_id, member_name, member_name_kana, handle, owner_kind, match_state, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        args: [id, e.memberName, e.memberNameKana, e.handle, e.ownerKind, i++, at, at],
      });
    }
    await tx.execute({
      sql: 'UPDATE instagram_submissions SET note = ?, updated_at = ? WHERE id = ?',
      args: [v.note, at, id],
    });
  });
  return true;
}

/** 本人による取り消し。承認済みなら boom_members の紐付けも外す(任意で集めている以上、消せないと嘘になる)。 */
export async function deleteByToken(token: string): Promise<boolean> {
  const id = await findSubmissionIdByToken(token);
  if (id === null) return false;
  await withWriteTx(async (tx) => {
    await tx.execute({
      sql: `UPDATE boom_members SET instagram_handle = NULL, instagram_owner_kind = NULL, instagram_linked_at = NULL
            WHERE id IN (SELECT matched_member_id FROM instagram_entries
                         WHERE submission_id = ? AND match_state = 'approved' AND matched_member_id IS NOT NULL)`,
      args: [id],
    });
    await tx.execute({ sql: 'DELETE FROM instagram_entries WHERE submission_id = ?', args: [id] });
    await tx.execute({ sql: 'DELETE FROM instagram_submissions WHERE id = ?', args: [id] });
  });
  return true;
}

// ============================================
// スタッフ画面(要認証)
// ============================================

export type StaffEntry = {
  id: number;
  member_name: string;
  member_name_kana: string;
  handle: string;
  owner_kind: OwnerKind;
  match_state: 'pending' | 'approved' | 'rejected';
  matched_member_id: number | null;
  matched_member_name: string | null;
  matched_at: string | null;
  created_at: string;
  note: string;
  suggestion: MatchSuggestion;
};

async function loadMembersForMatch(): Promise<MemberForIgMatch[]> {
  const rows = await getAll(
    `SELECT id, hacomono_member_id, full_name, full_name_kana, status, instagram_handle FROM boom_members`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    hacomono_member_id: (r.hacomono_member_id as string) ?? '',
    full_name: (r.full_name as string) ?? '',
    full_name_kana: (r.full_name_kana as string) ?? '',
    status: (r.status as string) ?? '',
    instagram_handle: (r.instagram_handle as string) ?? null,
  }));
}

export async function listForStaff(): Promise<StaffEntry[]> {
  const rows = await getAll(
    `SELECT e.id, e.member_name, e.member_name_kana, e.handle, e.owner_kind, e.match_state,
            e.matched_member_id, e.matched_at, e.created_at, s.note,
            m.full_name AS matched_member_name
     FROM instagram_entries e
     JOIN instagram_submissions s ON s.id = e.submission_id
     LEFT JOIN boom_members m ON m.id = e.matched_member_id
     ORDER BY e.created_at DESC, e.sort_order`
  );
  const members = await loadMembersForMatch();
  const suggestions = suggestMatches(
    rows.map((r) => ({
      id: Number(r.id),
      memberName: (r.member_name as string) ?? '',
      memberNameKana: (r.member_name_kana as string) ?? '',
      handle: (r.handle as string) ?? '',
      ownerKind: (r.owner_kind as string) ?? '',
    })),
    members
  );
  const byId = new Map(suggestions.map((s) => [s.entry_id, s]));

  return rows.map((r) => ({
    id: Number(r.id),
    member_name: (r.member_name as string) ?? '',
    member_name_kana: (r.member_name_kana as string) ?? '',
    handle: (r.handle as string) ?? '',
    owner_kind: (r.owner_kind as OwnerKind) ?? 'other',
    match_state: (r.match_state as StaffEntry['match_state']) ?? 'pending',
    matched_member_id: r.matched_member_id === null ? null : Number(r.matched_member_id),
    matched_member_name: (r.matched_member_name as string) ?? null,
    matched_at: (r.matched_at as string) ?? null,
    created_at: (r.created_at as string) ?? '',
    note: (r.note as string) ?? '',
    suggestion: byId.get(Number(r.id)) ?? { entry_id: Number(r.id), candidates: [], confidence: 'なし' },
  }));
}

export type ApproveResult = { ok: true } | { ok: false; error: string };

/**
 * 承認して boom_members へ書き込む。**ここが唯一 boom_members を更新する経路**。
 * 会員IDは呼び出し側(スタッフ)が明示的に渡す。候補から自動で選ばない。
 */
export async function approveEntry(entryId: number, memberId: number, actor: string): Promise<ApproveResult> {
  const entry = await getOne('SELECT handle, owner_kind FROM instagram_entries WHERE id = ?', [entryId]);
  if (!entry) return { ok: false, error: '回答が見つかりません' };
  const member = await getOne('SELECT id FROM boom_members WHERE id = ?', [memberId]);
  if (!member) return { ok: false, error: '会員が見つかりません' };

  const at = nowIso();
  await withWriteTx(async (tx) => {
    await tx.execute({
      sql: 'UPDATE boom_members SET instagram_handle = ?, instagram_owner_kind = ?, instagram_linked_at = ?, updated_at = ? WHERE id = ?',
      args: [entry.handle, entry.owner_kind, at, at, memberId],
    });
    await tx.execute({
      sql: `UPDATE instagram_entries
            SET match_state = 'approved', matched_member_id = ?, matched_by = ?, matched_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [memberId, actor, at, at, entryId],
    });
  });
  return { ok: true };
}

/** 保留(この回答は紐付けない)。boom_members は触らない。 */
export async function rejectEntry(entryId: number): Promise<ApproveResult> {
  const r = await execute(
    `UPDATE instagram_entries SET match_state = 'rejected', matched_member_id = NULL, matched_at = NULL, updated_at = ? WHERE id = ?`,
    [nowIso(), entryId]
  );
  if (Number(r.rowsAffected) === 0) return { ok: false, error: '回答が見つかりません' };
  return { ok: true };
}

/** 承認の取り消し。boom_members から紐付けを外し、回答を未処理へ戻す。 */
export async function unlinkEntry(entryId: number): Promise<ApproveResult> {
  const entry = await getOne('SELECT matched_member_id FROM instagram_entries WHERE id = ?', [entryId]);
  if (!entry) return { ok: false, error: '回答が見つかりません' };
  const at = nowIso();
  await withWriteTx(async (tx) => {
    if (entry.matched_member_id !== null) {
      await tx.execute({
        sql: 'UPDATE boom_members SET instagram_handle = NULL, instagram_owner_kind = NULL, instagram_linked_at = NULL, updated_at = ? WHERE id = ?',
        args: [at, Number(entry.matched_member_id)],
      });
    }
    await tx.execute({
      sql: `UPDATE instagram_entries SET match_state = 'pending', matched_member_id = NULL, matched_by = NULL, matched_at = NULL, updated_at = ? WHERE id = ?`,
      args: [at, entryId],
    });
  });
  return { ok: true };
}

/** スタッフ画面のサマリ。 */
export async function summary(): Promise<{ total: number; pending: number; approved: number; linkedMembers: number }> {
  const r = await getOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN match_state = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN match_state = 'approved' THEN 1 ELSE 0 END) AS approved
     FROM instagram_entries`
  );
  const m = await getOne(
    `SELECT COUNT(*) AS n FROM boom_members WHERE TRIM(COALESCE(instagram_handle, '')) <> ''`
  );
  return {
    total: Number(r?.total ?? 0),
    pending: Number(r?.pending ?? 0),
    approved: Number(r?.approved ?? 0),
    linkedMembers: Number(m?.n ?? 0),
  };
}
