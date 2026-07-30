import { NextRequest, NextResponse } from 'next/server';
import { batch, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDate } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 既定(15秒)では余裕が薄い。実測でこのrouteは約12秒かかる回があり、
// 行数が増えると既定値に当たって504になるため明示的に余裕を取る(2026-07-30)。
export const maxDuration = 60;

// POST /api/staff/kpi/import-reservations
// HACOMONO RL001(固定枠:予約一覧) CSV → hacomono_reservations にUPSERT (T-175)。
// daily_sync.py が当月+前月分を日次POSTする。予約IDキーなので再取込は冪等。
// PII最小化: メールアドレス・生年月日・住所系カラムは取り込まない。
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  let csvText = '';
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (file instanceof File) {
      const buf = await file.arrayBuffer();
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
  if (rows.length < 2) return NextResponse.json({ ok: true, imported: 0, note: 'no data rows' });
  const records = rowsToDicts(rows, 0);

  // boom_member_id 突合マップ
  const mem = (await getAll(
    `SELECT id, hacomono_member_id FROM boom_members WHERE hacomono_member_id IS NOT NULL`
  )) as { id: number; hacomono_member_id: string }[];
  const midMap = new Map(mem.map((r) => [String(r.hacomono_member_id), r.id]));

  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  let skipped = 0;
  for (const r of records) {
    const rid = (r['予約ID'] ?? '').trim();
    if (!rid || !/^\d+$/.test(rid)) { skipped++; continue; }
    const mid = (r['メンバーID'] ?? '').trim();
    stmts.push({
      sql: `INSERT INTO hacomono_reservations
        (reservation_id, status, booked_at, lesson_date, start_time, end_time,
         program_code, program_name, staff_name, hacomono_member_id, kaiin_no, full_name, boom_member_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(reservation_id) DO UPDATE SET
          status=excluded.status, lesson_date=excluded.lesson_date,
          boom_member_id=excluded.boom_member_id`,
      args: [
        Number(rid),
        (r['予約ステータス'] ?? '').trim(),
        parseDate(r['予約処理日']),
        parseDate(r['受講日']),
        (r['開始時刻'] ?? '').trim() || null,
        (r['終了時刻'] ?? '').trim() || null,
        (r['プログラムコード'] ?? '').trim() || null,
        (r['プログラム名'] ?? '').trim() || null,
        (r['スタッフ名'] ?? '').trim() || null,
        mid || null,
        (r['会員番号'] ?? '').trim() || null,
        (r['氏名'] ?? '').trim() || null,
        mid ? midMap.get(mid) ?? null : null,
      ],
    });
  }
  for (let i = 0; i < stmts.length; i += 100) {
    await batch(stmts.slice(i, i + 100));
  }
  return NextResponse.json({ ok: true, imported: stmts.length, skipped });
}
