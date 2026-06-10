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
  role: string; // 本人 | 保護者 | 保護者/本人 | 講師 | 講師/保護者
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

type AggMember = { kana: string; kaiin_no: string | null; birthday: string | null };

// アカウント(lstep_id)単位の集約。relationで区別して保持する。
//   owners   = relation'本人'  (アカウントの持ち主自身が会員。原則1人)
//   children = relation'保護者' (持ち主が保護者である子会員。LINE未所持の子はここにぶら下げる)
//   teacher  = relation'講師'
type Agg = {
  system_display_name: string;
  owners: AggMember[];
  children: AggMember[];
  teacher: boolean;
};

// 既存表示名から保護者名抽出 (「【保護者】タンノ ユカ / 子:...」「【保護者/本人】...」両対応)
function extractParentName(sysName: string): string {
  if (!sysName) return '';
  const m = sysName.match(/^【保護者(?:\/本人)?】\s*([^\/]+?)\s*\/\s*子[:：]/);
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
    // 並び順を固定(カナ昇順)。並び替えだけの差分ノイズを防ぐ
    const givens = parts.map((p) => p.slice(1).join(' ')).filter(Boolean).sort();
    return `${firstSurname} ${givens.join('・')}`;
  }
  return members.map((m) => m.kana).sort().join('・');
}

// 表示名を「意味的に同じか」判定するための正規化。
// スペース・「・」・並び順を無視した「文字の多重集合」で比較する。
// → スペースの有無や子どもの並び順だけの違いは同一とみなし(=承認待ちに出さない)、
//    子(兄弟)の増減や名前そのものの変化だけを「意味ある変更」として検出する。
// (現在の表示名に姓+名のスペースが無いケースでも誤検知しない頑健な方式)
function canonicalDisplay(s: string): string {
  if (!s) return '';
  return [...s.replace(/[\s　・,，]/g, '')].sort().join('');
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
        system_display_name: r.system_display_name ?? '',
        owners: [],
        children: [],
        teacher: false,
      });
    }
    const a = byLid.get(lid)!;
    const rel = (r.relation ?? r.role ?? '').trim();
    if (rel === '講師') a.teacher = true;
    const mem: AggMember | null = r.full_name_kana
      ? { kana: r.full_name_kana, kaiin_no: r.hacomono_kaiin_no, birthday: r.birthday }
      : null;
    if (!mem) continue;
    if (rel === '本人' || rel === '講師') {
      if (!a.owners.some((m) => m.kana === mem.kana)) a.owners.push(mem);
    } else if (rel === '保護者') {
      if (!a.children.some((m) => m.kana === mem.kana)) a.children.push(mem);
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
    if (!agg || (agg.owners.length === 0 && agg.children.length === 0)) continue;
    targetRows++;

    // restrictTo指定時: 対象外の行はセルを変更せず元のまま残す(承認分だけ反映)
    if (restrictTo && !restrictTo.has(lid)) continue;

    // 変換対象CSV(=最新のLstepエクスポート)の現在のシステム表示名。
    // 保護者名・講師名は「いま実際にLINEに付いている表示名」から引き継ぐのが正しいので、
    // 行の現在値を最優先で参照し、DB(lstep_friends.system_display_name)はフォールバックにする。
    const currentDisplay = sysNameCol !== undefined ? (row[sysNameCol] ?? '').trim() : '';

    // 本人(持ち主)が複数 = 紐付け異常。自動リネームせず要確認として警告
    if (agg.owners.length > 1 && !agg.teacher) {
      warnings.push(
        `要確認: アカウント ${lid} (${currentDisplay || '表示名なし'}) に本人が${agg.owners.length}人紐付いています(${agg.owners.map((o) => o.kana).join('・')})。本人は1人が原則です。紐付けを確認してください。`
      );
      continue;
    }

    const ownerLabel = buildMemberLabel(agg.owners); // 持ち主(会員)の名前
    const childLabel = buildMemberLabel(agg.children); // 子(LINE未所持会員)の名前
    const role =
      agg.teacher && agg.children.length > 0 ? '講師/保護者'
      : agg.teacher ? '講師'
      : agg.owners.length > 0 && agg.children.length > 0 ? '保護者/本人'
      : agg.children.length > 0 ? '保護者'
      : '本人';

    // システム表示名生成 (ルール: 本人は持ち主1人だけ。子は保護者の「子:」に連名)
    let newDisplay = '';
    if (role === '本人') {
      newDisplay = ownerLabel ? `【本人】${ownerLabel}` : '';
    } else if (role === '保護者/本人') {
      // 持ち主自身も会員 & 子も会員 (例: キクチ リカ)
      newDisplay = childLabel ? `【保護者/本人】${ownerLabel} / 子:${childLabel}` : `【本人】${ownerLabel}`;
    } else if (role === '保護者') {
      // 持ち主は非会員の保護者。親名は現在の表示名から引き継ぐ
      const parent =
        extractParentName(currentDisplay) || extractParentName(agg.system_display_name) || '???';
      newDisplay = childLabel ? `【保護者】${parent} / 子:${childLabel}` : '';
    } else {
      // 講師 / 講師/保護者
      const mCur = currentDisplay.match(/^【講師(?:\/保護者)?】\s*([^\/]+?)\s*(?:\/|$)/);
      const mDb = (agg.system_display_name ?? '').match(/^【講師(?:\/保護者)?】\s*([^\/]+?)\s*(?:\/|$)/);
      const teacher = mCur ? mCur[1].trim() : mDb ? mDb[1].trim() : ownerLabel;
      if (!teacher) {
        newDisplay = '';
      } else if (role === '講師/保護者') {
        newDisplay = `【講師/保護者】${teacher} / 子:${childLabel}`;
      } else if (/\/\s*子[:：]/.test(currentDisplay)) {
        // DBに子リンクが無いのに現表示には子がいる = リンク未整備。
        // 子情報を消す退行を防ぐため現状維持(変更を出さない)
        newDisplay = currentDisplay;
      } else {
        newDisplay = `【講師】${teacher}`;
      }
    }

    // 会員名(1)列: このアカウントに紐づく全会員(持ち主+子)
    const allMembers = [...agg.owners, ...agg.children];
    const memberLabel = buildMemberLabel(allMembers);

    if (newDisplay && sysNameCol !== undefined) {
      row[sysNameCol] = newDisplay;
    }
    if (memberLabel && memberName1Col !== undefined) {
      row[memberName1Col] = memberLabel;
    }
    // 会員番号(1), 生年月日: 単独紐付けの時のみ
    if (allMembers.length === 1) {
      if (memberNo1Col !== undefined && allMembers[0].kaiin_no) {
        row[memberNo1Col] = allMembers[0].kaiin_no;
      }
      if (memberBirthCol !== undefined && allMembers[0].birthday) {
        row[memberBirthCol] = allMembers[0].birthday;
      }
    }
    // タグ列: 本入会=持ち主が会員 / 会員保護者=子がいる / 講師
    if (agg.owners.length > 0 && !agg.teacher && phase4ACol !== undefined) row[phase4ACol] = '1';
    if (agg.children.length > 0 && phase4BCol !== undefined) row[phase4BCol] = '1';
    if (agg.teacher && instructorCol !== undefined) row[instructorCol] = '1';

    // スペース有無・並び順だけの差はノイズなので「変更なし」とみなす
    const changed = !!newDisplay && canonicalDisplay(newDisplay) !== canonicalDisplay(currentDisplay);
    if (changed) updatedRows++;
    if (newDisplay) {
      changes.push({
        lstep_id: lid,
        role,
        member_label: memberLabel,
        current_display: currentDisplay,
        new_display: newDisplay,
        changed,
      });
    }
  }

  return { grid, changes, updatedRows, targetRows, totalRows, warnings };
}
