// src/lib/autoLinkDb.ts — 会員 ↔ LINE 自動ひもづけの実行部
//
// 判定(純関数)は autoLink.ts。ここはDBから材料を集め、選ばれたものだけ
// member_lstep_links に追加する。既存行は変更・削除しない(INSERT OR IGNORE + 会員に1件も無いときだけ)。
// 日次の体験予約取込 (/api/staff/operations/trial-import) の最後に呼ばれる。
// route.ts から POST 以外を export すると next build が落ちるため lib に置く (enrollmentMatchDb.ts と同じ理由)。

import { getAll, batch } from '@/lib/db';
import { buildLinkSuggestions, normalizeKana, type Member } from '@/lib/linkSuggest';
import { decideAutoLinks, AUTO_LINK_CONFIDENCE, type AutoLink, type AutoLinkSkip, type ExistingLinkForAuto } from '@/lib/autoLink';

export type AutoLinkSummary = {
  ok: true;
  dry_run: boolean;
  unlinked_members: number;
  /** 追加した件数 (dry_run では追加予定の件数) */
  linked: number;
  no_trial_candidate: number;
  /** 氏名は載せない。会員番号と続柄だけ */
  links: { hacomono_member_id: string; relation: AutoLink['relation'] }[];
  skipped: { hacomono_member_id: string; reason: string }[];
};

export async function runAutoLink({ dryRun }: { dryRun: boolean }): Promise<AutoLinkSummary> {
  const members = (await getAll(
    `SELECT m.id, m.hacomono_member_id, m.full_name, m.full_name_kana
       FROM boom_members m
      WHERE m.status = 'active'
        AND m.full_name_kana IS NOT NULL AND m.full_name_kana != ''
        AND NOT EXISTS (SELECT 1 FROM member_lstep_links ml WHERE ml.member_id = m.id)`
  )) as Member[];

  const empty: AutoLinkSummary = {
    ok: true, dry_run: dryRun, unlinked_members: 0, linked: 0, no_trial_candidate: 0, links: [], skipped: [],
  };
  if (members.length === 0) return empty;

  const suggestions = await buildLinkSuggestions(members);

  const existingLinks = (await getAll(
    `SELECT ml.member_id, ml.lstep_id, bm.full_name_kana AS member_full_name_kana
       FROM member_lstep_links ml
       LEFT JOIN boom_members bm ON bm.id = ml.member_id`
  )) as ExistingLinkForAuto[];

  const friends = (await getAll(
    `SELECT lstep_id FROM lstep_friends WHERE COALESCE(blocked,0) = 0`
  )) as { lstep_id: string }[];
  const activeFriendIds = new Set(friends.map((f) => f.lstep_id));

  const kanaRows = (await getAll(
    `SELECT full_name_kana FROM boom_members WHERE full_name_kana IS NOT NULL AND full_name_kana != ''`
  )) as { full_name_kana: string }[];
  const memberKanaCount = new Map<string, number>();
  for (const r of kanaRows) {
    const k = normalizeKana(r.full_name_kana);
    if (k) memberKanaCount.set(k, (memberKanaCount.get(k) ?? 0) + 1);
  }

  const { links, skipped, noTrialCandidate } = decideAutoLinks({
    suggestions, existingLinks, activeFriendIds, memberKanaCount,
  });

  let inserted = links.length;
  if (!dryRun && links.length > 0) {
    // 判定〜書き込みの間にスタッフ画面で手動確定された会員は触らない (NOT EXISTS)
    const stmts = links.map((l) => ({
      sql: `INSERT OR IGNORE INTO member_lstep_links (member_id, lstep_id, relation, confidence, confirmed_at)
            SELECT ?, ?, ?, ?, CURRENT_TIMESTAMP
             WHERE NOT EXISTS (SELECT 1 FROM member_lstep_links WHERE member_id = ?)`,
      args: [l.member_id, l.lstep_id, l.relation, AUTO_LINK_CONFIDENCE, l.member_id] as (string | number | null)[],
    }));
    inserted = 0;
    for (let i = 0; i < stmts.length; i += 50) {
      const res = await batch(stmts.slice(i, i + 50));
      for (const r of res) inserted += Number(r.rowsAffected ?? 0);
    }
  }

  return {
    ok: true,
    dry_run: dryRun,
    unlinked_members: members.length,
    linked: inserted,
    no_trial_candidate: noTrialCandidate,
    links: links.map((l) => ({ hacomono_member_id: l.hacomono_member_id, relation: l.relation })),
    skipped: skipped.map((s: AutoLinkSkip) => ({ hacomono_member_id: s.hacomono_member_id, reason: s.reason })),
  };
}
