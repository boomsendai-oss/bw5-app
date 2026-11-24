'use server';

// 特設ワークショップ スタッフ専用 Server Actions。/staff/* はproxy(cookie存在チェック)で
// 覆われているが、proxyはDBを見られないため isAuthorizedServer() による本検証をここで必ず行う(規約4.5)。
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { isIsoDate } from '@/lib/dateJst';
import { getSpWsEvent, markSpWsOnsitePaid, updateSpWsEvent } from '@/lib/spWsDb';

async function requireStaff(): Promise<void> {
  if (!(await isAuthorizedServer())) throw new Error('Unauthorized');
}

const str = (fd: FormData, k: string, max = 2000) => String(fd.get(k) ?? '').trim().slice(0, max);
const int = (fd: FormData, k: string) => Math.max(0, Math.floor(Number(fd.get(k)) || 0));
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** 当日払いの人から受付で現金を受け取ったら「支払済」にする。 */
export async function markSpWsPaid(fd: FormData): Promise<void> {
  await requireStaff();
  const entryId = int(fd, 'entryId');
  if (entryId > 0) await markSpWsOnsitePaid(entryId);
  revalidatePath('/staff/ws');
}

/** 設定の保存(会場が決まったら会場欄を入れるだけで公開ページが変わる)。 */
export async function saveSpWsSettings(fd: FormData): Promise<void> {
  await requireStaff();
  const slug = str(fd, 'slug', 40);
  const cur = await getSpWsEvent(slug);
  if (!cur) throw new Error('ワークショップが見つかりません');
  const eventDate = str(fd, 'event_date', 10);
  const deadline = str(fd, 'entry_deadline', 16);
  const photo = str(fd, 'photo_url', 500);
  await updateSpWsEvent(slug, {
    title: str(fd, 'title', 100) || cur.title,
    subtitle: str(fd, 'subtitle', 200),
    instructorName: str(fd, 'instructor_name', 60) || cur.instructorName,
    instructorKana: str(fd, 'instructor_kana', 60),
    instructorFrom: str(fd, 'instructor_from', 60),
    instructorBio: str(fd, 'instructor_bio'),
    instructorGenre: str(fd, 'instructor_genre', 100),
    instructorInstagram: str(fd, 'instructor_instagram', 60).replace(/^@/, ''),
    photoUrl: photo === '' || /^https:\/\//.test(photo) || photo.startsWith('/') ? photo : cur.photoUrl,
    description: str(fd, 'description'),
    eventDate: isIsoDate(eventDate) ? eventDate : cur.eventDate,
    startTime: str(fd, 'start_time', 5),
    endTime: str(fd, 'end_time', 5),
    venue: str(fd, 'venue', 100),
    venueAddress: str(fd, 'venue_address', 200),
    fee: int(fd, 'fee'),
    capacity: int(fd, 'capacity'),
    entryDeadline: deadline === '' || DT_RE.test(deadline) ? deadline : cur.entryDeadline,
    entryOpen: fd.get('entry_open') === '1',
    belongings: str(fd, 'belongings'),
    target: str(fd, 'target', 200),
    cancelPolicy: str(fd, 'cancel_policy'),
    contact: str(fd, 'contact', 100),
  });
  revalidatePath('/staff/ws');
  redirect(`/staff/ws?e=${encodeURIComponent(slug)}&saved=1`);
}
