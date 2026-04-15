import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const candidates = db.prepare('SELECT * FROM vote_candidates ORDER BY sort_order ASC').all();
    return NextResponse.json(candidates);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch vote candidates' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { candidate_id, fingerprint } = body;

    if (!fingerprint) {
      return NextResponse.json({ error: 'Fingerprint is required' }, { status: 400 });
    }

    // Check if this fingerprint already voted
    const existing = db.prepare('SELECT * FROM vote_records WHERE fingerprint = ?').get(fingerprint);
    if (existing) {
      return NextResponse.json({ error: 'Already voted' }, { status: 409 });
    }

    // Check candidate exists
    const candidate = db.prepare('SELECT * FROM vote_candidates WHERE id = ?').get(candidate_id);
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    // Cast vote in a transaction
    const castVote = db.transaction(() => {
      db.prepare('INSERT INTO vote_records (fingerprint, candidate_id) VALUES (?, ?)').run(fingerprint, candidate_id);
      db.prepare('UPDATE vote_candidates SET votes = votes + 1 WHERE id = ?').run(candidate_id);
    });

    castVote();

    const candidates = db.prepare('SELECT * FROM vote_candidates ORDER BY sort_order ASC').all();
    return NextResponse.json({ success: true, candidates });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to cast vote' }, { status: 500 });
  }
}
