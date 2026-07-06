import { describe, it, expect } from 'vitest';
import {
  minutesBetween,
  buildExpandedKeys,
  isInactiveStatus,
  isMasterOutOfRange,
  expandMasterSlots,
  expandMasterSlotsRange,
} from '../lessonResolver';

// ── minutesBetween ──

describe('minutesBetween', () => {
  it('正常な時間差を計算', () => {
    expect(minutesBetween('09:00', '10:30')).toBe(90);
    expect(minutesBetween('14:00', '15:00')).toBe(60);
  });

  it('同一時刻は0', () => {
    expect(minutesBetween('10:00', '10:00')).toBe(0);
  });

  it('空文字は0', () => {
    expect(minutesBetween('', '10:00')).toBe(0);
    expect(minutesBetween('09:00', '')).toBe(0);
    expect(minutesBetween('', '')).toBe(0);
  });
});

// ── buildExpandedKeys ──

describe('buildExpandedKeys', () => {
  it('master_id + date のキーを生成', () => {
    const instances = [
      { master_id: 1, date: '2026-06-01' },
      { master_id: 2, date: '2026-06-01' },
      { master_id: 1, date: '2026-06-08' },
    ];
    const keys = buildExpandedKeys(instances);
    expect(keys.size).toBe(3);
    expect(keys.has('1_2026-06-01')).toBe(true);
    expect(keys.has('2_2026-06-01')).toBe(true);
    expect(keys.has('1_2026-06-08')).toBe(true);
  });

  it('master_id が null のインスタンスはスキップ', () => {
    const instances = [
      { master_id: null, date: '2026-06-01' },
      { master_id: 3, date: '2026-06-01' },
    ];
    const keys = buildExpandedKeys(instances);
    expect(keys.size).toBe(1);
    expect(keys.has('3_2026-06-01')).toBe(true);
  });

  it('cancelled/removed もキーに含める（展開抑止用）', () => {
    const instances = [
      { master_id: 1, date: '2026-06-01', status: 'cancelled' },
      { master_id: 2, date: '2026-06-01', status: 'removed' },
    ];
    const keys = buildExpandedKeys(instances);
    expect(keys.size).toBe(2);
  });

  it('空配列は空セット', () => {
    expect(buildExpandedKeys([]).size).toBe(0);
  });
});

// ── isInactiveStatus ──

describe('isInactiveStatus', () => {
  it('cancelled は非アクティブ', () => {
    expect(isInactiveStatus('cancelled')).toBe(true);
  });

  it('removed は非アクティブ', () => {
    expect(isInactiveStatus('removed')).toBe(true);
  });

  it('scheduled はアクティブ', () => {
    expect(isInactiveStatus('scheduled')).toBe(false);
  });

  it('空文字はアクティブ', () => {
    expect(isInactiveStatus('')).toBe(false);
  });
});

// ── isMasterOutOfRange ──

describe('isMasterOutOfRange', () => {
  it('start_date 前は範囲外', () => {
    expect(isMasterOutOfRange({ start_date: '2026-06-10' }, '2026-06-09')).toBe(true);
  });

  it('start_date 当日は範囲内', () => {
    expect(isMasterOutOfRange({ start_date: '2026-06-10' }, '2026-06-10')).toBe(false);
  });

  it('end_date 後は範囲外', () => {
    expect(isMasterOutOfRange({ end_date: '2026-06-20' }, '2026-06-21')).toBe(true);
  });

  it('end_date 当日は範囲内', () => {
    expect(isMasterOutOfRange({ end_date: '2026-06-20' }, '2026-06-20')).toBe(false);
  });

  it('start_date/end_date がなければ常に範囲内', () => {
    expect(isMasterOutOfRange({}, '2026-06-15')).toBe(false);
    expect(isMasterOutOfRange({ start_date: null, end_date: null }, '2026-06-15')).toBe(false);
  });
});

// ── expandMasterSlots ──

describe('expandMasterSlots', () => {
  // 2026-06: 月曜=1,8,15,22,29  水曜=3,10,17,24
  const masters = [
    { id: 1, default_day_of_week: 1 }, // 月曜
    { id: 2, default_day_of_week: 3 }, // 水曜
  ];

  it('月内の全該当日を展開', () => {
    const slots = expandMasterSlots('2026-06', masters, new Set());
    const master1Slots = slots.filter(s => s.master.id === 1);
    const master2Slots = slots.filter(s => s.master.id === 2);
    // 2026年6月の月曜: 1,8,15,22,29
    expect(master1Slots.map(s => s.dateStr)).toEqual([
      '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29',
    ]);
    // 水曜: 3,10,17,24
    expect(master2Slots.map(s => s.dateStr)).toEqual([
      '2026-06-03', '2026-06-10', '2026-06-17', '2026-06-24',
    ]);
  });

  it('expandedKeys にあるスロットはスキップ', () => {
    const expanded = new Set(['1_2026-06-08', '2_2026-06-10']);
    const slots = expandMasterSlots('2026-06', masters, expanded);
    expect(slots.find(s => s.dateStr === '2026-06-08' && s.master.id === 1)).toBeUndefined();
    expect(slots.find(s => s.dateStr === '2026-06-10' && s.master.id === 2)).toBeUndefined();
    // 他の日は展開される
    expect(slots.find(s => s.dateStr === '2026-06-01' && s.master.id === 1)).toBeDefined();
    expect(slots.find(s => s.dateStr === '2026-06-03' && s.master.id === 2)).toBeDefined();
  });

  it('dow が返る', () => {
    const slots = expandMasterSlots('2026-06', masters, new Set());
    for (const s of slots) {
      if (s.master.id === 1) expect(s.dow).toBe(1); // 月曜
      if (s.master.id === 2) expect(s.dow).toBe(3); // 水曜
    }
  });

  it('master が空なら空配列', () => {
    expect(expandMasterSlots('2026-06', [], new Set())).toEqual([]);
  });

  it('end_date を過ぎた日は展開しない(終了クラスへの誤支給防止 A-1)', () => {
    // 月曜master が 2026-06-15 で終了 → 06-22, 06-29 は生成されない
    const ending = [{ id: 1, default_day_of_week: 1, end_date: '2026-06-15' }];
    const slots = expandMasterSlots('2026-06', ending, new Set());
    expect(slots.map(s => s.dateStr)).toEqual(['2026-06-01', '2026-06-08', '2026-06-15']);
  });

  it('start_date より前の日は展開しない', () => {
    // 月曜master が 2026-06-15 開講 → 06-01, 06-08 は生成されない
    const starting = [{ id: 1, default_day_of_week: 1, start_date: '2026-06-15' }];
    const slots = expandMasterSlots('2026-06', starting, new Set());
    expect(slots.map(s => s.dateStr)).toEqual(['2026-06-15', '2026-06-22', '2026-06-29']);
  });
});

// ── expandMasterSlotsRange ──

describe('expandMasterSlotsRange', () => {
  const masters = [
    { id: 1, default_day_of_week: 0 }, // 日曜
  ];

  it('日付範囲内の該当曜日を展開', () => {
    // 2026-06-01(月)〜2026-06-14(日) の日曜 = 6/7, 6/14
    const slots = expandMasterSlotsRange('2026-06-01', '2026-06-14', masters, new Set());
    expect(slots.map(s => s.dateStr)).toEqual(['2026-06-07', '2026-06-14']);
  });

  it('confirmedMonths の月はスキップ', () => {
    const confirmed = new Set(['2026-06']);
    const slots = expandMasterSlotsRange('2026-06-01', '2026-07-31', masters, new Set(), confirmed);
    // 6月はスキップ、7月のみ展開
    expect(slots.every(s => s.dateStr.startsWith('2026-07'))).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('expandedKeys でスキップ', () => {
    const expanded = new Set(['1_2026-06-07']);
    const slots = expandMasterSlotsRange('2026-06-01', '2026-06-14', masters, expanded);
    expect(slots.map(s => s.dateStr)).toEqual(['2026-06-14']);
  });

  it('1日だけの範囲', () => {
    // 2026-06-07 は日曜
    const slots = expandMasterSlotsRange('2026-06-07', '2026-06-07', masters, new Set());
    expect(slots.length).toBe(1);
    expect(slots[0].dateStr).toBe('2026-06-07');
  });

  it('該当曜日がない範囲は空', () => {
    // 2026-06-01(月)〜2026-06-05(金) に日曜なし
    const slots = expandMasterSlotsRange('2026-06-01', '2026-06-05', masters, new Set());
    expect(slots).toEqual([]);
  });
});
