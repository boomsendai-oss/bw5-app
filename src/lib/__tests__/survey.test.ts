import { describe, it, expect } from 'vitest';
import {
  effectiveState,
  validateSurveyDefinition,
  validateResponseInput,
  generateSurveySlug,
  aggregateAnswers,
  crossTab,
  gridCellKey,
  gridCellKeys,
  optionLabel,
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

describe('nameRequired (回答者名の必須設定)', () => {
  it('定義: nameRequiredを保持する(既定false)', () => {
    const v1 = validateSurveyDefinition({ ...validDef, nameRequired: true });
    if (typeof v1 === 'string') throw new Error(v1);
    expect(v1.nameRequired).toBe(true);
    const v2 = validateSurveyDefinition(validDef);
    if (typeof v2 === 'string') throw new Error(v2);
    expect(v2.nameRequired).toBe(false);
  });
  it('回答: nameRequired=trueで名前なしは拒否・ありは受理', () => {
    const payload = { answers: { weekday: { optionKeys: ['mon'] }, temp: { optionKeys: ['must'] } } };
    expect(typeof validateResponseInput(QS, payload, { nameRequired: true })).toBe('string');
    const ok = validateResponseInput(QS, { ...payload, name: '山田太郎' }, { nameRequired: true });
    expect(typeof ok).not.toBe('string');
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

const GRID_Q: QuestionDef = {
  id: 21,
  questionKey: 'schedule',
  label: '通える曜日と時間帯',
  qtype: 'grid',
  required: true,
  options: [],
  rows: [
    { key: 'mon', label: '月曜' },
    { key: 'thu', label: '木曜' },
    { key: 'sat', label: '土曜' },
  ],
  cols: [
    { key: 't16', label: '16時台' },
    { key: 't18', label: '18時台' },
    { key: 'am', label: '午前' },
  ],
  allowOther: false,
};

describe('grid設問 (曜日×時間帯のマス目)', () => {
  it('定義: 正常なgridを受理する', () => {
    const v = validateSurveyDefinition({
      title: 'g',
      questions: [
        {
          questionKey: 'schedule',
          label: '通える曜日と時間帯',
          qtype: 'grid',
          required: true,
          options: [],
          rows: [{ key: 'mon', label: '月曜' }],
          cols: [{ key: 't18', label: '18時台' }],
          allowOther: false,
        },
      ],
    });
    expect(typeof v).not.toBe('string');
    if (typeof v === 'string') return;
    expect(v.questions[0].rows).toHaveLength(1);
    expect(v.questions[0].cols).toHaveLength(1);
  });
  it('定義: gridExpand(2段階表示)フラグを保持する・grid以外では立たない', () => {
    const v = validateSurveyDefinition({
      title: 'g',
      questions: [
        {
          questionKey: 's',
          label: 'x',
          qtype: 'grid',
          required: false,
          options: [],
          rows: [{ key: 'a', label: 'A' }],
          cols: [{ key: 'b', label: 'B' }],
          gridExpand: true,
          allowOther: false,
        },
      ],
    });
    if (typeof v === 'string') throw new Error(v);
    expect(v.questions[0].gridExpand).toBe(true);
    const v2 = validateSurveyDefinition({ ...validDef, questions: [{ ...validDef.questions[0], gridExpand: true }] });
    if (typeof v2 === 'string') throw new Error(v2);
    expect(v2.questions[0].gridExpand).toBe(false);
  });
  it('定義: gridで行または列が空は拒否', () => {
    const base = { questionKey: 's', label: 'x', qtype: 'grid', required: false, options: [], allowOther: false };
    expect(
      typeof validateSurveyDefinition({ title: 'g', questions: [{ ...base, rows: [], cols: [{ key: 'a', label: 'A' }] }] })
    ).toBe('string');
    expect(
      typeof validateSurveyDefinition({ title: 'g', questions: [{ ...base, rows: [{ key: 'a', label: 'A' }], cols: [] }] })
    ).toBe('string');
  });
  it('定義: grid以外にrows/colsを渡しても無視される', () => {
    const v = validateSurveyDefinition(validDef);
    if (typeof v === 'string') throw new Error(v);
    expect(v.questions[0].rows).toEqual([]);
  });
  it('回答: セル選択(複数曜日×各時間帯)を受理する', () => {
    const v = validateResponseInput([GRID_Q], {
      answers: {
        schedule: { optionKeys: [gridCellKey('mon', 't18'), gridCellKey('thu', 't16'), gridCellKey('sat', 'am')] },
      },
    });
    expect(typeof v).not.toBe('string');
    if (typeof v === 'string') return;
    expect(v.answers[0].optionKeys).toHaveLength(3);
  });
  it('回答: 存在しないセルは拒否', () => {
    expect(
      typeof validateResponseInput([GRID_Q], { answers: { schedule: { optionKeys: [gridCellKey('sun', 't18')] } } })
    ).toBe('string');
  });
  it('回答: requiredのgrid未選択は拒否', () => {
    expect(typeof validateResponseInput([GRID_Q], { answers: {} })).toBe('string');
  });
  it('集計: セルごとの件数がgridCellsに出る', () => {
    const rows: AnswerRow[] = [
      { response_id: 1, question_id: 21, option_key: gridCellKey('mon', 't18'), text_value: null },
      { response_id: 2, question_id: 21, option_key: gridCellKey('mon', 't18'), text_value: null },
      { response_id: 2, question_id: 21, option_key: gridCellKey('sat', 'am'), text_value: null },
    ];
    const agg = aggregateAnswers([GRID_Q], rows);
    expect(agg[0].total).toBe(2);
    expect(agg[0].gridCells.find((c) => c.rowKey === 'mon' && c.colKey === 't18')?.count).toBe(2);
    expect(agg[0].gridCells.find((c) => c.rowKey === 'sat' && c.colKey === 'am')?.count).toBe(1);
  });
  it('optionLabel: gridセルは「行×列」で表示・その他/通常選択肢も解決', () => {
    expect(optionLabel(GRID_Q, gridCellKey('mon', 't18'))).toBe('月曜×18時台');
    expect(optionLabel(QS[0], 'mon')).toBe('月');
    expect(optionLabel(QS[1], OTHER_KEY)).toBe('その他');
  });
});

describe('grid rowCols (行ごとの選択肢制限)', () => {
  const RESTRICTED: QuestionDef = {
    ...GRID_Q,
    id: 31,
    questionKey: 'mtg',
    rows: [
      { key: 'sep12', label: '9/12(土)' },
      { key: 'sep19', label: '9/19(土)' },
    ],
    cols: [
      { key: 's18', label: '18時' },
      { key: 's19', label: '19時' },
      { key: 's20', label: '20時' },
    ],
    rowCols: { sep19: ['s20'] },
  };
  it('gridCellKeys: rowColsで制限された行はそのセルだけ', () => {
    expect(gridCellKeys(RESTRICTED)).toEqual(['sep12__s18', 'sep12__s19', 'sep12__s20', 'sep19__s20']);
  });
  it('回答: 制限外セル(9/19の18時)は拒否・許可セルは受理', () => {
    expect(
      typeof validateResponseInput([RESTRICTED], { answers: { mtg: { optionKeys: [gridCellKey('sep19', 's18')] } } })
    ).toBe('string');
    const ok = validateResponseInput([RESTRICTED], { answers: { mtg: { optionKeys: [gridCellKey('sep19', 's20')] } } });
    expect(typeof ok).not.toBe('string');
  });
  it('定義: rowColsを保持する(不正な行キー・列キーは拒否)', () => {
    const base = {
      title: 'g',
      questions: [
        {
          questionKey: 'mtg',
          label: 'x',
          qtype: 'grid',
          required: true,
          options: [],
          rows: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
          cols: [{ key: 'c1', label: 'C1' }, { key: 'c2', label: 'C2' }],
          rowCols: { b: ['c2'] },
          allowOther: false,
        },
      ],
    };
    const v = validateSurveyDefinition(base);
    if (typeof v === 'string') throw new Error(v);
    expect(v.questions[0].rowCols).toEqual({ b: ['c2'] });
    const bad = JSON.parse(JSON.stringify(base));
    bad.questions[0].rowCols = { zzz: ['c1'] };
    expect(typeof validateSurveyDefinition(bad)).toBe('string');
  });
  it('集計: gridCellsは許可セルのみ', () => {
    const rows: AnswerRow[] = [{ response_id: 1, question_id: 31, option_key: 'sep19__s20', text_value: null }];
    const agg = aggregateAnswers([RESTRICTED], rows);
    expect(agg[0].gridCells.map((c) => `${c.rowKey}__${c.colKey}`)).toEqual([
      'sep12__s18', 'sep12__s19', 'sep12__s20', 'sep19__s20',
    ]);
    expect(agg[0].gridCells.find((c) => c.rowKey === 'sep19' && c.colKey === 's20')?.count).toBe(1);
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
