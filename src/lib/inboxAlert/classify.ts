// 受信箱アラート: Claude Opus 5 でメールを判定する。AIが使えない時はルール判定(見逃さない側)に切り替える。
// 本文はプロンプトに渡すだけで、ログにもDBにも残さない。
// メールは外部の誰でも書ける入力なので、<mail> タグで区切り、要約からURL・連絡先を消す(通知経由の誘導を防ぐ)。
import Anthropic from '@anthropic-ai/sdk';
import { CRITERIA } from './criteria';
import { truncateChars } from './format';
import type { ReadMode } from './prefilter';

export const TIERS = ['now', 'digest', 'count'] as const;
export const KINDS = ['new_inquiry', 'reply', 'money_deadline', 'automation_failure', 'money_later', 'other'] as const;
export type Tier = (typeof TIERS)[number];
export type Kind = (typeof KINDS)[number];
export type AiReadMode = Exclude<ReadMode, 'count_only'>;

export type Classification = { tier: Tier; kind: Kind; summary: string; aiFailed: boolean; error?: string };
export type ClassifyResult = Classification & { inputTokens: number; outputTokens: number };

export type MailForAi = { accountLabel: string; from: string; subject: string; receivedIso: string; body: string };
export type ModelReply = { stopReason: string | null; text: string; inputTokens: number; outputTokens: number };
export type CallModel = (userPrompt: string) => Promise<ModelReply>;

export const MODEL = 'claude-opus-5';
export const FALLBACK_MODEL = 'claude-opus-4-8';
const BODY_LIMIT: Record<AiReadMode, number> = { ai_light: 500, ai_full: 3000 };

/** AIが使えない時でも、これに当たる自動送信メールは朝まで待たせずに鳴らす(「よろしくお願いします」「お問い合わせはこちら」のような定型句では鳴らさない) */
const ACTION_HINT =
  /失敗|エラー|停止|未払|残高不足|期限|至急|緊急|ご対応|ご返信ください|返信をお願い|ご連絡ください|メッセージが届|お問い合わせが届|failed|declined|suspend|past due|overdue|action required|credit balance/i;

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    tier: { type: 'string', enum: [...TIERS] },
    kind: { type: 'string', enum: [...KINDS] },
    summary: { type: 'string' },
  },
  required: ['tier', 'kind', 'summary'],
  additionalProperties: false,
};

/** メール由来の文字列の < > を全角にし、<mail> の区切りを偽装できないようにする(入れ子や大文字でも効く) */
const neutralize = (s: string) => s.replace(/</g, '＜').replace(/>/g, '＞');
const oneLine = (s: string) => neutralize(s).replace(/\s+/g, ' ').trim();

export function buildUserPrompt(mail: MailForAi, mode: AiReadMode): string {
  const body = neutralize(truncateChars(mail.body, BODY_LIMIT[mode]));
  return [
    `受信アカウント: ${mail.accountLabel}`,
    `受信日時(UTC): ${mail.receivedIso}`,
    `読み方: ${mode === 'ai_light' ? '自動送信の可能性が高い(本文は冒頭だけ)' : '人が書いた可能性がある'}`,
    '<mail>',
    `差出人: ${oneLine(mail.from)}`,
    `件名: ${oneLine(mail.subject)}`,
    '本文:',
    body,
    '</mail>',
  ].join('\n');
}

/** 要約からURL・メールアドレス・電話番号を消す(日付・金額・注文番号は残す) */
export function scrubSummary(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/https?:\/\/[\x21-\x7E]+|www\.[\x21-\x7E]+/gi, '[URL]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[メール]')
    .replace(/(?<![\w-])(?:\+81[\d\- ]{9,13}|0\d{1,4}-\d{1,4}-\d{3,4}|0\d{9,10})(?![\w-])/g, '[番号]');
}

export function parseClassification(text: string): Classification | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (!TIERS.includes(o.tier as Tier) || !KINDS.includes(o.kind as Kind) || typeof o.summary !== 'string') return null;
  return {
    tier: o.tier as Tier,
    kind: o.kind as Kind,
    summary: truncateChars(scrubSummary(o.summary).trim(), 60),
    aiFailed: false,
  };
}

/**
 * AIが使えない時の判定。全文を読むメール(人が書いた風)は鳴らす。
 * 冒頭だけのメール(自動送信風)は朝のまとめに回すが、失敗・停止・至急などの言葉があれば鳴らす。
 */
export function fallbackClassification(
  mode: AiReadMode,
  error: string,
  mail?: Pick<MailForAi, 'subject' | 'body'>,
): Classification {
  const hinted = !!mail && ACTION_HINT.test(`${mail.subject}\n${truncateChars(mail.body, 500)}`);
  return { tier: mode === 'ai_full' || hinted ? 'now' : 'digest', kind: 'other', summary: '', aiFailed: true, error };
}

export async function classifyMail(mail: MailForAi, mode: AiReadMode, callModel: CallModel = callClaude): Promise<ClassifyResult> {
  try {
    const r = await callModel(buildUserPrompt(mail, mode));
    const usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    if (r.stopReason === 'refusal') return { ...fallbackClassification(mode, 'refusal', mail), ...usage };
    if (r.stopReason === 'max_tokens') return { ...fallbackClassification(mode, 'max_tokens', mail), ...usage };
    const parsed = parseClassification(r.text);
    if (!parsed) return { ...fallbackClassification(mode, 'unparseable', mail), ...usage };
    return { ...parsed, ...usage };
  } catch (e) {
    return {
      ...fallbackClassification(mode, e instanceof Error ? e.message : String(e), mail),
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

/**
 * 1件の判定が長引いてもVercelの60秒上限の中でエラーとして扱えるよう、時間を絞り再試行しない
 * (SDK既定は10分・再試行2回。失敗は見逃さない側のルール判定に倒れる)
 */
export const callClaude: CallModel = async (userPrompt) => {
  const client = new Anthropic({ timeout: 15_000, maxRetries: 0 });
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: FALLBACK_MODEL }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: [{ type: 'text', text: CRITERIA, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const u = res.usage;
  return {
    stopReason: res.stop_reason,
    text,
    inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens,
  };
};
