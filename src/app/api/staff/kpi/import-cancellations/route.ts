import { NextRequest, NextResponse } from 'next/server';
import { batch, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDate } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/staff/kpi/import-cancellations
// HACOMONO RL005(固定枠:予約キャンセル処理一覧) CSV → hacomono_cancellations にUPSERT。
// daily_sync.py が当月+前月分を日次POSTする。
//
// なぜ要るか(2026-09-01): 予約一覧(RL001)にはキャンセル済みが載らない。
// これを見ないと「予約が無い」の意味が(未申込 / キャンセル済み)のどちらか分からず、
// 申込数を読み違える。実際にSHOKO WSで誤読が起きた。
// PII最小化: メール・生年月日・住所は取り込まない。
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

  // HACOMONOはエラー時にHTTP 200で管理画面のHTMLを返すことがある。
  // それをCSVとして食うと「0件成功」に化けるので明示的に弾く(2026-09-01実測)。
  if (csvText.trimStart().startsWith('<')) {
    return NextResponse.json(
      { error: 'CSVではなくHTMLが渡されました(HACOMONO側のエクスポート失敗の可能性)' },
      { status: 400 }
    );
  }

  const rows = parseCSV(csvText);
  if (rows.length < 2) return NextResponse.json({ ok: true, imported: 0, note: 'no data rows' });
  const records = rowsToDicts(rows, 0);

  if (!('キャンセル処理日' in (records[0] ?? {}))) {
    return NextResponse.json(
      { error: 'RL005(予約キャンセル処理一覧)のCSVではありません' },
      { status: 400 }
    );
  }

  const mem = (await getAll(
    `SELECT id, hacomono_member_id FROM boom_members WHERE hacomono_member_id IS NOT NULL`
  )) as { id: number; hacomono_member_id: string }[];
  const midMap = new Map(mem.map((r) => [String(r.hacomono_member_id), r.id]));

  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  let skipped = 0;
  for (const r of records) {
    // 「2026/08/29 14:13」形式。日付部分だけparseDateし、時刻は残す
    const rawCancelled = (r['キャンセル処理日'] ?? '').trim();
    const lessonDate = parseDate(r['レッスン日']);
    if (!rawCancelled || !lessonDate) { skipped++; continue; }
    const [datePart, timePart] = rawCancelled.split(/\s+/);
    const cancelledAt = [parseDate(datePart), timePart ?? ''].filter(Boolean).join(' ').trim();
    if (!cancelledAt) { skipped++; continue; }

    const mid = (r['メンバーID'] ?? '').trim();
    stmts.push({
      sql: `INSERT INTO hacomono_cancellations
        (cancelled_at, lesson_date, start_time, end_time, program_code, program_name,
         staff_name, hacomono_member_id, kaiin_no, full_name, boom_member_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(cancelled_at, hacomono_member_id, lesson_date, program_code) DO UPDATE SET
          full_name=excluded.full_name, boom_member_id=excluded.boom_member_id`,
      args: [
        cancelledAt,
        lessonDate,
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
