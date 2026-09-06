import { describe, it, expect } from 'vitest';
import { fieldName, parseSimpleFormData } from '../surveySimpleForm';
import { gridCellKey, OTHER_KEY, type QuestionDef } from '../survey';

const QS: QuestionDef[] = [
  {
    id: 1,
    questionKey: 'grade',
    label: '学年',
    qtype: 'multi',
    required: true,
    options: [
      { key: 'es_low', label: '小1〜2' },
      { key: 'adult', label: '大人' },
    ],
    allowOther: false,
  },
  {
    id: 2,
    questionKey: 'temp',
    label: '温度感',
    qtype: 'single',
    required: true,
    options: [
      { key: 'must', label: '必ず' },
      { key: 'maybe', label: 'たぶん' },
    ],
    allowOther: false,
  },
  {
    id: 3,
    questionKey: 'genre',
    label: 'ジャンル',
    qtype: 'multi',
    required: false,
    options: [{ key: 'hiphop', label: 'HIPHOP' }],
    allowOther: true,
  },
  {
    id: 4,
    questionKey: 'schedule',
    label: '曜日×時間帯',
    qtype: 'grid',
    required: true,
    options: [],
    rows: [{ key: 'mon', label: '月曜' }],
    cols: [{ key: 't18', label: '18時台' }],
    allowOther: false,
  },
  { id: 5, questionKey: 'voice', label: '要望', qtype: 'text', required: false, options: [], allowOther: false },
];

// FormDataの最小インターフェース(テスト用)
function fakeForm(entries: Record<string, string[]>) {
  return {
    get: (k: string) => entries[k]?.[0] ?? null,
    getAll: (k: string) => entries[k] ?? [],
  };
}

describe('parseSimpleFormData', () => {
  it('選択・グリッド・その他・自由記入・名前をpayloadに変換する', () => {
    const form = fakeForm({
      [fieldName('name')]: [' 山田太郎 '],
      [fieldName('q', 'grade')]: ['es_low', 'adult'],
      [fieldName('q', 'temp')]: ['must'],
      [fieldName('q', 'genre')]: ['hiphop', OTHER_KEY],
      [fieldName('other', 'genre')]: ['POP'],
      [fieldName('q', 'schedule')]: [gridCellKey('mon', 't18')],
      [fieldName('text', 'voice')]: ['よろしくお願いします'],
    });
    const payload = parseSimpleFormData(QS, form);
    expect(payload.name).toBe('山田太郎');
    expect(payload.answers.grade).toEqual({ optionKeys: ['es_low', 'adult'], otherText: undefined, text: undefined });
    expect(payload.answers.temp?.optionKeys).toEqual(['must']);
    expect(payload.answers.genre).toEqual({ optionKeys: ['hiphop', OTHER_KEY], otherText: 'POP', text: undefined });
    expect(payload.answers.schedule?.optionKeys).toEqual(['mon__t18']);
    expect(payload.answers.voice).toEqual({ optionKeys: undefined, otherText: undefined, text: 'よろしくお願いします' });
  });
  it('未回答の設問はpayloadに含めない・名前空はundefined', () => {
    const form = fakeForm({ [fieldName('q', 'temp')]: ['maybe'] });
    const payload = parseSimpleFormData(QS, form);
    expect(payload.name).toBeUndefined();
    expect(Object.keys(payload.answers)).toEqual(['temp']);
  });
  it('__otherをテキストなしで選んでも有効な回答になる(記述は任意・TARO 2026-09-06)', () => {
    const form = fakeForm({ [fieldName('q', 'temp')]: ['must'], [fieldName('q', 'genre')]: [OTHER_KEY] });
    const payload = parseSimpleFormData(QS, form);
    expect(payload.answers.genre).toEqual({ optionKeys: [OTHER_KEY], otherText: undefined, text: undefined });
  });
});
