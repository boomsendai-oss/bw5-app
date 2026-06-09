import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, toCSV, toCSVRow } from '@/lib/csvUtil';
import { encodeShiftJIS } from '@/lib/sjis';
import { transformLstepGrid } from '@/lib/lstepTransform';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/operations/download?type=ticket|monthly|unmatched|lstep_import
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? '';

  if (type === 'ticket' || type === 'monthly') {
    const kw = type === 'ticket' ? '%チケット%' : '%マンスリー%';
    const rows = (await getAll(
      `SELECT hacomono_member_id, hacomono_kaiin_no, full_name, full_name_kana,
              plan_code, plan_name, plan_started_at, plan_continued_months,
              enrolled_at, status
       FROM boom_members
       WHERE plan_name LIKE ? AND status = 'active'
       ORDER BY full_name_kana ASC`,
      [kw]
    )) as Record<string, string | null>[];

    const header = [
      'メンバーID',
      '会員番号',
      '氏名',
      '氏名カナ',
      'プランコード',
      'プラン名',
      'プラン開始日',
      'プラン継続期間',
      '入会日時',
      'ステータス',
    ];
    const body = rows.map((r) => [
      r.hacomono_member_id,
      r.hacomono_kaiin_no,
      r.full_name,
      r.full_name_kana,
      r.plan_code,
      r.plan_name,
      r.plan_started_at,
      r.plan_continued_months,
      r.enrolled_at,
      r.status,
    ]);
    const csv = '﻿' + toCSV([header, ...body]);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${type}_members.csv"`,
      },
    });
  }

  if (type === 'unmatched') {
    // Lstep に存在するが member_lstep_links に紐付け無いユーザー
    const rows = (await getAll(
      `SELECT lf.lstep_id, lf.display_name, lf.system_display_name,
              lf.line_register_name, lf.real_name, lf.last_message_at, lf.blocked
       FROM lstep_friends lf
       LEFT JOIN member_lstep_links ml ON ml.lstep_id = lf.lstep_id
       WHERE ml.id IS NULL
       ORDER BY lf.last_message_at DESC NULLS LAST`
    )) as Record<string, string | number | null>[];

    const header = [
      'Lstep_ID',
      '表示名',
      'システム表示名',
      'LINE登録名',
      '本名',
      '最終メッセージ日時',
      'ブロック',
    ];
    const body = rows.map((r) => [
      r.lstep_id,
      r.display_name,
      r.system_display_name,
      r.line_register_name,
      r.real_name,
      r.last_message_at,
      r.blocked,
    ]);
    const csv = '﻿' + toCSV([header, ...body]);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lstep_unmatched.csv"`,
      },
    });
  }

  if (type === 'lstep_import') {
    // Lstep 管理画面 UPLOAD 形式 (cp932, 2行ヘッダー、56列)
    //
    // 戦略: 最後にUPLOADされた Lstep CSV原本(snapshot)をベースに、
    // 該当行・該当セルだけを差分更新して cp932で返す。
    // (Lstep制約: 「エクスポートCSVをそのまま使え」「左1列・上1〜2行触らない」を満たす)
    //
    // 注意: snapshot が daily_sync の軽量CSV(ID+表示名の2列)だと
    // システム表示名列が無く変換できない。その場合は lstep-transform に
    // フルエクスポートCSVを直接POSTする運用を推奨。
    const snap = (await getOne(
      `SELECT csv_text FROM lstep_csv_snapshots ORDER BY id DESC LIMIT 1`
    )) as { csv_text: string } | null;
    if (!snap || !snap.csv_text) {
      return NextResponse.json(
        { error: 'Lstep CSVのスナップショットがありません。先に突合(/api/staff/operations/sync)を実行してください。' },
        { status: 400 }
      );
    }

    const grid = parseCSV(snap.csv_text);
    const result = await transformLstepGrid(grid);
    const fatal = result.warnings.find((w) => w.includes('システム表示名'));
    if (fatal) {
      return NextResponse.json(
        {
          error: 'スナップショットがフル友だちCSVではありません',
          warnings: result.warnings,
          hint: 'Lstepのフルエクスポートを /api/staff/operations/lstep-transform に直接POSTしてください。',
        },
        { status: 400 }
      );
    }

    const lines = result.grid.map((row) => toCSVRow(row));
    const csv = lines.join('\r\n') + '\r\n';
    const sjisBytes = encodeShiftJIS(csv);
    const ab = sjisBytes.buffer.slice(sjisBytes.byteOffset, sjisBytes.byteOffset + sjisBytes.byteLength) as ArrayBuffer;
    return new NextResponse(ab, {
      headers: {
        'Content-Type': 'text/csv; charset=shift_jis',
        'Content-Disposition': `attachment; filename="lstep_import_diff.csv"`,
        'X-Lstep-Updated-Rows': String(result.updatedRows),
      },
    });
  }

  return NextResponse.json({ error: 'invalid type' }, { status: 400 });
}
