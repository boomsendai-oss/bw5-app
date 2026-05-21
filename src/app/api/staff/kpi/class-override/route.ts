import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_CATEGORIES = ['new', 'watch', 'normal', 'exclude'] as const;

// GET /api/staff/kpi/class-override — 全 overrides を返す (UI拡張用)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const rows = await getAll(
    `SELECT program_name, category, launched_at, note, updated_at
     FROM class_kpi_overrides ORDER BY program_name`
  );
  return NextResponse.json({ overrides: rows });
}

// POST /api/staff/kpi/class-override — 分類上書きを UPSERT
// body: { program_name(必須), category?, launched_at?, note? }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const programName = typeof body.program_name === 'string' ? body.program_name.trim() : '';
  if (!programName) {
    return NextResponse.json({ error: 'program_name is required' }, { status: 400 });
  }

  // category は 'new'|'watch'|'normal'|'exclude'|null のみ許可
  let category: string | null = null;
  if (body.category != null && body.category !== '') {
    if (typeof body.category !== 'string' || !ALLOWED_CATEGORIES.includes(body.category as (typeof ALLOWED_CATEGORIES)[number])) {
      return NextResponse.json(
        { error: `category must be one of ${ALLOWED_CATEGORIES.join('|')} or null` },
        { status: 400 }
      );
    }
    category = body.category;
  }

  const launchedAt = typeof body.launched_at === 'string' && body.launched_at.trim() ? body.launched_at.trim() : null;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  await execute(
    `INSERT INTO class_kpi_overrides (program_name, category, launched_at, note, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(program_name) DO UPDATE SET
       category = excluded.category,
       launched_at = excluded.launched_at,
       note = excluded.note,
       updated_at = CURRENT_TIMESTAMP`,
    [programName, category, launchedAt, note]
  );

  return NextResponse.json({ ok: true, program_name: programName, category, launched_at: launchedAt, note });
}
