import { NextRequest, NextResponse } from 'next/server';
import { buildLessonsForMonths, getOrCreateIcsExportToken, type ExportLesson } from '@/lib/scheduleExport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/schedule/export/ics?token=xxx&months=3
//
// 今月から指定月数分のレッスンを iCalendar (RFC 5545) で出力する。
// Googleカレンダーの「URLで予定を追加」で購読すれば自動同期できる。
//
// 認証: ICS購読はGoogleがCookieなしでGETするため、?token=xxx で認証する。
//       (settingsテーブルの ics_export_token と一致すれば返す。isAuthorizedとは別系統)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const expected = await getOrCreateIcsExportToken();
  if (!token || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized (invalid token)' }, { status: 401 });
  }

  const months = parseInt(url.searchParams.get('months') ?? '3', 10);
  const lessons = await buildLessonsForMonths(months);

  const ics = buildIcs(lessons);

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="boom-schedule.ics"',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

// ============================================
// iCalendar (RFC 5545) 生成
// ============================================

function buildIcs(lessons: ExportLesson[]): string {
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//BOOM Dance School//BW5 Schedule Export//JA');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push('X-WR-CALNAME:BOOMレッスンスケジュール');
  lines.push('X-WR-TIMEZONE:Asia/Tokyo');

  // VTIMEZONE (Asia/Tokyo は固定オフセット +0900・DSTなし)
  lines.push('BEGIN:VTIMEZONE');
  lines.push('TZID:Asia/Tokyo');
  lines.push('BEGIN:STANDARD');
  lines.push('DTSTART:19700101T000000');
  lines.push('TZOFFSETFROM:+0900');
  lines.push('TZOFFSETTO:+0900');
  lines.push('TZNAME:JST');
  lines.push('END:STANDARD');
  lines.push('END:VTIMEZONE');

  const dtstamp = formatUtcStamp(new Date());

  for (const l of lessons) {
    const dtstart = toLocalDateTime(l.date, l.start_time);
    const dtend = toLocalDateTime(l.date, l.end_time);
    if (!dtstart || !dtend) continue; // 時刻不正はスキップ

    const summary = `【${l.instructor_name ?? '未定'}】${l.class_name}`;
    const descParts: string[] = [];
    if (l.source === 'master' && l.frequency_type) descParts.push(`頻度: ${l.frequency_type}`);
    if (l.source === 'master') descParts.push('通常パターン (週次自動展開)');
    if (l.duration_minutes != null) descParts.push(`所要 ${l.duration_minutes}分`);
    if (l.status === 'cancelled') descParts.push('★この回は休講');
    if (l.notes) descParts.push(`メモ: ${l.notes}`);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${makeUid(l)}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=Asia/Tokyo:${dtstart}`);
    lines.push(`DTEND;TZID=Asia/Tokyo:${dtend}`);
    lines.push(foldLine(`SUMMARY:${escapeText(summary)}`));
    if (l.studio_name) lines.push(foldLine(`LOCATION:${escapeText(l.studio_name)}`));
    if (descParts.length > 0) lines.push(foldLine(`DESCRIPTION:${escapeText(descParts.join(' / '))}`));
    lines.push(`STATUS:${l.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // RFC 5545: 行区切りは CRLF
  return lines.join('\r\n') + '\r\n';
}

/** YYYY-MM-DD + HH:MM(:SS) -> ローカル日時 "YYYYMMDDTHHMMSS" (TZID=Asia/Tokyo 前提・UTC変換しない) */
function toLocalDateTime(date: string, time: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time ?? '');
  if (!dm || !tm) return null;
  const hh = String(parseInt(tm[1], 10)).padStart(2, '0');
  const mm = tm[2];
  const ss = tm[3] ?? '00';
  return `${dm[1]}${dm[2]}${dm[3]}T${hh}${mm}${ss}`;
}

/** UTCタイムスタンプ "YYYYMMDDTHHMMSSZ" (DTSTAMP用) */
function formatUtcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** 一意なUID: lesson-{master_id|inst-instance_id}-{date}@boom */
function makeUid(l: ExportLesson): string {
  const key = l.instance_id != null ? `inst-${l.instance_id}` : `master-${l.master_id ?? 'x'}`;
  return `lesson-${key}-${l.date}@boom`;
}

/** RFC 5545 TEXT エスケープ (\ , ; , 改行) */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/** RFC 5545 行折り返し (75オクテット上限。継続行は先頭スペース)。マルチバイト安全にバイト単位で折る。 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // UTF-8 連続バイト (0b10xxxxxx) の途中で切らないよう後退
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.subarray(start, end).toString('utf-8'));
    start = end;
    limit = 74; // 継続行は先頭スペース1文字分を引く
  }
  return chunks.join('\r\n ');
}
