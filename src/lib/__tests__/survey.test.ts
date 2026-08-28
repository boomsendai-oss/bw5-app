import { describe, it, expect } from 'vitest';
import {
  effectiveState,
  validateSurveyDefinition,
  validateResponseInput,
  generateSurveySlug,
  aggregateAnswers,
  crossTab,
  OTHER_KEY,
  type QuestionDef,
  type AnswerRow,
} from '../survey';

// JST 2026-08-28 12:00 ちょうど (= UTC 03:00)
const NOW = new Date('2026-08-28T03:00:00Z');

const baseSurvey = { status: 'open', opens_at: null as string | null, closes_at: null as string | null };

describe('effectiveState (回答期間の実効状態)', () => {
  it('draftは常にdraft', () => {
    expect(effectiveState({ ...baseSurvey, status: 'draft' }, NOW)).toBe('draft');
  });
  it('closedは期間内でも常にclosed(手動closeが優先)', () => {
    expect(
      effectiveState({ status: 'closed', opens_at: '2026-08-01T00:00', closes_at: '2026-09-30T23:59' }, NOW)
    ).toBe('closed');
  });
  it('open+期間未設定はaccepting', () => {
    expect(effectiveState(baseSurvey, NOW)).toBe('accepting');
  });
  it('open+opens_atが未来はscheduled', () => {
    expect(effectiveState({ ...baseSurvey, opens_at: '2026-08-28T12:01' }, NOW)).toBe('scheduled');
  });
  it('open+opens_atちょうどはaccepting', () => {
    expect(effectiveState({ ...baseSurvey, opens_at: '2026-08-28T12:00' }, NOW)).toBe('accepting');
  });
  it('open+closes_atちょうどはaccepting・過ぎたらexpired', () => {
    expect(effectiveState({ ...baseSurvey, closes_at: '2026-08-28T12:00' }, NOW)).toBe('accepting');
    expect(effectiveState({ ...baseSurvey, closes_at: '2026-08-28T11:59' }, NOW)).toBe('expired');
  });
  it('open+期間内はaccepting', () => {
    expect(
      effectiveState({ ...baseSurvey, opens_at: '2026-08-20T00:00', closes_at: '2026-09-10T23:59' }, NOW)
    ).toBe('accepting');
  });
});

const validDef = {
  title: '七ヶ浜クラス増設アンケート',
  intro: 'ご協力お願いします',
  audience: 'member',
  nameNote: 'お名前の記入は任意です。',
  opensAt: '2026-09-01T12:00',
  closesAt: '2026-09-14T23:59',
  questions: [
    {
      questionKey: 'weekday',
      label: '通いやすい曜日',
      qtype: 'multi',
      required: true,
      options: [
        { key: 'mon', label: '月' },
        { key: 'wed', label: '水' },
      ],
      allowOther: false,
    },
    { questionKey: 'voice', label: 'ご要望', qtype: 'text', required: false, options: [], allowOther: false },
  ],
};

describe('validateSurveyDefinition', () => {
  it('正常な定義を受理し正規化して返す', () => {
    const v = validateSurveyDefinition(validDef);
    expect(typeof v).not.toBe('string');
    if (typeof v === 'string') return;
    expect(v.title).toBe('七ヶ浜クラス増設アンケート');
    expect(v.questions).toHaveLength(2);
    expect(v.opensAt).toBe('2026-09-01T12:00');
  });
  it('タイトル空は拒否', () => {
    expect(typeof validateSurveyDefinition({ ...validDef, title: '  ' })).toBe('string');
  });
  it('設問0問は拒否', () => {
    expect(typeof validateSurveyDefinition({ ...validDef, questions: [] })).toBe('string');
  });
  it('question_key重複は拒否', () => {
    const dup = { ...validDef, questions: [validDef.questions[0], { ...validDef.questions[1], questionKey: 'weekday' }] };
    expect(typeof validateSurveyDefinition(dup)).toBe('string');
  });
  it('choice系でoptions空は拒否', () => {
    const bad = { ...validDef, questions: [{ ...validDef.questions[0], options: [] }] };
    expect(typeof validateSurveyDefinition(bad)).toBe('string');
  });
  it('optionsのkey重複は拒否', () => {
    const bad = {
      ...validDef,
      questions: [
        { ...validDef.questions[0], options: [{ key: 'mon', label: '月' }, { key: 'mon', label: '月2' }] },
      ],
    };
    expect(typeof validateSurveyDefinition(bad)).toBe('string');
  });
  it('不正なqtypeは拒否', () => {
    const bad = { ...validDef, questions: [{ ...validDef.questions[1], qtype: 'rating' }] };
    expect(typeof validateSurveyDefinition(bad)).toBe('string');
  });
  it('opens_at > closes_at の逆転は拒否', () => {
    expect(typeof validateSurveyDefinition({ ...validDef, opensAt: '2026-09-20T00:00', closesAt: '2026-09-14T23:59' })).toBe(
      'string'
    );
  });
});

const QS: QuestionDef[] = [
  {
    id: 11,
    questionKey: 'weekday',
    label: '通いやすい曜日',
    qtype: 'multi',
    required: true,
    options: [
      { key: 'mon', label: '月' },
      { key: 'wed', label: '水' },
      { key: 'fri', label: '金' },
    ],
    allowOther: false,
  },
  {
    id: 12,
    questionKey: 'genre',
    label: 'ジャンル',
    qtype: 'multi',
    required: false,
    options: [{ key: 'hiphop', label: 'HIPHOP' }],
    allowOther: true,
  },
  {
    id: 13,
    questionKey: 'temp',
    label: 'できたら通う?',
    qtype: 'single',
    required: true,
    options: [
      { key: 'must', label: '必ず通いたい' },
      { key: 'maybe', label: 'たぶん通う' },
      { key: 'unknown', label: 'わからない' },
    ],
    allowOther: false,
  },
  { id: 14, questionKey: 'voice', label: 'ご要望', qtype: 'text', required: false, options: [], allowOther: false },
];

describe('validateResponseInput', () => {
  it('正常回答を受理(名前trim・任意設問スキップ可)', () => {
    const v = validateResponseInput(QS, {
      name: '  山田太郎 ',
      answers: {
        weekday: { optionKeys: ['mon', 'fri'] },
        temp: { optionKeys: ['must'] },
      },
    });
    expect(typeof v).not.toBe('string');
    if (typeof v === 'string') return;
    expect(v.name).toBe('山田太郎');
    expect(v.answers.find((a) => a.questionKey === 'weekday')?.optionKeys).toEqual(['mon', 'fri']);
    expect(v.answers.find((a) => a.questionKey === 'genre')).toBeUndefined();
  });
  it('名前なしはnull(記名任意)', () => {
    const v = validateResponseInput(QS, { answers: { weekday: { optionKeys: ['mon'] }, temp: { optionKeys: ['maybe'] } } });
    if (typeof v === 'string') throw new Error(v);
    expect(v.name).toBeNull();
  });
  it('required未回答は拒否', () => {
    expect(typeof validateResponseInput(QS, { answers: { temp: { optionKeys: ['must'] } } })).toBe('string');
  });
  it('存在しないquestionKeyは拒否', () => {
    expect(
      typeof validateResponseInput(QS, {
        answers: { weekday: { optionKeys: ['mon'] }, temp: { optionKeys: ['must'] }, hack: { text: 'x' } },
      })
    ).toBe('string');
  });
  it('存在しないoptionKeyは拒否', () => {
    expect(
      typeof validateResponseInput(QS, { answers: { weekday: { optionKeys: ['sun'] }, temp: { optionKeys: ['must'] } } })
    ).toBe('string');
  });
  it('singleに複数選択は拒否', () => {
    expect(
      typeof validateResponseInput(QS, {
        answers: { weekday: { optionKeys: ['mon'] }, temp: { optionKeys: ['must', 'maybe'] } },
      })
    ).toBe('string');
  });
  it('allowOther=falseの設問にotherTextは拒否', () => {
    expect(
      typeof validateResponseInput(QS, {
        answers: { weekday: { optionKeys: ['mon'], otherText: 'POP' }, temp: { optionKeys: ['must'] } },
      })
    ).toBe('string');
  });
  it('allowOther=trueならotherTextだけでも回答になる', () => {
    const v = validateResponseInput(QS, {
      answers: { weekday: { optionKeys: ['mon'] }, temp: { optionKeys: ['must'] }, genre: { otherText: 'POP' } },
    });
    if (typeof v === 'string') throw new Error(v);
    expect(v.answers.find((a) => a.questionKey === 'genre')?.otherText).toBe('POP');
  });
  it('text設問2000字超は拒否', () => {
    expect(
      typeof validateResponseInput(QS, {
        answers: { weekday: { optionKeys: ['mon'] }, temp: { optionKeys: ['must'] }, voice: { text: 'あ'.repeat(2001) } },
      })
    ).toBe('string');
  });
});

describe('generateSurveySlug', () => {
  it('16文字hex・毎回異なる', () => {
    const a = generateSurveySlug();
    const b = generateSurveySlug();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});

// 回答2件: R1=月+金/必ず, R2=月/わからない+ジャンルその他POP+要望テキスト
const ROWS: AnswerRow[] = [
  { response_id: 1, question_id: 11, option_key: 'mon', text_value: null },
  { response_id: 1, question_id: 11, option_key: 'fri', text_value: null },
  { response_id: 1, question_id: 13, option_key: 'must', text_value: null },
  { response_id: 2, question_id: 11, option_key: 'mon', text_value: null },
  { response_id: 2, question_id: 13, option_key: 'unknown', text_value: null },
  { response_id: 2, question_id: 12, option_key: OTHER_KEY, text_value: 'POP' },
  { response_id: 2, question_id: 14, option_key: null, text_value: '土曜に増やしてほしい' },
];

describe('aggregateAnswers', () => {
  it('選択肢ごとの件数・その他・自由記入を集計する', () => {
    const agg = aggregateAnswers(QS, ROWS);
    const weekday = agg.find((a) => a.questionKey === 'weekday')!;
    expect(weekday.total).toBe(2);
    expect(weekday.optionCounts.find((o) => o.key === 'mon')?.count).toBe(2);
    expect(weekday.optionCounts.find((o) => o.key === 'fri')?.count).toBe(1);
    expect(weekday.optionCounts.find((o) => o.key === 'wed')?.count).toBe(0);
    const genre = agg.find((a) => a.questionKey === 'genre')!;
    expect(genre.otherTexts).toEqual(['POP']);
    const voice = agg.find((a) => a.questionKey === 'voice')!;
    expect(voice.texts).toEqual(['土曜に増やしてほしい']);
  });
});

describe('crossTab', () => {
  it('曜日×温度感のマス件数', () => {
    const cells = crossTab(ROWS, 11, 13);
    expect(cells.find((c) => c.rowKey === 'mon' && c.colKey === 'must')?.count).toBe(1);
    expect(cells.find((c) => c.rowKey === 'mon' && c.colKey === 'unknown')?.count).toBe(1);
    expect(cells.find((c) => c.rowKey === 'fri' && c.colKey === 'must')?.count).toBe(1);
    expect(cells.find((c) => c.rowKey === 'fri' && c.colKey === 'unknown')).toBeUndefined();
  });
  it('filterで温度感=「必ず+たぶん」の回答者に絞れる', () => {
    const cells = crossTab(ROWS, 11, 13, { questionId: 13, optionKeys: ['must', 'maybe'] });
    expect(cells.find((c) => c.rowKey === 'mon' && c.colKey === 'must')?.count).toBe(1);
    expect(cells.find((c) => c.rowKey === 'mon' && c.colKey === 'unknown')).toBeUndefined();
  });
});
