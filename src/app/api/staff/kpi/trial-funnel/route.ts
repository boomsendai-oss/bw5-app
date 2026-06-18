import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/staff/kpi/trial-funnel
 *   体験→入会ファネル (T-157/T-160)。
 *   hacomono_all_members(全メンバー=会員登録した全員=体験来店者) を分類して、
 *   月額入会CVRを主KPIに、未契約の中身(重複/最近/離脱)も返す。
 *
 *   ★BOOMはHACOMONOのトライアル機能未使用＝「会員登録した＝体験に来た」とみなす。
 *   CVRの本命は「体験来店→月額会員」。チケットは月額なしのゆるい受け皿として別枠。
 */
type Row = {
  full_name: string | null;
  full_name_kana: string | null;
  rep_name: string | null;
  permission_type: string | null;
  enrolled_at: string | null;
  last_lesson_at: string | null;
  plan_code: string | null;
  plan_name: string | null;
};

function classify(plan: string): 'staff' | 'monthly' | 'ticket' | 'kyukai' | 'none' {
  const p = plan || '';
  if (!p.trim()) return 'none';
  if (p.includes('管理者') || p.includes('インストラクター')) return 'staff';
  if (p.includes('チケット')) return 'ticket';
  if (p.includes('休会')) return 'kyukai';
  return 'monthly'; // レギュラー / カレッジ 等
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const rows = (await getAll(
    `SELECT full_name, full_name_kana, rep_name, permission_type,
            enrolled_at, last_lesson_at, plan_code, plan_name
       FROM hacomono_all_members`
  )) as Row[];

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, empty: true, note: 'hacomono_all_members 未取込' });
  }

  // 契約者の代表氏名集合(保護者名義の重複検出に使用)
  const repNamesOfContracted = new Set(
    rows
      .filter((r) => (r.plan_code ?? '').trim())
      .map((r) => (r.rep_name ?? '').trim())
      .filter(Boolean)
  );

  const now = Date.now();
  const RECENT_DAYS = 30;

  let staff = 0, monthly = 0, ticket = 0, kyukai = 0;
  const noPlan: { name: string; kana: string; enrolled: string | null; last: string | null; kind: string }[] = [];

  for (const r of rows) {
    const cat = classify(r.plan_name ?? '');
    if (cat === 'staff') { staff++; continue; }
    if (cat === 'monthly') { monthly++; continue; }
    if (cat === 'ticket') { ticket++; continue; }
    if (cat === 'kyukai') { kyukai++; continue; }
    // 未契約 → 内訳分類
    const name = (r.full_name ?? '').trim();
    const hasLesson = !!(r.last_lesson_at ?? '').trim();
    const enrolled = r.enrolled_at;
    let kind: 'dup_suspect' | 'recent' | 'churned';
    if (!hasLesson && repNamesOfContracted.has(name)) {
      kind = 'dup_suspect'; // 受講なし＋誰かの保護者として登録 = 山下恵美子パターン
    } else if (enrolled && now - new Date(enrolled.replace(' ', 'T')).getTime() <= RECENT_DAYS * 86400000) {
      kind = 'recent'; // 30日以内に登録 = これから判定
    } else {
      kind = 'churned'; // 受講が止まった/古い = 離脱
    }
    noPlan.push({ name, kana: (r.full_name_kana ?? '').trim(), enrolled, last: r.last_lesson_at, kind });
  }

  const dupSuspect = noPlan.filter((x) => x.kind === 'dup_suspect').length;
  const recent = noPlan.filter((x) => x.kind === 'recent').length;
  const churned = noPlan.filter((x) => x.kind === 'churned').length;
  const noPlanTotal = noPlan.length;

  // 来店(会員登録した顧客) = 全体 - スタッフ
  const visited = rows.length - staff;
  // CVRの分母: 来店から「重複ノイズ」「判定中(最近30日)」を除いた確定母数
  const cvrBase = Math.max(1, visited - dupSuspect - recent);
  const monthlyCvr = (monthly / cvrBase) * 100; // ★主KPI
  const anyCvr = ((monthly + ticket) / cvrBase) * 100; // 参考(チケ込み)

  return NextResponse.json({
    ok: true,
    total_members: rows.length,
    staff_excluded: staff,
    visited, // 体験に来て会員登録した顧客
    breakdown: { monthly, ticket, kyukai, no_plan: noPlanTotal },
    no_plan_detail: { dup_suspect: dupSuspect, recent, churned },
    cvr_base: cvrBase,
    monthly_cvr: Number(monthlyCvr.toFixed(1)), // 体験→月額 (本命)
    any_contract_cvr: Number(anyCvr.toFixed(1)), // 体験→何か契約 (参考・甘い)
    // 重複疑い・離脱の実名リスト(クレンジング/幽霊整理用)
    dup_suspects: noPlan.filter((x) => x.kind === 'dup_suspect'),
    churned_list: noPlan.filter((x) => x.kind === 'churned'),
  });
}
