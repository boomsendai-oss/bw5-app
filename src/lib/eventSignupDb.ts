// 太白まつり募集のDBアクセス層。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
import { getAll, getOne, execute, withWriteTx } from '@/lib/db';
import type { Transaction } from '@libsql/client';
import {
  isPartKey,
  partLabel,
  defaultSettings,
  generateEditToken,
  countByPart,
  type PartKey,
  type PartDef,
  type ResolvedSettings,
  type ValidatedSignup,
} from '@/lib/eventSignup';

export interface OwnPerformer {
  name: string;
  parts: PartKey[];
}
export interface OwnSignup {
  note: string;
  performers: OwnPerformer[];
}
export interface StaffPerformer {
  id: number;
  name: string;
  parts: PartKey[];
}
export interface StaffSignup {
  id: number;
  note: string;
  createdAt: string;
  performers: StaffPerformer[];
}

export interface AuditEntry {
  id: number;
  signupId: number | null;
  actor: string;
  action: string;
  message: string;
  createdAt: string;
}

// 出演者リストを「太郎（ガールズHIPHOP・WAACK）、次郎（HIPHOP）」形式の読める文字列に。
function snapshotText(performers: { name: string; parts: PartKey[] }[]): string {
  if (!performers.length) return '(なし)';
  return performers
    .map((p) => `${p.name}（${p.parts.map(partLabel).join('・') || 'パート未選択'}）`)
    .join('、');
}

async function loadPerformers(signupId: number): Promise<{ name: string; parts: PartKey[] }[]> {
  const performers = await getAll(
    'SELECT id, performer_name FROM event_signup_performers WHERE signup_id = ? ORDER BY sort_order ASC, id ASC',
    [signupId]
  );
  const out: { name: string; parts: PartKey[] }[] = [];
  for (const p of performers) {
    const parts = await getAll('SELECT part_key FROM event_signup_parts WHERE performer_id = ?', [Number(p.id)]);
    out.push({
      name: String(p.performer_name),
      parts: parts.map((r) => String(r.part_key)).filter(isPartKey) as PartKey[],
    });
  }
  return out;
}

// 変更ログを1件記録する。actor='guest'(お客様) or 'staff'。
async function logAudit(
  eventId: number,
  signupId: number | null,
  actor: 'guest' | 'staff',
  action: string,
  message: string
): Promise<void> {
  const now = new Date().toISOString();
  await execute(
    'INSERT INTO event_signup_audit (event_id, signup_id, actor, action, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [eventId, signupId, actor, action, message, now]
  );
}

export async function listAudit(eventId: number, limit = 300): Promise<AuditEntry[]> {
  const rows = await getAll(
    'SELECT id, signup_id, actor, action, message, created_at FROM event_signup_audit WHERE event_id = ? ORDER BY id DESC LIMIT ?',
    [eventId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    signupId: r.signup_id != null ? Number(r.signup_id) : null,
    actor: String(r.actor),
    action: String(r.action),
    message: String(r.message),
    createdAt: String(r.created_at),
  }));
}

export async function findEventByCode(code: string): Promise<{ id: number; name: string } | null> {
  const row = await getOne('SELECT id, name FROM events WHERE UPPER(code) = UPPER(?)', [code]);
  return row ? { id: Number(row.id), name: String(row.name) } : null;
}

// 設定行が無ければデフォルトを返す(永続化はしない=公開/スタッフ双方から安全に読める)。
export async function resolveSettings(eventId: number): Promise<ResolvedSettings> {
  const row = await getOne('SELECT * FROM event_signup_settings WHERE event_id = ?', [eventId]);
  if (!row) return defaultSettings();
  let parts: PartDef[];
  try {
    const parsed = JSON.parse(String(row.parts_json || '[]'));
    parts = Array.isArray(parsed) && parsed.length ? parsed : defaultSettings().parts;
  } catch {
    parts = defaultSettings().parts;
  }
  return {
    parts,
    feeText: String(row.fee_text ?? ''),
    deadline: String(row.deadline ?? ''),
    introMd: String(row.intro_md ?? ''),
    calendarUrl: String(row.calendar_url ?? ''),
    isOpen: Number(row.is_open ?? 1) === 1,
  };
}

export async function saveSettings(eventId: number, s: ResolvedSettings): Promise<void> {
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO event_signup_settings
       (event_id, parts_json, fee_text, deadline, intro_md, calendar_url, is_open, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       parts_json = excluded.parts_json,
       fee_text = excluded.fee_text,
       deadline = excluded.deadline,
       intro_md = excluded.intro_md,
       calendar_url = excluded.calendar_url,
       is_open = excluded.is_open,
       updated_at = excluded.updated_at`,
    [
      eventId,
      JSON.stringify(s.parts),
      s.feeText,
      s.deadline,
      s.introMd,
      s.calendarUrl,
      s.isOpen ? 1 : 0,
      now,
    ]
  );
}

async function insertPerformers(
  tx: Transaction,
  signupId: number,
  performers: ValidatedSignup['performers']
): Promise<void> {
  for (let i = 0; i < performers.length; i++) {
    const p = performers[i];
    const res = await tx.execute({
      sql: 'INSERT INTO event_signup_performers (signup_id, performer_name, sort_order) VALUES (?, ?, ?)',
      args: [signupId, p.name, i],
    });
    const performerId = Number(res.lastInsertRowid);
    for (const part of p.parts) {
      await tx.execute({
        sql: 'INSERT INTO event_signup_parts (performer_id, part_key) VALUES (?, ?)',
        args: [performerId, part],
      });
    }
  }
}

// 新規申込を作成しトークンを保存する。
export async function createSignup(
  eventId: number,
  token: string,
  data: ValidatedSignup
): Promise<void> {
  const now = new Date().toISOString();
  let signupId = 0;
  await withWriteTx(async (tx) => {
    const res = await tx.execute({
      sql: 'INSERT INTO event_signups (event_id, edit_token, understood, note, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)',
      args: [eventId, token, data.note, now, now],
    });
    signupId = Number(res.lastInsertRowid);
    await insertPerformers(tx, signupId, data.performers);
  });
  await logAudit(eventId, signupId, 'guest', 'create', `新規申込：${snapshotText(data.performers)}`);
}

// トークン一致の1件だけ返す(列挙不可)。無ければ null。
export async function loadByToken(eventId: number, token: string): Promise<OwnSignup | null> {
  const su = await getOne(
    'SELECT id, note FROM event_signups WHERE event_id = ? AND edit_token = ?',
    [eventId, token]
  );
  if (!su) return null;
  const performers = await getAll(
    'SELECT id, performer_name FROM event_signup_performers WHERE signup_id = ? ORDER BY sort_order ASC, id ASC',
    [Number(su.id)]
  );
  const out: OwnPerformer[] = [];
  for (const p of performers) {
    const parts = await getAll(
      'SELECT part_key FROM event_signup_parts WHERE performer_id = ?',
      [Number(p.id)]
    );
    out.push({
      name: String(p.performer_name),
      parts: parts.map((r) => String(r.part_key)).filter(isPartKey) as PartKey[],
    });
  }
  return { note: String(su.note ?? ''), performers: out };
}

// トークン一致の申込を丸ごと差し替える(出演者・パートを作り直す)。成功可否を返す。
export async function updateByToken(
  eventId: number,
  token: string,
  data: ValidatedSignup
): Promise<boolean> {
  const su = await getOne(
    'SELECT id FROM event_signups WHERE event_id = ? AND edit_token = ?',
    [eventId, token]
  );
  if (!su) return false;
  const signupId = Number(su.id);
  const before = await loadPerformers(signupId);
  const now = new Date().toISOString();
  await withWriteTx(async (tx) => {
    const perfIds = await tx.execute({
      sql: 'SELECT id FROM event_signup_performers WHERE signup_id = ?',
      args: [signupId],
    });
    for (const r of perfIds.rows) {
      await tx.execute({ sql: 'DELETE FROM event_signup_parts WHERE performer_id = ?', args: [Number(r.id)] });
    }
    await tx.execute({ sql: 'DELETE FROM event_signup_performers WHERE signup_id = ?', args: [signupId] });
    await tx.execute({
      sql: 'UPDATE event_signups SET note = ?, updated_at = ? WHERE id = ?',
      args: [data.note, now, signupId],
    });
    await insertPerformers(tx, signupId, data.performers);
  });
  await logAudit(
    eventId,
    signupId,
    'guest',
    'update',
    `お客様が編集\n変更前：${snapshotText(before)}\n変更後：${snapshotText(data.performers)}`
  );
  return true;
}

// スタッフ用: 全申込を出演者・パート込みで返す(トークンは返さない)。
export async function listByEvent(eventId: number): Promise<StaffSignup[]> {
  const signups = await getAll(
    'SELECT id, note, created_at FROM event_signups WHERE event_id = ? ORDER BY created_at ASC, id ASC',
    [eventId]
  );
  const out: StaffSignup[] = [];
  for (const su of signups) {
    const performers = await getAll(
      'SELECT id, performer_name FROM event_signup_performers WHERE signup_id = ? ORDER BY sort_order ASC, id ASC',
      [Number(su.id)]
    );
    const ps: StaffPerformer[] = [];
    for (const p of performers) {
      const parts = await getAll('SELECT part_key FROM event_signup_parts WHERE performer_id = ?', [Number(p.id)]);
      ps.push({
        id: Number(p.id),
        name: String(p.performer_name),
        parts: parts.map((r) => String(r.part_key)).filter(isPartKey) as PartKey[],
      });
    }
    out.push({ id: Number(su.id), note: String(su.note ?? ''), createdAt: String(su.created_at), performers: ps });
  }
  return out;
}

export async function deleteSignup(eventId: number, signupId: number): Promise<void> {
  const su = await getOne('SELECT id FROM event_signups WHERE id = ? AND event_id = ?', [signupId, eventId]);
  if (!su) return;
  const before = await loadPerformers(signupId);
  await withWriteTx(async (tx) => {
    const perfIds = await tx.execute({
      sql: 'SELECT id FROM event_signup_performers WHERE signup_id = ?',
      args: [signupId],
    });
    for (const r of perfIds.rows) {
      await tx.execute({ sql: 'DELETE FROM event_signup_parts WHERE performer_id = ?', args: [Number(r.id)] });
    }
    await tx.execute({ sql: 'DELETE FROM event_signup_performers WHERE signup_id = ?', args: [signupId] });
    await tx.execute({ sql: 'DELETE FROM event_signups WHERE id = ?', args: [signupId] });
  });
  await logAudit(eventId, signupId, 'staff', 'delete', `スタッフが申込を削除：${snapshotText(before)}`);
}

// スタッフ用: 出演者1人の名前/パートを更新。event_id 経由で所有チェック。
export async function updatePerformer(
  eventId: number,
  performerId: number,
  name: string,
  parts: PartKey[]
): Promise<boolean> {
  const row = await getOne(
    `SELECT p.id, p.performer_name, p.signup_id FROM event_signup_performers p
       JOIN event_signups s ON s.id = p.signup_id
      WHERE p.id = ? AND s.event_id = ?`,
    [performerId, eventId]
  );
  if (!row) return false;
  const beforeName = String(row.performer_name);
  const signupId = Number(row.signup_id);
  const beforeParts = (await getAll('SELECT part_key FROM event_signup_parts WHERE performer_id = ?', [performerId]))
    .map((r) => String(r.part_key))
    .filter(isPartKey) as PartKey[];
  await withWriteTx(async (tx) => {
    await tx.execute({ sql: 'UPDATE event_signup_performers SET performer_name = ? WHERE id = ?', args: [name, performerId] });
    await tx.execute({ sql: 'DELETE FROM event_signup_parts WHERE performer_id = ?', args: [performerId] });
    for (const k of parts) {
      await tx.execute({ sql: 'INSERT INTO event_signup_parts (performer_id, part_key) VALUES (?, ?)', args: [performerId, k] });
    }
  });
  await logAudit(
    eventId,
    signupId,
    'staff',
    'update',
    `スタッフが編集\n変更前：${snapshotText([{ name: beforeName, parts: beforeParts }])}\n変更後：${snapshotText([{ name, parts }])}`
  );
  return true;
}

// スタッフ用: 出演者1人を削除。最後の1人を消すと申込ごと消す。
export async function deletePerformer(eventId: number, performerId: number): Promise<void> {
  const row = await getOne(
    `SELECT p.id, p.performer_name, p.signup_id FROM event_signup_performers p
       JOIN event_signups s ON s.id = p.signup_id
      WHERE p.id = ? AND s.event_id = ?`,
    [performerId, eventId]
  );
  if (!row) return;
  const signupId = Number(row.signup_id);
  const delName = String(row.performer_name);
  const delParts = (await getAll('SELECT part_key FROM event_signup_parts WHERE performer_id = ?', [performerId]))
    .map((r) => String(r.part_key))
    .filter(isPartKey) as PartKey[];
  await withWriteTx(async (tx) => {
    await tx.execute({ sql: 'DELETE FROM event_signup_parts WHERE performer_id = ?', args: [performerId] });
    await tx.execute({ sql: 'DELETE FROM event_signup_performers WHERE id = ?', args: [performerId] });
    const remain = await tx.execute({
      sql: 'SELECT COUNT(*) AS n FROM event_signup_performers WHERE signup_id = ?',
      args: [signupId],
    });
    if (Number(remain.rows[0].n) === 0) {
      await tx.execute({ sql: 'DELETE FROM event_signups WHERE id = ?', args: [signupId] });
    }
  });
  await logAudit(
    eventId,
    signupId,
    'staff',
    'delete_performer',
    `スタッフが出演者を削除：${snapshotText([{ name: delName, parts: delParts }])}`
  );
}

// ============================================================
// 講師共有(読み取り専用): 秘密トークンでその1イベントの名簿だけ見せる
// ============================================================

export interface SharedRosterPerformer {
  name: string;
  parts: PartKey[];
}
export interface SharedRosterSignup {
  note: string;
  createdAt: string;
  performers: SharedRosterPerformer[];
}
export interface SharedRoster {
  eventName: string;
  summary: { performerCount: number; signupCount: number; byPart: { key: string; label: string; count: number }[] };
  parts: { key: string; label: string }[];
  signups: SharedRosterSignup[];
}

// スタッフ用: 共有トークンを取得(無ければ生成して保存)。
export async function getOrCreateShareToken(eventId: number): Promise<string> {
  const row = await getOne('SELECT share_token FROM event_signup_settings WHERE event_id = ?', [eventId]);
  if (row?.share_token) return String(row.share_token);
  const token = generateEditToken();
  const cur = await resolveSettings(eventId);
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO event_signup_settings
       (event_id, parts_json, fee_text, deadline, intro_md, calendar_url, is_open, updated_at, share_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET share_token = excluded.share_token`,
    [
      eventId,
      JSON.stringify(cur.parts),
      cur.feeText,
      cur.deadline,
      cur.introMd,
      cur.calendarUrl,
      cur.isOpen ? 1 : 0,
      now,
      token,
    ]
  );
  return token;
}

// 公開(講師共有): code と token が一致したときだけ、読み取り専用の名簿を返す。
// 不一致・未設定は null(存在有無を漏らさない)。
export async function getSharedRoster(code: string, token: string): Promise<SharedRoster | null> {
  if (!token) return null;
  const ev = await findEventByCode(code);
  if (!ev) return null;
  const row = await getOne('SELECT share_token FROM event_signup_settings WHERE event_id = ?', [ev.id]);
  const stored = row?.share_token ? String(row.share_token) : '';
  if (!stored || stored !== token) return null;

  const settings = await resolveSettings(ev.id);
  const signups = await listByEvent(ev.id);
  const flat = signups.flatMap((s) => s.performers.map((p) => ({ parts: p.parts })));
  const counts = countByPart(flat);
  const byPart = settings.parts.map((p) => ({ key: p.key, label: p.label, count: counts[p.key] ?? 0 }));
  return {
    eventName: ev.name,
    summary: { performerCount: flat.length, signupCount: signups.length, byPart },
    parts: settings.parts.map((p) => ({ key: p.key, label: p.label })),
    signups: signups.map((s) => ({
      note: s.note,
      createdAt: s.createdAt,
      performers: s.performers.map((p) => ({ name: p.name, parts: p.parts })),
    })),
  };
}
