// src/lib/autoLink.ts — 会員 ↔ LINE(Lステップ友だちID) の自動ひもづけ判定 (純関数)
//
// 背景: member_lstep_links は 2026-05-17 にまとめて作ったあと、スタッフ画面の
// 「候補→手動確定」しか経路がなく、10月以降の新入会者が未連携のまま残っていた。
// BOOMは「体験を受けないと入会できない」運用なので、体験予約の友だちIDから高い精度で
// ひもづけられる (linkSuggest.ts 冒頭コメント参照)。
//
// ここでは linkSuggest.buildLinkSuggestions の結果のうち、**誤結合の心配がない候補だけ**を選ぶ。
// 迷うものは全部見送り(=従来どおりスタッフ画面の候補に残る)。判定は保守的に倒す:
//   1. 体験予約由来の候補がちょうど1つ (表示名由来の候補は根拠が弱いので数えない)
//   2. その候補の confidence が '高' (同名複数・年齢不一致・本人/保護者が決められない中高生は '中' に落ちている)
//   3. 体験予約の「カナ名」と完全一致 (漢字氏名だけの一致は見送り)
//   4. 続柄が 本人 / 保護者 (講師は自動にしない)
//   5. そのLINEがLステップの友だち一覧にあり、ブロックされていない
//   6. 同じカナ名の会員が他にいない (同姓同名の会員がいると、どちらの体験か決められない)
//   7. そのLINEが既に別の会員にひもづいている場合は、同じ姓の会員(兄弟・親子)で、
//      今回が「保護者」としてのひもづけのときだけ認める。今回の自動分どうしでも同じ扱い。
//
// 既存のひもづけは変更・削除しない (追加だけ)。書き込みは autoLinkDb.ts。

import { normalizeKana, type LinkSuggestion } from './linkSuggest';

/** 自動でひもづけた行の member_lstep_links.confidence。人が確認した '確実'/'推定' と区別する */
export const AUTO_LINK_CONFIDENCE = '自動';

export type AutoLink = {
  member_id: number;
  hacomono_member_id: string;
  lstep_id: string;
  relation: '本人' | '保護者';
};

export type AutoLinkSkip = {
  member_id: number;
  hacomono_member_id: string;
  reason: string;
};

export type ExistingLinkForAuto = {
  member_id: number;
  lstep_id: string;
  member_full_name_kana: string | null;
};

/** "ヤマダ タロウ" → "ヤマダ"。空白が無い場合は判定できないので '' */
export function surnameKana(fullKana: string | null | undefined): string {
  const parts = (fullKana ?? '').trim().split(/[\s　]+/).filter(Boolean);
  if (parts.length < 2) return '';
  return normalizeKana(parts[0]);
}

export function decideAutoLinks(args: {
  /** 未ひもづけ会員ぶんの候補 (buildLinkSuggestions の戻り値) */
  suggestions: LinkSuggestion[];
  /** 既存の member_lstep_links (会員カナ付き) */
  existingLinks: ExistingLinkForAuto[];
  /** Lステップの友だちのうちブロックされていない友だちID */
  activeFriendIds: Set<string>;
  /** 全会員(在籍・退会とも)の正規化カナ名 → 人数 */
  memberKanaCount: Map<string, number>;
}): { links: AutoLink[]; skipped: AutoLinkSkip[]; noTrialCandidate: number } {
  const { suggestions, existingLinks, activeFriendIds, memberKanaCount } = args;

  // lstep_id → 既にひもづいている会員の姓カナ
  const linkedSurnames = new Map<string, { member_id: number; surname: string }[]>();
  for (const l of existingLinks) {
    if (!linkedSurnames.has(l.lstep_id)) linkedSurnames.set(l.lstep_id, []);
    linkedSurnames.get(l.lstep_id)!.push({ member_id: l.member_id, surname: surnameKana(l.member_full_name_kana) });
  }

  const skipped: AutoLinkSkip[] = [];
  let noTrialCandidate = 0;
  const tentative: (AutoLink & { surname: string })[] = [];

  for (const s of suggestions) {
    const skip = (reason: string) =>
      skipped.push({ member_id: s.member_id, hacomono_member_id: s.hacomono_member_id, reason });

    const trial = s.candidates.filter((c) => c.source === '体験予約');
    if (trial.length === 0) {
      noTrialCandidate += 1;
      continue;
    }
    if (trial.length > 1) { skip(`体験予約の候補が${trial.length}件`); continue; }
    const c = trial[0];
    if (c.confidence !== '高') {
      const why = c.reasons.filter((r) => /要確認/.test(r)).join(' / ');
      skip(`確度が中${why ? `(${why})` : ''}`);
      continue;
    }
    if (c.match_key !== 'カナ') { skip('体験予約とカナ名が一致しない(漢字氏名のみ一致)'); continue; }
    if (c.relation_suggestion !== '本人' && c.relation_suggestion !== '保護者') {
      skip(`続柄が${c.relation_suggestion}`);
      continue;
    }
    if (!activeFriendIds.has(c.lstep_id)) { skip('LINEが友だち一覧に無い/ブロック中'); continue; }
    const kana = normalizeKana(s.full_name_kana);
    if ((memberKanaCount.get(kana) ?? 0) > 1) { skip('同じカナ名の会員が複数'); continue; }

    const surname = surnameKana(s.full_name_kana);
    const others = (linkedSurnames.get(c.lstep_id) ?? []).filter((o) => o.member_id !== s.member_id);
    if (others.length > 0) {
      const family = c.relation_suggestion === '保護者' && surname !== '' && others.every((o) => o.surname === surname);
      if (!family) { skip('そのLINEは別の会員にひもづけ済み(家族と確認できない)'); continue; }
    }
    tentative.push({
      member_id: s.member_id,
      hacomono_member_id: s.hacomono_member_id,
      lstep_id: c.lstep_id,
      relation: c.relation_suggestion,
      surname,
    });
  }

  // 今回の自動分どうしで同じLINEを取り合う場合も、同じ姓の保護者ひもづけだけ認める
  const byLstep = new Map<string, (AutoLink & { surname: string })[]>();
  for (const t of tentative) {
    if (!byLstep.has(t.lstep_id)) byLstep.set(t.lstep_id, []);
    byLstep.get(t.lstep_id)!.push(t);
  }
  const links: AutoLink[] = [];
  for (const group of byLstep.values()) {
    const ok =
      group.length === 1 ||
      group.every((g) => g.relation === '保護者' && g.surname !== '' && g.surname === group[0].surname);
    for (const g of group) {
      if (ok) {
        links.push({ member_id: g.member_id, hacomono_member_id: g.hacomono_member_id, lstep_id: g.lstep_id, relation: g.relation });
      } else {
        skipped.push({ member_id: g.member_id, hacomono_member_id: g.hacomono_member_id, reason: '同じLINEに複数の会員が当たった(家族と確認できない)' });
      }
    }
  }
  links.sort((a, b) => a.member_id - b.member_id);
  return { links, skipped, noTrialCandidate };
}
