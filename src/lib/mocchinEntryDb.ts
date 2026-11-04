// BW6スペシャルナンバー by MOCCHIN の申込のDB操作。純ロジックは mocchinEntry.ts。
// 公開フォーム: src/app/mocchin / スタッフ一覧: src/app/staff/mocchin
import { execute, getAll, getOne } from '@/lib/db';
import { nowUtcIso, todayJst } from '@/lib/dateJst';
import { MOCCHIN_DEFAULT_CAPACITY, type ValidatedMocchin } from '@/lib/mocchinEntry';

/** 設定は party_settings に置く(クリパと同じ置き場・event_key で分ける) */
export const MOCCHIN_SETTINGS_KEY = 'bw6_mocchin';

export interface MocchinEntry {
  id: number;
  status: 'active' | 'cancelled';
  name: string;
  kana: string;
  age: string;
  guardianName: string;
  phone: string;
  email: string;
  isMember: boolean;
  memberNo: string;
  danceHistory: string;
  classNumber: string;
  note: string;
  paid: boolean;
  paidAt: string;
  staffNote: string;
  appliedOn: string;
  createdAt: string;
}

function toEntry(r: Record<string, unknown>): MocchinEntry {
  return {
    id: Number(r.id),
    status: r.status === 'cancelled' ? 'cancelled' : 'active',
    name: String(r.name ?? ''),
    kana: String(r.kana ?? ''),
    age: String(r.age ?? ''),
    guardianName: String(r.guardian_name ?? ''),
    phone: String(r.phone ?? ''),
    email: String(r.email ?? ''),
    isMember: Number(r.is_member) === 1,
    memberNo: String(r.member_no ?? ''),
    danceHistory: String(r.dance_history ?? ''),
    classNumber: String(r.class_number ?? ''),
    note: String(r.note ?? ''),
    paid: Number(r.paid) === 1,
    paidAt: String(r.paid_at ?? ''),
    staffNote: String(r.staff_note ?? ''),
    appliedOn: String(r.applied_on ?? ''),
    createdAt: String(r.created_at ?? ''),
  };
}

export async function getMocchinCapacity(): Promise<number> {
  const r = await getOne('SELECT value FROM party_settings WHERE event_key = ? AND key = ?', [MOCCHIN_SETTINGS_KEY, 'capacity']);
  const n = Number(r?.value);
  return Number.isInteger(n) && n > 0 ? n : MOCCHIN_DEFAULT_CAPACITY;
}

export async function saveMocchinCapacity(n: number): Promise<void> {
  await execute(
    'INSERT INTO party_settings (event_key, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_key, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [MOCCHIN_SETTINGS_KEY, 'capacity', String(n), nowUtcIso()]
  );
}

export async function countActiveMocchin(): Promise<number> {
  const r = await getOne("SELECT COUNT(*) AS n FROM mocchin_entries WHERE status = 'active'");
  return Number(r?.n ?? 0);
}

/** 申込を1件保存して id を返す。定員を超えても受け付ける(オーディション/キャンセル待ちの案内は呼び出し側) */
export async function createMocchinEntry(v: ValidatedMocchin): Promise<{ id: number; appliedOn: string }> {
  const now = nowUtcIso();
  const appliedOn = todayJst();
  const r = await execute(
    `INSERT INTO mocchin_entries
      (name, kana, age, guardian_name, phone, email, is_member, member_no, dance_history, class_number, note, applied_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.name, v.kana, v.age, v.guardianName, v.phone, v.email, v.isMember ? 1 : 0, v.memberNo, v.danceHistory, v.classNumber, v.note, appliedOn, now, now]
  );
  return { id: Number(r.lastInsertRowid), appliedOn };
}

export async function listMocchinEntries(): Promise<MocchinEntry[]> {
  const rows = await getAll('SELECT * FROM mocchin_entries ORDER BY id');
  return rows.map(toEntry);
}

export async function setMocchinPaid(id: number, paid: boolean): Promise<boolean> {
  const now = nowUtcIso();
  const r = await execute('UPDATE mocchin_entries SET paid = ?, paid_at = ?, updated_at = ? WHERE id = ?', [paid ? 1 : 0, paid ? now : '', now, id]);
  return Number(r.rowsAffected) > 0;
}

export async function setMocchinStatus(id: number, status: 'active' | 'cancelled'): Promise<boolean> {
  const r = await execute('UPDATE mocchin_entries SET status = ?, updated_at = ? WHERE id = ?', [status, nowUtcIso(), id]);
  return Number(r.rowsAffected) > 0;
}

export async function setMocchinStaffNote(id: number, note: string): Promise<boolean> {
  const r = await execute('UPDATE mocchin_entries SET staff_note = ?, updated_at = ? WHERE id = ?', [note.slice(0, 500), nowUtcIso(), id]);
  return Number(r.rowsAffected) > 0;
}
