import { NextRequest, NextResponse } from 'next/server';
import { execute, batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDateTime } from '@/lib/csvUtil';
import type { InStatement } from '@libsql/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/staff/kpi/import-all-members
//   HACOMONO ML001(全メンバー)CSV を hacomono_all_members に全件洗い替えで取り込む(T-157/T-160)。
//   スナップショット方式: DELETE ALL → INSERT。
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
  if (rows.length < 2) return NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 });
  const dicts = rowsToDicts(rows);

  const v = (r: Record<string, string>, k: string) => (r[k] ?? '').trim();

  const records = dicts
    .map((r) => {
      const mid = v(r, 'メンバーID');
      if (!mid || !/^\d+$/.test(mid)) return null;
      return {
        hacomono_member_id: mid,
        kaiin_no: v(r, '会員番号') || null,
        full_name: v(r, '氏名') || null,
        full_name_kana: v(r, '氏名カナ') || null,
        has_email: v(r, 'メールアドレス') ? 1 : 0,
        permission_type: v(r, '権限タイプ') || null,
        rep_name: v(r, '代表氏名') || null,
        trial_received_at: parseDateTime(v(r, '無料体験会 受講日時')),
        enrolled_at: parseDateTime(v(r, '入会日時')),
        last_lesson_at: parseDateTime(v(r, '最終受講日時')),
        plan_code: v(r, '契約プランコード') || null,
        plan_name: v(r, '契約プラン名') || null,
        plan_started_at: parseDateTime(v(r, 'プラン契約日')),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  if (records.length === 0) {
    return NextResponse.json({ error: 'メンバーID を持つ行がありません' }, { status: 400 });
  }

  // 全件洗い替え
  await execute('DELETE FROM hacomono_all_members');
  const sql = `INSERT INTO hacomono_all_members
    (hacomono_member_id, kaiin_no, full_name, full_name_kana, has_email, permission_type,
     rep_name, trial_received_at, enrolled_at, last_lesson_at, plan_code, plan_name, plan_started_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const stmts: InStatement[] = records.map((r) => ({
    sql,
    args: [
      r.hacomono_member_id, r.kaiin_no, r.full_name, r.full_name_kana, r.has_email,
      r.permission_type, r.rep_name, r.trial_received_at, r.enrolled_at, r.last_lesson_at,
      r.plan_code, r.plan_name, r.plan_started_at,
    ],
  }));
  for (let i = 0; i < stmts.length; i += 100) {
    await batch(stmts.slice(i, i + 100));
  }

  return NextResponse.json({ ok: true, imported: records.length });
}
