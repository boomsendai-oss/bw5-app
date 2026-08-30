// アンケート基盤の純ロジック (WS AO 2026-08-28)
//
// 目的: テーマを変えて量産できるアンケート。定義はDB(surveys/survey_questions)に持ち、
//       スタッフ画面から発行→公開フォーム(/survey/[slug])→集計・会員紐付け。
// 設計書: docs/superpowers/specs/2026-08-28-survey-engine-design.md
//
// ※ このモジュールは公開フォーム(クライアント)からも import されるため node: 依存を持たない。
//   日時は 'YYYY-MM-DDTHH:mm'(JST・分精度) の文字列で保存し、辞書順比較で判定する。

export const QTYPES = ['single', 'multi', 'text', 'grid'] as const;
export type Qtype = (typeof QTYPES)[number];

export const AUDIENCES = ['member', 'public', 'both'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** 「その他(自由記入)」の選択を表す予約option_key。設問定義のoptionsには使えない。 */
export const OTHER_KEY = '__other';

export type EffectiveState = 'draft' | 'scheduled' | 'accepting' | 'expired' | 'closed';

export interface QuestionOption {
  key: string;
  label: string;
}

export interface QuestionDef {
  id?: number;
  questionKey: string;
  label: string;
  qtype: Qtype;
  required: boolean;
  options: QuestionOption[];
  /** grid専用: 行(例=曜日)。検証済み定義では常に配列(grid以外は[])。 */
  rows?: QuestionOption[];
  /** grid専用: 列(例=時間帯)。 */
  cols?: QuestionOption[];
  /**
   * grid専用: trueなら公開フォームで行を先にタップ→その行の列が展開される2段階表示。
   * 全マス見せると「興味がないのに手当たり次第タップ」の水増しが起きるため(TARO 2026-08-28)。
   * 表示だけの違いで、保存形式(セルkey)は同じ。
   */
  gridExpand?: boolean;
  allowOther: boolean;
}

/** gridのセルを表すoption_key。行キーと列キーを'__'で合成する。 */
export function gridCellKey(rowKey: string, colKey: string): string {
  return `${rowKey}__${colKey}`;
}

/** gridの全セルキー(行×列の直積)。 */
export function gridCellKeys(q: QuestionDef): string[] {
  const out: string[] = [];
  for (const r of q.rows ?? []) for (const c of q.cols ?? []) out.push(gridCellKey(r.key, c.key));
  return out;
}

/**
 * option_keyの表示名を引く。gridセルは「行×列」(例: 月曜×18時台)、
 * OTHER_KEYは「その他」、通常設問は選択肢ラベル。CSV/回答一覧/会員履歴で共用する。
 */
export function optionLabel(q: QuestionDef, key: string): string {
  if (key === OTHER_KEY) return 'その他';
  if (q.qtype === 'grid') {
    for (const r of q.rows ?? []) {
      for (const c of q.cols ?? []) {
        if (gridCellKey(r.key, c.key) === key) return `${r.label}×${c.label}`;
      }
    }
    return key;
  }
  return q.options.find((o) => o.key === key)?.label ?? key;
}

export interface ValidatedSurvey {
  title: string;
  intro: string | null;
  audience: Audience;
  nameNote: string | null;
  /** trueなら回答者名の記入が必須(既定=任意)。SHOKO定期化のようにその場回収で全員記名させたい時用。 */
  nameRequired: boolean;
  opensAt: string | null;
  closesAt: string | null;
  questions: QuestionDef[];
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** now を 'YYYY-MM-DDTHH:mm'(JST) に変換。opens_at/closes_at と辞書順比較できる。 */
export function jstMinuteStamp(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * 回答受付の実効状態。cronで状態を書き換えず、リクエスト時に毎回導出する。
 * 手動close(status='closed')は期間設定より常に優先。境界は opens_at/closes_at とも「ちょうど」は受付中。
 */
export function effectiveState(
  survey: { status: string; opens_at?: string | null; closes_at?: string | null },
  now: Date = new Date()
): EffectiveState {
  if (survey.status === 'draft') return 'draft';
  if (survey.status === 'closed') return 'closed';
  const stamp = jstMinuteStamp(now);
  if (survey.opens_at && stamp < survey.opens_at) return 'scheduled';
  if (survey.closes_at && stamp > survey.closes_at) return 'expired';
  return 'accepting';
}

const MAX_TITLE = 100;
const MAX_LABEL = 200;
const MAX_OPTION_LABEL = 100;
const MAX_TEXTAREA = 2000;
const MAX_NAME = 100;
const MAX_OTHER = 200;
const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 30;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const KEY_RE = /^[a-z0-9_]{1,40}$/;

function asTrimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** アンケート定義(スタッフ画面ビルダー入力)の検証。エラーは日本語文字列で返す。 */
export function validateSurveyDefinition(input: unknown): ValidatedSurvey | string {
  if (typeof input !== 'object' || input === null) return '入力形式が不正です';
  const obj = input as Record<string, unknown>;

  const title = asTrimmed(obj.title);
  if (!title) return 'タイトルを入力してください';
  if (title.length > MAX_TITLE) return `タイトルは${MAX_TITLE}文字以内にしてください`;

  const intro = asTrimmed(obj.intro) || null;
  const nameNote = asTrimmed(obj.nameNote) || null;
  const nameRequired = obj.nameRequired === true || obj.nameRequired === 1;

  const audience = asTrimmed(obj.audience) || 'member';
  if (!(AUDIENCES as readonly string[]).includes(audience)) return '対象の指定が不正です';

  const opensAt = asTrimmed(obj.opensAt) || null;
  const closesAt = asTrimmed(obj.closesAt) || null;
  if (opensAt && !DATETIME_RE.test(opensAt)) return '回答開始日時の形式が不正です';
  if (closesAt && !DATETIME_RE.test(closesAt)) return '回答締切日時の形式が不正です';
  if (opensAt && closesAt && opensAt > closesAt) return '回答開始が締切より後になっています';

  if (!Array.isArray(obj.questions) || obj.questions.length === 0) return '設問を1問以上作成してください';
  if (obj.questions.length > MAX_QUESTIONS) return `設問は${MAX_QUESTIONS}問以内にしてください`;

  const questions: QuestionDef[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < obj.questions.length; i++) {
    const raw = obj.questions[i] as Record<string, unknown>;
    if (typeof raw !== 'object' || raw === null) return `設問${i + 1}の形式が不正です`;

    const questionKey = asTrimmed(raw.questionKey);
    if (!KEY_RE.test(questionKey)) return `設問${i + 1}のキーが不正です(半角英数と_のみ)`;
    if (seenKeys.has(questionKey)) return `設問キー「${questionKey}」が重複しています`;
    seenKeys.add(questionKey);

    const label = asTrimmed(raw.label);
    if (!label) return `設問${i + 1}の質問文を入力してください`;
    if (label.length > MAX_LABEL) return `設問${i + 1}の質問文は${MAX_LABEL}文字以内にしてください`;

    const qtype = asTrimmed(raw.qtype);
    if (!(QTYPES as readonly string[]).includes(qtype)) return `設問${i + 1}の回答形式が不正です`;

    const required = raw.required === true || raw.required === 1;
    const allowOther = raw.allowOther === true || raw.allowOther === 1;

    const parseOptionList = (rawList: unknown, listName: string): QuestionOption[] | string => {
      const out: QuestionOption[] = [];
      const seen = new Set<string>();
      const arr = Array.isArray(rawList) ? rawList : [];
      for (let j = 0; j < arr.length; j++) {
        const o = arr[j] as Record<string, unknown>;
        const key = asTrimmed(o?.key);
        const optLabel = asTrimmed(o?.label);
        if (!KEY_RE.test(key)) return `設問${i + 1}の${listName}${j + 1}のキーが不正です`;
        if (key === OTHER_KEY) return `キー「${OTHER_KEY}」は予約されています`;
        if (seen.has(key)) return `設問${i + 1}の${listName}キー「${key}」が重複しています`;
        seen.add(key);
        if (!optLabel) return `設問${i + 1}の${listName}${j + 1}の表示名を入力してください`;
        if (optLabel.length > MAX_OPTION_LABEL) return `設問${i + 1}の${listName}${j + 1}は${MAX_OPTION_LABEL}文字以内にしてください`;
        out.push({ key, label: optLabel });
      }
      if (out.length > MAX_OPTIONS) return `設問${i + 1}の${listName}は${MAX_OPTIONS}個以内にしてください`;
      return out;
    };

    const options = parseOptionList(raw.options, '選択肢');
    if (typeof options === 'string') return options;

    let rows: QuestionOption[] = [];
    let cols: QuestionOption[] = [];
    if (qtype === 'grid') {
      const parsedRows = parseOptionList(raw.rows, '行');
      if (typeof parsedRows === 'string') return parsedRows;
      const parsedCols = parseOptionList(raw.cols, '列');
      if (typeof parsedCols === 'string') return parsedCols;
      rows = parsedRows;
      cols = parsedCols;
      if (rows.length === 0) return `設問${i + 1}(マス目)に行を1つ以上設定してください`;
      if (cols.length === 0) return `設問${i + 1}(マス目)に列を1つ以上設定してください`;
      if (options.length > 0) return `設問${i + 1}(マス目)に選択肢は設定できません`;
    }

    if (qtype === 'text') {
      if (options.length > 0) return `設問${i + 1}(自由記入)に選択肢は設定できません`;
      if (allowOther) return `設問${i + 1}(自由記入)に「その他」枠は不要です`;
    } else if (qtype !== 'grid' && options.length === 0) {
      return `設問${i + 1}に選択肢を1つ以上設定してください`;
    }

    const gridExpand = qtype === 'grid' && (raw.gridExpand === true || raw.gridExpand === 1);
    const id = typeof raw.id === 'number' && Number.isInteger(raw.id) ? raw.id : undefined;
    questions.push({ id, questionKey, label, qtype: qtype as Qtype, required, options, rows, cols, gridExpand, allowOther });
  }

  return { title, intro, audience: audience as Audience, nameNote, nameRequired, opensAt, closesAt, questions };
}

export interface AnswerItem {
  questionKey: string;
  optionKeys: string[];
  otherText: string | null;
  text: string | null;
}

export interface ValidatedResponse {
  name: string | null;
  answers: AnswerItem[];
}

/** 公開フォームからの回答検証。設問定義に対して選択肢・必須・文字数を検査する。 */
export function validateResponseInput(
  questions: QuestionDef[],
  payload: unknown,
  opts?: { nameRequired?: boolean }
): ValidatedResponse | string {
  if (typeof payload !== 'object' || payload === null) return '入力形式が不正です';
  const obj = payload as Record<string, unknown>;

  const name = asTrimmed(obj.name) || null;
  if (opts?.nameRequired && !name) return 'お名前を入力してください';
  if (name && name.length > MAX_NAME) return `お名前は${MAX_NAME}文字以内にしてください`;

  const rawAnswers =
    typeof obj.answers === 'object' && obj.answers !== null ? (obj.answers as Record<string, unknown>) : {};

  const byKey = new Map(questions.map((q) => [q.questionKey, q]));
  for (const key of Object.keys(rawAnswers)) {
    if (!byKey.has(key)) return '不明な設問への回答が含まれています';
  }

  const answers: AnswerItem[] = [];
  for (const q of questions) {
    const raw = rawAnswers[q.questionKey] as Record<string, unknown> | undefined;
    const optionKeys = Array.isArray(raw?.optionKeys) ? raw.optionKeys.map((k) => asTrimmed(k)).filter(Boolean) : [];
    const otherText = asTrimmed(raw?.otherText) || null;
    const text = asTrimmed(raw?.text) || null;

    if (q.qtype === 'text') {
      if (optionKeys.length > 0 || otherText) return `「${q.label}」の回答形式が不正です`;
      if (text && text.length > MAX_TEXTAREA) return `「${q.label}」は${MAX_TEXTAREA}文字以内にしてください`;
      if (q.required && !text) return `「${q.label}」に回答してください`;
      if (text) answers.push({ questionKey: q.questionKey, optionKeys: [], otherText: null, text });
      continue;
    }

    const validKeys = new Set(q.qtype === 'grid' ? gridCellKeys(q) : q.options.map((o) => o.key));
    for (const k of optionKeys) {
      if (!validKeys.has(k)) return `「${q.label}」に不正な選択肢が含まれています`;
    }
    if (new Set(optionKeys).size !== optionKeys.length) return `「${q.label}」の選択が重複しています`;
    if (!q.allowOther && otherText) return `「${q.label}」の回答形式が不正です`;
    if (otherText && otherText.length > MAX_OTHER) return `「${q.label}」のその他は${MAX_OTHER}文字以内にしてください`;
    if (text) return `「${q.label}」の回答形式が不正です`;

    const picked = optionKeys.length + (otherText ? 1 : 0);
    if (q.qtype === 'single' && picked > 1) return `「${q.label}」は1つだけ選択してください`;
    if (q.required && picked === 0) return `「${q.label}」に回答してください`;
    if (picked > 0) answers.push({ questionKey: q.questionKey, optionKeys, otherText, text: null });
  }

  return { name, answers };
}

/** 公開URL用slug(16桁hex)。連番にしない=未公開アンケートの推測列挙を防ぐ。 */
export function generateSurveySlug(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AnswerRow {
  response_id: number;
  question_id: number;
  option_key: string | null;
  text_value: string | null;
}

export interface QuestionAgg {
  questionId: number;
  questionKey: string;
  label: string;
  qtype: Qtype;
  /** この設問に(何かしら)回答した回答者数 */
  total: number;
  optionCounts: { key: string; label: string; count: number }[];
  /** grid専用: セルごとの選択者数(0件セルも含む)。他のqtypeでは空配列。 */
  gridCells: { rowKey: string; colKey: string; count: number }[];
  otherTexts: string[];
  texts: string[];
}

/** 設問ごとの単純集計。選択肢は定義順・未選択も0件で出す。 */
export function aggregateAnswers(questions: QuestionDef[], rows: AnswerRow[]): QuestionAgg[] {
  const byQuestion = new Map<number, AnswerRow[]>();
  for (const r of rows) {
    const list = byQuestion.get(r.question_id) ?? [];
    list.push(r);
    byQuestion.set(r.question_id, list);
  }
  return questions
    .filter((q) => typeof q.id === 'number')
    .map((q) => {
      const qRows = byQuestion.get(q.id!) ?? [];
      const respondents = new Set(qRows.map((r) => r.response_id));
      const counts = new Map<string, number>();
      const otherTexts: string[] = [];
      const texts: string[] = [];
      for (const r of qRows) {
        if (r.option_key === OTHER_KEY) {
          counts.set(OTHER_KEY, (counts.get(OTHER_KEY) ?? 0) + 1);
          if (r.text_value) otherTexts.push(r.text_value);
        } else if (r.option_key) {
          counts.set(r.option_key, (counts.get(r.option_key) ?? 0) + 1);
        } else if (r.text_value) {
          texts.push(r.text_value);
        }
      }
      const optionCounts = q.options.map((o) => ({ key: o.key, label: o.label, count: counts.get(o.key) ?? 0 }));
      if (q.allowOther) optionCounts.push({ key: OTHER_KEY, label: 'その他', count: counts.get(OTHER_KEY) ?? 0 });
      const gridCells: { rowKey: string; colKey: string; count: number }[] = [];
      if (q.qtype === 'grid') {
        for (const r of q.rows ?? []) {
          for (const c of q.cols ?? []) {
            gridCells.push({ rowKey: r.key, colKey: c.key, count: counts.get(gridCellKey(r.key, c.key)) ?? 0 });
          }
        }
      }
      return {
        questionId: q.id!,
        questionKey: q.questionKey,
        label: q.label,
        qtype: q.qtype,
        total: respondents.size,
        optionCounts,
        gridCells,
        otherTexts,
        texts,
      };
    });
}

export interface CrossCell {
  rowKey: string;
  colKey: string;
  count: number;
}

/**
 * クロス集計: 設問A(行)×設問B(列)の選択組み合わせごとに回答者数を数える。
 * multi×multiは1回答者が複数マスに入る(同一マスには1回)。filterで別設問の選択肢により回答者を絞れる
 * (例: 温度感=「必ず+たぶん」だけで曜日×時間帯を見る)。
 */
export function crossTab(
  rows: AnswerRow[],
  rowQuestionId: number,
  colQuestionId: number,
  filter?: { questionId: number; optionKeys: string[] }
): CrossCell[] {
  let allowed: Set<number> | null = null;
  if (filter) {
    allowed = new Set(
      rows
        .filter((r) => r.question_id === filter.questionId && r.option_key && filter.optionKeys.includes(r.option_key))
        .map((r) => r.response_id)
    );
  }
  const rowKeys = new Map<number, string[]>();
  const colKeys = new Map<number, string[]>();
  for (const r of rows) {
    if (!r.option_key) continue;
    if (allowed && !allowed.has(r.response_id)) continue;
    if (r.question_id === rowQuestionId) {
      (rowKeys.get(r.response_id) ?? rowKeys.set(r.response_id, []).get(r.response_id)!).push(r.option_key);
    } else if (r.question_id === colQuestionId) {
      (colKeys.get(r.response_id) ?? colKeys.set(r.response_id, []).get(r.response_id)!).push(r.option_key);
    }
  }
  const cellCounts = new Map<string, number>();
  for (const [responseId, rks] of rowKeys) {
    const cks = colKeys.get(responseId);
    if (!cks) continue;
    const seen = new Set<string>();
    for (const rk of rks) {
      for (const ck of cks) {
        const cell = `${rk} ${ck}`;
        if (seen.has(cell)) continue;
        seen.add(cell);
        cellCounts.set(cell, (cellCounts.get(cell) ?? 0) + 1);
      }
    }
  }
  return Array.from(cellCounts, ([cell, count]) => {
    const [rowKey, colKey] = cell.split(' ');
    return { rowKey, colKey, count };
  });
}
