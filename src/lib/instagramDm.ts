// src/lib/instagramDm.ts — Instagram DM の受信(Webhook)・台帳・自動返信・手動返信。Node.js runtime 専用。
//
// 経路: Meta → POST /api/instagram/webhook (X-Hub-Signature-256 で署名検証)
//       → parseWebhookEvents → handleInboundMessage(保存→判定→自動返信→TARO通知)
// 送信: POST graph.instagram.com/{ig-user-id}/messages {recipient:{id}, message:{text}}
// 必要スコープ: instagram_business_manage_messages (instagram.ts の SCOPES に追加済み・再認可が必要)
// 24時間ルール: 相手の最終メッセージから24時間を過ぎると送れない(Meta仕様)。手動返信もこの制限内。
//
// 台帳: ig_dm_threads(送信者ごと) / ig_dm_messages(1通ごと) … scripts/migrations/20261007_ig_dm.sql
// 会員DBとは紐づけない。

import { createHmac, timingSafeEqual } from 'node:crypto';
import { execute, getAll, getOne } from './db';
import { getInstagramAuth, GRAPH_BASE } from './instagram';
import { notifyTaro } from './notify';
import { decideAutoReply, statusAfter, type DmKind } from './instagramDmRules';

export type InboundEvent = {
  senderId: string;
  recipientId: string;
  mid: string | null;
  text: string;
  attachments: Array<{ type: string; url?: string }>;
  timestampMs: number | null;
  isEcho: boolean;
  raw: unknown;
};

/** Meta の署名検証。rawBody は生の文字列(JSON.parse前)。 */
export function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const given = signatureHeader.slice('sha256='.length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Webhook本文からメッセージ受信イベントだけを取り出す。
 * Instagramログイン方式は entry[].messaging[] 形式。changes[] 形式(field=messages)も念のため受ける。
 * 既読・配信通知・リアクションは message が無いので落とす。
 */
export function parseWebhookEvents(payload: any): InboundEvent[] {
  const out: InboundEvent[] = [];
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    const items: any[] = [];
    if (Array.isArray(entry.messaging)) items.push(...entry.messaging);
    if (Array.isArray(entry.changes)) {
      for (const c of entry.changes) if (c?.field === 'messages' && c.value) items.push(c.value);
    }
    for (const m of items) {
      const msg = m?.message;
      const senderId = m?.sender?.id;
      const recipientId = m?.recipient?.id;
      if (!msg || !senderId || !recipientId) continue;
      const attachments = Array.isArray(msg.attachments)
        ? msg.attachments.map((a: any) => ({ type: String(a?.type ?? 'unknown'), url: a?.payload?.url }))
        : [];
      out.push({
        senderId: String(senderId),
        recipientId: String(recipientId),
        mid: msg.mid ? String(msg.mid) : null,
        text: typeof msg.text === 'string' ? msg.text : '',
        attachments,
        timestampMs: typeof m.timestamp === 'number' ? m.timestamp : null,
        isEcho: !!msg.is_echo,
        raw: m,
      });
    }
  }
  return out;
}

type ThreadRow = {
  sender_id: string;
  username: string | null;
  display_name: string | null;
  first_in_at: string;
  last_in_at: string;
  last_out_at: string | null;
  last_text: string | null;
  status: string;
  note: string;
  auto_reply_kinds: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

async function insertMessage(p: {
  mid: string | null;
  senderId: string;
  direction: 'in' | 'out';
  text: string;
  attachments?: unknown[];
  kind?: string | null;
  sentBy?: string | null;
  igTimestamp?: string | null;
  raw?: unknown;
}): Promise<boolean> {
  // mid はユニーク。Metaは同じ通知を再送することがあるので、重複は静かに捨てる(冪等)。
  const res = await execute(
    `INSERT OR IGNORE INTO ig_dm_messages (mid, sender_id, direction, text, attachments, kind, sent_by, ig_timestamp, created_at, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.mid,
      p.senderId,
      p.direction,
      p.text,
      JSON.stringify(p.attachments ?? []),
      p.kind ?? null,
      p.sentBy ?? null,
      p.igTimestamp ?? null,
      nowIso(),
      p.raw ? JSON.stringify(p.raw).slice(0, 8000) : null,
    ]
  );
  return (res.rowsAffected ?? 0) > 0;
}

async function getThread(senderId: string): Promise<ThreadRow | null> {
  return (await getOne('SELECT * FROM ig_dm_threads WHERE sender_id = ?', [senderId])) as ThreadRow | null;
}

async function upsertThreadInbound(senderId: string, text: string, at: string): Promise<void> {
  await execute(
    `INSERT INTO ig_dm_threads (sender_id, first_in_at, last_in_at, last_text, status, updated_at)
     VALUES (?, ?, ?, ?, 'new', ?)
     ON CONFLICT(sender_id) DO UPDATE SET last_in_at = excluded.last_in_at, last_text = excluded.last_text, updated_at = excluded.updated_at`,
    [senderId, at, at, text.slice(0, 500), at]
  );
}

/** 送信者のプロフィール(name/username)。権限や相手の設定で取れないことがあるので失敗は無視。 */
async function fetchSenderProfile(senderId: string): Promise<{ username?: string; name?: string } | null> {
  try {
    const { token } = await getInstagramAuth();
    const res = await fetch(`${GRAPH_BASE}/${senderId}?fields=name,username&access_token=${encodeURIComponent(token)}`);
    const json = await res.json();
    if (!res.ok || json.error) return null;
    return { username: json.username, name: json.name };
  } catch {
    return null;
  }
}

/** DMを1通送る(自動返信・手動返信の共通口)。成功時は送信ログも残す。 */
export async function sendDm(
  senderId: string,
  text: string,
  meta: { kind?: DmKind | null; sentBy: 'auto' | 'staff' }
): Promise<{ messageId: string }> {
  const { token, igUserId } = await getInstagramAuth();
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: senderId }, message: { text } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`DM送信失敗: ${JSON.stringify(json.error ?? json)}`);
  }
  const messageId = String(json.message_id ?? '');
  const at = nowIso();
  await insertMessage({ mid: messageId || null, senderId, direction: 'out', text, kind: meta.kind ?? null, sentBy: meta.sentBy });
  await execute('UPDATE ig_dm_threads SET last_out_at = ?, updated_at = ? WHERE sender_id = ?', [at, at, senderId]);
  return { messageId };
}

/** 受信1件の処理: 保存 → 判定 → 自動返信 → スレッド状態更新 → TAROへ通知。 */
export async function handleInboundMessage(ev: InboundEvent): Promise<{ stored: boolean; autoKind: DmKind | null; reason?: string }> {
  // 自分が送った分(is_echo)は台帳に残すだけ(手動返信をアプリ外=インスタアプリから送った場合の記録になる)
  if (ev.isEcho) {
    await insertMessage({
      mid: ev.mid,
      senderId: ev.recipientId,
      direction: 'out',
      text: ev.text,
      attachments: ev.attachments,
      sentBy: 'echo',
      igTimestamp: ev.timestampMs ? new Date(ev.timestampMs).toISOString() : null,
    });
    return { stored: true, autoKind: null, reason: 'echo' };
  }

  const at = nowIso();
  const igTs = ev.timestampMs ? new Date(ev.timestampMs).toISOString() : null;
  const before = await getThread(ev.senderId);
  const inboundCountBefore = Number(
    (await getOne('SELECT COUNT(*) AS n FROM ig_dm_messages WHERE sender_id = ? AND direction = ?', [ev.senderId, 'in']))?.n ?? 0
  );
  const stored = await insertMessage({
    mid: ev.mid,
    senderId: ev.senderId,
    direction: 'in',
    text: ev.text,
    attachments: ev.attachments,
    igTimestamp: igTs,
    raw: ev.raw,
  });
  if (!stored) return { stored: false, autoKind: null, reason: '重複(受信済みmid)' };

  await upsertThreadInbound(ev.senderId, ev.text || (ev.attachments.length ? `[${ev.attachments[0].type}]` : ''), at);

  // 初回はプロフィールを取りに行く(台帳で誰か分かるように)
  if (!before || (!before.username && !before.display_name)) {
    const prof = await fetchSenderProfile(ev.senderId);
    if (prof && (prof.username || prof.name)) {
      await execute('UPDATE ig_dm_threads SET username = ?, display_name = ? WHERE sender_id = ?', [
        prof.username ?? null,
        prof.name ?? null,
        ev.senderId,
      ]);
    }
  }

  const autoKinds: DmKind[] = before ? safeParseKinds(before.auto_reply_kinds) : [];
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const autoLast24h = Number(
    (
      await getOne(
        "SELECT COUNT(*) AS n FROM ig_dm_messages WHERE sender_id = ? AND direction = 'out' AND sent_by = 'auto' AND created_at >= ?",
        [ev.senderId, since]
      )
    )?.n ?? 0
  );

  const decision = decideAutoReply(ev.text, {
    autoReplyKinds: autoKinds,
    autoRepliesLast24h: autoLast24h,
    inboundCountBefore,
    now: at,
  });

  let autoKind: DmKind | null = null;
  let sendError: string | null = null;
  if (decision.kind) {
    try {
      await sendDm(ev.senderId, decision.text, { kind: decision.kind, sentBy: 'auto' });
      autoKind = decision.kind;
      autoKinds.push(decision.kind);
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
    }
  }

  // スレッド状態: 自動で案内できたものは auto_replied、申込・判定不能・送信失敗は needs_reply(人が見る)。
  // 本文なし(ストーリーのメンション・投稿のシェア・スタンプ・画像だけ)は「返信待ち」にしない=通知だけ残して new のまま。
  const hasText = !!(ev.text || '').trim();
  const status = sendError ? 'needs_reply' : !hasText ? 'new' : statusAfter(autoKind);
  // いったん done にした相手からまた来たら、また人の目に戻す
  await execute('UPDATE ig_dm_threads SET status = ?, auto_reply_kinds = ?, updated_at = ? WHERE sender_id = ?', [
    status,
    JSON.stringify(autoKinds),
    at,
    ev.senderId,
  ]);

  // TARO通知(沈黙=正常ではなく、DMは毎回知らせる。件数は少ない前提)
  const thread = await getThread(ev.senderId);
  const who = thread?.username ? `@${thread.username}` : thread?.display_name || ev.senderId;
  const lines = [
    `差出人: ${who}`,
    `本文: ${ev.text || (ev.attachments.length ? `[${ev.attachments.map((a) => a.type).join(',')}]` : '(本文なし)')}`,
    '',
    autoKind ? `自動返信: ${autoKind} を送信しました` : `自動返信: なし(${decision.kind ? sendError : (decision as { reason: string }).reason})`,
    `状態: ${status === 'needs_reply' ? '返信待ち(TAROの返信が必要)' : status === 'new' ? '本文なし(メンション/シェア/画像のみ・自動返信なし)' : '自動案内済み'}`,
    '',
    '台帳・返信: https://bw5-app.vercel.app/staff/instagram/dm',
  ];
  try {
    await notifyTaro({ subject: `インスタDM ${who}${status === 'needs_reply' ? '【返信待ち】' : ''}`, body: lines.join('\n'), subjectPrefix: '[BOOM DM]' });
  } catch (e) {
    console.warn(`DM通知失敗: ${e instanceof Error ? e.message : e}`);
  }

  return { stored: true, autoKind, reason: sendError ?? (decision.kind ? undefined : (decision as { reason: string }).reason) };
}

function safeParseKinds(s: string): DmKind[] {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? (v as DmKind[]) : [];
  } catch {
    return [];
  }
}

/** Webhook購読を有効化(連携アカウントに messages フィールドを購読)。ダッシュボードの設定とは別に必要。 */
export async function subscribeMessagesWebhook(): Promise<unknown> {
  const { token, igUserId } = await getInstagramAuth();
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`購読失敗: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

export async function listThreads(limit = 100): Promise<ThreadRow[]> {
  return (await getAll(
    `SELECT * FROM ig_dm_threads ORDER BY CASE status WHEN 'needs_reply' THEN 0 WHEN 'new' THEN 1 WHEN 'auto_replied' THEN 2 ELSE 3 END, last_in_at DESC LIMIT ?`,
    [limit]
  )) as ThreadRow[];
}

export async function listMessages(senderId: string, limit = 200): Promise<any[]> {
  return getAll(
    'SELECT id, mid, direction, text, attachments, kind, sent_by, ig_timestamp, created_at FROM ig_dm_messages WHERE sender_id = ? ORDER BY id ASC LIMIT ?',
    [senderId, limit]
  );
}

export async function setThreadStatus(senderId: string, status: 'new' | 'needs_reply' | 'auto_replied' | 'done', note?: string): Promise<void> {
  const at = nowIso();
  if (typeof note === 'string') {
    await execute('UPDATE ig_dm_threads SET status = ?, note = ?, updated_at = ? WHERE sender_id = ?', [status, note.slice(0, 2000), at, senderId]);
  } else {
    await execute('UPDATE ig_dm_threads SET status = ?, updated_at = ? WHERE sender_id = ?', [status, at, senderId]);
  }
}

/** 相手の最終メッセージから24時間以内か(Metaの送信可能ウィンドウ)。 */
export function withinReplyWindow(lastInAtIso: string, now = Date.now()): boolean {
  return now - new Date(lastInAtIso).getTime() <= 24 * 3600 * 1000;
}
