// クチコミ返信ドラフト生成 (T-178)
// Claude API (claude-sonnet-4-6) で返信案を作る。投稿は必ず人間の承認後。
import Anthropic from '@anthropic-ai/sdk';
import { extractOriginalComment } from './gbpText';

// 返信ポリシー: docs/指示書_GBPクチコミ自動返信システム_20260611.md フェーズ4
// (出典: Googleクチコミ返信の全体戦略)
const SYSTEM_PROMPT = `あなたは仙台のキッズダンススクール「BOOM」のオーナーとして、Googleビジネスプロフィールのクチコミに公開返信を書きます。

返信ポリシー(厳守):
- 公開返信は「入会を検討中の見込み客」が読む前提で書く。クチコミ投稿者だけでなく、未来のお客さんへのメッセージでもある
- 感謝は具体的に。クチコミ本文の褒めポイントを引用・言及する(汎用的な定型文にしない)
- 価格への不満には、値下げも値上げも一切約束しない。料金の背景や透明性、誠実な姿勢で対応する
- ネガティブな内容には真摯に受け止めて改善姿勢を示す。言い訳しない。反論しない
- 文体は丁寧で温かく、親しみやすく。絵文字は1〜2個まで
- 長さは3〜5文程度。冗長にしない
- 嘘や事実の捏造はしない。クチコミに書かれていない体験をでっち上げない
- 署名や「BOOM代表」などの肩書きは不要(Googleが店舗名を自動表示するため)

出力は返信本文のみ。前置きや説明は書かない。`;

export type DraftInput = {
  reviewerName: string;
  starRating: number;
  comment: string | null;
};

export function draftConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function generateReplyDraft(input: DraftInput): Promise<string> {
  const client = new Anthropic();
  // 英訳前置("(Translated by Google) ... (Original) ...")を除いた原文だけをAIに渡す
  const original = extractOriginalComment(input.comment);
  const body = original
    ? `クチコミ本文:\n${original}`
    : 'クチコミ本文: (本文なし・星評価のみ)';
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `以下のクチコミへの公開返信を書いてください。\n\n投稿者: ${input.reviewerName || '(匿名)'}\n星評価: ${'★'.repeat(input.starRating)}${'☆'.repeat(Math.max(0, 5 - input.starRating))} (${input.starRating}/5)\n${body}`,
      },
    ],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('ドラフト生成結果が空でした');
  return text;
}
