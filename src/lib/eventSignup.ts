// 太白区民まつり 出演者募集の純ロジック(DB非依存・vitest対象)。
import { randomBytes } from 'node:crypto';

export const PART_KEYS = ['girls_hh', 'waack', 'hiphop'] as const;
export type PartKey = (typeof PART_KEYS)[number];

export function isPartKey(v: string): v is PartKey {
  return (PART_KEYS as readonly string[]).includes(v);
}

export interface PartDef {
  key: PartKey;
  label: string;
  note?: string;
}

export const DEFAULT_PARTS: PartDef[] = [
  { key: 'girls_hh', label: 'ガールズHIPHOP' },
  { key: 'waack', label: 'WAACK' },
  { key: 'hiphop', label: 'HIPHOP', note: '長町では調整中(仙台HIPHOP合流等)' },
];

export interface ResolvedSettings {
  parts: PartDef[];
  feeText: string;
  deadline: string;
  introMd: string;
  calendarUrl: string;
  isOpen: boolean;
}

export function defaultSettings(): ResolvedSettings {
  return {
    parts: DEFAULT_PARTS,
    feeText: '参加費：お一人 3,000円',
    deadline: '2026-08-01',
    calendarUrl: '',
    isOpen: true,
    introMd: [
      '## 太白区民まつり2026 出演者募集',
      '',
      '- 日時：2026年10月18日(日) 9:30〜15:30（出演時間は当日ご案内）',
      '- 会場：杜の広場公園（あすと長町1丁目・ゼビオアリーナ仙台 東側）',
      '- 衣装：BOOM Tシャツ',
      '- 参加費：お一人 3,000円',
      '',
      '### 全体リハーサル（2回）',
      '日程は会員向けGoogleカレンダーで公開しています。下のボタンからご確認ください。',
      'HIPHOPパートの練習日程もカレンダーに掲載しています。',
    ].join('\n'),
  };
}

export interface PerformerInput {
  name: string;
  parts: string[];
}
export interface SignupInput {
  understood: boolean;
  note?: string;
  performers: PerformerInput[];
}
export interface ValidatedPerformer {
  name: string;
  parts: PartKey[];
}
export interface ValidatedSignup {
  note: string;
  performers: ValidatedPerformer[];
}

// 検証OKなら ValidatedSignup、NGなら日本語エラー文字列を返す。
export function validateSignupInput(input: SignupInput): ValidatedSignup | string {
  if (!input || !input.understood) return '内容の確認にチェックを入れてください';
  const rows = Array.isArray(input.performers) ? input.performers : [];
  const cleaned: ValidatedPerformer[] = [];
  for (const p of rows) {
    const name = (p?.name ?? '').trim();
    if (!name) continue;
    if (name.length > 50) return '出演者名が長すぎます（50文字以内）';
    const parts = Array.from(new Set((p?.parts ?? []).filter(isPartKey)));
    if (parts.length === 0) return `${name} さんの希望パートを1つ以上選んでください`;
    cleaned.push({ name, parts });
  }
  if (cleaned.length === 0) return '出演者を1人以上入力してください';
  if (cleaned.length > 10) return '一度に登録できるのは10人までです';
  const note = (input.note ?? '').trim().slice(0, 500);
  return { note, performers: cleaned };
}

export function generateEditToken(): string {
  return randomBytes(24).toString('hex');
}

export function countByPart(performers: { parts: PartKey[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of PART_KEYS) out[k] = 0;
  for (const p of performers) {
    for (const k of p.parts) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface SignupRowForCsv {
  performerName: string;
  parts: PartKey[];
  createdAt: string;
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function buildSignupCsv(rows: SignupRowForCsv[], labels: Record<string, string>): string {
  const header = ['出演者名', '希望パート', '申込日時'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const parts = r.parts.map((k) => labels[k] ?? k).join(' / ');
    lines.push([csvCell(r.performerName), csvCell(parts), csvCell(r.createdAt)].join(','));
  }
  return lines.join('\n');
}
