import { NextRequest, NextResponse } from 'next/server';
import { getAll, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

// 共通：候補一覧を取得して返す
async function fetchCandidates() {
  return await getAll('SELECT * FROM vote_candidates ORDER BY sort_order ASC, id ASC');
}

// GET /api/votes — 全候補の取得
export async function GET() {
  try {
    const candidates = await fetchCandidates();
    return NextResponse.json(candidates);
  } catch (e) {
    console.error('[votes] GET failed', e);
    return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 });
  }
}

// POST /api/votes — 管理操作（admin tab から呼ばれる）
// body: { action: 'update_candidate' | 'add_candidate' | 'delete_candidate' | 'reset', ... }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body?.action;

    if (action === 'update_candidate') {
      const id = Number(body.id);
      const name = String(body.name ?? '').trim();
      if (!id || !name) {
        return NextResponse.json({ error: 'id と name は必須です' }, { status: 400 });
      }
      await execute('UPDATE vote_candidates SET name = ? WHERE id = ?', [name, id]);
      return NextResponse.json(await fetchCandidates());
    }

    if (action === 'add_candidate') {
      const name = String(body.name ?? '').trim();
      if (!name) {
        return NextResponse.json({ error: 'name は必須です' }, { status: 400 });
      }
      const row = await getAll('SELECT COALESCE(MAX(sort_order), 0) AS m FROM vote_candidates');
      const nextOrder = Number(row?.[0]?.m ?? 0) + 1;
      await execute(
        'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)',
        [name, nextOrder]
      );
      return NextResponse.json(await fetchCandidates());
    }

    if (action === 'delete_candidate') {
      const id = Number(body.id);
      if (!id) {
        return NextResponse.json({ error: 'id は必須です' }, { status: 400 });
      }
      // 関連する投票記録も削除（孤児レコード防止）
      await execute('DELETE FROM vote_records WHERE candidate_id = ?', [id]);
      await execute('DELETE FROM vote_candidates WHERE id = ?', [id]);
      return NextResponse.json(await fetchCandidates());
    }

    if (action === 'reset') {
      // 投票数を0にリセット + 投票記録を全削除（再投票可能に）
      await execute('UPDATE vote_candidates SET votes = 0', []);
      await execute('DELETE FROM vote_records', []);
      return NextResponse.json(await fetchCandidates());
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[votes] POST failed', e);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
