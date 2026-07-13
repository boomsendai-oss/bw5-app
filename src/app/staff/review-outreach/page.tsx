// クチコミ声がけリスト (Server Component)
// 家族(保護者)単位で「声がけ済み / 投稿済み」をトラッキングする。
// LINEアタックのスパムフィルタ対策で 1日5件ペース運用 (2026-07-13 TARO合意)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { getAll, getOne } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';
import OutreachList, { type Family } from './OutreachList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REVIEW_GOAL = 40; // 仙台1位ライン (ROCKFOOT 39超え・2026-07-13実測)

type MemberRow = {
  id: number;
  full_name: string;
  member_type: string;
  full_name_kana: string | null;
  fam_name: string;
  has_line: number;
};

export default async function ReviewOutreachPage() {
  const authed = await isAuthorizedServer();
  if (!authed) {
    return (
      <div>
        <StaffPageHeader title="クチコミ声がけリスト" backHref="/staff" />
        <div className="p-4 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">
            ログインが必要です。<a href="/staff" className="text-brand-600 underline">スタッフトップ</a>からログインしてください。
          </p>
        </div>
      </div>
    );
  }

  // 在籍会員(月謝/学割/チケット/休会)を取得。family = rep_name(保護者)単位、無ければ本人。
  const rows = (await getAll(
    `SELECT bm.id, bm.full_name, bm.member_type, bm.full_name_kana,
            COALESCE(NULLIF(TRIM(bm.rep_name), ''), bm.full_name) AS fam_name,
            EXISTS(SELECT 1 FROM member_lstep_links l WHERE l.member_id = bm.id) AS has_line
     FROM boom_members bm
     WHERE bm.status = 'active'
       AND bm.member_type IN ('regular', 'college', 'ticket', '休会')`
  )) as MemberRow[];

  // 家族キーの安定化: 同一fam_nameの全会員(退会含む)の最小idを使う
  const allIds = (await getAll(
    `SELECT COALESCE(NULLIF(TRIM(rep_name), ''), full_name) AS fam_name, MIN(id) AS min_id
     FROM boom_members GROUP BY fam_name`
  )) as { fam_name: string; min_id: number }[];
  const keyByFam = new Map(allIds.map((r) => [r.fam_name, r.min_id]));

  const famMap = new Map<string, Family>();
  const kanaByFam = new Map<string, string>();
  for (const m of rows) {
    let fam = famMap.get(m.fam_name);
    if (!fam) {
      fam = {
        key: keyByFam.get(m.fam_name) ?? m.id,
        name: m.fam_name,
        members: [],
        hasLine: false,
        asked: null,
        posted: null,
      };
      famMap.set(m.fam_name, fam);
    }
    // 保護者名=本人名(大人会員)のときは会員名の重複表示を避ける
    fam.members.push({ name: m.full_name, type: m.member_type });
    if (m.has_line) fam.hasLine = true;
    // 家族の読み仮名 = メンバーのフリガナの最小値(姓は保護者と共通が前提)
    const kana = (m.full_name_kana ?? '').trim();
    if (kana) {
      const cur = kanaByFam.get(m.fam_name);
      if (!cur || kana.localeCompare(cur, 'ja') < 0) kanaByFam.set(m.fam_name, kana);
    }
  }

  // 進捗を結合
  const outreach = (await getAll(
    `SELECT family_key, asked_at, posted_at FROM review_outreach`
  )) as { family_key: number; asked_at: string | null; posted_at: string | null }[];
  const stateByKey = new Map(outreach.map((o) => [o.family_key, o]));
  for (const fam of famMap.values()) {
    const st = stateByKey.get(fam.key);
    if (st) {
      fam.asked = st.asked_at;
      fam.posted = st.posted_at;
    }
  }

  // 並び: あ〜ん順(家族の読み仮名 = メンバーのフリガナ・2026-07-13 TARO指定)
  const families = [...famMap.values()].sort((a, b) => {
    const ka = kanaByFam.get(a.name) ?? a.name;
    const kb = kanaByFam.get(b.name) ?? b.name;
    return ka.localeCompare(kb, 'ja');
  });

  const reviewTotal = Number(
    (await getOne('SELECT COUNT(*) AS n FROM gbp_reviews'))?.n ?? 0
  );

  return (
    <div>
      <StaffPageHeader
        title="クチコミ声がけリスト"
        description="保護者へのお願いLINEの進捗管理。1日5件ペース(スパムフィルタ対策)・見返りの約束はNG"
        backHref="/staff"
      />
      <div className="p-4 max-w-3xl mx-auto space-y-4">
        <OutreachList
          families={families}
          reviewTotal={reviewTotal}
          reviewGoal={REVIEW_GOAL}
        />
      </div>
    </div>
  );
}
