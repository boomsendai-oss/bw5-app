// 簡易版アンケートフォーム(/survey/[slug]/simple)の純ロジック (WS AO 2026-08-31)
//
// 背景: Next.js 16のクライアントJSはSafari 16.4+専用(ES2022)で、それより古い端末
// (iOS 16.3以前=iPhone 7等)では構文エラーでハイドレーションが死に、通常版が
// 「読み込み中…」のまま白く見える。簡易版はサーバレンダリングの素のHTMLフォーム
// (form action=Server Action)だけで完結し、クライアントJSゼロでも送信できる。
//
// フィールド命名: name / q_<questionKey>(選択・チェックボックス) /
// other_<questionKey>(その他の自由記入) / text_<questionKey>(自由記入設問)

import { OTHER_KEY, type QuestionDef } from './survey';

/** FormDataの最小インターフェース(テストで差し替えられるように) */
export interface FormLike {
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

export function fieldName(kind: 'name' | 'q' | 'other' | 'text', questionKey?: string): string {
  if (kind === 'name') return 'name';
  return `${kind}_${questionKey}`;
}

/** FormData → validateResponseInput が受けるpayload形へ変換。検証はvalidate側に任せる。 */
export function parseSimpleFormData(
  questions: QuestionDef[],
  form: FormLike
): { name?: string; answers: Record<string, { optionKeys?: string[]; otherText?: string; text?: string }> } {
  const rawName = form.get(fieldName('name'));
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;

  const answers: Record<string, { optionKeys?: string[]; otherText?: string; text?: string }> = {};
  for (const q of questions) {
    if (q.qtype === 'text') {
      const raw = form.get(fieldName('text', q.questionKey));
      const text = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
      if (text) answers[q.questionKey] = { optionKeys: undefined, otherText: undefined, text };
      continue;
    }
    const picked = form
      .getAll(fieldName('q', q.questionKey))
      .filter((v): v is string => typeof v === 'string' && v !== '');
    let otherText: string | undefined;
    if (q.allowOther && picked.includes(OTHER_KEY)) {
      const raw = form.get(fieldName('other', q.questionKey));
      otherText = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
    }
    if (picked.length > 0) {
      answers[q.questionKey] = { optionKeys: picked, otherText, text: undefined };
    }
  }
  return { name, answers };
}
