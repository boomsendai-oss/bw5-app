import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { buildLessonsForMonths, type ExportLesson } from '@/lib/scheduleExport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/schedule/export/csv?months=3
//
// 今月から指定月数分のレッスンを汎用CSV(UTF-8 BOM付き)で出力。
// HACOMONO/Lstep向け変換の素材になる中間形式。
// 認証: isAuthorized (管理パスワード)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const months = parseInt(url.searchParams.get('months') ?? '3', 10);
  const lessons = await buildLessonsForMonths(months);

  const csv = buildCsv(lessons);
  // UTF-8 BOM付き (Excelの文字化け防止)
  const body = '﻿' + csv;

  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const filename = `boom_schedule_${stamp}.csv`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

const HEADERS = [
  '日付',
  '曜日',
  '開始時刻',
  '終了時刻',
  'クラス名',
  'インストラクター',
  'スタジオ',
  'ステータス',
  '所要分',
];

function buildCsv(lessons: ExportLesson[]): string {
  const rows: string[] = [];
  rows.push(HEADERS.map(csvCell).join(','));
  for (const l of lessons) {
    rows.push(
      [
        l.date,
        DOW_LABELS[l.day_of_week] ?? '',
        hhmm(l.start_time),
        hhmm(l.end_time),
        l.class_name,
        l.instructor_name ?? '',
        l.studio_name ?? '',
        l.status === 'cancelled' ? '休講' : '開催',
        l.duration_minutes != null ? String(l.duration_minutes) : '',
      ]
        .map(csvCell)
        .join(',')
    );
  }
  // CSVは CRLF 区切り (RFC 4180)
  return rows.join('\r\n') + '\r\n';
}

/** HH:MM:SS -> HH:MM */
function hhmm(t: string | null): string {
  if (!t) return '';
  const m = /^(\d{1,2}:\d{2})/.exec(t);
  return m ? m[1] : t;
}

/** RFC 4180 セルエスケープ (", , 改行 を含む場合は " で囲み内部の " を 2重化) */
function csvCell(v: string): string {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
