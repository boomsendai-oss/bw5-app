// src/lib/trialCalendar.ts — Node.js runtime 専用。
//
// 体験予約(trial_records)を、boom.sendai が所有する「体験予約(スタッフ用)」カレンダーへ同期する
// (2026-11-09 TARO依頼: どのクラスにいつ体験さんが入っているかをカレンダーで見たい)。
//
// 🔴 守ること(生徒への見え方・Lstep連携を壊さないため):
//   - 書き込むのは専用カレンダーだけ。正本カレンダー(primary=生徒が見る)と
//     休講ブロック用カレンダー(Lstepのシフト連携が読む)には絶対に書かない。下の assertSafeTarget で止める。
//   - 専用カレンダーは公開設定にしない(ACLの default/公開を付けない)。
//   - 触る予定は boomTrial=1 の印が付いたものだけ。人が手で入れた予定は消さない。
//   - 過去の予定は消さない(記録として残す)。今日以降だけを合わせる。
//
// 認証は googleCalendar.ts と同じ保存済み refresh_token(boom.sendai・calendarスコープ)。

import { getAll, getOne, execute } from './db';
import { getCalendarClient } from './googleCalendar';
import { fetchEventsForRange } from './lessonCalendar';
import { buildTrialGroups, type TrialRow } from './trialNotify';
import { buildTrialCalendarEvents, type LessonSlot } from './trialCalendarEvents';
import { todayJst } from './dateJst';

const CALENDAR_ID_KEY = 'trial_calendar_id';
const BLOCK_CALENDAR_ID_KEY = 'block_calendar_id';
export const TRIAL_CALENDAR_SUMMARY = '体験予約（スタッフ用・非公開）';

export type TrialCalendarSummary = {
  ok: true;
  calendarId: string;
  desired: number;
  created: number;
  updated: number;
  deleted: number;
  kept: number;
};

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 書き込み先が正本/休講ブロック用でないことを確かめる。違ったら例外で止める。 */
async function assertSafeTarget(calendarId: string): Promise<void> {
  const block = (await getOne('SELECT value FROM settings WHERE key = ?', [BLOCK_CALENDAR_ID_KEY]))?.value as string | undefined;
  if (!calendarId || calendarId === 'primary' || calendarId.endsWith('@gmail.com') || (block && calendarId === block)) {
    throw new Error(`体験予約カレンダーの書き込み先が不正です(${calendarId})。正本/休講ブロック用には書きません`);
  }
}

/** 専用カレンダーを取得。無ければ作成(非公開)。IDは settings にキャッシュ。 */
export async function ensureTrialCalendar(): Promise<string> {
  const cal = await getCalendarClient();
  const cached = (await getOne('SELECT value FROM settings WHERE key = ?', [CALENDAR_ID_KEY]))?.value as string | undefined;
  if (cached) {
    try {
      await cal.calendars.get({ calendarId: cached });
      await assertSafeTarget(cached);
      return cached;
    } catch {
      // 消えている等 → 下で探し直す/作り直す
    }
  }
  const list = await cal.calendarList.list({ maxResults: 250 });
  const found = (list.data.items ?? []).find((c) => c.summary === TRIAL_CALENDAR_SUMMARY && c.accessRole === 'owner');
  let id = found?.id ?? '';
  if (!id) {
    const created = await cal.calendars.insert({
      requestBody: {
        summary: TRIAL_CALENDAR_SUMMARY,
        timeZone: 'Asia/Tokyo',
        description: 'BOOMアプリが体験予約(Lステップ)を自動で書き込みます。生徒には公開しません。手動編集しないでください。',
      },
    });
    id = created.data.id ?? '';
    if (!id) throw new Error('体験予約カレンダーの作成に失敗しました');
  }
  await assertSafeTarget(id);
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [CALENDAR_ID_KEY, id]
  );
  return id;
}

/** 今日〜daysAhead日先の体験予約を専用カレンダーに合わせる。 */
export async function syncTrialCalendar(opts: { daysAhead?: number } = {}): Promise<TrialCalendarSummary> {
  const daysAhead = opts.daysAhead ?? 90;
  const today = todayJst();
  const until = addDays(today, daysAhead);

  const rows = (await getAll(
    `SELECT reserved_at, lesson_name, status,
            applicant_name, applicant_name_kana, applicant_age,
            course_type, dance_experience, referral_source
       FROM trial_records
      WHERE date(reserved_at) >= date(?) AND date(reserved_at) <= date(?)
      ORDER BY reserved_at ASC`,
    [today, until]
  )) as TrialRow[];
  const groups = buildTrialGroups(rows);

  // 終了時刻・場所は正本カレンダー(読むだけ)から借りる。取れなければ60分で置く。
  let slots: LessonSlot[] = [];
  try {
    slots = await fetchEventsForRange(today, until, 'primary');
  } catch (e) {
    console.warn(`体験カレンダー: 正本の読み取り失敗(60分で代用): ${e instanceof Error ? e.message : e}`);
  }
  const desired = new Map(buildTrialCalendarEvents(groups, slots).map((ev) => [ev.key, ev]));

  const cal = await getCalendarClient();
  const calendarId = await ensureTrialCalendar();
  await assertSafeTarget(calendarId);

  // 既存(印付き・今日以降)
  const existing = new Map<string, { id: string; hash: string }>();
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({
      calendarId,
      privateExtendedProperty: ['boomTrial=1'],
      timeMin: `${today}T00:00:00+09:00`,
      timeMax: `${until}T23:59:59+09:00`,
      singleEvents: true,
      maxResults: 2500,
      pageToken,
    });
    for (const ev of res.data.items ?? []) {
      const k = ev.extendedProperties?.private?.boomKey;
      if (!k || !ev.id) continue;
      if (existing.has(k)) {
        // 同じ枠が2件ある(途中で失敗した等) → 余分は消す
        await cal.events.delete({ calendarId, eventId: ev.id });
        continue;
      }
      existing.set(k, { id: ev.id, hash: ev.extendedProperties?.private?.boomHash ?? '' });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  let created = 0, updated = 0, deleted = 0, kept = 0;
  for (const [key, ev] of desired) {
    const body = {
      summary: ev.summary,
      description: ev.description,
      location: ev.location ?? undefined,
      start: { dateTime: `${ev.date}T${ev.start}:00`, timeZone: 'Asia/Tokyo' },
      end: { dateTime: `${ev.date}T${ev.end}:00`, timeZone: 'Asia/Tokyo' },
      transparency: 'transparent', // TAROの「予定あり」表示を邪魔しない
      extendedProperties: { private: { boomTrial: '1', boomKey: key, boomHash: ev.hash } },
    };
    const cur = existing.get(key);
    if (!cur) {
      await cal.events.insert({ calendarId, requestBody: body });
      created++;
    } else if (cur.hash !== ev.hash) {
      await cal.events.update({ calendarId, eventId: cur.id, requestBody: body });
      updated++;
    } else {
      kept++;
    }
  }
  // 体験が全員キャンセルになった枠などは消す(今日以降・印付きのみ)
  for (const [key, cur] of existing) {
    if (desired.has(key)) continue;
    await cal.events.delete({ calendarId, eventId: cur.id });
    deleted++;
  }

  return { ok: true, calendarId, desired: desired.size, created, updated, deleted, kept };
}
