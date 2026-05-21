import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { parseCSV, toCSV, toCSVRow } from '@/lib/csvUtil';
import { encodeShiftJIS } from '@/lib/sjis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/operations/download?type=ticket|monthly|unmatched|lstep_import
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? '';

  if (type === 'ticket' || type === 'monthly') {
    const kw = type === 'ticket' ? '%チケット%' : '%マンスリー%';
    const rows = (await getAll(
      `SELECT hacomono_member_id, hacomono_kaiin_no, full_name, full_name_kana,
              plan_code, plan_name, plan_started_at, plan_continued_months,
              enrolled_at, status
       FROM boom_members
       WHERE plan_name LIKE ? AND status = 'active'
       ORDER BY full_name_kana ASC`,
      [kw]
    )) as Record<string, string | null>[];

    const header = [
      'メンバーID',
      '会員番号',
      '氏名',
      '氏名カナ',
      'プランコード',
      'プラン名',
      'プラン開始日',
      'プラン継続期間',
      '入会日時',
      'ステータス',
    ];
    const body = rows.map((r) => [
      r.hacomono_member_id,
      r.hacomono_kaiin_no,
      r.full_name,
      r.full_name_kana,
      r.plan_code,
      r.plan_name,
      r.plan_started_at,
      r.plan_continued_months,
      r.enrolled_at,
      r.status,
    ]);
    const csv = '﻿' + toCSV([header, ...body]);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${type}_members.csv"`,
      },
    });
  }

  if (type === 'unmatched') {
    // Lstep に存在するが member_lstep_links に紐付け無いユーザー
    const rows = (await getAll(
      `SELECT lf.lstep_id, lf.display_name, lf.system_display_name,
              lf.line_register_name, lf.real_name, lf.last_message_at, lf.blocked
       FROM lstep_friends lf
       LEFT JOIN member_lstep_links ml ON ml.lstep_id = lf.lstep_id
       WHERE ml.id IS NULL
       ORDER BY lf.last_message_at DESC NULLS LAST`
    )) as Record<string, string | number | null>[];

    const header = [
      'Lstep_ID',
      '表示名',
      'システム表示名',
      'LINE登録名',
      '本名',
      '最終メッセージ日時',
      'ブロック',
    ];
    const body = rows.map((r) => [
      r.lstep_id,
      r.display_name,
      r.system_display_name,
      r.line_register_name,
      r.real_name,
      r.last_message_at,
      r.blocked,
    ]);
    const csv = '﻿' + toCSV([header, ...body]);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lstep_unmatched.csv"`,
      },
    });
  }

  if (type === 'lstep_import') {
    // Lstep 管理画面 UPLOAD 形式 (cp932, 2行ヘッダー、56列)
    //
    // 戦略: 最後にUPLOADされた Lstep CSV原本(snapshot)をベースに、
    // 該当行・該当セルだけを差分更新して cp932で返す。
    // (Lstep制約: 「エクスポートCSVをそのまま使え」「左1列・上1〜2行触らない」を満たす)
    const snap = (await getOne(
      `SELECT csv_text FROM lstep_csv_snapshots ORDER BY id DESC LIMIT 1`
    )) as { csv_text: string } | null;
    if (!snap || !snap.csv_text) {
      return NextResponse.json(
        { error: 'Lstep CSVのスナップショットがありません。先に突合(/api/staff/operations/sync)を実行してください。' },
        { status: 400 }
      );
    }

    const grid = parseCSV(snap.csv_text);
    if (grid.length < 3) {
      return NextResponse.json({ error: 'Lstep CSVが不正です (ヘッダー2行+データが必要)' }, { status: 500 });
    }
    // grid[0] = タグID行 (絶対編集禁止 → そのまま維持して出力する)
    const header2 = grid[1]; // ラベル行
    const colCount = header2.length;
    // ラベル → 列index
    const L = new Map<string, number>();
    header2.forEach((label, i) => {
      const key = (label ?? '').trim();
      if (key && !L.has(key)) L.set(key, i);
    });
    const idCol = L.get('ID') ?? 0;
    const sysNameCol = L.get('システム表示名');
    const memberName1Col = L.get('会員名(1)');
    const memberNo1Col = L.get('会員番号(1)');
    const memberBirthCol = L.get('会員生年月日');
    const phase4ACol = L.get('フェーズ４ーA：hacomono【本入会完了】');
    const phase4BCol = L.get('フェーズ４ーB：hacomono【会員保護者】');
    const instructorCol = L.get('イントラ / インストラクター');

    // DB側: lstep_id → 紐付けmember一覧 + role
    type LinkRow = {
      lstep_id: string;
      relation: string | null;
      role: string | null;
      system_display_name: string | null;
      full_name_kana: string | null;
      hacomono_kaiin_no: string | null;
      birthday: string | null;
    };
    const linkRows = (await getAll(
      `SELECT lf.lstep_id, lf.system_display_name, lf.role,
              ml.relation,
              m.full_name_kana, m.hacomono_kaiin_no, m.birthday
       FROM lstep_friends lf
       LEFT JOIN member_lstep_links ml ON ml.lstep_id = lf.lstep_id
       LEFT JOIN boom_members m ON m.id = ml.member_id`
    )) as LinkRow[];

    type Agg = {
      role: string; // '本人' | '保護者' | '講師' | ''
      system_display_name: string;
      members: { kana: string; kaiin_no: string | null; birthday: string | null }[];
    };
    const byLid = new Map<string, Agg>();
    for (const r of linkRows) {
      const lid = r.lstep_id;
      if (!byLid.has(lid)) {
        byLid.set(lid, {
          role: '',
          system_display_name: r.system_display_name ?? '',
          members: [],
        });
      }
      const a = byLid.get(lid)!;
      // 役割優先順位: 講師 > 保護者 > 本人 (リンクrelationベース、role列はfallback)
      const rel = (r.relation ?? r.role ?? '').trim();
      if (rel === '講師') a.role = '講師';
      else if (rel === '保護者' && a.role !== '講師') a.role = '保護者';
      else if (rel === '本人' && a.role !== '講師' && a.role !== '保護者') a.role = '本人';
      if (r.full_name_kana) {
        // 重複排除
        if (!a.members.some((m) => m.kana === r.full_name_kana)) {
          a.members.push({
            kana: r.full_name_kana,
            kaiin_no: r.hacomono_kaiin_no,
            birthday: r.birthday,
          });
        }
      }
    }

    // 既存表示名から保護者名抽出 (例: 「【保護者】タンノ ユカ / 子:...」 → 「タンノ ユカ」)
    const extractParentName = (sysName: string): string => {
      if (!sysName) return '';
      const m = sysName.match(/^【保護者】\s*([^\/]+?)\s*\/\s*子[:：]/);
      if (m) return m[1].trim();
      return '';
    };

    // 兄弟拡張: 同姓なら「姓 名1・名2」、違うなら「氏1・氏2」
    const buildMemberLabel = (members: { kana: string }[]): string => {
      if (members.length === 0) return '';
      if (members.length === 1) return members[0].kana;
      const parts = members.map((m) => m.kana.split(/[\s　]+/));
      const firstSurname = parts[0][0] ?? '';
      const sameSurname = parts.every((p) => (p[0] ?? '') === firstSurname);
      if (sameSurname) {
        const givens = parts.map((p) => p.slice(1).join(' ')).filter(Boolean);
        return `${firstSurname} ${givens.join('・')}`;
      }
      return members.map((m) => m.kana).join('・');
    };

    let updated = 0;
    for (let i = 2; i < grid.length; i++) {
      const row = grid[i];
      if (!row || row.length === 0) continue;
      // 列数を揃える (元行が短ければ埋める、長ければそのまま)
      while (row.length < colCount) row.push('');
      const lid = (row[idCol] ?? '').trim();
      if (!lid || !/^\d+$/.test(lid)) continue;
      const agg = byLid.get(lid);
      if (!agg || !agg.role) continue;

      const memberLabel = buildMemberLabel(agg.members);

      // システム表示名生成
      let newDisplay = '';
      if (agg.role === '本人') {
        newDisplay = memberLabel ? `【本人】${memberLabel}` : '';
      } else if (agg.role === '保護者') {
        const parent = extractParentName(agg.system_display_name) || '???';
        newDisplay = memberLabel ? `【保護者】${parent} / 子:${memberLabel}` : '';
      } else if (agg.role === '講師') {
        // 既存表示名から【講師】◯◯ 抽出 (なければmemberLabelで補完)
        const existing = agg.system_display_name ?? '';
        const m = existing.match(/^【講師】\s*(.+)$/);
        newDisplay = m ? `【講師】${m[1].trim()}` : (memberLabel ? `【講師】${memberLabel}` : '');
      }

      if (newDisplay && sysNameCol !== undefined) {
        row[sysNameCol] = newDisplay;
      }
      if (memberLabel && memberName1Col !== undefined) {
        row[memberName1Col] = memberLabel;
      }
      // 会員番号(1), 生年月日: 単独紐付けの時のみ
      if (agg.members.length === 1) {
        if (memberNo1Col !== undefined && agg.members[0].kaiin_no) {
          row[memberNo1Col] = agg.members[0].kaiin_no;
        }
        if (memberBirthCol !== undefined && agg.members[0].birthday) {
          row[memberBirthCol] = agg.members[0].birthday;
        }
      }
      // タグ列
      if (agg.role === '本人' && phase4ACol !== undefined) row[phase4ACol] = '1';
      if (agg.role === '保護者' && phase4BCol !== undefined) row[phase4BCol] = '1';
      if (agg.role === '講師') {
        if (instructorCol !== undefined) row[instructorCol] = '1';
        // 兼任 (子: が含まれる) → 保護者タグも
        if (newDisplay.includes('/ 子:') && phase4BCol !== undefined) row[phase4BCol] = '1';
      }
      updated++;
    }

    // 全行を再CSV化 (header1 含む全行をそのまま出力)
    const lines: string[] = [];
    for (const row of grid) {
      lines.push(toCSVRow(row));
    }
    const csv = lines.join('\r\n') + '\r\n';
    const sjisBytes = encodeShiftJIS(csv);
    const ab = sjisBytes.buffer.slice(sjisBytes.byteOffset, sjisBytes.byteOffset + sjisBytes.byteLength) as ArrayBuffer;
    return new NextResponse(ab, {
      headers: {
        'Content-Type': 'text/csv; charset=shift_jis',
        'Content-Disposition': `attachment; filename="lstep_import_diff.csv"`,
        'X-Lstep-Updated-Rows': String(updated),
      },
    });
  }

  return NextResponse.json({ error: 'invalid type' }, { status: 400 });
}
