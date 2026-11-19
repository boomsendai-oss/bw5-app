'use server';

// 月1プチバトル スタッフ専用 Server Actions。/staff/* はproxy(cookie存在チェック)で
// 覆われているが、proxyはDBを見られないため isAuthorizedServer() による本検証をここで必ず行う(規約4.5)。
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { isIsoDate } from '@/lib/dateJst';
import type { BattleCast, BattleDivision } from '@/lib/battle';
import { createBattleEventFrom, getBattleEvent, updateBattleEvent } from '@/lib/battleDb';

async function requireStaff(): Promise<void> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
}

const str = (fd: FormData, k: string, max = 2000) => String(fd.get(k) ?? '').trim().slice(0, max);
const int = (fd: FormData, k: string) => Math.max(0, Math.floor(Number(fd.get(k)) || 0));
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** 設定フォームの保存。部門は行ごと(div_name_0, div_capacity_0 …)。名前が空の行は消す。 */
export async function saveBattleEventSettings(fd: FormData): Promise<void> {
  await requireStaff();
  const eventKey = str(fd, 'event_key', 40);
  const cur = await getBattleEvent(eventKey);
  if (!cur) throw new Error('回が見つかりません');

  const divisions: BattleDivision[] = [];
  for (let i = 0; i < 10; i++) {
    const name = str(fd, `div_name_${i}`, 100);
    if (!name) continue;
    const key = str(fd, `div_key_${i}`, 30) || `d${Date.now().toString(36)}${i}`;
    const maxAgeRaw = str(fd, `div_maxage_${i}`, 3);
    divisions.push({
      key,
      name,
      note: str(fd, `div_note_${i}`, 200),
      capacity: int(fd, `div_capacity_${i}`),
      maxAge: maxAgeRaw === '' ? null : Math.max(0, Math.floor(Number(maxAgeRaw)) || 0),
    });
  }
  const cast: BattleCast[] = [];
  for (let i = 0; i < 8; i++) {
    const role = str(fd, `cast_role_${i}`, 40);
    if (!role) continue;
    cast.push({
      role,
      mark: str(fd, `cast_mark_${i}`, 2),
      name: str(fd, `cast_name_${i}`, 60),
      photo: str(fd, `cast_photo_${i}`, 500),
      note: str(fd, `cast_note_${i}`, 100),
      instagram: str(fd, `cast_ig_${i}`, 60).replace(/^@/, ''),
      announced: fd.get(`cast_on_${i}`) === '1',
    });
  }
  const eventDate = str(fd, 'event_date', 10);
  const lateFeeFrom = str(fd, 'late_fee_from', 16);
  const entryDeadline = str(fd, 'entry_deadline', 16);

  await updateBattleEvent(eventKey, {
    title: str(fd, 'title', 100) || cur.title,
    subtitle: str(fd, 'subtitle', 200),
    description: str(fd, 'description'),
    eventDate: isIsoDate(eventDate) ? eventDate : cur.eventDate,
    openTime: str(fd, 'open_time', 5),
    startTime: str(fd, 'start_time', 5),
    endTime: str(fd, 'end_time', 5),
    venue: str(fd, 'venue', 100),
    venueAddress: str(fd, 'venue_address', 200),
    moveSeconds: int(fd, 'move_seconds'),
    divisions: divisions.length > 0 ? divisions : cur.divisions,
    entryFee: int(fd, 'entry_fee'),
    entryFeeLate: int(fd, 'entry_fee_late'),
    lateFeeFrom: lateFeeFrom === '' || DT_RE.test(lateFeeFrom) ? lateFeeFrom : cur.lateFeeFrom,
    spectatorFee: int(fd, 'spectator_fee'),
    spectatorNote: str(fd, 'spectator_note', 200),
    entryDeadline: entryDeadline === '' || DT_RE.test(entryDeadline) ? entryDeadline : cur.entryDeadline,
    entryOpen: fd.get('entry_open') === '1',
    rules: str(fd, 'rules'),
    cancelPolicy: str(fd, 'cancel_policy'),
    cast,
  });
  revalidatePath('/staff/battle');
  redirect(`/staff/battle?e=${encodeURIComponent(eventKey)}&saved=1`);
}

/** 新しい回を作る(元の回の設定をコピー・受付は閉)。event_key は開催日。 */
export async function createNextBattleEvent(fd: FormData): Promise<void> {
  await requireStaff();
  const src = str(fd, 'src_key', 40);
  const newDate = str(fd, 'new_date', 10);
  if (!isIsoDate(newDate)) redirect(`/staff/battle?e=${encodeURIComponent(src)}&err=date`);
  const ok = await createBattleEventFrom(src, newDate);
  revalidatePath('/staff/battle');
  redirect(`/staff/battle?e=${encodeURIComponent(ok ? newDate : src)}${ok ? '&created=1' : '&err=exists'}`);
}
