import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { buildLinkSuggestions, type Member as SuggestMember } from '@/lib/linkSuggest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/notifications/link-search?q=<search>&member_id=<id>
// - q: テキスト検索 (display_name, system_display_name, real_name, line_register_name)
// - member_id: 自動候補 (buildLinkSuggestions) を返す
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const params = req.nextUrl.searchParams;
  const q = (params.get('q') ?? '').trim();
  const memberIdStr = params.get('member_id');
  const memberId = memberIdStr ? Number(memberIdStr) : null;

  // --- 会員情報 + 自動候補 (member_id がある場合) ---
  let autoSuggestions: Awaited<ReturnType<typeof buildLinkSuggestions>> = [];
  let memberInfo: Record<string, unknown> | null = null;
  if (memberId && Number.isInteger(memberId) && memberId > 0) {
    const memberRow = await getOne(
      `SELECT id, hacomono_member_id, full_name, full_name_kana, status, plan_name
       FROM boom_members WHERE id = ?`,
      [memberId]
    );
    if (memberRow) {
      memberInfo = memberRow as Record<string, unknown>;
      const suggestMember = memberRow as SuggestMember;
      autoSuggestions = await buildLinkSuggestions([suggestMember]);
    }
  }

  // --- テキスト検索 ---
  type FriendRow = {
    lstep_id: string;
    display_name: string | null;
    system_display_name: string | null;
    real_name: string | null;
    line_register_name: string | null;
  };

  let searchResults: FriendRow[] = [];
  if (q.length >= 1) {
    const like = `%${q}%`;
    searchResults = (await getAll(
      `SELECT lstep_id, display_name, system_display_name, real_name, line_register_name
       FROM lstep_friends
       WHERE COALESCE(blocked, 0) = 0
         AND (display_name LIKE ? COLLATE NOCASE
           OR system_display_name LIKE ? COLLATE NOCASE
           OR real_name LIKE ? COLLATE NOCASE
           OR line_register_name LIKE ? COLLATE NOCASE)
       ORDER BY system_display_name ASC
       LIMIT 30`,
      [like, like, like, like]
    )) as FriendRow[];
  }

  return NextResponse.json({
    ok: true,
    member: memberInfo,
    auto_suggestions: autoSuggestions.length > 0 ? autoSuggestions[0].candidates : [],
    search_results: searchResults,
  });
}
