import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { buildHacomonoExport, hacomonoResultToCsv } from '@/lib/hacomonoExport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/schedule/export/hacomono?months=1
//
// 今月から指定月数分のBW5レッスンを HACOMONO スケジュールインポート形式CSV
// (UTF-8 BOM付き) で出力する。
// 認証: isAuthorized (管理パスワード)。
//
// マッピング未解決の行はスキップせず該当コードを空欄でCSVに出力し、
// 警告件数をレスポンスヘッダ (X-Hacomono-Unresolved 等) で報告する。
//
// ?format=json を付けると、未解決サマリのJSONを返す (UIの事前チェック用)。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const months = parseInt(url.searchParams.get('months') ?? '1', 10);
  const format = url.searchParams.get('format');

  const result = await buildHacomonoExport(months);

  if (format === 'json') {
    return NextResponse.json(
      {
        rowCount: result.rows.length,
        matchedCount: result.matchedCount,
        unresolvedCount: result.unresolvedCount,
        unresolvedDetail: result.unresolvedDetail,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const csv = hacomonoResultToCsv(result);
  // UTF-8 BOM付き (HACOMONO/Excelの文字化け防止)
  const body = '﻿' + csv;

  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const filename = `hacomono_schedule_${stamp}.csv`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store, max-age=0',
      'X-Hacomono-Row-Count': String(result.rows.length),
      'X-Hacomono-Matched': String(result.matchedCount),
      'X-Hacomono-Unresolved': String(result.unresolvedCount),
    },
  });
}
