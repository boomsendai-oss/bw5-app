// 七ヶ浜レッスン会場の予約bot(別リポ shichigahama-yoyaku)からの通知を受け、
// ①真実カレンダー(boom.sendaiプライマリ)の当日「七ヶ浜」レッスン予定に会場を書き込み
// ②BOOMメールへ完了/失敗メール(予定リンク付き)を送る。認証はgoogleCalendar.tsと同じ保存済みrefresh_token。
import { google } from 'googleapis';
import { getOne } from './db';
import { sendEmail } from './email';

const REFRESH_TOKEN_KEY = 'google_calendar_refresh_token';
const NOTIFY_TO = 'boom.sendai@gmail.com';

export type VenueNotifyInput = {
  date: string;            // YYYY-MM-DD (JST)
  subject: string;         // メール件名(botが文面を決める)
  body: string;            // メール本文(末尾にカレンダーリンクを追記する)
  location?: string;       // 会場表記。指定時のみカレンダーの場所を更新
  match?: string;          // 予定タイトルの絞り込み語(既定「七ヶ浜」)
  dry_run?: boolean;       // trueなら書込みも送信もせず対象予定だけ返す
};
export type VenueNotifyEvent = { id: string; summary: string; start: string; location: string | null; htmlLink: string | null; updated: boolean };
export type VenueNotifyResult = { ok: true; events: VenueNotifyEvent[]; mailed: boolean; dry_run: boolean };

async function primaryCalendar() {
  const clientId = process.env.GOOGLE_CAL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CAL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GoogleカレンダーのクライアントIDが未設定');
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [REFRESH_TOKEN_KEY]);
  const refreshToken = row?.value as string | undefined;
  if (!refreshToken) throw new Error('Googleカレンダーのrefresh tokenが未保存');
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

export async function notifyVenueBooking(input: VenueNotifyInput): Promise<VenueNotifyResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('date は YYYY-MM-DD');
  const match = input.match ?? '七ヶ浜';
  const dryRun = !!input.dry_run;
  const cal = await primaryCalendar();
  const list = await cal.events.list({
    calendarId: 'primary',
    timeMin: `${input.date}T00:00:00+09:00`,
    timeMax: `${input.date}T23:59:59+09:00`,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });
  const targets = (list.data.items ?? []).filter((e) => (e.summary ?? '').includes(match) && e.status !== 'cancelled');
  const events: VenueNotifyEvent[] = [];
  for (const e of targets) {
    let updated = false;
    let htmlLink = e.htmlLink ?? null;
    let location = e.location ?? null;
    if (input.location && !dryRun && e.id && location !== input.location) {
      const res = await cal.events.patch({ calendarId: 'primary', eventId: e.id, requestBody: { location: input.location } });
      updated = true;
      htmlLink = res.data.htmlLink ?? htmlLink;
      location = res.data.location ?? input.location;
    }
    events.push({ id: e.id ?? '', summary: e.summary ?? '', start: e.start?.dateTime ?? e.start?.date ?? '', location, htmlLink, updated });
  }
  const links = events.map((ev) => `・${ev.start.slice(11, 16)} ${ev.summary}\n${ev.htmlLink ?? '(リンクなし)'}`).join('\n');
  const text = `${input.body}\n\n■ Googleカレンダー（${input.location ? '会場を記入済み' : '該当予定'}）\n${links || '（当日の該当予定が見つかりませんでした）'}\n\n— 七ヶ浜会場予約bot`;
  let mailed = false;
  if (!dryRun) {
    await sendEmail({ to: NOTIFY_TO, subject: input.subject, text });
    mailed = true;
  }
  return { ok: true, events, mailed, dry_run: dryRun };
}
