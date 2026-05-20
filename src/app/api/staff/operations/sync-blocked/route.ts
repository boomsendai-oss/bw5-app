import { NextRequest, NextResponse } from 'next/server';
import { getAll, batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/staff/operations/sync-blocked
//
// Lstep 全件 CSV (CP932, 2行ヘッダー) を受け取り、
// lstep_friends の `blocked` 列だけを lstep_id をキーに更新する。
//
// 全体同期 (/operations/sync) は HACOMONO 3CSV が揃わないと実行できず、
// boom_members まで書き換えてしまうため、ブロック状態だけを安全に
// 反映したい場合はこのエンドポイントを使う。
//
// - 新規行の INSERT はしない (既存 lstep_friends の blocked のみ UPDATE)
// - display_name / member_lstep_links 等、他の列・テーブルには一切触れない
// - 認証必須 (x-admin-password / staff_events_auth cookie)
//
// multipart/form-data:
//   lstep : Lstep 全件 CSV (CP932, 2行ヘッダー)
// または text/plain で CSV 本文を直接送る (CP932 を呼び出し側で UTF-8 化済みの場合)
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  try {
    return await handleSyncBlocked(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `blocked同期エラー: ${msg}` }, { status: 500 });
  }
}

function isBlocked(raw: string): boolean {
  const v = (raw ?? '').trim();
  // Lstep CSV の「ユーザーブロック」列は通常 '0' / '1'。
  // 表記揺れにも備えて複数パターンを許容する。
  return ['1', 'ブロック', 'ブロック中', 'TRUE', 'true', 'yes', 'Yes'].includes(v);
}

async function handleSyncBlocked(req: NextRequest) {
  let lstepText = '';
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'multipart/form-data の解析に失敗しました' }, { status: 400 });
    }
    const lstepFile = form.get('lstep');
    if (!(lstepFile instanceof File)) {
      return NextResponse.json({ error: 'lstep フィールド (CSVファイル) が必要です' }, { status: 400 });
    }
    const buf = await lstepFile.arrayBuffer();
    // Lstep CSV は CP932 (Shift-JIS)。UTF-8 で文字化けが多ければ shift-jis にフォールバック。
    lstepText = new TextDecoder('shift-jis').decode(buf);
  } else {
    // text/plain など: 呼び出し側で UTF-8 化済みの CSV 本文を受け取る
    lstepText = await req.text();
  }

  if (!lstepText.trim()) {
    return NextResponse.json({ error: 'Lstep CSV 本文が空です' }, { status: 400 });
  }

  // 2行ヘッダー → ヘッダー行 index = 1
  const lstepRows = rowsToDicts(parseCSV(lstepText), 1).filter((r) => {
    const id = (r['ID'] ?? '').trim();
    return id && /^\d+$/.test(id);
  });

  if (lstepRows.length === 0) {
    return NextResponse.json(
      { error: 'CSV から有効な行を読み取れませんでした (ヘッダー2行/ID列を確認)' },
      { status: 400 }
    );
  }

  if (!('ユーザーブロック' in lstepRows[0])) {
    return NextResponse.json(
      { error: '「ユーザーブロック」列が見つかりません (Lstep 全件 CSV か確認してください)' },
      { status: 400 }
    );
  }

  // CSV 上の blocked 状態を集計
  const csvBlocked = new Map<string, number>();
  let csvBlockedCount = 0;
  for (const r of lstepRows) {
    const lid = (r['ID'] ?? '').trim();
    const b = isBlocked(r['ユーザーブロック'] ?? '') ? 1 : 0;
    csvBlocked.set(lid, b);
    if (b === 1) csvBlockedCount++;
  }

  // 既存 lstep_friends の lstep_id 集合 (UPDATE 対象を既存行に限定)
  const existing = (await getAll(`SELECT lstep_id FROM lstep_friends`)) as { lstep_id: string }[];
  const existingIds = new Set(existing.map((r) => r.lstep_id));

  // 既存行のうち CSV に存在するものだけ blocked を UPDATE
  const statements = [];
  let matched = 0;
  let notInDb = 0;
  for (const [lid, blocked] of csvBlocked) {
    if (!existingIds.has(lid)) {
      notInDb++;
      continue;
    }
    matched++;
    statements.push({
      sql: `UPDATE lstep_friends SET blocked = ?, updated_at = CURRENT_TIMESTAMP WHERE lstep_id = ?`,
      args: [blocked, lid] as (string | number)[],
    });
  }

  for (let i = 0; i < statements.length; i += 50) {
    await batch(statements.slice(i, i + 50));
  }

  // 反映後の集計
  const after = (await getAll(
    `SELECT
       SUM(CASE WHEN blocked = 0 THEN 1 ELSE 0 END) AS not_blocked,
       SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) AS blocked,
       COUNT(*) AS total
     FROM lstep_friends`
  )) as { not_blocked: number; blocked: number; total: number }[];

  return NextResponse.json({
    ok: true,
    csv_rows: lstepRows.length,
    csv_blocked: csvBlockedCount,
    updated: matched,
    csv_ids_not_in_db: notInDb,
    lstep_friends_after: after[0] ?? null,
  });
}
