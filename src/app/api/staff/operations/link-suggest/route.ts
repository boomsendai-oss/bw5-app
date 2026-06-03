import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { buildLinkSuggestions, type Member as SuggestMember } from '@/lib/linkSuggest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/staff/operations/link-suggest
//   未紐付け(member_lstep_links が無い)の在籍会員すべてについて、
//   体験予約データ(友だちID + カナ名)を主軸に紐付け候補を一括計算して返す。
//   日次syncは新規入会者のみを対象にするため、既存の未紐付けバックログを
//   解消するための画面ボタン用エンドポイント。
//
// query:
//   limit (任意, 既定 500)
//   include_withdrew=1 で退会者も含める (既定は在籍のみ)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') ?? 500)));
  const includeWithdrew = url.searchParams.get('include_withdrew') === '1';

  const statusCond = includeWithdrew ? '' : `AND m.status = 'active'`;
  const members = (await getAll(
    `SELECT m.id, m.hacomono_member_id, m.full_name, m.full_name_kana
       FROM boom_members m
       LEFT JOIN member_lstep_links ml ON ml.member_id = m.id
      WHERE ml.id IS NULL ${statusCond}
      ORDER BY m.enrolled_at DESC
      LIMIT ?`,
    [limit]
  )) as SuggestMember[];

  const suggestions = await buildLinkSuggestions(members);
  // 候補が1件以上あるものだけ返す (ノイズ削減)
  const withCandidates = suggestions.filter((s) => s.candidates.length > 0);

  return NextResponse.json({
    ok: true,
    summary: {
      unlinked_members: members.length,
      with_candidates: withCandidates.length,
      without_candidates: members.length - withCandidates.length,
    },
    link_suggestions: withCandidates,
  });
}
