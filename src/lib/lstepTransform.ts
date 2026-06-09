// Lstep 友だちCSV → 表示名一括更新CSV 変換ロジック (共有モジュール)
//
// Lstep 管理画面「友だちリスト → CSV操作 → CSVエクスポート」で出力した
// フル友だちCSV (cp932, 2行ヘッダー, 56列) を受け取り、
// member_lstep_links の紐付け情報から各友だちの「システム表示名」等を再生成して、
// そのまま Lstep の「CSVインポート」に流せる差分CSV(grid)を返す。
//
// Lstep制約:
//   - 「エクスポートCSVをそのまま使え」(列構成・タグID行を維持)
//   - 「左1列・上1〜2行は触らない」
// を満たすため、元gridの該当セルだけを差分更新する。
//
// download/route.ts (snapshotベース) と lstep-transform/route.ts (POSTされたCSVベース) の
// 両方から呼ばれる。daily_sync の軽量スナップショット(ID+表示名の2列)では
// システム表示名列が無いため変換不可 → warnings で通知する。

import { getAll } from '@/lib/db';

export type LstepChange = {
  lstep_id: string;
  role: string; // 本人 | 保護者 | 講師
  member_label: string;
  current_display: string; // 変換前のシステム表示名
  new_display: string; // 変換後のシステム表示名
  changed: boolean; // 実際に表示名が変わるか
};

export type TransformResult = {
  grid: string[][]; // 差分更新後の全行 (CSV出力用)
  changes: LstepChange[]; // role が確定した(=対象の)友だちの変更内容
  updatedRows: number; // システム表示名が実際に変わった行数
  targetRows: number; // 紐付けがあり対象になった行数
  totalRows: number; // データ行総数
  warnings: string[];
};

type LinkRow = {
  lstep_id: string;
  relation: string | null;
  role: string | null;
  system_display_name: string | null;
  full_name_kana: string | null;
  hacomono_kaiin_no: string | null;
  birthday: string | null;
};

type Agg = {
  role: string; // '本人' | '保護者' | '講師' | ''
  system_display_name: string;
  members: { kana: string; kaiin_no: string | null; birthday: string | null }[];
};

// 既存表示名から保護者名抽出 (例: 「【保護者】タンノ ユカ / 子:...」 → 「タンノ ユカ」)
function extractParentName(sysName: string): string {
  if (!sysName) return '';
  const m = sysName.match(/^【保護者】\s*([^\/]+?)\s*\/\s*子[:：]/);
  if (m) return m[1].trim();
  return '';
}

// 兄弟拡張: 同姓なら「姓 名1・名2」、違うなら「氏1・氏2」
function buildMemberLabel(members: { kana: string }[]): string {
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
}

// lstep_id → 紐付けmember集約 を DB から構築
async function buildAggByLstepId(): Promise<Map<string, Agg>> {
  const linkRows = (await getAll(
    `SELECT lf.lstep_id, lf.system_display_name, lf.role,
            ml.relation,
            m.full_name_kana, m.hacomono_kaiin_no, m.birthday
     FROM lstep_friends lf
     LEFT JOIN member_lstep_links ml ON ml.lstep_id = lf.lstep_id
     LEFT JOIN boom_members m ON m.id = ml.member_id`
  )) as LinkRow[];

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
      if (!a.members.some((m) => m.kana === r.full_name_kana)) {
        a.members.push({
          kana: r.full_name_kana,
          kaiin_no: r.hacomono_kaiin_no,
          birthday: r.birthday,
        });
      }
    }
  }
  return byLid;
}

// メインの変換: grid (parseCSV済み) を受け取り、差分更新後の grid と変更一覧を返す
//   opts.restrictTo: 指定すると、そのlstep_idの行だけセルを更新する
//     (承認済み分だけのインポートCSVを生成する用途。未承認の行は元のまま出力)
export async function transformLstepGrid(
  grid: string[][],
  opts?: { restrictTo?: Set<string> }
): Promise<TransformResult> {
  const restrictTo = opts?.restrictTo;
  const warnings: string[] = [];

  if (grid.length < 3) {
    return {
      grid,
      changes: [],
      updatedRows: 0,
      targetRows: 0,
      totalRows: 0,
      warnings: ['Lstep CSVが不正です (タグID行 + ラベル行 + データ行が必要)'],
    };
  }

  // grid[0] = タグID行 (絶対編集禁止), grid[1] = ラベル行
  const header2 = grid[1];
  const colCount = header2.length;
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

  if (sysNameCol === undefined) {
    warnings.push(
      'このCSVには「システム表示名」列がありません。Lstep管理画面の「友だちリスト → CSV操作 → CSVエクスポート」で出力したフルCSV(56列)を使用してください。(daily_syncの軽量CSVは非対応)'
    );
  }

  const byLid = await buildAggByLstepId();

  const changes: LstepChange[] = [];
  let updatedRows = 0;
  let targetRows = 0;
  let totalRows = 0;

  for (let i = 2; i < grid.length; i++) {
    const row = grid[i];
    if (!row || row.length === 0) continue;
    // 列数を揃える (元行が短ければ埋める)
    while (row.length < colCount) row.push('');
    const lid = (row[idCol] ?? '').trim();
    if (!lid || !/^\d+$/.test(lid)) continue;
    totalRows++;

    const agg = byLid.get(lid);
    if (!agg || !agg.role) continue;
    targetRows++;

    // restrictTo指定時: 対象外の行はセルを変更せず元のまま残す(承認分だけ反映)
    if (restrictTo && !restrictTo.has(lid)) continue;

    const memberLabel = buildMemberLabel(agg.members);

    // 変換対象CSV(=最新のLstepエクスポート)の現在のシステム表示名。
    // 保護者名・講師名は「いま実際にLINEに付いている表示名」から引き継ぐのが正しいので、
    // 行の現在値を最優先で参照し、DB(lstep_friends.system_display_name)はフォールバックにする。
    // (daily_syncの軽量CSVだとDB側が空になるため、行を優先しないと親名が???になる)
    const currentDisplay = sysNameCol !== undefined ? (row[sysNameCol] ?? '').trim() : '';

    // システム表示名生成
    let newDisplay = '';
    if (agg.role === '本人') {
      newDisplay = memberLabel ? `【本人】${memberLabel}` : '';
    } else if (agg.role === '保護者') {
      const parent =
        extractParentName(currentDisplay) || extractParentName(agg.system_display_name) || '???';
      newDisplay = memberLabel ? `【保護者】${parent} / 子:${memberLabel}` : '';
    } else if (agg.role === '講師') {
      const mCur = currentDisplay.match(/^【講師】\s*(.+)$/);
      const mDb = (agg.system_display_name ?? '').match(/^【講師】\s*(.+)$/);
      const teacher = mCur ? mCur[1].trim() : mDb ? mDb[1].trim() : '';
      newDisplay = teacher ? `【講師】${teacher}` : memberLabel ? `【講師】${memberLabel}` : '';
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
      if (newDisplay.includes('/ 子:') && phase4BCol !== undefined) row[phase4BCol] = '1';
    }

    const changed = !!newDisplay && newDisplay !== currentDisplay;
    if (changed) updatedRows++;
    if (newDisplay) {
      changes.push({
        lstep_id: lid,
        role: agg.role,
        member_label: memberLabel,
        current_display: currentDisplay,
        new_display: newDisplay,
        changed,
      });
    }
  }

  return { grid, changes, updatedRows, targetRows, totalRows, warnings };
}
