import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne, batch as dbBatch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, toCSVRow } from '@/lib/csvUtil';
import { encodeShiftJIS } from '@/lib/sjis';
import { transformLstepGrid } from '@/lib/lstepTransform';
import type { InStatement } from '@libsql/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Lstep 表示名更新「承認キュー」API
//
// POST  (multipart `lstep`)          : Lstepフルエクスポートから承認待ちバッチを新規作成
//                                       (既存openバッチはsupersededにする)
// POST  ?mode=confirm&batch_id=X      : 承認済み行を反映済(uploaded)にマーク
// GET                                 : 現在のopenバッチ＋変更一覧
// GET   ?mode=pending_upload          : 承認済み・未反映の件数/バッチ (Claudeがアップロード要否を判断)
// GET   ?mode=import_csv&batch_id=X    : 承認済み分だけのインポートCSV(cp932)を生成 (反映マークはしない)

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') ?? 'current';

  if (mode === 'pending_upload') {
    // 承認済みだが未反映の変更があるバッチ
    const rows = await getAll(
      `SELECT b.id as batch_id, b.created_at,
              COUNT(c.id) as approved_count
         FROM lstep_pending_batches b
         JOIN lstep_pending_changes c ON c.batch_id = b.id
        WHERE c.status = 'approved'
        GROUP BY b.id
        ORDER BY b.id DESC`
    );
    const total = rows.reduce((s, r) => s + Number(r.approved_count), 0);
    return NextResponse.json({ ok: true, pending_upload_total: total, batches: rows });
  }

  if (mode === 'import_csv') {
    const batchId = Number(url.searchParams.get('batch_id'));
    if (!Number.isInteger(batchId) || batchId <= 0) {
      return NextResponse.json({ error: 'batch_id が必要です' }, { status: 400 });
    }
    const b = (await getOne(`SELECT csv_text FROM lstep_pending_batches WHERE id = ?`, [batchId])) as
      | { csv_text: string }
      | null;
    if (!b) return NextResponse.json({ error: 'バッチが見つかりません' }, { status: 404 });

    const approved = (await getAll(
      `SELECT lstep_id FROM lstep_pending_changes WHERE batch_id = ? AND status = 'approved'`,
      [batchId]
    )) as { lstep_id: string }[];
    if (approved.length === 0) {
      return NextResponse.json({ error: '承認済みの変更がありません' }, { status: 400 });
    }
    const restrictTo = new Set(approved.map((r) => r.lstep_id));
    const grid = parseCSV(b.csv_text);
    const result = await transformLstepGrid(grid, { restrictTo });

    const lines = result.grid.map((row) => toCSVRow(row));
    const csv = lines.join('\r\n') + '\r\n';
    const sjis = encodeShiftJIS(csv);
    const ab = sjis.buffer.slice(sjis.byteOffset, sjis.byteOffset + sjis.byteLength) as ArrayBuffer;
    return new NextResponse(ab, {
      headers: {
        'Content-Type': 'text/csv; charset=shift_jis',
        'Content-Disposition': `attachment; filename="lstep_import_approved_${batchId}.csv"`,
        'X-Lstep-Approved-Rows': String(restrictTo.size),
      },
    });
  }

  // mode === 'current' : 最新のopenバッチ＋変更
  const b = (await getOne(
    `SELECT id, total_rows, target_rows, changed_rows, status, created_at
       FROM lstep_pending_batches
      WHERE status = 'open'
      ORDER BY id DESC LIMIT 1`
  )) as Record<string, unknown> | null;

  if (!b) {
    // openは無いが、承認済み未反映が残っていないかも返す
    const pu = await getAll(
      `SELECT COUNT(*) as c FROM lstep_pending_changes WHERE status = 'approved'`
    );
    return NextResponse.json({ ok: true, batch: null, pending_upload_total: Number(pu[0]?.c ?? 0) });
  }

  const changes = await getAll(
    `SELECT id, lstep_id, role, member_label, current_display, new_display, status
       FROM lstep_pending_changes
      WHERE batch_id = ?
      ORDER BY (status='approved') DESC, role, member_label`,
    [b.id]
  );
  const counts = {
    pending: changes.filter((c) => c.status === 'pending').length,
    approved: changes.filter((c) => c.status === 'approved').length,
    rejected: changes.filter((c) => c.status === 'rejected').length,
    uploaded: changes.filter((c) => c.status === 'uploaded').length,
  };
  return NextResponse.json({ ok: true, batch: b, changes, counts });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') ?? 'create';

  if (mode === 'confirm') {
    const batchId = Number(url.searchParams.get('batch_id'));
    if (!Number.isInteger(batchId) || batchId <= 0) {
      return NextResponse.json({ error: 'batch_id が必要です' }, { status: 400 });
    }
    const res = await execute(
      `UPDATE lstep_pending_changes SET status='uploaded', uploaded_at=CURRENT_TIMESTAMP
        WHERE batch_id = ? AND status = 'approved'`,
      [batchId]
    );
    const uploaded = Number(res.rowsAffected ?? 0);
    // 残りの未処理(pending/approved)が無ければバッチをuploadedに
    const remain = (await getOne(
      `SELECT COUNT(*) as c FROM lstep_pending_changes WHERE batch_id = ? AND status IN ('pending','approved')`,
      [batchId]
    )) as { c: number } | null;
    if (Number(remain?.c ?? 0) === 0) {
      await execute(
        `UPDATE lstep_pending_batches SET status='uploaded', updated_at=CURRENT_TIMESTAMP WHERE id = ?`,
        [batchId]
      );
    }
    try {
      await execute(
        `INSERT INTO lstep_update_log (action, updated_rows, note)
         VALUES ('upload_confirmed', ?, ?)`,
        [uploaded, JSON.stringify({ batch_id: batchId })]
      );
    } catch { /* ログ失敗は無視 */ }
    return NextResponse.json({ ok: true, uploaded });
  }

  // mode === 'create' : エクスポートCSVから承認待ちバッチを作る
  let csvText: string;
  const note = url.searchParams.get('note') ?? null;
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('lstep') as File | null;
      if (!file) return NextResponse.json({ error: 'multipart `lstep` が必要です' }, { status: 400 });
      csvText = new TextDecoder('shift-jis').decode(await file.arrayBuffer());
    } else {
      csvText = new TextDecoder('shift-jis').decode(await req.arrayBuffer());
    }
  } catch (e) {
    return NextResponse.json(
      { error: `CSV読み込み失敗: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }
  if (!csvText.trim()) return NextResponse.json({ error: '空のCSVです' }, { status: 400 });

  const grid = parseCSV(csvText);
  const result = await transformLstepGrid(grid);
  if (result.warnings.some((w) => w.includes('システム表示名'))) {
    return NextResponse.json(
      { error: 'フル友だちCSVではありません(システム表示名列が必要)', warnings: result.warnings },
      { status: 400 }
    );
  }

  const changed = result.changes.filter((c) => c.changed);
  if (changed.length === 0) {
    return NextResponse.json({
      ok: true,
      batch_id: null,
      message: '変更が必要な行はありません(すべて最新)',
      summary: { total: result.totalRows, target: result.targetRows, changed: 0 },
    });
  }

  // 既存openバッチをsupersededに
  await execute(`UPDATE lstep_pending_batches SET status='superseded', updated_at=CURRENT_TIMESTAMP WHERE status='open'`);

  const ins = await execute(
    `INSERT INTO lstep_pending_batches (csv_text, total_rows, target_rows, changed_rows, status, note)
     VALUES (?,?,?,?, 'open', ?)`,
    [csvText, result.totalRows, result.targetRows, changed.length, note]
  );
  const batchId = Number(ins.lastInsertRowid);

  const stmts: InStatement[] = changed.map((c) => ({
    sql: `INSERT INTO lstep_pending_changes (batch_id, lstep_id, role, member_label, current_display, new_display, status)
          VALUES (?,?,?,?,?,?, 'pending')`,
    args: [batchId, c.lstep_id, c.role, c.member_label, c.current_display, c.new_display],
  }));
  for (let i = 0; i < stmts.length; i += 50) await dbBatch(stmts.slice(i, i + 50));

  return NextResponse.json({
    ok: true,
    batch_id: batchId,
    summary: { total: result.totalRows, target: result.targetRows, changed: changed.length },
  });
}
