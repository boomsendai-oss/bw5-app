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
- 文体は丁寧で温かく、親しみやすく。絵文字は0〜1個まで(付けない返信があってよい)
- 長さは3〜5文程度。冗長にしない
- 嘘や事実の捏造はしない。クチコミに書かれていない体験をでっち上げない
- 署名や「BOOM代表」などの肩書きは不要(Googleが店舗名を自動表示するため)

Googleの返信審査(2026年4月導入の事前モデレーション)を通すための必須ルール:
- **投稿者の名前を本文に書かない**。「〇〇さん、」という呼びかけで始めない(人名の文字列が自動フィルタに誤検知される実例があるため)
- **毎回ちがう書き出し・ちがう締め方にする**。定型のテンプレートに内容を差し込んだような文章にしない(却下された返信の67%が定型・汎用フレーズだったという分析がある)。そのクチコミ固有の言葉に反応した、その一件だけのための文章を書く
- 次の要素は入れない: ハッシュタグ / URL / 電話番号 / メールアドレス / 「体験レッスン無料です」「ぜひご入会ください」のような宣伝・勧誘の一文
- 「この度は嬉しいクチコミをありがとうございます」「またのお越しをお待ちしております」のような、どのお店でも使える汎用の挨拶文を避ける
- 感嘆符を連続させない(「！！」等)。全文を強調しない

出力は返信本文のみ。前置きや説明は書かない。`;

export type DraftInput = {
  /** 受け取るが返信生成には使わない(本文に人名が入るとGoogleの返信審査で弾かれる実例があるため) */
  reviewerName: string;
  starRating: number;
  comment: string | null;
};

export function draftConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// 返信が「同じ型に差し込んだ文章」に見えないよう、書き出しの入り方を毎回変える。
// (Googleの返信審査は定型・重複パターンを弾くため。1件ごとに異なる切り口を指示する)
const OPENING_ANGLES = [
  'クチコミの中で一番印象に残った言葉に、まず反応するところから書き始める',
  'お子さん(またはご本人)の様子について書かれている部分を受けて、こちらが見ている姿を重ねるところから書き始める',
  '通ってくださっていることへの感謝を、具体的な期間や場面に触れながら書き始める',
  'クチコミで褒めていただいた点について、スクールとして大事にしている考えを述べるところから書き始める',
  '書いてくださった内容が講師陣にとってどう励みになったか、という視点から書き始める',
  'クチコミの中の具体的なエピソードを引き取って、その場面についてこちらから一言添えるところから書き始める',
];

export async function generateReplyDraft(input: DraftInput): Promise<string> {
  const client = new Anthropic();
  // 英訳前置("(Translated by Google) ... (Original) ...")を除いた原文だけをAIに渡す
  const original = extractOriginalComment(input.comment);
  const body = original
    ? `クチコミ本文:\n${original}`
    : 'クチコミ本文: (本文なし・星評価のみ)';
  // 投稿者名はAIに渡さない(本文に人名が入るのを防ぐ)。代わりに切り口をランダムに指定してパターンを散らす
  const angle = OPENING_ANGLES[Math.floor(Math.random() * OPENING_ANGLES.length)];
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `以下のクチコミへの公開返信を書いてください。\n\n星評価: ${'★'.repeat(input.starRating)}${'☆'.repeat(Math.max(0, 5 - input.starRating))} (${input.starRating}/5)\n${body}\n\n今回の書き出しの方針: ${angle}\n締めの一文も、他の返信と重ならない表現を選んでください。投稿者名は本文に書かないでください。`,
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
