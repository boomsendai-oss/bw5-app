import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, rowsToDicts, parseDateTime } from '@/lib/csvUtil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/staff/operations/trial-import
 *
 * Lstepカレンダー「体験レッスン予約カレンダー」からエクスポートした
 * 予約者リストCSV (CP932想定) を受け取り、trial_records に UPSERT する。
 *
 * multipart/form-data:
 *   trial_csv : Lstep体験予約CSV (CP932, 1行ヘッダー想定)
 *
 * 仕様:
 *   - (lstep_id, reserved_at) で重複判定
 *   - 既存レコードは status_updated_at が新しい場合のみ更新
 *   - lstep_id → member_lstep_links で member_id を解決 (relation='本人' 優先)
 *   - ステータスを「予約済 / 来店確認済 / キャンセル / ノーショー」へ正規化
 */

type TrialStatus = '予約済' | '来店確認済' | 'キャンセル' | 'ノーショー' | 'その他';

function normalizeStatus(raw: string | undefined | null): TrialStatus {
  const s = (raw ?? '').trim();
  if (!s) return '予約済';
  if (/キャンセル|cancel/i.test(s)) return 'キャンセル';
  if (/ノーショー|no.?show|無断/i.test(s)) return 'ノーショー';
  if (/来店|来場|受講|完了|出席|attended|done/i.test(s)) return '来店確認済';
  if (/予約|reserved/i.test(s)) return '予約済';
  return 'その他';
}

// 複数の候補ヘッダーから最初に見つかった値を返す
function pick(row: Record<string, string>, candidates: string[]): string {
  // 完全一致を最優先 (部分一致は後段で。例: '日時' が '申し込み日時' を誤ヒットしないように)
  for (const c of candidates) {
    const v = row[c];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  // partial match (ヘッダー揺らぎ対策)
  const keys = Object.keys(row);
  for (const c of candidates) {
    const hit = keys.find((k) => k.includes(c));
    if (hit) {
      const v = row[hit];
      if (v && String(v).trim()) return String(v).trim();
    }
  }
  return '';
}

/**
 * 予約日時を解決する。
 * - Lstep予約CSV(実フォーマット)は「日付」(YYYY-MM-DD) と「開始時刻」(HH:MM:SS) が別列。
 *   この場合は結合して `YYYY-MM-DD HH:MM:SS` を作る。
 * - 「予約日時」等の結合済み列がある旧フォーマットも引き続き対応 (後方互換)。
 */
function resolveReservedAt(row: Record<string, string>): string | null {
  // 1) Lstep予約CSV実フォーマット: 「日付」(YYYY-MM-DD) + 「開始時刻」(HH:MM:SS) が別列。
  //    完全一致のみ採用 (部分一致だと '申し込み日時' 等を誤って拾うため)。
  const dateExact = ['日付', '開始日'].map((k) => row[k]).find((v) => v && v.trim());
  const timeExact = ['開始時刻', '開始時間'].map((k) => row[k]).find((v) => v && v.trim());
  if (dateExact) {
    const date = (parseDateTime(dateExact) ?? '').slice(0, 10);
    if (date) {
      const time = timeExact ? timeExact.trim() : '';
      return time ? `${date} ${time}` : date;
    }
  }

  // 2) 結合済みの日時列 (旧フォーマット, 後方互換)。完全一致を優先し、無ければ部分一致。
  const combined = pick(row, ['予約日時', '予約日', '開始日時']);
  if (combined) return parseDateTime(combined);

  return null;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  try {
    return await handleImport(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `体験予約取込エラー: ${msg}` }, { status: 500 });
  }
}

async function handleImport(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-data が必要です' }, { status: 400 });
  }

  const csvFile = form.get('trial_csv') as File | null;
  if (!csvFile) {
    return NextResponse.json({ error: 'trial_csv ファイルを指定してください' }, { status: 400 });
  }

  const buf = await csvFile.arrayBuffer();
  // Lstep CSV は CP932 想定。失敗時は UTF-8 フォールバック。
  let csvText: string;
  try {
    csvText = new TextDecoder('shift-jis', { fatal: false }).decode(buf);
  } catch {
    csvText = new TextDecoder('utf-8').decode(buf);
  }

  let rows: Record<string, string>[];
  try {
    rows = rowsToDicts(parseCSV(csvText), 0);
  } catch (e) {
    throw new Error(`CSV parse 失敗: ${e instanceof Error ? e.message : String(e)}`);
  }

  // lstep_id → member_id の解決マップ ('本人' 優先)
  type LinkRow = { lstep_id: string; member_id: number; relation: string | null };
  const links = (await getAll(
    `SELECT lstep_id, member_id, relation FROM member_lstep_links WHERE lstep_id IS NOT NULL`
  )) as LinkRow[];
  const memberByLid = new Map<string, number>();
  for (const r of links) {
    const cur = memberByLid.get(r.lstep_id);
    if (cur === undefined) memberByLid.set(r.lstep_id, r.member_id);
    else if ((r.relation ?? '').trim() === '本人') memberByLid.set(r.lstep_id, r.member_id);
  }

  const customerKanaByLid = new Map<string, string>(); // lstep_id → お客さまカナ
  let newCount = 0;
  let updateCount = 0;
  let canceledCount = 0;
  let attendedCount = 0;
  let unmatchedLstepCount = 0;
  let skippedCount = 0;

  const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);

  type Parsed = {
    lstep_id: string | null;
    reserved_at: string;
    lesson_name: string | null;
    status: TrialStatus;
    member_id: number | null;
    applicant_name: string | null;
    applicant_name_kana: string | null;
    applicant_age: number | null;
  };

  const parsedRows: Parsed[] = [];
  for (const r of rows) {
    const reserved = resolveReservedAt(r);
    if (!reserved) {
      skippedCount += 1;
      continue;
    }
    const lessonName =
      pick(r, ['予約枠', 'レッスン名', 'メニュー', 'コース', 'タイトル']) || null;
    const lstepId =
      pick(r, ['友だちID', '友達ID', 'LINE_ID', 'LINE ID', 'lstep_id', 'ユーザーID', 'ID']) || null;
    const statusRaw = pick(r, ['ステータス', '状態', 'status']);
    const status = normalizeStatus(statusRaw);

    // 申込者名(=受講する子の本名)・カナ・年齢。会員との突合キーになる最重要データ。
    // 「お名前」が無い旧フォーマットは「お客さま」(姓/カナ 結合) からのフォールバック。
    const applicantName = pick(r, ['お名前', '氏名', '受講者名', 'お客さま']) || null;
    const applicantKana = pick(r, ['お名前(カナ)', 'お名前（カナ）', '氏名カナ', 'カナ']) || null;
    const ageRaw = pick(r, ['ご年齢', '年齢', 'age']);
    const ageNum = ageRaw ? parseInt(ageRaw.replace(/[^0-9]/g, ''), 10) : NaN;
    const applicantAge = Number.isFinite(ageNum) && ageNum > 0 && ageNum < 120 ? ageNum : null;

    // 「お客さま」列 = LINEアカウント持ち主の「漢字名/カナ名」。
    // カナ部分を lstep_friends.customer_kana に保存 (保護者名のプリセットに使う)
    const customerRaw = pick(r, ['お客さま', '顧客名']) || '';
    const customerKana = customerRaw.includes('/')
      ? customerRaw.split('/').pop()!.trim()
      : '';
    if (lstepId && customerKana) {
      customerKanaByLid.set(lstepId, customerKana);
    }

    let memberId: number | null = null;
    if (lstepId) {
      memberId = memberByLid.get(lstepId) ?? null;
      if (memberId === null) unmatchedLstepCount += 1;
    }
    parsedRows.push({
      lstep_id: lstepId,
      reserved_at: reserved,
      lesson_name: lessonName,
      status,
      member_id: memberId,
      applicant_name: applicantName,
      applicant_name_kana: applicantKana,
      applicant_age: applicantAge,
    });
  }

  // 既存レコード取得 (一括): (lstep_id, reserved_at)
  // SQLite で複合キーの IN は使いにくいため、対象 lstep_id 一覧で取得して Map に
  const lstepIds = Array.from(new Set(parsedRows.map((p) => p.lstep_id).filter((x): x is string => !!x)));
  type ExRow = {
    id: number;
    lstep_id: string | null;
    reserved_at: string;
    status: string | null;
    status_updated_at: string | null;
  };
  let existing: ExRow[] = [];
  if (lstepIds.length > 0) {
    const placeholders = lstepIds.map(() => '?').join(',');
    existing = (await getAll(
      `SELECT id, lstep_id, reserved_at, status, status_updated_at
         FROM trial_records WHERE lstep_id IN (${placeholders})`,
      lstepIds
    )) as ExRow[];
  }
  const existingMap = new Map<string, ExRow>();
  for (const e of existing) {
    existingMap.set(`${e.lstep_id ?? ''}|${e.reserved_at}`, e);
  }

  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  for (const p of parsedRows) {
    if (p.status === 'キャンセル') canceledCount += 1;
    if (p.status === '来店確認済') attendedCount += 1;

    const key = `${p.lstep_id ?? ''}|${p.reserved_at}`;
    const ex = p.lstep_id ? existingMap.get(key) : undefined;
    if (ex) {
      // 既存: status_updated_at が新しい (=今回の取込) 場合のみ更新
      const exTs = ex.status_updated_at ?? '';
      if (exTs >= nowIso) {
        continue; // 既により新しい更新あり (通常起きないが冪等性のため)
      }
      // status が変わっていなければ status_updated_at だけ触らず、他フィールドだけ更新
      const statusChanged = (ex.status ?? '') !== p.status;
      if (statusChanged) {
        stmts.push({
          sql: `UPDATE trial_records SET
                  lesson_name = COALESCE(?, lesson_name),
                  status = ?,
                  status_source = 'lstep_calendar_csv',
                  status_updated_at = ?,
                  member_id = COALESCE(?, member_id),
                  applicant_name = COALESCE(?, applicant_name),
                  applicant_name_kana = COALESCE(?, applicant_name_kana),
                  applicant_age = COALESCE(?, applicant_age)
                WHERE id = ?`,
          args: [p.lesson_name, p.status, nowIso, p.member_id, p.applicant_name, p.applicant_name_kana, p.applicant_age, ex.id],
        });
        updateCount += 1;
      } else {
        // lesson_name / member_id / 申込者情報 の補完だけ
        stmts.push({
          sql: `UPDATE trial_records SET
                  lesson_name = COALESCE(?, lesson_name),
                  member_id = COALESCE(?, member_id),
                  applicant_name = COALESCE(?, applicant_name),
                  applicant_name_kana = COALESCE(?, applicant_name_kana),
                  applicant_age = COALESCE(?, applicant_age)
                WHERE id = ?`,
          args: [p.lesson_name, p.member_id, p.applicant_name, p.applicant_name_kana, p.applicant_age, ex.id],
        });
      }
    } else {
      stmts.push({
        sql: `INSERT INTO trial_records
                (lstep_id, member_id, reserved_at, lesson_name, status, status_source, status_updated_at,
                 applicant_name, applicant_name_kana, applicant_age)
              VALUES (?, ?, ?, ?, ?, 'lstep_calendar_csv', ?, ?, ?, ?)
              ON CONFLICT(lstep_id, reserved_at) DO UPDATE SET
                lesson_name = COALESCE(excluded.lesson_name, trial_records.lesson_name),
                status = excluded.status,
                status_source = excluded.status_source,
                status_updated_at = excluded.status_updated_at,
                member_id = COALESCE(excluded.member_id, trial_records.member_id),
                applicant_name = COALESCE(excluded.applicant_name, trial_records.applicant_name),
                applicant_name_kana = COALESCE(excluded.applicant_name_kana, trial_records.applicant_name_kana),
                applicant_age = COALESCE(excluded.applicant_age, trial_records.applicant_age)`,
        args: [p.lstep_id, p.member_id, p.reserved_at, p.lesson_name, p.status, nowIso,
               p.applicant_name, p.applicant_name_kana, p.applicant_age],
      });
      newCount += 1;
    }
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await batch(stmts.slice(i, i + 50));
  }

  // お客さまカナを lstep_friends.customer_kana に保存 (親名プリセット用。既存値があれば上書き)
  const kanaStmts = Array.from(customerKanaByLid.entries()).map(([lid, kana]) => ({
    sql: `UPDATE lstep_friends SET customer_kana = ? WHERE lstep_id = ?`,
    args: [kana, lid] as (string | number | null)[],
  }));
  for (let i = 0; i < kanaStmts.length; i += 50) {
    await batch(kanaStmts.slice(i, i + 50));
  }

  // 当月サマリ
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthStart = `${ym}-01 00:00:00`;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextStart = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
  const monthAgg = (await getOne(
    `SELECT
       COUNT(*) AS reserved,
       SUM(CASE WHEN status='来店確認済' THEN 1 ELSE 0 END) AS attended,
       SUM(CASE WHEN status='キャンセル' THEN 1 ELSE 0 END) AS canceled
     FROM trial_records WHERE reserved_at >= ? AND reserved_at < ?`,
    [monthStart, nextStart]
  )) as { reserved: number; attended: number; canceled: number } | null;

  return NextResponse.json({
    ok: true,
    summary: {
      csv_rows: rows.length,
      parsed_rows: parsedRows.length,
      skipped: skippedCount,
      new_reservations: newCount,
      status_updates: updateCount,
      canceled_in_csv: canceledCount,
      attended_in_csv: attendedCount,
      unmatched_lstep_ids: unmatchedLstepCount,
      month: ym,
      month_reserved: Number(monthAgg?.reserved ?? 0),
      month_attended: Number(monthAgg?.attended ?? 0),
      month_canceled: Number(monthAgg?.canceled ?? 0),
    },
  });
}
