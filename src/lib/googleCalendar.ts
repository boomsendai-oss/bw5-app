// src/lib/googleCalendar.ts — Node.js runtime 専用。
//
// 休講(cancelled)レッスンを boom.sendai が「所有する」Googleカレンダーに
// イベントとして書き込む。Lstepの「Gカレ→シフト連携」は所有カレンダーしか
// 連携できないため、ICS購読(read-only/非所有)では弾かれる問題への対応。
//
// 認証は Drive(env: GOOGLE_REFRESH_TOKEN) とは別系統:
//   - Calendar専用の refresh_token を settings('google_calendar_refresh_token') に保存
//   - スコープは calendar のみ。Drive側(env)は一切触らないので壊れない。
//
// 所有カレンダーID は settings('block_calendar_id') にキャッシュ。

import { google } from 'googleapis';
import { getOne, execute } from './db';
import { buildLessonsForMonths } from './scheduleExport';

const REFRESH_TOKEN_KEY = 'google_calendar_refresh_token';
const CALENDAR_ID_KEY = 'block_calendar_id';
const CALENDAR_SUMMARY = 'BOOM休講ブロック(Lstep用)';
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

function getEnv() {
  // カレンダーはWebアプリ型クライアント(ホスト型リダイレクト対応)を使う。
  // Drive用のデスクトップ型(GOOGLE_CLIENT_ID)はホスト型リダイレクト不可のため別建て。
  // 未設定なら従来のGOOGLE_CLIENT_IDにフォールバック(同一Webクライアントを使う場合)。
  const clientId = process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CAL_CLIENT_ID / GOOGLE_CAL_CLIENT_SECRET (またはGOOGLE_CLIENT_ID/SECRET) が未設定です');
  }
  return { clientId, clientSecret };
}

/** アプリのコールバックURL (Google Cloud Console の承認済みリダイレクトURIに登録必須) */
export function getRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/staff/google/calendar-callback`;
}

/** 連携(同意)用URLを生成 */
export function buildConsentUrl(origin: string): string {
  const { clientId, clientSecret } = getEnv();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, getRedirectUri(origin));
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // refresh_token を確実に発行させる
    scope: SCOPES,
  });
}

/** 同意後のcodeをrefresh_tokenに交換してsettingsに保存 */
export async function exchangeAndStoreToken(code: string, origin: string): Promise<void> {
  const { clientId, clientSecret } = getEnv();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, getRedirectUri(origin));
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('refresh_token が取得できませんでした (既に同意済みの場合は Google アカウントの権限を一度削除して再試行してください)');
  }
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [REFRESH_TOKEN_KEY, tokens.refresh_token]
  );
}

async function getStoredRefreshToken(): Promise<string> {
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [REFRESH_TOKEN_KEY]);
  const tok = (row?.value as string | undefined) ?? '';
  if (!tok) throw new Error('Googleカレンダー未連携です。/staff/schedule/sync の「Google連携」ボタンから連携してください');
  return tok;
}

export async function isConnected(): Promise<boolean> {
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [REFRESH_TOKEN_KEY]);
  return !!(row?.value as string | undefined);
}

async function getCalendarClient() {
  const { clientId, clientSecret } = getEnv();
  const refreshToken = await getStoredRefreshToken();
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

/** 所有カレンダー(休講ブロック用)を取得。無ければ作成。IDをsettingsにキャッシュ。 */
export async function ensureBlockCalendar(): Promise<string> {
  const cal = await getCalendarClient();
  // キャッシュ済みIDが生きているか確認
  const cached = await getOne('SELECT value FROM settings WHERE key = ?', [CALENDAR_ID_KEY]);
  const cachedId = (cached?.value as string | undefined) ?? '';
  if (cachedId) {
    try {
      await cal.calendars.get({ calendarId: cachedId });
      return cachedId;
    } catch {
      // 消えている等 → 作り直し
    }
  }
  // 既存の同名カレンダーを探す
  const list = await cal.calendarList.list({ maxResults: 250 });
  const found = (list.data.items ?? []).find((c) => c.summary === CALENDAR_SUMMARY && c.accessRole === 'owner');
  let id = found?.id ?? '';
  if (!id) {
    const created = await cal.calendars.insert({
      requestBody: { summary: CALENDAR_SUMMARY, timeZone: 'Asia/Tokyo', description: 'BOOMアプリが休講枠を自動で書き込みます。Lstep体験予約のブロック用。手動編集しないでください。' },
    });
    id = created.data.id ?? '';
    if (!id) throw new Error('カレンダー作成に失敗しました');
  }
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [CALENDAR_ID_KEY, id]
  );
  return id;
}

function toRfc3339(date: string, time: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time ?? '');
  if (!dm || !tm) return null;
  const hh = String(parseInt(tm[1], 10)).padStart(2, '0');
  return `${dm[1]}-${dm[2]}-${dm[3]}T${hh}:${tm[2]}:${tm[3] ?? '00'}`;
}

export type SyncResult = { calendarId: string; created: number; deleted: number; kept: number; total_cancelled: number };

/**
 * 休講レッスンを所有カレンダーに同期する。
 * - 望ましいイベント集合 = 今後 months ヶ月の cancelled レッスン
 * - 既存(boomBlock印付き)と突き合わせて、足りないものを作成、不要なものを削除
 * - 二重防止: extendedProperties.private.boomKey = "{master_id}-{date}-{start}"
 */
export async function syncBlockEvents(months = 3): Promise<SyncResult> {
  const cal = await getCalendarClient();
  const calendarId = await ensureBlockCalendar();

  const lessons = (await buildLessonsForMonths(months)).filter((l) => l.status === 'cancelled');
  // 望ましいイベント: key -> lesson
  const desired = new Map<string, (typeof lessons)[number]>();
  for (const l of lessons) {
    const key = `${l.master_id ?? 'x'}-${l.date}-${l.start_time}`;
    desired.set(key, l);
  }

  // 既存のboomBlockイベントを取得 (この印が付いたものだけを管理対象にする = 手動予定は触らない)
  const existing = new Map<string, string>(); // key -> eventId
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({
      calendarId,
      privateExtendedProperty: ['boomBlock=1'],
      maxResults: 2500,
      showDeleted: false,
      pageToken,
    });
    for (const ev of res.data.items ?? []) {
      const k = ev.extendedProperties?.private?.boomKey;
      if (k && ev.id) existing.set(k, ev.id);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  let created = 0;
  let kept = 0;
  let deleted = 0;

  // 作成 (existing に無い desired)
  for (const [key, l] of desired) {
    if (existing.has(key)) {
      kept++;
      continue;
    }
    const startIso = toRfc3339(l.date, l.start_time);
    const endIso = toRfc3339(l.date, l.end_time);
    if (!startIso || !endIso) continue;
    await cal.events.insert({
      calendarId,
      requestBody: {
        summary: `【休講】${l.class_name}`,
        description: 'BOOMアプリが自動生成: この時間は休講のため体験予約をブロックします',
        start: { dateTime: startIso, timeZone: 'Asia/Tokyo' },
        end: { dateTime: endIso, timeZone: 'Asia/Tokyo' },
        transparency: 'opaque',
        extendedProperties: { private: { boomBlock: '1', boomKey: key } },
      },
    });
    created++;
  }

  // 削除 (desired に無い existing = 休講解除された/期間外)
  for (const [key, eventId] of existing) {
    if (desired.has(key)) continue;
    try {
      await cal.events.delete({ calendarId, eventId });
      deleted++;
    } catch {
      // 既に消えている等は無視
    }
  }

  return { calendarId, created, deleted, kept, total_cancelled: lessons.length };
}

// ============================================================
// レッスンスケジュール公開カレンダー (全員=スタッフ/インストラクター/生徒が閲覧)
//   アプリのマスター予定(全レッスン)を、公開の所有Googleカレンダーへ自動反映する。
//   - 休講は【休講】プレフィックス＋グレー色で「見える」形(非表示にしない)
//   - 公開ACL(リンクを知っている人は閲覧可)を付与
// ============================================================
const LESSON_CALENDAR_ID_KEY = 'lesson_calendar_id';
const LESSON_CALENDAR_SUMMARY = 'BOOMレッスンスケジュール';

export async function ensureLessonCalendar(): Promise<string> {
  const cal = await getCalendarClient();
  const cached = await getOne('SELECT value FROM settings WHERE key = ?', [LESSON_CALENDAR_ID_KEY]);
  const cachedId = (cached?.value as string | undefined) ?? '';
  if (cachedId) {
    try { await cal.calendars.get({ calendarId: cachedId }); return cachedId; } catch { /* 消えてたら作り直し */ }
  }
  const list = await cal.calendarList.list({ maxResults: 250 });
  const found = (list.data.items ?? []).find((c) => c.summary === LESSON_CALENDAR_SUMMARY && c.accessRole === 'owner');
  let id = found?.id ?? '';
  if (!id) {
    const created = await cal.calendars.insert({
      requestBody: {
        summary: LESSON_CALENDAR_SUMMARY,
        timeZone: 'Asia/Tokyo',
        description: 'BOOMダンススクールのレッスンスケジュール。アプリのマスター予定を自動反映しています。',
      },
    });
    id = created.data.id ?? '';
    if (!id) throw new Error('レッスンカレンダー作成に失敗しました');
  }
  // 公開ACL: リンクを知っている人は閲覧可 (検索には出ない)。scope.type=default=public, role=reader
  try {
    await cal.acl.insert({ calendarId: id, requestBody: { role: 'reader', scope: { type: 'default' } } });
  } catch { /* 既に公開なら無視 */ }
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [LESSON_CALENDAR_ID_KEY, id]
  );
  return id;
}

export type LessonCalendarEvent = { summary: string; location: string | null; startIso: string };

/**
 * 公開レッスンカレンダーのイベントを期間指定で読み取る (読み取り専用)。
 * 予定の「正」はこのカレンダー (手動変更・代講の最終反映先) — X週次投稿等はここから読む。
 * カレンダー未作成/未連携なら null (作成はしない)。
 */
export async function listLessonEvents(timeMinIso: string, timeMaxIso: string): Promise<LessonCalendarEvent[] | null> {
  const cached = await getOne('SELECT value FROM settings WHERE key = ?', [LESSON_CALENDAR_ID_KEY]);
  const calendarId = (cached?.value as string | undefined) ?? '';
  if (!calendarId) return null;
  const cal = await getCalendarClient();
  const items: LessonCalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({
      calendarId,
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken,
    });
    for (const ev of res.data.items ?? []) {
      if (ev.status === 'cancelled') continue;
      const startIso = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00+09:00` : null);
      if (!startIso || !ev.summary) continue;
      items.push({ summary: ev.summary, location: ev.location ?? null, startIso });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

export type LessonSyncResult = { calendarId: string; created: number; updated: number; deleted: number; kept: number; total: number; embedUrl: string };

/**
 * 全レッスンを公開カレンダーへ同期する。
 * - desired = 今後 months ヶ月の全レッスン(休講含む)
 * - 既存(boomLesson印)と署名(boomSig)で突合し、新規作成/変更更新/不要削除
 */
export async function syncLessons(months = 3, startYm?: string): Promise<LessonSyncResult> {
  const cal = await getCalendarClient();
  const calendarId = await ensureLessonCalendar();
  const lessons = await buildLessonsForMonths(months, startYm);

  const desired = new Map<string, (typeof lessons)[number]>();
  for (const l of lessons) {
    const idPart = l.instance_id != null ? `i${l.instance_id}` : `m${l.master_id ?? 'x'}`;
    desired.set(`${idPart}-${l.date}-${l.start_time}`, l);
  }

  // 既存のboomLessonイベント
  const existing = new Map<string, { id: string; sig: string }>();
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({
      calendarId, privateExtendedProperty: ['boomLesson=1'], maxResults: 2500, showDeleted: false, pageToken,
    });
    for (const ev of res.data.items ?? []) {
      const k = ev.extendedProperties?.private?.boomKey;
      if (k && ev.id) existing.set(k, { id: ev.id, sig: ev.extendedProperties?.private?.boomSig ?? '' });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  let created = 0, updated = 0, kept = 0, deleted = 0;
  for (const [key, l] of desired) {
    const startIso = toRfc3339(l.date, l.start_time);
    const endIso = toRfc3339(l.date, l.end_time);
    if (!startIso || !endIso) continue;
    const cancelled = l.status === 'cancelled';
    const summary = `${cancelled ? '【休講】' : ''}【${l.instructor_name ?? '未定'}】${l.class_name}`;
    const sig = `${summary}|${startIso}|${endIso}|${l.studio_name ?? ''}`;
    const requestBody = {
      summary,
      location: l.studio_name ?? undefined,
      start: { dateTime: startIso, timeZone: 'Asia/Tokyo' },
      end: { dateTime: endIso, timeZone: 'Asia/Tokyo' },
      colorId: cancelled ? '8' : undefined, // 休講=グラファイト(グレー)
      transparency: 'transparent',
      extendedProperties: { private: { boomLesson: '1', boomKey: key, boomSig: sig } },
    };
    const ex = existing.get(key);
    if (!ex) { await cal.events.insert({ calendarId, requestBody }); created++; }
    else if (ex.sig !== sig) { await cal.events.update({ calendarId, eventId: ex.id, requestBody }); updated++; }
    else { kept++; }
  }
  for (const [key, ex] of existing) {
    if (desired.has(key)) continue;
    try { await cal.events.delete({ calendarId, eventId: ex.id }); deleted++; } catch { /* 既に無い */ }
  }

  const embedUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}&ctz=Asia%2FTokyo`;
  return { calendarId, created, updated, kept, deleted, total: lessons.length, embedUrl };
}
