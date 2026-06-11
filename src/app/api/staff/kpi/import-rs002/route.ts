import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDate } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/kpi/import-rs002
// CSVテキストをbodyに送る、または multipart/form-data でファイルアップロード
//
// HACOMONO RS002 のカラム名に対する完全一致マッチング。
// 注意(T-163): 以前は部分一致フォールバックがあり、「キャンセル数」検索が
//   「無断キャンセル数」カラムを誤ヒットして no_show_count == cancel_count に
//   なっていた(本番141行全件で破損)。RS002には純粋な「キャンセル数」カラムは
//   存在しない(無断キャンセル数=no_show / キャンセル待ち数=waitlist のみ)ため、
//   完全一致のみとし、該当無しは空文字(=null)を返す。
function pick(rec: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== '') return rec[k];
  }
  return '';
}

function parseInt0(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,円]/g, '').trim();
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

function parseRate(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[%％\s]/g, '').trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  // 70 → 0.7 に変換
  return n > 1.5 ? n / 100 : n;
}

function parseTimeHM(s: string): string {
  if (!s) return '';
  // 18:30 / 18:30:00 / 1830 等を HH:MM に
  const t = s.trim();
  if (/^\d{2}:\d{2}/.test(t)) return t.substring(0, 5);
  if (/^\d{4}$/.test(t)) return `${t.substring(0, 2)}:${t.substring(2, 4)}`;
  return t;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  let csvText = '';
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (file instanceof File) {
      const buf = await file.arrayBuffer();
      // まずUTF-8、文字化け多ければShift-JIS
      csvText = new TextDecoder('utf-8').decode(buf);
      if ((csvText.match(/�/g)?.length ?? 0) > 10) {
        csvText = new TextDecoder('shift-jis').decode(buf);
      }
    }
  } else {
    csvText = await req.text();
  }

  if (!csvText) return NextResponse.json({ error: 'CSV body required' }, { status: 400 });

  const rows = parseCSV(csvText);
  if (rows.length < 2) return NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 });

  const records = rowsToDicts(rows);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const rec of records) {
    try {
      const lessonDate = parseDate(pick(rec, 'レッスン日', '実施日', '日付'));
      const startTime = parseTimeHM(pick(rec, '開始時刻', '開始時間'));
      if (!lessonDate || !startTime) { skipped++; continue; }

      const endTime = parseTimeHM(pick(rec, '終了時刻', '終了時間'));
      const programCode = pick(rec, 'プログラムコード');
      const programName = pick(rec, 'プログラム名');
      const staffCode = pick(rec, 'スタッフコード');
      const staffName = pick(rec, 'スタッフ名', '担当スタッフ');
      const studioCode = pick(rec, '店舗コード', 'スペースコード');
      const studioName = pick(rec, '店舗名', 'スペース名');
      const capacity = parseInt0(pick(rec, 'スペース数', '定員', '最大予約数'));
      const totalRes = parseInt0(pick(rec, '総予約数', '予約数'));
      const checkin = parseInt0(pick(rec, 'チェックイン数'));
      const noshow = parseInt0(pick(rec, '無断キャンセル数'));
      const cancels = parseInt0(pick(rec, 'キャンセル数'));
      const waitlist = parseInt0(pick(rec, 'キャンセル待ち数'));
      const trial = parseInt0(pick(rec, 'トライアル予約数', '無料体験予約数'));
      let utilRate = parseRate(pick(rec, '稼働率'));
      // 稼働率が空なら計算: 予約数 / 定員
      if (utilRate === null && totalRes !== null && capacity && capacity > 0) {
        utilRate = totalRes / capacity;
      }

      await execute(
        `INSERT INTO lesson_utilization
         (lesson_date, start_time, end_time, program_code, program_name, staff_code, staff_name,
          studio_code, studio_name, capacity, total_reservations, checkin_count, no_show_count,
          cancel_count, waitlist_count, trial_count, utilization_rate, source, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rs002', CURRENT_TIMESTAMP)
         ON CONFLICT(lesson_date, start_time, program_code, staff_code) DO UPDATE SET
           end_time=excluded.end_time,
           program_name=excluded.program_name,
           staff_name=excluded.staff_name,
           studio_code=excluded.studio_code,
           studio_name=excluded.studio_name,
           capacity=excluded.capacity,
           total_reservations=excluded.total_reservations,
           checkin_count=excluded.checkin_count,
           no_show_count=excluded.no_show_count,
           cancel_count=excluded.cancel_count,
           waitlist_count=excluded.waitlist_count,
           trial_count=excluded.trial_count,
           utilization_rate=excluded.utilization_rate,
           imported_at=CURRENT_TIMESTAMP`,
        [lessonDate, startTime, endTime || null, programCode || null, programName || null,
         staffCode || null, staffName || null, studioCode || null, studioName || null,
         capacity, totalRes, checkin, noshow, cancels, waitlist, trial, utilRate]
      );
      imported++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      skipped++;
    }
  }

  return NextResponse.json({
    ok: true,
    total_rows: records.length,
    imported,
    skipped,
    errors: errors.slice(0, 5),
  });
}
