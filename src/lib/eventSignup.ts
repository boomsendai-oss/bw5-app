// 太白区民まつり 出演者募集の純ロジック(DB非依存・vitest対象)。
// ※ このモジュールはクライアント(公開フォーム)からも import されるため、
//   node: 依存を持たない(トークン生成は Web Crypto を使う)。

export const PART_KEYS = ['girls_hh', 'waack', 'hiphop'] as const;
export type PartKey = (typeof PART_KEYS)[number];

export function isPartKey(v: string): v is PartKey {
  return (PART_KEYS as readonly string[]).includes(v);
}

// パートキー → 表示名(ログ用)。DEFAULT_PARTS を参照。
export function partLabel(key: string): string {
  return DEFAULT_PARTS.find((p) => p.key === key)?.label ?? key;
}

// 出演者名は全角カタカナのみ許可（長音符ー・中点・・全角/半角スペースは許可）。
// 名簿を書き起こしやすくするため、ひらがな・漢字・英数字は不可。
const KATAKANA_NAME_RE = /^[゠-ヿ　\s]+$/;
export function isKatakanaName(name: string): boolean {
  return KATAKANA_NAME_RE.test(name);
}

export interface PartDef {
  key: PartKey;
  label: string;
  note?: string;
  lesson?: string; // 振り入れレッスンの曜日(公開フォームに表示)
}

export const DEFAULT_PARTS: PartDef[] = [
  { key: 'girls_hh', label: 'ガールズHIPHOP', lesson: '土曜レッスン' },
  { key: 'waack', label: 'WAACK', lesson: '土曜レッスン' },
  { key: 'hiphop', label: 'HIPHOP', lesson: '木曜レッスン' },
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
      '日時：2026年10月18日(日) 9:30〜15:30（出演時間は当日ご案内）',
      '会場：杜の広場公園（あすと長町1丁目・ゼビオアリーナ仙台 東側）',
      '参加費：お一人 3,000円',
      '衣装：後日ご案内します',
      '申込締切：2026年8月1日(土)',
      '',
      '▼ 練習・レッスンの予約について',
      '出演するパートが決まったら、練習レッスンの予約も HACOMONO から入れてください。',
      '・ガールズHIPHOP / WAACK … 通常の土曜レッスンの中で振り入れします（土曜レッスンをご予約ください）',
      '・HIPHOP … 専用レッスンで振り入れします（下記の各回を HACOMONO からご予約ください）',
      '',
      '▼ HIPHOPパート 練習日程（木曜 18:30〜19:30・コナミスポーツクラブ仙台長町）',
      '8/6・8/20・9/10・9/24・10/8',
      '',
      '▼ 全体リハーサル（2回・できるだけご参加ください）',
      '・9/19(土) 17:30〜19:00　コナスポ',
      '・10/11(日) 18:00〜20:00　太白区文化センター 展示ホール',
      '',
      '⚠ 練習への参加が極端に少ない場合は、出演をお見送りいただくことがあります（特にHIPHOPパート）。',
      '　振り付けを覚えきれないと本番で他の出演者に影響するため、できるだけご参加ください。',
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
    if (!isKatakanaName(name)) return `「${name}」はカタカナで入力してください`;
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
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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
