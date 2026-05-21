import { NextRequest, NextResponse } from 'next/server';
import { batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';

// 曜日テキスト -> 0..6 (日=0)
const DOW_MAP: Record<string, number> = {
  '日': 0, '日曜': 0, '日曜日': 0,
  '月': 1, '月曜': 1, '月曜日': 1,
  '火': 2, '火曜': 2, '火曜日': 2,
  '水': 3, '水曜': 3, '水曜日': 3,
  '木': 4, '木曜': 4, '木曜日': 4,
  '金': 5, '金曜': 5, '金曜日': 5,
  '土': 6, '土曜': 6, '土曜日': 6,
};

function pick(d: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (d[k] !== undefined && d[k] !== '') return d[k];
  }
  return '';
}

// POST /api/staff/schedule/upload-csv — multipart/form-data, field "file"
// 列: 曜日,開始時刻,終了時刻,クラス名,対象,場所,インストラクター[,備考]
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 });
  }
  const text = await (file as File).text();
  const rows = parseCSV(text);
  const dicts = rowsToDicts(rows);

  const inserts: { sql: string; args: (string | number | null)[] }[] = [];
  const errors: { line: number; reason: string }[] = [];
  let inserted = 0;

  dicts.forEach((d, i) => {
    const lineNo = i + 2; // header=1
    const dowText = pick(d, ['曜日', 'dow', 'day_of_week']).trim();
    const className = pick(d, ['クラス名', 'class_name', 'クラス']).trim();
    if (!className) {
      // 空行はスキップ
      if (Object.values(d).every((v) => !v)) return;
      errors.push({ line: lineNo, reason: 'クラス名 が空' });
      return;
    }
    const dow = DOW_MAP[dowText];
    if (dowText && dow === undefined) {
      errors.push({ line: lineNo, reason: `曜日不正: ${dowText}` });
      return;
    }
    inserts.push({
      sql: `INSERT INTO lesson_schedule
        (day_of_week, start_time, end_time, class_name, target, location, instructor, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      args: [
        dow ?? null,
        pick(d, ['開始時刻', 'start_time', '開始']) || null,
        pick(d, ['終了時刻', 'end_time', '終了']) || null,
        className,
        pick(d, ['対象', 'target']) || null,
        pick(d, ['場所', 'location', 'スタジオ']) || null,
        pick(d, ['インストラクター', 'instructor', '担当']) || null,
      ],
    });
    inserted++;
  });

  if (inserts.length > 0) {
    await batch(inserts, 'write');
  }

  return NextResponse.json({ ok: true, inserted, errors });
}
