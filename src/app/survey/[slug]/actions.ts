'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: アンケート公開フォーム /survey/[slug] を
// 会員/保護者がLINEで配られたURLから直接開いて叩くため。
//
// PII対策(/ig・/entry と同じ方針):
//   - 回答・名簿を列挙するアクションは提供しない(集計・回答一覧はスタッフ画面側のみ)
//   - 送信はIP単位でレート制限する
//   - 氏名をログに出さない
//   - slugは16桁hexランダム(未公開アンケートの推測列挙を防ぐ)
//   - 回答期限はサーバ側で毎回再判定する(画面表示だけで守らない)

import { headers } from 'next/headers';
import { checkRateLimit, isAuthorizedServer } from '@/lib/eventAuth';
import { effectiveState, validateResponseInput, type EffectiveState, type QuestionDef } from '@/lib/survey';
import { getSurveyBySlug, submitResponse } from '@/lib/surveyDb';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export interface PublicSurveyView {
  found: boolean;
  state: EffectiveState | null;
  title: string;
  intro: string | null;
  nameNote: string | null;
  nameRequired: boolean;
  audience: string;
  opensAt: string | null;
  closesAt: string | null;
  questions: QuestionDef[];
}

const NOT_FOUND: PublicSurveyView = {
  found: false,
  state: null,
  title: '',
  intro: null,
  nameNote: null,
  nameRequired: false,
  audience: 'member',
  opensAt: null,
  closesAt: null,
  questions: [],
};

/** 公開: アンケート定義と受付状態だけを返す。回答データは一切返さない。
 * 例外: draftはスタッフセッションがある場合のみ「プレビュー」として返す(state='draft'・送信は不可)。 */
export async function getPublicSurvey(slug: string): Promise<PublicSurveyView> {
  if (!/^[0-9a-f]{16}$/.test(slug || '')) return NOT_FOUND;
  const survey = await getSurveyBySlug(slug);
  if (!survey) return NOT_FOUND;
  if (survey.status === 'draft') {
    if (!(await isAuthorizedServer())) return NOT_FOUND;
    return {
      found: true,
      state: 'draft',
      title: survey.title,
      intro: survey.intro,
      nameNote: survey.name_note,
      nameRequired: survey.name_required,
      audience: survey.audience,
      opensAt: survey.opens_at,
      closesAt: survey.closes_at,
      questions: survey.questions,
    };
  }
  const state = effectiveState(survey);
  return {
    found: true,
    state,
    title: survey.title,
    intro: survey.intro,
    nameNote: survey.name_note,
    nameRequired: survey.name_required,
    audience: survey.audience,
    opensAt: survey.opens_at,
    closesAt: survey.closes_at,
    // 受付中以外は設問を返さない(表示に不要なデータを出さない)
    questions: state === 'accepting' ? survey.questions : [],
  };
}

export type SubmitSurveyResult = { ok: true } | { ok: false; error: string };

export async function submitSurveyResponse(slug: string, payload: unknown): Promise<SubmitSurveyResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`survey:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  if (!/^[0-9a-f]{16}$/.test(slug || '')) return { ok: false, error: 'アンケートが見つかりません' };
  const survey = await getSurveyBySlug(slug);
  if (!survey || survey.status === 'draft') return { ok: false, error: 'アンケートが見つかりません' };
  if (effectiveState(survey) !== 'accepting') return { ok: false, error: '回答の受付期間外です' };
  const validated = validateResponseInput(survey.questions, payload, { nameRequired: survey.name_required });
  if (typeof validated === 'string') return { ok: false, error: validated };
  await submitResponse(survey.id, validated);
  return { ok: true };
}
