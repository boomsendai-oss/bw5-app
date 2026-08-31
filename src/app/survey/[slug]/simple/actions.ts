'use server';

// ⚠️ 公開Server Action(認証なし)。理由: 簡易版アンケートフォーム /survey/[slug]/simple の
// <form action> から呼ばれる(古い端末向けにクライアントJSゼロで動く必要がある)。
// PII対策・レート制限・期限のサーバ側再判定は通常版(../actions.ts)と同一方針。
// 結果はredirect(?done=1 / ?error=...)で返す = JSなしのMPA遷移でも成立する。

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkRateLimit } from '@/lib/eventAuth';
import { effectiveState, validateResponseInput } from '@/lib/survey';
import { parseSimpleFormData } from '@/lib/surveySimpleForm';
import { getSurveyBySlug, submitResponse } from '@/lib/surveyDb';

export async function submitSimpleSurvey(slug: string, formData: FormData): Promise<void> {
  const base = `/survey/${encodeURIComponent(slug)}/simple`;
  let dest = `${base}?done=1`;
  try {
    const h = await headers();
    const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    if (!(await checkRateLimit(`survey:${ip}`, 20, 3600))) {
      dest = `${base}?error=${encodeURIComponent('送信が多すぎます。しばらくしてからお試しください')}`;
    } else if (!/^[0-9a-f]{16}$/.test(slug || '')) {
      dest = `${base}?error=${encodeURIComponent('アンケートが見つかりません')}`;
    } else {
      const survey = await getSurveyBySlug(slug);
      if (!survey || survey.status === 'draft') {
        dest = `${base}?error=${encodeURIComponent('アンケートが見つかりません')}`;
      } else if (effectiveState(survey) !== 'accepting') {
        dest = `${base}?error=${encodeURIComponent('回答の受付期間外です')}`;
      } else {
        const payload = parseSimpleFormData(survey.questions, formData);
        const validated = validateResponseInput(survey.questions, payload, { nameRequired: survey.name_required });
        if (typeof validated === 'string') {
          dest = `${base}?error=${encodeURIComponent(validated)}`;
        } else {
          await submitResponse(survey.id, validated);
        }
      }
    }
  } catch {
    dest = `${base}?error=${encodeURIComponent('送信に失敗しました。時間をおいてもう一度お試しください')}`;
  }
  redirect(dest);
}
