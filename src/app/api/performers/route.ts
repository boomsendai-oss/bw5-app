import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/performers?q=佐藤  — search by performer name
// GET /api/performers?m_id=M2 — get performers for a specific performance
// GET /api/performers          — get all performers grouped by m_id
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  const mId = req.nextUrl.searchParams.get('m_id');

  if (q) {
    // Search performers by name (partial match)
    const rows = await getAll(
      `SELECT p.name, p.m_id, p.sort_order,
              pf.title, pf.instructor, pf.part, pf.genre
       FROM performers p
       JOIN performances pf ON p.m_id = pf.m_id
       WHERE p.name LIKE ?
       ORDER BY pf.part ASC, CAST(SUBSTR(p.m_id, 2) AS INTEGER) ASC, p.sort_order ASC`,
      [`%${q}%`]
    );
    return NextResponse.json(rows);
  }

  if (mId) {
    // Get performers for a specific performance
    const rows = await getAll(
      `SELECT name, sort_order FROM performers WHERE m_id = ? ORDER BY sort_order ASC`,
      [mId]
    );
    return NextResponse.json(rows);
  }

  // All performers with their performance info
  const rows = await getAll(
    `SELECT p.name, p.m_id, p.sort_order,
            pf.title, pf.part
     FROM performers p
     JOIN performances pf ON p.m_id = pf.m_id
     ORDER BY pf.part ASC, CAST(SUBSTR(p.m_id, 2) AS INTEGER) ASC, p.sort_order ASC`
  );
  return NextResponse.json(rows);
}
