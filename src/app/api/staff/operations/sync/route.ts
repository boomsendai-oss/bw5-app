import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDate, parseDateTime } from '@/lib/csvUtil';
import { buildLinkSuggestions, type Member as SuggestMember } from '@/lib/linkSuggest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/staff/operations/sync
// multipart/form-data:
//   hacomono_active : HACOMONO 契約中 CSV (UTF-8 BOM)
//   hacomono_withdrew: HACOMONO 退会 CSV (UTF-8 BOM)
//   lstep           : Lstep 全件 CSV (CP932, 2行ヘッダー)
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  try {
    return await handleSync(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    return NextResponse.json(
      { error: `突合エラー: ${msg}`, stack: stack?.split('\n').slice(0, 5).join('\n') },
      { status: 500 }
    );
  }
}

async function handleSync(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-data が必要です' }, { status: 400 });
  }

  const activeFile = form.get('hacomono_active') as File | null;
  const withdrewFile = form.get('hacomono_withdrew') as File | null;
  const lstepFile = form.get('lstep') as File | null;

  if (!activeFile || !withdrewFile || !lstepFile) {
    return NextResponse.json(
      { error: '3つのCSV (hacomono_active, hacomono_withdrew, lstep) を全て指定してください' },
      { status: 400 }
    );
  }

  // --- 読み込み (HACOMONO=UTF-8 BOM, Lstep=CP932) ---
  const activeText = new TextDecoder('utf-8').decode(await activeFile.arrayBuffer());
  const withdrewText = new TextDecoder('utf-8').decode(await withdrewFile.arrayBuffer());
  let lstepText: string;
  try {
    lstepText = new TextDecoder('shift-jis').decode(await lstepFile.arrayBuffer());
  } catch (e) {
    throw new Error(`Lstep CSV decode (shift-jis) 失敗: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Lstep CSV全文をスナップショット保存 (ダウンロード時にベースとして使う)
  try {
    await execute(`INSERT INTO lstep_csv_snapshots (csv_text) VALUES (?)`, [lstepText]);
  } catch (e) {
    // 保存失敗は致命的ではないのでログだけ
    console.error('[sync] lstep_csv_snapshots INSERT failed:', e);
  }

  let activeRows: Record<string, string>[];
  let withdrewRows: Record<string, string>[];
  let lstepRows: Record<string, string>[];
  try {
    activeRows = rowsToDicts(parseCSV(activeText), 0);
    withdrewRows = rowsToDicts(parseCSV(withdrewText), 0);
    lstepRows = rowsToDicts(parseCSV(lstepText), 1).filter((r) => {
      const id = (r['ID'] ?? '').trim();
      return id && /^\d+$/.test(id);
    });
  } catch (e) {
    throw new Error(`CSV parse 失敗: ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- 既存DB取得 ---
  type ExistingMember = {
    id: number;
    hacomono_member_id: string;
    plan_code: string | null;
    plan_name: string | null;
    status: string;
  };
  const existingMembers = (await getAll(
    `SELECT id, hacomono_member_id, plan_code, plan_name, status FROM boom_members`
  )) as ExistingMember[];
  const existingByMid = new Map<string, ExistingMember>();
  for (const m of existingMembers) existingByMid.set(m.hacomono_member_id, m);

  const existingLstep = (await getAll(`SELECT lstep_id FROM lstep_friends`)) as {
    lstep_id: string;
  }[];
  const existingLstepIds = new Set(existingLstep.map((r) => r.lstep_id));

  // --- 突合 ---
  type MemberSnapshot = {
    hacomono_member_id: string;
    hacomono_kaiin_no: string | null;
    full_name: string;
    full_name_kana: string;
    birthday: string | null;
    email: string | null;
    phone: string | null;
    enrolled_at: string | null;
    withdrew_at: string | null;
    plan_code: string | null;
    plan_name: string | null;
    plan_started_at: string | null;
    plan_continued_months: string | null;
    guardian_relation: string | null;
    rep_name: string | null;
    status: 'active' | 'withdrew';
  };

  const mapHacomono = (r: Record<string, string>, status: 'active' | 'withdrew'): MemberSnapshot | null => {
    const mid = (r['メンバーID'] ?? '').trim();
    if (!mid) return null;
    // 代表氏名は会員本人と別人(=保護者)のときだけ意味を持つので、同名なら null にする
    const repNameRaw = (r['代表氏名'] ?? '').trim();
    const fullName = (r['氏名'] ?? '').trim();
    const repName = repNameRaw && repNameRaw !== fullName ? repNameRaw : null;
    return {
      hacomono_member_id: mid,
      hacomono_kaiin_no: (r['会員番号'] ?? '').trim() || null,
      full_name: fullName,
      full_name_kana: (r['氏名カナ'] ?? '').trim(),
      birthday: parseDate(r['生年月日']),
      email: (r['メールアドレス'] ?? '').trim() || null,
      phone: (r['電話番号'] ?? '').trim() || null,
      enrolled_at: parseDateTime(r['入会日時']),
      withdrew_at: status === 'withdrew' ? parseDateTime(r['退会手続き日']) : null,
      plan_code: (r['契約プランコード'] ?? '').trim() || null,
      plan_name: (r['契約プラン名'] ?? '').trim() || null,
      plan_started_at: parseDate(r['プラン契約適用開始日']),
      plan_continued_months: (r['プラン継続期間'] ?? '').trim() || null,
      // 緊急連絡先続柄(母/父等)。子供会員なら保護者の存在を示す強いシグナル。
      guardian_relation: (r['緊急連絡先続柄'] ?? '').trim() || null,
      rep_name: repName,
      status,
    };
  };

  const activeMembers = activeRows.map((r) => mapHacomono(r, 'active')).filter((x): x is MemberSnapshot => !!x);
  const withdrewMembers = withdrewRows.map((r) => mapHacomono(r, 'withdrew')).filter((x): x is MemberSnapshot => !!x);

  const newMembers: MemberSnapshot[] = [];
  const planChanges: { member: MemberSnapshot; from: { code: string | null; name: string | null }; to: { code: string | null; name: string | null } }[] = [];
  const withdrewDetected: MemberSnapshot[] = [];

  for (const m of activeMembers) {
    const exist = existingByMid.get(m.hacomono_member_id);
    if (!exist) {
      newMembers.push(m);
    } else {
      if ((exist.plan_code ?? '') !== (m.plan_code ?? '') || (exist.plan_name ?? '') !== (m.plan_name ?? '')) {
        planChanges.push({
          member: m,
          from: { code: exist.plan_code, name: exist.plan_name },
          to: { code: m.plan_code, name: m.plan_name },
        });
      }
    }
  }
  // 契約中CSVにも入ってるIDは「再入会済」なので退会扱いしない
  const activeIdSet = new Set(activeMembers.map((m) => m.hacomono_member_id));
  for (const m of withdrewMembers) {
    if (activeIdSet.has(m.hacomono_member_id)) continue;
    const exist = existingByMid.get(m.hacomono_member_id);
    if (!exist || exist.status === 'active') {
      withdrewDetected.push(m);
    }
  }

  // --- DB UPSERT ---
  // boom_members
  const memberUpsertSql = `
    INSERT INTO boom_members
      (hacomono_member_id, hacomono_kaiin_no, full_name, full_name_kana, birthday,
       email, phone, enrolled_at, withdrew_at, status,
       plan_code, plan_name, plan_started_at, plan_continued_months,
       guardian_relation, rep_name, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
    ON CONFLICT(hacomono_member_id) DO UPDATE SET
      hacomono_kaiin_no=excluded.hacomono_kaiin_no,
      full_name=excluded.full_name,
      full_name_kana=excluded.full_name_kana,
      birthday=excluded.birthday,
      email=excluded.email,
      phone=excluded.phone,
      enrolled_at=excluded.enrolled_at,
      withdrew_at=excluded.withdrew_at,
      status=excluded.status,
      plan_code=excluded.plan_code,
      plan_name=excluded.plan_name,
      plan_started_at=excluded.plan_started_at,
      plan_continued_months=excluded.plan_continued_months,
      guardian_relation=excluded.guardian_relation,
      rep_name=excluded.rep_name,
      updated_at=CURRENT_TIMESTAMP
  `;

  // 同一メンバーIDが両CSVに出現した場合「契約中=現在の状態」を優先するため、
  // withdrew を先に投入 → active を後勝ちで上書き
  // バッチ実行で高速化 (50件ずつ)
  const memberStatements = [...withdrewMembers, ...activeMembers].map((m) => ({
    sql: memberUpsertSql,
    args: [
      m.hacomono_member_id,
      m.hacomono_kaiin_no,
      m.full_name,
      m.full_name_kana,
      m.birthday,
      m.email,
      m.phone,
      m.enrolled_at,
      m.withdrew_at,
      m.status,
      m.plan_code,
      m.plan_name,
      m.plan_started_at,
      m.plan_continued_months,
      m.guardian_relation,
      m.rep_name,
    ] as (string | number | null)[],
  }));
  for (let i = 0; i < memberStatements.length; i += 50) {
    await batch(memberStatements.slice(i, i + 50));
  }

  // lstep_friends
  const lstepUpsertSql = `
    INSERT INTO lstep_friends
      (lstep_id, display_name, system_display_name, line_register_name, real_name,
       role, blocked, last_message_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
    ON CONFLICT(lstep_id) DO UPDATE SET
      display_name=excluded.display_name,
      system_display_name=excluded.system_display_name,
      line_register_name=excluded.line_register_name,
      real_name=excluded.real_name,
      blocked=excluded.blocked,
      last_message_at=excluded.last_message_at,
      updated_at=CURRENT_TIMESTAMP
  `;

  const lstepNew: { lstep_id: string; display_name: string; system_display_name: string; real_name: string }[] = [];
  const lstepStatements = lstepRows.map((r) => {
    const lid = (r['ID'] ?? '').trim();
    const blockedRaw = (r['ユーザーブロック'] ?? '').trim();
    const blocked = ['1', 'ブロック', 'ブロック中', 'TRUE', 'true'].includes(blockedRaw) ? 1 : 0;
    if (!existingLstepIds.has(lid)) {
      lstepNew.push({
        lstep_id: lid,
        display_name: (r['表示名'] ?? '').trim(),
        system_display_name: (r['システム表示名'] ?? '').trim(),
        real_name: (r['本名'] ?? '').trim(),
      });
    }
    return {
      sql: lstepUpsertSql,
      args: [
        lid,
        (r['表示名'] ?? '').trim() || null,
        (r['システム表示名'] ?? '').trim() || null,
        (r['LINE登録名'] ?? '').trim() || null,
        (r['本名'] ?? '').trim() || null,
        null,
        blocked,
        parseDateTime(r['最終メッセージ日時']),
      ] as (string | number | null)[],
    };
  });
  for (let i = 0; i < lstepStatements.length; i += 50) {
    await batch(lstepStatements.slice(i, i + 50));
  }

  // Lstep 未紐付け新規: lstepNew のうち member_lstep_links に存在しない
  type LinkedLstep = { lstep_id: string };
  const linked = (await getAll(`SELECT DISTINCT lstep_id FROM member_lstep_links`)) as LinkedLstep[];
  const linkedSet = new Set(linked.map((r) => r.lstep_id));
  const lstepNewUnmatched = lstepNew.filter((r) => !linkedSet.has(r.lstep_id));

  // --- 新規入会者の紐付け候補を抽出 ---
  // UPSERT 後の DB から id を含む member を取得
  const newMemberIds = newMembers.map((m) => m.hacomono_member_id);
  let linkSuggestions: Awaited<ReturnType<typeof buildLinkSuggestions>> = [];
  if (newMemberIds.length > 0) {
    // IN 句を組み立て (件数制限 — 念のため 200 件まで)
    const ids = newMemberIds.slice(0, 200);
    const placeholders = ids.map(() => '?').join(',');
    const rows = (await getAll(
      `SELECT m.id, m.hacomono_member_id, m.full_name, m.full_name_kana
       FROM boom_members m
       LEFT JOIN member_lstep_links ml ON ml.member_id = m.id
       WHERE m.hacomono_member_id IN (${placeholders}) AND ml.id IS NULL`,
      ids
    )) as SuggestMember[];
    linkSuggestions = await buildLinkSuggestions(rows);
  }

  return NextResponse.json({
    ok: true,
    summary: {
      new_members: newMembers.length,
      withdrew_members: withdrewDetected.length,
      plan_changes: planChanges.length,
      lstep_new_total: lstepNew.length,
      lstep_new_unmatched: lstepNewUnmatched.length,
      hacomono_active_total: activeMembers.length,
      hacomono_withdrew_total: withdrewMembers.length,
      lstep_total: lstepRows.length,
    },
    details: {
      new_members: newMembers.map((m) => ({
        hacomono_member_id: m.hacomono_member_id,
        full_name: m.full_name,
        plan_name: m.plan_name,
        enrolled_at: m.enrolled_at,
      })),
      withdrew_members: withdrewDetected.map((m) => ({
        hacomono_member_id: m.hacomono_member_id,
        full_name: m.full_name,
        withdrew_at: m.withdrew_at,
      })),
      plan_changes: planChanges.map((p) => ({
        hacomono_member_id: p.member.hacomono_member_id,
        full_name: p.member.full_name,
        from: p.from,
        to: p.to,
      })),
      lstep_new_unmatched: lstepNewUnmatched,
    },
    link_suggestions: linkSuggestions,
  });
}
