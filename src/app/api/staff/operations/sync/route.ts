import { NextRequest, NextResponse } from 'next/server';
import { type InStatement } from '@libsql/client';
import { execute, getAll, getOne, batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDate, parseDateTime } from '@/lib/csvUtil';
import { buildLinkSuggestions, type Member as SuggestMember, type LinkSuggestion } from '@/lib/linkSuggest';
import { deriveMemberType } from '@/lib/memberType';

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
    full_name: string | null;
    plan_code: string | null;
    plan_name: string | null;
    status: string;
    withdrew_at: string | null;
    member_type: string | null;
  };
  const existingMembers = (await getAll(
    `SELECT id, hacomono_member_id, full_name, plan_code, plan_name, status, withdrew_at, member_type FROM boom_members`
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
    member_type: string;
    status: 'active' | 'withdrew';
  };

  const mapHacomono = (r: Record<string, string>, status: 'active' | 'withdrew'): MemberSnapshot | null => {
    const mid = (r['メンバーID'] ?? '').trim();
    if (!mid) return null;
    // 代表氏名は会員本人と別人(=保護者)のときだけ意味を持つので、同名なら null にする
    const repNameRaw = (r['代表氏名'] ?? '').trim();
    const fullName = (r['氏名'] ?? '').trim();
    const repName = repNameRaw && repNameRaw !== fullName ? repNameRaw : null;
    const planName = (r['契約プラン名'] ?? '').trim() || null;
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
      plan_name: planName,
      plan_started_at: parseDate(r['プラン契約適用開始日']),
      plan_continued_months: (r['プラン継続期間'] ?? '').trim() || null,
      // 緊急連絡先続柄(母/父等)。子供会員なら保護者の存在を示す強いシグナル。
      guardian_relation: (r['緊急連絡先続柄'] ?? '').trim() || null,
      rep_name: repName,
      // member_type は plan_name から毎回導出し鮮度を保つ(B-1: 退会/休眠/KPIの対象集合を凍結させない)
      member_type: deriveMemberType(planName),
      status,
    };
  };

  const activeMembers = activeRows.map((r) => mapHacomono(r, 'active')).filter((x): x is MemberSnapshot => !!x);
  const withdrewMembers = withdrewRows.map((r) => mapHacomono(r, 'withdrew')).filter((x): x is MemberSnapshot => !!x);

  const newMembers: MemberSnapshot[] = [];
  const planChanges: { member: MemberSnapshot; from: { code: string | null; name: string | null }; to: { code: string | null; name: string | null } }[] = [];
  const withdrewDetected: { hacomono_member_id: string; full_name: string; withdrew_at: string | null }[] = [];

  // 退会手続き日マップ (T-159)。
  // HACOMONOは退会手続き済みでも在籍最終日までは「契約中CSV」に載せ続ける。
  // 以前は契約中行が後勝ちで withdrew_at を NULL に戻し続け、最終日後は両CSVから
  // 消えて誰も更新しない → 退会が10ヶ月間1件も記録されないバグになっていた。
  // 両CSVに居る会員は「契約中(status=active)のまま withdrew_at だけ保持」する。
  // 在籍カウントは日付窓方式(withdrew_at > 月末)なので退会日まで正しく在籍に数えられる。
  const withdrewAtByMid = new Map<string, string | null>();
  for (const m of withdrewMembers) {
    withdrewAtByMid.set(m.hacomono_member_id, m.withdrew_at);
  }

  for (const m of activeMembers) {
    // 退会手続き済みの契約中会員: withdrew_at を退会CSVから引き継ぐ
    const pendingWithdrawal = withdrewAtByMid.get(m.hacomono_member_id);
    if (pendingWithdrawal) m.withdrew_at = pendingWithdrawal;

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
      // 新たに退会手続きが検出された会員(既存DBに退会日が無い)を通知対象に
      if (pendingWithdrawal && !exist.withdrew_at) {
        withdrewDetected.push({ hacomono_member_id: m.hacomono_member_id, full_name: m.full_name, withdrew_at: pendingWithdrawal });
      }
    }
  }
  const activeIdSet = new Set(activeMembers.map((m) => m.hacomono_member_id));
  // 契約中CSVに居ない退会CSV会員 = 完全退会済み
  for (const m of withdrewMembers) {
    if (activeIdSet.has(m.hacomono_member_id)) continue;
    const exist = existingByMid.get(m.hacomono_member_id);
    if (!exist || exist.status === 'active') {
      withdrewDetected.push({ hacomono_member_id: m.hacomono_member_id, full_name: m.full_name, withdrew_at: m.withdrew_at });
    }
  }

  // 消失検出 (T-159): DB上activeなのに両CSVから消えた会員 = 退会済み。
  // (HACOMONOの退会CSVは「手続き中」だけを返し、完全退会後は両CSVから消えるため、
  //  これを拾わないと退会が永久に記録されない)
  // - staff はHACOMONO会員CSVに載らないので除外
  // - 休会 は契約中CSVから外れるだけで退会ではないので除外 (mid92/123で誤判定実績あり)
  // - visitor は課金取込の自動生成レコードで会員CSVに載らないので除外
  //
  // B-2: 旧実装は「契約中CSVが50件以上」だけを安全弁にしていたため、店舗別など
  //   部分CSVを誤アップロードすると残り全員(数十名)を即 status='withdrew' に一括更新して
  //   しまった。カバレッジ(現役ロスターのうち今回CSVに含まれた割合)で部分CSVを検知し、
  //   ほぼ全件(>=90%)かつ消失が少数(<=5)のときだけ自動退会。それ以外は status を触らず
  //   承認待ち(withdrew_pending)として返し、人が確認する。
  const withdrewIdSet = new Set(withdrewMembers.map((m) => m.hacomono_member_id));

  // 現在DB上でactiveな「実会員」ロスター(staff/休会/visitor と mid欠落は対象外)
  const roster = existingMembers.filter(
    (e) => e.status === 'active' && !!e.hacomono_member_id
      && e.member_type !== 'staff' && e.member_type !== '休会' && e.member_type !== 'visitor'
  );
  const presentInCsv = roster.filter(
    (e) => activeIdSet.has(e.hacomono_member_id) || withdrewIdSet.has(e.hacomono_member_id)
  ).length;
  const syncCoverage = roster.length > 0 ? presentInCsv / roster.length : 1;

  const disappeared: ExistingMember[] = roster.filter(
    (e) => !activeIdSet.has(e.hacomono_member_id) && !withdrewIdSet.has(e.hacomono_member_id)
  );

  const COVERAGE_MIN = 0.9;
  const AUTO_WITHDRAW_MAX = 5;
  const canAutoWithdraw = syncCoverage >= COVERAGE_MIN && disappeared.length <= AUTO_WITHDRAW_MAX;
  const withdrewPending: { hacomono_member_id: string; full_name: string; withdrew_at: string | null }[] = [];

  if (disappeared.length > 0 && canAutoWithdraw) {
    const stmts = disappeared.map((d) => ({
      sql: `UPDATE boom_members SET status='withdrew',
             withdrew_at=COALESCE(withdrew_at, datetime('now')),
             updated_at=CURRENT_TIMESTAMP WHERE id = ?`,
      args: [d.id] as (string | number)[],
    }));
    for (let i = 0; i < stmts.length; i += 50) {
      await batch(stmts.slice(i, i + 50));
    }
    for (const d of disappeared) {
      withdrewDetected.push({ hacomono_member_id: d.hacomono_member_id, full_name: d.full_name ?? '', withdrew_at: d.withdrew_at });
    }
  } else if (disappeared.length > 0) {
    // 承認待ち: 部分CSV/大量消失の疑い → status は変更せず人の確認に回す
    for (const d of disappeared) {
      withdrewPending.push({ hacomono_member_id: d.hacomono_member_id, full_name: d.full_name ?? '', withdrew_at: d.withdrew_at });
    }
    // 1時間以内に同種通知が無ければ集約通知を1件だけ作る(スパム防止)
    await execute(
      `INSERT INTO staff_notifications (type, title, detail, severity, related_member_id, related_lstep_id)
       SELECT 'withdraw_pending_review', ?, ?, 'warning', NULL, NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_notifications
         WHERE type='withdraw_pending_review' AND created_at > datetime('now','-1 hour')
       )`,
      [
        `退会候補 ${withdrewPending.length}件 要確認 (同期カバレッジ ${Math.round(syncCoverage * 100)}%・自動退会は保留)`,
        JSON.stringify({ count: withdrewPending.length, coverage: syncCoverage, members: withdrewPending.slice(0, 50) }),
      ]
    );
  }

  // --- DB UPSERT ---
  // boom_members
  const memberUpsertSql = `
    INSERT INTO boom_members
      (hacomono_member_id, hacomono_kaiin_no, full_name, full_name_kana, birthday,
       email, phone, enrolled_at, withdrew_at, status,
       plan_code, plan_name, plan_started_at, plan_continued_months,
       guardian_relation, rep_name, member_type, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
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
      member_type=excluded.member_type,
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
      m.member_type,
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

  // --- スタッフ通知の生成 (重複防止付き) ---
  await generateStaffNotifications(
    newMembers, planChanges, withdrewDetected, linkSuggestions
  );

  return NextResponse.json({
    ok: true,
    summary: {
      new_members: newMembers.length,
      withdrew_members: withdrewDetected.length,
      withdrew_pending: withdrewPending.length,
      sync_coverage: Math.round(syncCoverage * 1000) / 1000,
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
      // B-2: 自動退会せず承認待ちにした消失会員(部分CSV/大量消失の疑い)
      withdrew_pending: withdrewPending,
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

// --- 通知生成 (sync 完了後に呼ばれる) ---
async function generateStaffNotifications(
  newMembers: { hacomono_member_id: string; full_name: string; full_name_kana: string; plan_name: string | null; enrolled_at: string | null }[],
  planChanges: { member: { hacomono_member_id: string; full_name: string }; from: { code: string | null; name: string | null }; to: { code: string | null; name: string | null } }[],
  withdrewDetected: { hacomono_member_id: string; full_name: string }[],
  linkSuggestions: LinkSuggestion[]
) {
  // 重複防止 INSERT: 同じ type + related_member_id が直近24時間以内に存在しなければ挿入
  const DEDUP_INSERT = `
    INSERT INTO staff_notifications (type, title, detail, severity, related_member_id, related_lstep_id)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM staff_notifications
      WHERE type = ? AND related_member_id = ? AND created_at > datetime('now', '-1 day')
    )
  `;

  const stmts: InStatement[] = [];

  // linkSuggestions を member_id でインデックス化
  const suggestionByMemberId = new Map<number, LinkSuggestion>();
  for (const s of linkSuggestions) {
    suggestionByMemberId.set(s.member_id, s);
  }

  // (a) 新規入会
  for (const m of newMembers) {
    // UPSERT 後の boom_members から id を取得
    const row = await getOne(
      `SELECT id FROM boom_members WHERE hacomono_member_id = ?`,
      [m.hacomono_member_id]
    );
    const memberId = row?.id as number | null;

    // (a) new_member 通知
    stmts.push({
      sql: DEDUP_INSERT,
      args: [
        'new_member',
        `新規入会: ${m.full_name}`,
        JSON.stringify({
          hacomono_member_id: m.hacomono_member_id,
          plan_name: m.plan_name,
          enrolled_at: m.enrolled_at,
          full_name_kana: m.full_name_kana,
        }),
        'info',
        memberId,
        null,
        // WHERE params
        'new_member',
        memberId,
      ],
    });

    // (b)(c) LINE 紐付け候補の有無
    if (memberId != null) {
      const suggestion = suggestionByMemberId.get(memberId);
      if (suggestion && suggestion.candidates.length > 0) {
        const topCandidate = suggestion.candidates[0];
        stmts.push({
          sql: DEDUP_INSERT,
          args: [
            'lstep_linked',
            `LINE紐付け候補あり: ${m.full_name} → ${topCandidate.system_display_name}`,
            JSON.stringify({
              candidates: suggestion.candidates.slice(0, 3),
              confidence: topCandidate.confidence,
            }),
            'info',
            memberId,
            topCandidate.lstep_id,
            // WHERE params
            'lstep_linked',
            memberId,
          ],
        });
      } else {
        stmts.push({
          sql: DEDUP_INSERT,
          args: [
            'lstep_unlinked',
            `LINE紐付け候補なし: ${m.full_name}`,
            JSON.stringify({
              hacomono_member_id: m.hacomono_member_id,
              full_name_kana: m.full_name_kana,
            }),
            'warning',
            memberId,
            null,
            // WHERE params
            'lstep_unlinked',
            memberId,
          ],
        });
      }
    }
  }

  // (d) プラン変更
  for (const p of planChanges) {
    const row = await getOne(
      `SELECT id FROM boom_members WHERE hacomono_member_id = ?`,
      [p.member.hacomono_member_id]
    );
    const memberId = row?.id as number | null;

    stmts.push({
      sql: DEDUP_INSERT,
      args: [
        'plan_change',
        `プラン変更: ${p.member.full_name} (${p.from.name ?? '不明'} → ${p.to.name ?? '不明'})`,
        JSON.stringify({ from: p.from, to: p.to }),
        'info',
        memberId,
        null,
        // WHERE params
        'plan_change',
        memberId,
      ],
    });
  }

  // (e) 退会
  for (const m of withdrewDetected) {
    const row = await getOne(
      `SELECT id FROM boom_members WHERE hacomono_member_id = ?`,
      [m.hacomono_member_id]
    );
    const memberId = row?.id as number | null;

    stmts.push({
      sql: DEDUP_INSERT,
      args: [
        'member_withdrew',
        `退会: ${m.full_name}`,
        JSON.stringify({ hacomono_member_id: m.hacomono_member_id }),
        'warning',
        memberId,
        null,
        // WHERE params
        'member_withdrew',
        memberId,
      ],
    });
  }

  // バッチ実行 (50件ずつ)
  if (stmts.length > 0) {
    for (let i = 0; i < stmts.length; i += 50) {
      await batch(stmts.slice(i, i + 50));
    }
  }
}
