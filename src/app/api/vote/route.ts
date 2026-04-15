import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, batch } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const candidates = await getAll('SELECT * FROM vote_candidates ORDER BY sort_order ASC');

    // Check if fingerprint provided to return vote status
    const fp = req.nextUrl.searchParams.get('fingerprint');
    if (fp) {
      const existing = await getOne('SELECT candidate_id FROM vote_records WHERE fingerprint = ?', [fp]);
      return NextResponse.json({
        candidates,
        voted: !!existing,
        voted_candidate_id: existing?.candidate_id ?? null,
      });
    }

    return NextResponse.json({ candidates });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch vote candidates' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { candidate_id, fingerprint } = body;

    if (!fingerprint) {
      return NextResponse.json({ error: 'Fingerprint is required' }, { status: 400 });
    }

    // Check if this fingerprint already voted
    const existing = await getOne('SELECT * FROM vote_records WHERE fingerprint = ?', [fingerprint]);
    if (existing) {
      return NextResponse.json({ error: 'Already voted' }, { status: 409 });
    }

    // Check candidate exists
    const candidate = await getOne('SELECT * FROM vote_candidates WHERE id = ?', [candidate_id]);
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    // Cast vote in a batch (transaction)
    await batch([
      { sql: 'INSERT INTO vote_records (fingerprint, candidate_id) VALUES (?, ?)', args: [fingerprint, candidate_id] },
      { sql: 'UPDATE vote_candidates SET votes = votes + 1 WHERE id = ?', args: [candidate_id] },
    ], 'write');

    const candidates = await getAll('SELECT * FROM vote_candidates ORDER BY sort_order ASC');
    return NextResponse.json({ success: true, candidates });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to cast vote' }, { status: 500 });
  }
}
