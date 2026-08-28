// アンケート回答CSVエクスポート(スタッフ専用・isAuthorized必須)。
// 列: 回答ID/送信日時/記入名/紐付け会員/紐付け状態/設問ごとに1列(複数選択は;結合)。
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getSurveyById, listResponses } from '@/lib/surveyDb';
import { OTHER_KEY, optionLabel } from '@/lib/survey';

export const dynamic = 'force-dynamic';

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const MATCH_LABELS: Record<string, string> = {
  none: '無記名',
  auto: '自動紐付け',
  confirmed: '紐付け済',
  pending: '確認待ち',
  unmatched: '該当なし',
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const survey = Number.isInteger(id) && id > 0 ? await getSurveyById(id) : null;
  if (!survey) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const responses = await listResponses(id);
  const questions = survey.questions.filter((q) => typeof q.id === 'number');
  const header = ['回答ID', '送信日時', '記入名', '紐付け会員', '会員番号', '紐付け状態', ...questions.map((q) => q.label)];
  const lines = [header.map(csvCell).join(',')];
  for (const r of responses) {
    const byQuestion = new Map<number, string[]>();
    for (const a of r.answers) {
      const q = questions.find((qq) => qq.id === a.questionId);
      if (!q) continue;
      const value =
        a.optionKey === OTHER_KEY
          ? `その他:${a.textValue ?? ''}`
          : a.optionKey
            ? optionLabel(q, a.optionKey)
            : a.textValue ?? '';
      const list = byQuestion.get(a.questionId) ?? [];
      list.push(value);
      byQuestion.set(a.questionId, list);
    }
    const row = [
      String(r.id),
      r.submittedAt,
      r.respondentName ?? '',
      r.memberName ?? '',
      r.memberKaiinNo ?? '',
      MATCH_LABELS[r.matchStatus] ?? r.matchStatus,
      ...questions.map((q) => (byQuestion.get(q.id!) ?? []).join(';')),
    ];
    lines.push(row.map(csvCell).join(','));
  }
  const csv = '﻿' + lines.join('\n') + '\n';
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="survey_${id}_responses.csv"`,
    },
  });
}
