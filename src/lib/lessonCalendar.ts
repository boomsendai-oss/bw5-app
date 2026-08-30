// 正本スケジュール = BOOMアカウント(boom.sendai@gmail.com)のGoogleカレンダー。
// TAROが直接編集しており編集頻度が高い(単発イベント化・「代講 ○○」表記・休講は削除)。
// アプリDB(lesson_master等)やHACOMONOより新しい情報源として扱う(2026-07-16 TARO確定)。
//
// 読み取りは2系統:
//   1. Calendar API (events.list, singleEvents=true) — 繰り返し展開・例外・キャンセルを
//      Google側で正確に処理済み。認証は googleCalendar.ts と同じ保存済みrefresh_token。
//   2. 公開ICSフィード — 認証不要のフォールバック(envやトークンが無い環境用)。
//      繰り返しは簡易展開(FREQ=WEEKLY/DAILY, UNTIL, EXDATE, RECURRENCE-ID対応)。
//      注: GoogleのICSフィードは数時間キャッシュされるため、当日朝の編集はAPI系統でないと拾えない可能性。

import { google } from 'googleapis';
import { getOne } from './db';

const PUBLIC_ICS_URL = 'https://calendar.google.com/calendar/ical/boom.sendai%40gmail.com/public/basic.ics';
const REFRESH_TOKEN_KEY = 'google_calendar_refresh_token';

export type CalendarLesson = {
  start: string; // 'HH:MM' JST
  summary: string;
};

/** 指定日(JST 'YYYY-MM-DD')のレッスンイベント一覧を正本カレンダーから取得 */
export async function fetchLessonsForDate(date: string): Promise<{ lessons: CalendarLesson[]; source: 'api' | 'ics' }> {
  try {
    const viaApi = await fetchViaApi(date);
    if (viaApi) return { lessons: viaApi, source: 'api' };
  } catch (e) {
    console.warn(`Calendar API読み取り失敗→ICSフォールバック: ${e instanceof Error ? e.message : e}`);
  }
  return { lessons: await fetchViaIcs(date), source: 'ics' };
}

/**
 * 期間内のレッスンイベントを **Calendar APIのみ** で取得する(月次締めの実績用)。
 *
 * 日次の告知(fetchLessonsForDate)と違い ICS フォールバックを持たない。
 * GoogleのICSは数時間キャッシュされるため、**金額の根拠に古いデータを黙って使う方が危険**
 * だから。取れなければ例外にして呼び出し側で止める。
 * singleEvents=true なので繰り返し・例外・移動・キャンセルはGoogle側で解決済み。
 */
export async function fetchEventsForRange(
  fromDate: string,
  toDate: string,
  calendarId: string = 'primary'
): Promise<{ id: string; date: string; start: string; end: string; summary: string; location: string | null; description: string | null }[]> {
  const clientId = process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GoogleカレンダーのクライアントIDが未設定');
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [REFRESH_TOKEN_KEY]);
  const refreshToken = row?.value as string | undefined;
  if (!refreshToken) throw new Error('Googleカレンダーのrefresh tokenが未保存');

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const out: { id: string; date: string; start: string; end: string; summary: string; location: string | null; description: string | null }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({
      calendarId,
      timeMin: `${fromDate}T00:00:00+09:00`,
      timeMax: `${toDate}T23:59:59+09:00`,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
    });
    for (const ev of res.data.items ?? []) {
      if (ev.status === 'cancelled') continue;
      const sdt = ev.start?.dateTime;
      const edt = ev.end?.dateTime;
      if (!sdt || !edt || !ev.summary) continue; // 終日イベントはレッスンではない
      const fmt = (iso: string) =>
        new Date(iso).toLocaleString('ja-JP', {
          timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
      const [d, t] = fmt(sdt).split(' ');
      const [, te] = fmt(edt).split(' ');
      out.push({
        id: ev.id ?? '',
        date: d.replace(/\//g, '-'),
        start: t,
        end: te,
        summary: ev.summary,
        location: ev.location ?? null,
        description: ev.description ?? null,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function fetchViaApi(date: string): Promise<CalendarLesson[] | null> {
  const clientId = process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [REFRESH_TOKEN_KEY]);
  const refreshToken = row?.value as string | undefined;
  if (!refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });
  const res = await cal.events.list({
    calendarId: 'primary', // トークンの持ち主=boom.sendai の公開カレンダー本体
    timeMin: `${date}T00:00:00+09:00`,
    timeMax: `${date}T23:59:59+09:00`,
    singleEvents: true, // 繰り返しを展開(例外・移動・キャンセル反映済み)
    orderBy: 'startTime',
    maxResults: 50,
  });
  const lessons: CalendarLesson[] = [];
  for (const ev of res.data.items ?? []) {
    if (ev.status === 'cancelled') continue;
    const dt = ev.start?.dateTime; // 終日イベント(date)はレッスンではないので無視
    if (!dt || !ev.summary) continue;
    const hhmm = new Date(dt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
    lessons.push({ start: hhmm, summary: ev.summary });
  }
  return lessons;
}

// ---- ICSフォールバック(簡易展開) ----

// 週間プレビューが7日分を並列評価するため、ICS本文(約2MB)は短期キャッシュする
let icsCache: { text: string; fetchedAt: number } | null = null;
let icsFetching: Promise<string> | null = null;

async function getIcsText(): Promise<string> {
  if (icsCache && Date.now() - icsCache.fetchedAt < 5 * 60 * 1000) return icsCache.text;
  if (!icsFetching) {
    icsFetching = (async () => {
      try {
        const res = await fetch(PUBLIC_ICS_URL);
        if (!res.ok) throw new Error(`公開ICS取得失敗: HTTP ${res.status}`);
        const text = await res.text();
        icsCache = { text, fetchedAt: Date.now() };
        return text;
      } finally {
        icsFetching = null;
      }
    })();
  }
  return icsFetching;
}

async function fetchViaIcs(date: string): Promise<CalendarLesson[]> {
  const ics = (await getIcsText()).replace(/\r?\n[ \t]/g, ''); // 行折返しを展開
  const target = date.replace(/-/g, '');
  const targetDow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=日
  const events = ics.split('BEGIN:VEVENT').slice(1).map((s) => s.split('END:VEVENT')[0]);

  // RECURRENCE-ID(繰り返しの個別変更)を先に収集: 同UIDの当日基準回を上書き/移動している
  const overriddenKeys = new Set<string>();
  for (const ev of events) {
    const recId = ev.match(/RECURRENCE-ID[^:]*:(\d{8})/);
    const uid = ev.match(/UID:([^\n]+)/);
    if (recId && uid) overriddenKeys.add(`${uid[1].trim()}_${jstDateOf(ev, recId[1])}`);
  }

  const out: CalendarLesson[] = [];
  for (const ev of events) {
    if (/STATUS:CANCELLED/.test(ev)) continue;
    const m = ev.match(/DTSTART(;TZID=[^:]*)?:(\d{8})(?:T(\d{6}))?(Z?)/);
    if (!m || !m[3]) continue; // 終日は無視
    const summary = (ev.match(/SUMMARY:([^\n]+)/) ?? [])[1]?.trim();
    if (!summary) continue;
    const uid = (ev.match(/UID:([^\n]+)/) ?? [])[1]?.trim() ?? '';
    const { jstDate, jstTime } = toJst(m[2], m[3], !!m[4] || !m[1]);
    const isRecId = /RECURRENCE-ID/.test(ev);
    const rrule = (ev.match(/RRULE:([^\n]+)/) ?? [])[1];

    if (isRecId) {
      // 個別変更された回そのもの: 変更後のDTSTARTが当日なら採用
      if (jstDate === target) out.push({ start: jstTime, summary });
      continue;
    }
    if (!rrule) {
      if (jstDate === target) out.push({ start: jstTime, summary });
      continue;
    }
    // 繰り返し(FREQ=WEEKLY想定・DAILYも同式で概ね動く)
    if (jstDate > target) continue;
    const until = rrule.match(/UNTIL=(\d{8})/);
    if (until && until[1] < target) continue;
    const freq = (rrule.match(/FREQ=(\w+)/) ?? [])[1];
    const interval = parseInt((rrule.match(/INTERVAL=(\d+)/) ?? [])[1] ?? '1', 10);
    const startDow = new Date(`${isoOf(jstDate)}T00:00:00Z`).getUTCDay();
    if (freq === 'WEEKLY') {
      const byday = rrule.match(/BYDAY=([^;]+)/);
      const dows = byday ? byday[1].split(',').map(icalDowToNum) : [startDow];
      if (!dows.includes(targetDow)) continue;
      const weeks = Math.floor((Date.parse(isoOf(target)) - Date.parse(isoOf(jstDate))) / (7 * 86400000));
      if (weeks % interval !== 0) continue;
    } else if (freq === 'DAILY') {
      const days = Math.floor((Date.parse(isoOf(target)) - Date.parse(isoOf(jstDate))) / 86400000);
      if (days % interval !== 0) continue;
    } else if (freq === 'MONTHLY') {
      // 月次: おっちゃんNJS等の「第n日曜」(BYDAY=4SU)。BYMONTHDAY・毎月同日もフォロー。
      const byday = rrule.match(/BYDAY=([^;]+)/);
      const bymonthday = rrule.match(/BYMONTHDAY=([^;]+)/);
      if (byday) {
        if (!byday[1].split(',').some((tok) => matchesMonthlyByDay(tok, target))) continue;
      } else if (bymonthday) {
        if (!bymonthday[1].split(',').map(Number).includes(+target.slice(6, 8))) continue;
      } else if (target.slice(6, 8) !== jstDate.slice(6, 8)) {
        continue; // BY*指定なし=DTSTARTと同じ日
      }
      const monthsDiff = (+target.slice(0, 4) - +jstDate.slice(0, 4)) * 12 + (+target.slice(4, 6) - +jstDate.slice(4, 6));
      if (monthsDiff < 0 || monthsDiff % interval !== 0) continue;
    } else {
      continue; // YEARLY等は運用に無い
    }
    // EXDATE(この回だけ削除) / RECURRENCE-ID(この回だけ変更→上で採用済み)を除外
    const exdates = [...ev.matchAll(/EXDATE[^:]*:(\d{8})/g)].map((x) => jstDateOf(ev, x[1]));
    if (exdates.includes(target)) continue;
    if (overriddenKeys.has(`${uid}_${target}`)) continue;
    out.push({ start: jstTime, summary });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function isoOf(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** DTSTARTのUTC/ローカル差を吸収してJSTの日付・時刻へ */
function toJst(yyyymmdd: string, hhmmss: string, isUtc: boolean): { jstDate: string; jstTime: string } {
  if (!isUtc) {
    return { jstDate: yyyymmdd, jstTime: `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}` };
  }
  const dt = new Date(Date.UTC(
    +yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8),
    +hhmmss.slice(0, 2), +hhmmss.slice(2, 4)
  ) + 9 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    jstDate: `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`,
    jstTime: `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`,
  };
}

/** EXDATE等の日付をイベントのTZ表現に合わせてJST日付へ(UTC表記なら+9h) */
function jstDateOf(ev: string, yyyymmdd: string): string {
  // EXDATEはDTSTARTと同形式で入るのが通例。UTC(Z)形式イベントはEXDATEもZ形式=日付は時刻込みで判断すべきだが、
  // 深夜レッスンは無い(JST日中のみ)ため日付+9hずれは実運用では発生しない。日付をそのまま使う。
  return yyyymmdd;
}

function icalDowToNum(d: string): number {
  return { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }[d.trim() as 'SU'] ?? -1;
}

/** iCalのBYDAYトークン('4SU'=第4日曜 / '-1SU'=最終日曜 / 'SU'=毎日曜)に対象日(YYYYMMDD)が該当するか */
function matchesMonthlyByDay(token: string, yyyymmdd: string): boolean {
  const mt = token.trim().match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
  if (!mt) return false;
  const ord = mt[1] ? parseInt(mt[1], 10) : 0; // 0 = 序数指定なし(毎週該当曜日)
  const dow = icalDowToNum(mt[2]);
  const y = +yyyymmdd.slice(0, 4), mo = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() !== dow) return false;
  if (ord === 0) return true;
  if (ord > 0) return Math.floor((d - 1) / 7) + 1 === ord; // 月初からn番目
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return Math.floor((daysInMonth - d) / 7) + 1 === -ord; // 月末からn番目
}
