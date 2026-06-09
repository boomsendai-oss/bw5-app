import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, toCSVRow } from '@/lib/csvUtil';
import { encodeShiftJIS } from '@/lib/sjis';
import { transformLstepGrid } from '@/lib/lstepTransform';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/staff/operations/lstep-transform
//   直近の Lstep 更新ログ(lstep_update_log)を返す (履歴表示用)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const rows = await getAll(
    `SELECT id, action, target_rows, updated_rows, total_rows, created_at
     FROM lstep_update_log
     ORDER BY id DESC
     LIMIT 30`
  );
  return NextResponse.json({ ok: true, log: rows });
}

// POST /api/staff/operations/lstep-transform?mode=preview|csv
//
// Lstep 管理画面でエクスポートしたフル友だちCSV(cp932) を受け取り、
// member_lstep_links を元にシステム表示名を再生成する。
//   mode=preview (既定): 変更内容を JSON で返す (アップロード前の目視確認用)
//   mode=csv          : Lstep の CSVインポートにそのまま流せる cp932 CSV を返す
//
// daily_sync のスナップショットに依存せず、その場で渡されたCSVを変換するので
// 常に最新のLstepエクスポートをベースにできるN(=鮮度100%)。
//
// 入力: multipart/form-data の `lstep` フィールド (File, cp932)
//       または text/csv の生ボディ
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') === 'csv' ? 'csv' : 'preview';

  // --- 入力CSVの読み込み (cp932) ---
  let csvText: string;
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('lstep') as File | null;
      if (!file) {
        return NextResponse.json(
          { error: 'multipart の `lstep` フィールド(LstepフルCSV)が必要です' },
          { status: 400 }
        );
      }
      csvText = new TextDecoder('shift-jis').decode(await file.arrayBuffer());
    } else {
      // 生ボディ: cp932 として解釈
      const buf = await req.arrayBuffer();
      csvText = new TextDecoder('shift-jis').decode(buf);
    }
  } catch (e) {
    return NextResponse.json(
      { error: `CSV読み込み(shift-jis)失敗: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: '空のCSVです' }, { status: 400 });
  }

  // --- 変換 ---
  const grid = parseCSV(csvText);
  const result = await transformLstepGrid(grid);

  // フルエクスポートでない (システム表示名列が無い) 場合はここで止める
  const hasFatalWarning = result.warnings.some((w) => w.includes('システム表示名'));
  if (hasFatalWarning) {
    return NextResponse.json(
      {
        error: 'フル友だちCSVではありません',
        warnings: result.warnings,
        hint: 'Lstep管理画面「友だちリスト → CSV操作 → CSVエクスポート」のフルCSV(56列)を使用してください。',
      },
      { status: 400 }
    );
  }

  if (mode === 'preview') {
    // 変更が発生する行を優先で返す
    const changedFirst = [...result.changes].sort(
      (a, b) => Number(b.changed) - Number(a.changed)
    );
    return NextResponse.json({
      ok: true,
      summary: {
        total_rows: result.totalRows,
        target_rows: result.targetRows, // 紐付けあり=更新対象
        updated_rows: result.updatedRows, // 実際に表示名が変わる行
        unchanged_rows: result.targetRows - result.updatedRows,
      },
      warnings: result.warnings,
      changes: changedFirst,
    });
  }

  // mode === 'csv' : Lstep インポート用 cp932 CSV を返す
  const lines = result.grid.map((row) => toCSVRow(row));
  const outCsv = lines.join('\r\n') + '\r\n';
  const sjisBytes = encodeShiftJIS(outCsv);
  const ab = sjisBytes.buffer.slice(
    sjisBytes.byteOffset,
    sjisBytes.byteOffset + sjisBytes.byteLength
  ) as ArrayBuffer;

  // 生成ログを残す (アップロードはブラウザ側で行うため「生成」を記録)
  try {
    await execute(
      `INSERT INTO lstep_update_log (action, target_rows, updated_rows, total_rows, note)
       VALUES ('generate_csv', ?, ?, ?, ?)`,
      [
        result.targetRows,
        result.updatedRows,
        result.totalRows,
        JSON.stringify(result.changes.filter((c) => c.changed).slice(0, 500)),
      ]
    );
  } catch (e) {
    console.error('[lstep-transform] lstep_update_log INSERT failed:', e);
  }

  return new NextResponse(ab, {
    headers: {
      'Content-Type': 'text/csv; charset=shift_jis',
      'Content-Disposition': `attachment; filename="lstep_import_ready.csv"`,
      'X-Lstep-Target-Rows': String(result.targetRows),
      'X-Lstep-Updated-Rows': String(result.updatedRows),
    },
  });
}
