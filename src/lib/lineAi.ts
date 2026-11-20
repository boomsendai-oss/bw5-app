// スタッフ用AI専用LINE公式アカウント「BOOM AI」の受け口の中身（2026-11-20・システム部）。
// 流れ：LINE → /api/line-ai/webhook（ここ）→ line_ai_jobs に積む → M5 の作業係がAIで作ってグループへ送る。
// 守り：
//   - 署名（x-line-signature＝チャネルシークレットの HMAC-SHA256 base64）を確かめる。シークレットは line_ai_config に置く。
//   - 1対1のトークには何もしない（あいさつメッセージで「返信できません」と伝えている）。
//   - グループは「承認済み」のものだけ受け付ける。招かれたら pending で記録し、受付の返事で「承認待ち」と伝える。
//     承認は M5 の作業係（worker.py approve）だけ。承認されないまま24時間たつと作業係が退出させる。
//   - グループでは「@BOOM AI」とメンションされた書き込みだけを依頼として受け付ける。
//   - すぐ返す「受け付けました」は reply（通数に数えない）。結果は作業係が push（通数に数える）。
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execute, getAll } from '@/lib/db';

export type LineSource = { type: 'user' | 'group' | 'room'; userId?: string; groupId?: string; roomId?: string };
export type LineEvent = {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: LineSource;
  message?: {
    id?: string;
    type: string;
    text?: string;
    fileName?: string;
    mention?: { mentionees?: { index: number; length: number; isSelf?: boolean; type?: string }[] };
  };
};

export const ACK_TEXT = '受け付けました🤖 できあがったら、このグループに送ります。';
export const PENDING_TEXT =
  'BOOM AIです🤖 このグループで使うには、BOOMの承認が要ります。承認されるまでは依頼を受け付けません（承認されないまま24時間たつと、自動で退出します）。';
export const NOT_APPROVED_TEXT = 'このグループはまだ承認されていないので、依頼を受け付けられません。';
export const MAX_TEXT = 2000;

export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** グループ・複数人トークのid（1対1なら null） */
export function chatId(src?: LineSource): { id: string; kind: 'group' | 'room' } | null {
  if (src?.type === 'group' && src.groupId) return { id: src.groupId, kind: 'group' };
  if (src?.type === 'room' && src.roomId) return { id: src.roomId, kind: 'room' };
  return null;
}

/** 自分（BOOM AI）へのメンションがあれば、メンション部分を除いた依頼文を返す。無ければ null */
export function requestText(ev: LineEvent): string | null {
  const m = ev.message;
  if (!m || m.type !== 'text' || !m.text) return null;
  const self = (m.mention?.mentionees || []).filter((x) => x.isSelf);
  if (!self.length) return null;
  let text = m.text;
  for (const x of [...self].sort((a, b) => b.index - a.index)) {
    text = text.slice(0, x.index) + text.slice(x.index + x.length);
  }
  text = text.trim();
  return text ? text.slice(0, MAX_TEXT) : null;
}

let secretCache: { v: string; at: number } | null = null;
export async function channelSecret(): Promise<string> {
  if (secretCache && Date.now() - secretCache.at < 5 * 60_000) return secretCache.v;
  const rows = await getAll("SELECT value FROM line_ai_config WHERE key = 'channel_secret'");
  const v = rows[0]?.value ? String(rows[0].value) : '';
  secretCache = { v, at: Date.now() };
  return v;
}

/** ステートレスのチャネルアクセストークン（15分有効）をチャネルID＋シークレットで取る */
export async function accessToken(): Promise<string> {
  const rows = await getAll("SELECT key, value FROM line_ai_config WHERE key IN ('channel_id','channel_secret')");
  const cfg = Object.fromEntries(rows.map((r) => [String(r.key), String(r.value)]));
  if (!cfg.channel_id || !cfg.channel_secret) throw new Error('line_ai_config にチャネル情報がありません');
  const res = await fetch('https://api.line.me/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.channel_id,
      client_secret: cfg.channel_secret,
    }),
  });
  if (!res.ok) throw new Error(`トークンを取れません ${res.status}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('トークンが空');
  return j.access_token;
}

export async function reply(replyToken: string, text: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) console.error(`line-ai reply 失敗 ${res.status}`);
}

const nowIso = () => new Date().toISOString();

/** 1つのイベントを処理する。返す文字列は記録用の短い結果 */
export async function handleEvent(ev: LineEvent, replyFn = reply): Promise<string> {
  const chat = chatId(ev.source);
  if (!chat) return 'skip:1対1';
  if (ev.type === 'join') {
    await execute(
      `INSERT INTO line_ai_groups (group_id, kind, status, joined_at, updated_at) VALUES (?, ?, 'pending', ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET status = CASE WHEN status = 'approved' THEN 'approved' ELSE 'pending' END,
         joined_at = excluded.joined_at, updated_at = excluded.updated_at, notified_at = NULL`,
      [chat.id, chat.kind, nowIso(), nowIso()],
    );
    const g = await getAll('SELECT status FROM line_ai_groups WHERE group_id = ?', [chat.id]);
    if (ev.replyToken && g[0]?.status !== 'approved') await replyFn(ev.replyToken, PENDING_TEXT);
    return 'join';
  }
  if (ev.type === 'leave') {
    await execute("UPDATE line_ai_groups SET status = 'left', updated_at = ? WHERE group_id = ?", [nowIso(), chat.id]);
    return 'leave';
  }
  if (ev.type !== 'message') return 'skip:種類';
  const mt = ev.message?.type;
  if ((mt === 'image' || mt === 'file') && ev.message?.id) {
    // 貼られた画像・ファイルは、承認済みのグループだけ記録する（返事はしない）。後の「@BOOM AI これを…」で使う
    const gs = await getAll('SELECT status FROM line_ai_groups WHERE group_id = ?', [chat.id]);
    if (gs[0]?.status !== 'approved') return 'skip:未承認のファイル';
    await execute(
      'INSERT OR IGNORE INTO line_ai_files (message_id, group_id, user_id, type, file_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [ev.message.id, chat.id, ev.source?.userId || null, mt, ev.message.fileName || null, nowIso()],
    );
    return 'file';
  }
  const text = requestText(ev);
  if (!text) return 'skip:メンションなし';
  const g = await getAll('SELECT status FROM line_ai_groups WHERE group_id = ?', [chat.id]);
  if (g[0]?.status !== 'approved') {
    if (!g.length) {
      await execute(
        "INSERT OR IGNORE INTO line_ai_groups (group_id, kind, status, joined_at, updated_at) VALUES (?, ?, 'pending', ?, ?)",
        [chat.id, chat.kind, nowIso(), nowIso()],
      );
    }
    if (ev.replyToken) await replyFn(ev.replyToken, NOT_APPROVED_TEXT);
    return 'reject:未承認';
  }
  const r = await execute(
    `INSERT OR IGNORE INTO line_ai_jobs (event_id, group_id, user_id, text, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)`,
    [ev.webhookEventId || null, chat.id, ev.source?.userId || null, text, nowIso()],
  );
  if (r.rowsAffected && ev.replyToken) await replyFn(ev.replyToken, ACK_TEXT);
  return r.rowsAffected ? 'queued' : 'dup';
}
