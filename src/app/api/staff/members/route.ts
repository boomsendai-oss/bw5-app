import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

// GET /api/staff/members?q=<検索文字列>
// 会員一覧 + 紐付いているLstep情報を返す
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  // プランフィルタ: 'ticket' | 'monthly' | '' (全部)
  const planFilter = (url.searchParams.get('plan') ?? '').trim();

  // ひらがな→カタカナ、カタカナ→ひらがな 両方生成して両キーでマッチ
  const toKatakana = (s: string) =>
    s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const toHiragana = (s: string) =>
    s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const qKana = q ? toKatakana(q) : '';
  const qHira = q ? toHiragana(q) : '';

  type MemberRow = {
    id: number;
    hacomono_member_id: string;
    hacomono_kaiin_no: string | null;
    full_name: string;
    full_name_kana: string;
    birthday: string | null;
    email: string | null;
    phone: string | null;
    enrolled_at: string | null;
    withdrew_at: string | null;
    status: string;
    plan_code: string | null;
    plan_name: string | null;
    plan_started_at: string | null;
    plan_continued_months: string | null;
  };

  // プラン条件
  const planCond =
    planFilter === 'ticket'
      ? "AND plan_name LIKE '%チケット%'"
      : planFilter === 'monthly'
        ? "AND (plan_name LIKE '%レギュラー%' OR plan_name LIKE '%マンスリー%' OR plan_name LIKE '%カレッジ%')"
        : planFilter === 'kyukai'
          ? "AND plan_name LIKE '%休会%'"
          : '';

  let members: MemberRow[];
  if (q) {
    const like = `%${q}%`;
    const likeKana = `%${qKana}%`;
    const likeHira = `%${qHira}%`;
    members = (await getAll(
      `SELECT * FROM boom_members
       WHERE (full_name_kana LIKE ?
          OR full_name_kana LIKE ?
          OR full_name_kana LIKE ?
          OR full_name LIKE ?
          OR full_name LIKE ?
          OR full_name LIKE ?
          OR hacomono_kaiin_no LIKE ?)
          ${planCond}
       ORDER BY status ASC, full_name_kana ASC
       LIMIT 500`,
      [like, likeKana, likeHira, like, likeKana, likeHira, like]
    )) as MemberRow[];
  } else {
    members = (await getAll(
      `SELECT * FROM boom_members WHERE 1=1 ${planCond} ORDER BY status ASC, full_name_kana ASC LIMIT 500`
    )) as MemberRow[];
  }

  if (members.length === 0) {
    return NextResponse.json({ members: [] });
  }

  // 紐付いているLstep一覧をまとめて取得
  const ids = members.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  type LinkRow = {
    member_id: number;
    lstep_id: string;
    relation: string;
    confidence: string | null;
    display_name: string | null;
    system_display_name: string | null;
    line_register_name: string | null;
    real_name: string | null;
    role: string | null;
    blocked: number;
  };
  const links = (await getAll(
    `SELECT ml.member_id, ml.lstep_id, ml.relation, ml.confidence,
            lf.display_name, lf.system_display_name, lf.line_register_name,
            lf.real_name, lf.role, lf.blocked
     FROM member_lstep_links ml
     LEFT JOIN lstep_friends lf ON lf.lstep_id = ml.lstep_id
     WHERE ml.member_id IN (${placeholders})`,
    ids
  )) as LinkRow[];

  const linksByMember = new Map<number, LinkRow[]>();
  for (const l of links) {
    const arr = linksByMember.get(l.member_id) ?? [];
    arr.push(l);
    linksByMember.set(l.member_id, arr);
  }

  const enriched = members.map((m) => ({
    ...m,
    lstep_links: linksByMember.get(m.id) ?? [],
  }));

  return NextResponse.json({ members: enriched });
}
