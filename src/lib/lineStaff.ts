// スタジオとのやりとり用LINE公式アカウント「BOOMスタッフアカウント」（@183qsgtk）の受け口の中身（2026-11-23・システム部）。
// 流れ：LINE → /api/line-staff/webhook（ここ）→ line_staff_groups / line_staff_messages に残す → M5 の作業係が読む。
// 守り：
//   - 署名を確かめる（シークレットは line_staff_config）。仕組みは BOOM AI（lineAi.ts）と同じ部品を使う。
//   - ここからは何も返さない（スタジオへの文は、作業係がTAROのOK後に送るものだけ）。
//   - 招かれたグループは pending。承認は M5 の作業係（staff.py approve）だけ。24時間承認されなければ作業係が退出させる。
//   - 承認済みのグループの文字メッセージだけ残す（電話番号・メールらしき文字は伏せる・直近90日・最大2000件）。
import { execute, getAll } from '@/lib/db';
import { chatId, maskPersonal, verifySignature, MAX_TEXT, type LineEvent } from '@/lib/lineAi';

export { verifySignature };
export const KEEP_DAYS = 90;
export const KEEP_COUNT = 2000;

let secretCache: { v: string; at: number } | null = null;
export async function staffChannelSecret(): Promise<string> {
  if (secretCache && Date.now() - secretCache.at < 5 * 60_000) return secretCache.v;
  const rows = await getAll("SELECT value FROM line_staff_config WHERE key = 'channel_secret'");
  const v = rows[0]?.value ? String(rows[0].value) : '';
  secretCache = { v, at: Date.now() };
  return v;
}

const nowIso = () => new Date().toISOString();

/** 1つのイベントを処理する（返事はしない）。返す文字列は記録用の短い結果 */
export async function handleStaffEvent(ev: LineEvent): Promise<string> {
  const chat = chatId(ev.source);
  if (!chat) return 'skip:1対1';
  if (ev.type === 'join') {
    await execute(
      `INSERT INTO line_staff_groups (group_id, kind, status, joined_at, updated_at) VALUES (?, ?, 'pending', ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET status = CASE WHEN status = 'approved' THEN 'approved' ELSE 'pending' END,
         joined_at = excluded.joined_at, updated_at = excluded.updated_at, notified_at = NULL`,
      [chat.id, chat.kind, nowIso(), nowIso()],
    );
    return 'join';
  }
  if (ev.type === 'leave') {
    await execute("UPDATE line_staff_groups SET status = 'left', updated_at = ? WHERE group_id = ?", [nowIso(), chat.id]);
    return 'leave';
  }
  if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.message.text) return 'skip:種類';
  const g = await getAll('SELECT status FROM line_staff_groups WHERE group_id = ?', [chat.id]);
  if (g[0]?.status !== 'approved') return 'skip:未承認';
  const now = new Date();
  await execute(
    `INSERT OR IGNORE INTO line_staff_messages (message_id, group_id, user_id, role, text, created_at)
     VALUES (?, ?, ?, 'user', ?, ?)`,
    [ev.message.id || null, chat.id, ev.source?.userId || null, maskPersonal(ev.message.text).slice(0, MAX_TEXT), now.toISOString()],
  );
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400_000).toISOString();
  await execute(
    `DELETE FROM line_staff_messages WHERE group_id = ? AND (created_at < ? OR id NOT IN
       (SELECT id FROM line_staff_messages WHERE group_id = ? ORDER BY id DESC LIMIT ?))`,
    [chat.id, cutoff, chat.id, KEEP_COUNT],
  );
  return 'saved';
}
