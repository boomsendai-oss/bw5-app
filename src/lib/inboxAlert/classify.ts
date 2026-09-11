// 受信箱アラート: Claude Opus 5 でメールを判定する。AIが使えない時はルール判定(見逃さない側)に切り替える。
// 本文はプロンプトに渡すだけで、ログにもDBにも残さない。
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

export function buildUserPrompt(mail: MailForAi, mode: AiReadMode): string {
  return [
    `受信アカウント: ${mail.accountLabel}`,
    `差出人: ${mail.from}`,
    `件名: ${mail.subject}`,
    `受信日時: ${mail.receivedIso}`,
    `読み方: ${mode === 'ai_light' ? '自動送信の可能性が高い(本文は冒頭だけ)' : '人が書いた可能性がある'}`,
    '本文:',
    truncateChars(mail.body, BODY_LIMIT[mode]),
  ].join('\n');
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
  return { tier: o.tier as Tier, kind: o.kind as Kind, summary: truncateChars(o.summary.trim(), 60), aiFailed: false };
}

/** AIが使えない時の判定。全文を読むメール(人が書いた風)は鳴らし、冒頭だけのメールは朝のまとめに回す */
export function fallbackClassification(mode: AiReadMode, error: string): Classification {
  return { tier: mode === 'ai_full' ? 'now' : 'digest', kind: 'other', summary: '', aiFailed: true, error };
}

export async function classifyMail(mail: MailForAi, mode: AiReadMode, callModel: CallModel = callClaude): Promise<ClassifyResult> {
  try {
    const r = await callModel(buildUserPrompt(mail, mode));
    const usage = { inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    if (r.stopReason === 'refusal') return { ...fallbackClassification(mode, 'refusal'), ...usage };
    const parsed = parseClassification(r.text);
    if (!parsed) return { ...fallbackClassification(mode, 'unparseable'), ...usage };
    return { ...parsed, ...usage };
  } catch (e) {
    return { ...fallbackClassification(mode, e instanceof Error ? e.message : String(e)), inputTokens: 0, outputTokens: 0 };
  }
}

/** 1件の判定が長引いてもVercelの60秒上限の中でエラーとして扱えるよう、時間と再試行を絞る(SDK既定は10分・再試行2回) */
export const callClaude: CallModel = async (userPrompt) => {
  const client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
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
