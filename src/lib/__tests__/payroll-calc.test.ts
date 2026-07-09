import { describe, it, expect } from 'vitest';
import {
  calcPaymentDate,
  minutesBetween,
  resolveRate,
  resolveRateWithFallback,
  resolveTransitFee,
  deduplicateTransit,
  buildResultsMap,
  aggregateInstances,
  expandMasters,
  applyMonthlyFixed,
  sortLinesByDate,
  type PayrollResult,
  type InstanceInput,
  type MasterInput,
  type InstructorInput,
} from '../payroll-calc';

// ============================================
// calcPaymentDate
// ============================================
describe('calcPaymentDate', () => {
  it('翌月15日が平日ならそのまま返す (2026-01 → 2026-02-16 は月曜)', () => {
    // 2026-02-15 は日曜 → 翌営業日 = 2026-02-16 (月)
    expect(calcPaymentDate('2026-02')).toBe('2026-03-16');
    // まず 2026-03-15 の曜日を確認: 日曜
    // → 2026-03-16 月曜
  });

  it('15日が日曜なら月曜(16日)を返す', () => {
    // 2026-02-15 は日曜日
    expect(calcPaymentDate('2026-01')).toBe('2026-02-16');
  });

  it('15日が土曜なら月曜(17日)を返す', () => {
    // 2025-11-15 は土曜日 → 翌営業日は17日(月)
    expect(calcPaymentDate('2025-10')).toBe('2025-11-17');
  });

  it('15日が平日ならそのまま', () => {
    // 2026-04-15 は水曜日
    expect(calcPaymentDate('2026-03')).toBe('2026-04-15');
  });

  it('年末→翌年1月への繰り越し', () => {
    // 2025-12 → 2026-01-15 (木曜)
    expect(calcPaymentDate('2025-12')).toBe('2026-01-15');
  });
});

// ============================================
// minutesBetween
// ============================================
describe('minutesBetween', () => {
  it('通常ケース: 60分', () => {
    expect(minutesBetween('10:00', '11:00')).toBe(60);
  });

  it('通常ケース: 90分', () => {
    expect(minutesBetween('13:30', '15:00')).toBe(90);
  });

  it('同じ時間なら0分', () => {
    expect(minutesBetween('09:00', '09:00')).toBe(0);
  });

  it('空文字列なら0を返す', () => {
    expect(minutesBetween('', '11:00')).toBe(0);
    expect(minutesBetween('10:00', '')).toBe(0);
    expect(minutesBetween('', '')).toBe(0);
  });

  it('分の端数がある場合', () => {
    expect(minutesBetween('10:15', '11:45')).toBe(90);
    expect(minutesBetween('09:05', '09:50')).toBe(45);
  });
});

// ============================================
// resolveRate
// ============================================
describe('resolveRate', () => {
  const rateMap = new Map<string, number>([
    ['1_60', 6000],
    ['1_90', 8000],
    ['2_60', 5000],
  ]);

  it('override_rate があればそれを優先', () => {
    expect(resolveRate(10000, rateMap, 1, 60)).toBe(10000);
  });

  it('override_rate が null なら rateMap から取得', () => {
    expect(resolveRate(null, rateMap, 1, 60)).toBe(6000);
    expect(resolveRate(null, rateMap, 1, 90)).toBe(8000);
    expect(resolveRate(null, rateMap, 2, 60)).toBe(5000);
  });

  it('override_rate が undefined なら rateMap から取得', () => {
    expect(resolveRate(undefined, rateMap, 1, 60)).toBe(6000);
  });

  it('rateMap にもなければ 0', () => {
    expect(resolveRate(null, rateMap, 999, 60)).toBe(0);
  });

  it('override_rate が 0 でもそれを使う (0円は有効値)', () => {
    // 0 は falsy だが nullish coalescing (??) なので null/undefined 以外は通る
    expect(resolveRate(0, rateMap, 1, 60)).toBe(0);
  });
});

// ============================================
// resolveTransitFee
// ============================================
describe('resolveTransitFee', () => {
  const transitMap = new Map<string, number>([
    ['1_10', 500],
    ['1_20', 800],
  ]);

  it('transit_fee_override があればそれを優先', () => {
    expect(resolveTransitFee(1000, transitMap, 1, 10)).toBe(1000);
  });

  it('override が null なら transitMap から取得', () => {
    expect(resolveTransitFee(null, transitMap, 1, 10)).toBe(500);
    expect(resolveTransitFee(null, transitMap, 1, 20)).toBe(800);
  });

  it('studioId が null なら 0', () => {
    expect(resolveTransitFee(null, transitMap, 1, null)).toBe(0);
  });

  it('transitMap にもなければ 0', () => {
    expect(resolveTransitFee(null, transitMap, 1, 999)).toBe(0);
  });

  it('override が 0 でも有効値 (交通費不要を明示)', () => {
    expect(resolveTransitFee(0, transitMap, 1, 10)).toBe(0);
  });
});

// ============================================
// deduplicateTransit
// ============================================
describe('deduplicateTransit', () => {
  it('初回は交通費を計上し、Set に記録', () => {
    const charged = new Set<string>();
    expect(deduplicateTransit(500, 1, 10, '2026-06-01', charged)).toBe(500);
    expect(charged.has('1_10_2026-06-01')).toBe(true);
  });

  it('同一 (instructor x studio x date) の2回目は 0', () => {
    const charged = new Set<string>();
    deduplicateTransit(500, 1, 10, '2026-06-01', charged);
    expect(deduplicateTransit(500, 1, 10, '2026-06-01', charged)).toBe(0);
  });

  it('日付が違えば別計上', () => {
    const charged = new Set<string>();
    deduplicateTransit(500, 1, 10, '2026-06-01', charged);
    expect(deduplicateTransit(500, 1, 10, '2026-06-02', charged)).toBe(500);
  });

  it('スタジオが違えば別計上', () => {
    const charged = new Set<string>();
    deduplicateTransit(500, 1, 10, '2026-06-01', charged);
    expect(deduplicateTransit(800, 1, 20, '2026-06-01', charged)).toBe(800);
  });

  it('transitCandidate が 0 以下なら 0', () => {
    const charged = new Set<string>();
    expect(deduplicateTransit(0, 1, 10, '2026-06-01', charged)).toBe(0);
    expect(deduplicateTransit(-100, 1, 10, '2026-06-01', charged)).toBe(0);
  });

  it('studioId が null ならそのまま計上 (重複チェックなし)', () => {
    const charged = new Set<string>();
    expect(deduplicateTransit(300, 1, null, '2026-06-01', charged)).toBe(300);
    // studioId null は重複チェックされないので、もう1回呼んでも計上される
    expect(deduplicateTransit(300, 1, null, '2026-06-01', charged)).toBe(300);
  });
});

// ============================================
// buildResultsMap
// ============================================
describe('buildResultsMap', () => {
  it('インストラクターごとに初期状態の PayrollResult を作る', () => {
    const instructors: InstructorInput[] = [
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
      { id: 2, name: 'KEIKO', salary_type: 'monthly_fixed', monthly_fixed_amount: 200000 },
    ];
    const map = buildResultsMap(instructors);
    expect(map.size).toBe(2);
    const taro = map.get(1)!;
    expect(taro.instructor_name).toBe('TARO');
    expect(taro.salary_type).toBe('per_lesson');
    expect(taro.lines).toEqual([]);
    expect(taro.total_lesson_amount).toBe(0);
    const keiko = map.get(2)!;
    expect(keiko.salary_type).toBe('monthly_fixed');
  });

  it('salary_type が null なら per_lesson にフォールバック', () => {
    const map = buildResultsMap([{ id: 1, name: 'X', salary_type: null, monthly_fixed_amount: null }]);
    expect(map.get(1)!.salary_type).toBe('per_lesson');
  });
});

// ============================================
// aggregateInstances
// ============================================
describe('aggregateInstances', () => {
  const rateMap = new Map<string, number>([['1_60', 6000]]);
  const transitMap = new Map<string, number>([['1_10', 500]]);

  function makeResult(): Map<number, PayrollResult> {
    return buildResultsMap([
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
    ]);
  }

  it('scheduled インスタンスを正しく集計する', () => {
    const resultsMap = makeResult();
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>();

    const instances: InstanceInput[] = [{
      id: 100, date: '2026-06-01', start_time: '10:00', end_time: '11:00',
      instructor_id: 1, studio_id: 10, master_id: null, status: 'scheduled',
      class_name: 'HIPHOP', studio_name: 'StudioA', duration_minutes: 60,
      transit_fee_override: null,
    }];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);
    const r = resultsMap.get(1)!;
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].lesson_rate).toBe(6000);
    expect(r.lines[0].transit_fee).toBe(500);
    expect(r.total_lesson_amount).toBe(6000);
    expect(r.total_transit_amount).toBe(500);
    expect(r.lines[0].source).toBe('lesson_instance');
  });

  it('cancelled / removed は計上しない', () => {
    const resultsMap = makeResult();
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>();

    const instances: InstanceInput[] = [
      {
        id: 101, date: '2026-06-02', start_time: '10:00', end_time: '11:00',
        instructor_id: 1, studio_id: 10, master_id: 5, status: 'cancelled',
        class_name: 'HIPHOP', studio_name: 'StudioA', duration_minutes: 60,
        transit_fee_override: null,
      },
      {
        id: 102, date: '2026-06-03', start_time: '10:00', end_time: '11:00',
        instructor_id: 1, studio_id: 10, master_id: 6, status: 'removed',
        class_name: 'JAZZ', studio_name: 'StudioA', duration_minutes: 60,
        transit_fee_override: null,
      },
    ];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);
    expect(resultsMap.get(1)!.lines).toHaveLength(0);
    expect(resultsMap.get(1)!.total_lesson_amount).toBe(0);
    // ただし expandedKeys には記録される (master 再展開を防ぐ)
    expect(expandedKeys.has('5_2026-06-02')).toBe(true);
    expect(expandedKeys.has('6_2026-06-03')).toBe(true);
  });

  it('master の override_rate が使われる', () => {
    const resultsMap = makeResult();
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>([[5, 8000]]);

    const instances: InstanceInput[] = [{
      id: 103, date: '2026-06-01', start_time: '10:00', end_time: '11:00',
      instructor_id: 1, studio_id: 10, master_id: 5, status: 'scheduled',
      class_name: 'HOUSE Expert', studio_name: 'StudioA', duration_minutes: 60,
      transit_fee_override: null,
    }];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);
    expect(resultsMap.get(1)!.lines[0].lesson_rate).toBe(8000);
  });

  it('duration_minutes が null なら start/end から算出', () => {
    const rateMap2 = new Map<string, number>([['1_90', 9000]]);
    const resultsMap = makeResult();
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>();

    const instances: InstanceInput[] = [{
      id: 104, date: '2026-06-01', start_time: '13:00', end_time: '14:30',
      instructor_id: 1, studio_id: 10, master_id: null, status: 'scheduled',
      class_name: 'WAACK', studio_name: 'StudioA', duration_minutes: null,
      transit_fee_override: null,
    }];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap2, transitMap, expandedKeys, transitCharged);
    expect(resultsMap.get(1)!.lines[0].duration_minutes).toBe(90);
    expect(resultsMap.get(1)!.lines[0].lesson_rate).toBe(9000);
  });

  it('同一スタジオ・同一日の交通費は1回だけ', () => {
    const resultsMap = makeResult();
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>();

    const instances: InstanceInput[] = [
      {
        id: 105, date: '2026-06-01', start_time: '10:00', end_time: '11:00',
        instructor_id: 1, studio_id: 10, master_id: null, status: 'scheduled',
        class_name: 'HIPHOP', studio_name: 'StudioA', duration_minutes: 60,
        transit_fee_override: null,
      },
      {
        id: 106, date: '2026-06-01', start_time: '12:00', end_time: '13:00',
        instructor_id: 1, studio_id: 10, master_id: null, status: 'scheduled',
        class_name: 'HOUSE', studio_name: 'StudioA', duration_minutes: 60,
        transit_fee_override: null,
      },
    ];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);
    const r = resultsMap.get(1)!;
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].transit_fee).toBe(500); // 1回目: 計上
    expect(r.lines[1].transit_fee).toBe(0);   // 2回目: 重複で0
    expect(r.total_transit_amount).toBe(500);
    expect(r.total_lesson_amount).toBe(12000);
  });

  it('monthly_fixed のインストラクターは lines に加算しない', () => {
    const resultsMap = buildResultsMap([
      { id: 2, name: 'KEIKO', salary_type: 'monthly_fixed', monthly_fixed_amount: 200000 },
    ]);
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>();

    const instances: InstanceInput[] = [{
      id: 107, date: '2026-06-01', start_time: '10:00', end_time: '11:00',
      instructor_id: 2, studio_id: 10, master_id: null, status: 'scheduled',
      class_name: 'JAZZ', studio_name: 'StudioA', duration_minutes: 60,
      transit_fee_override: null,
    }];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);
    expect(resultsMap.get(2)!.lines).toHaveLength(0);
  });

  it('instructor_id が null のインスタンスはスキップ', () => {
    const resultsMap = makeResult();
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>();

    const instances: InstanceInput[] = [{
      id: 108, date: '2026-06-01', start_time: '10:00', end_time: '11:00',
      instructor_id: null, studio_id: 10, master_id: null, status: 'scheduled',
      class_name: 'OPEN', studio_name: 'StudioA', duration_minutes: 60,
      transit_fee_override: null,
    }];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);
    expect(resultsMap.get(1)!.lines).toHaveLength(0);
  });

  it('transit_fee_override が指定されていればそちらを使う', () => {
    const resultsMap = makeResult();
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>();

    const instances: InstanceInput[] = [{
      id: 109, date: '2026-06-01', start_time: '10:00', end_time: '11:00',
      instructor_id: 1, studio_id: 10, master_id: null, status: 'scheduled',
      class_name: 'HIPHOP', studio_name: 'StudioA', duration_minutes: 60,
      transit_fee_override: 1200,
    }];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);
    expect(resultsMap.get(1)!.lines[0].transit_fee).toBe(1200);
  });
});

// ============================================
// expandMasters
// ============================================
describe('expandMasters', () => {
  const rateMap = new Map<string, number>([['1_60', 6000]]);
  const transitMap = new Map<string, number>([['1_10', 500]]);

  it('週次展開で instance がない日を埋める', () => {
    const resultsMap = buildResultsMap([
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
    ]);
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();

    // 2026-06 の月曜日に展開する master (default_day_of_week=1)
    // 2026-06 の月曜は 1, 8, 15, 22, 29 の5回
    const masters: MasterInput[] = [{
      id: 1, class_name: 'HIPHOP', default_day_of_week: 1,
      default_start_time: '19:00', default_end_time: '20:00',
      duration_minutes: 60, override_rate: null,
      default_instructor_id: 1, default_studio_id: 10, studio_name: 'StudioA',
    }];

    expandMasters('2026-06', masters, resultsMap, rateMap, transitMap, expandedKeys, transitCharged);
    const r = resultsMap.get(1)!;
    expect(r.lines).toHaveLength(5);
    expect(r.total_lesson_amount).toBe(30000); // 6000 x 5
    expect(r.total_transit_amount).toBe(2500); // 500 x 5
    // 全て lesson_master_expanded
    expect(r.lines.every(l => l.source === 'lesson_master_expanded')).toBe(true);
  });

  it('expandedKeys にある日はスキップする', () => {
    const resultsMap = buildResultsMap([
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
    ]);
    // 2026-06-01 (月曜) を既に展開済みとしてマーク
    const expandedKeys = new Set<string>(['1_2026-06-01']);
    const transitCharged = new Set<string>();

    const masters: MasterInput[] = [{
      id: 1, class_name: 'HIPHOP', default_day_of_week: 1,
      default_start_time: '19:00', default_end_time: '20:00',
      duration_minutes: 60, override_rate: null,
      default_instructor_id: 1, default_studio_id: 10, studio_name: 'StudioA',
    }];

    expandMasters('2026-06', masters, resultsMap, rateMap, transitMap, expandedKeys, transitCharged);
    const r = resultsMap.get(1)!;
    expect(r.lines).toHaveLength(4); // 5 - 1 = 4
  });

  it('override_rate が master に設定されていれば優先する', () => {
    const resultsMap = buildResultsMap([
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
    ]);
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();

    // 日曜 (dow=0) のマスター。2026-06 の日曜は 7, 14, 21, 28 の4回
    const masters: MasterInput[] = [{
      id: 2, class_name: 'HOUSE Expert', default_day_of_week: 0,
      default_start_time: '15:00', default_end_time: '16:00',
      duration_minutes: 60, override_rate: 8000,
      default_instructor_id: 1, default_studio_id: 10, studio_name: 'StudioA',
    }];

    expandMasters('2026-06', masters, resultsMap, rateMap, transitMap, expandedKeys, transitCharged);
    const r = resultsMap.get(1)!;
    expect(r.lines.every(l => l.lesson_rate === 8000)).toBe(true);
    expect(r.total_lesson_amount).toBe(32000); // 8000 x 4
  });

  it('default_instructor_id が null のマスターはスキップ', () => {
    const resultsMap = buildResultsMap([
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
    ]);
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();

    const masters: MasterInput[] = [{
      id: 3, class_name: 'OPEN CLASS', default_day_of_week: 3,
      default_start_time: '18:00', default_end_time: '19:00',
      duration_minutes: 60, override_rate: null,
      default_instructor_id: null, default_studio_id: 10, studio_name: 'StudioA',
    }];

    expandMasters('2026-06', masters, resultsMap, rateMap, transitMap, expandedKeys, transitCharged);
    expect(resultsMap.get(1)!.lines).toHaveLength(0);
  });
});

// ============================================
// applyMonthlyFixed
// ============================================
describe('applyMonthlyFixed', () => {
  it('monthly_fixed のインストラクターに固定額を設定', () => {
    const instructors: InstructorInput[] = [
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
      { id: 2, name: 'KEIKO', salary_type: 'monthly_fixed', monthly_fixed_amount: 200000 },
    ];
    const resultsMap = buildResultsMap(instructors);
    // per_lesson の TARO にはレッスン実績があると仮定
    resultsMap.get(1)!.total_lesson_amount = 48000;

    applyMonthlyFixed(instructors, resultsMap);
    expect(resultsMap.get(1)!.total_lesson_amount).toBe(48000); // 変更なし
    expect(resultsMap.get(2)!.total_lesson_amount).toBe(200000);
  });

  it('monthly_fixed_amount が null なら 0', () => {
    const instructors: InstructorInput[] = [
      { id: 3, name: 'MIKU', salary_type: 'monthly_fixed', monthly_fixed_amount: null },
    ];
    const resultsMap = buildResultsMap(instructors);
    applyMonthlyFixed(instructors, resultsMap);
    expect(resultsMap.get(3)!.total_lesson_amount).toBe(0);
  });
});

// ============================================
// sortLinesByDate
// ============================================
describe('sortLinesByDate', () => {
  it('lines を日付の昇順にソートする', () => {
    const resultsMap = buildResultsMap([
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
    ]);
    const r = resultsMap.get(1)!;
    r.lines.push(
      { lesson_date: '2026-06-15', class_name: 'B', duration_minutes: 60, studio_name: null, studio_id: null, lesson_master_id: null, lesson_rate: 6000, transit_fee: 0, source: 'lesson_instance', source_ref_id: 1 },
      { lesson_date: '2026-06-01', class_name: 'A', duration_minutes: 60, studio_name: null, studio_id: null, lesson_master_id: null, lesson_rate: 6000, transit_fee: 0, source: 'lesson_instance', source_ref_id: 2 },
      { lesson_date: '2026-06-10', class_name: 'C', duration_minutes: 60, studio_name: null, studio_id: null, lesson_master_id: null, lesson_rate: 6000, transit_fee: 0, source: 'lesson_instance', source_ref_id: 3 },
    );
    sortLinesByDate(resultsMap);
    expect(r.lines.map(l => l.lesson_date)).toEqual(['2026-06-01', '2026-06-10', '2026-06-15']);
  });
});

// ============================================
// 統合テスト: instance + master 展開の組み合わせ
// ============================================
describe('統合: instance集計 + master展開', () => {
  it('instance がある日は master 展開をスキップする', () => {
    const instructors: InstructorInput[] = [
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
    ];
    const rateMap = new Map<string, number>([['1_60', 6000]]);
    const transitMap = new Map<string, number>([['1_10', 500]]);
    const resultsMap = buildResultsMap(instructors);
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>([[1, null]]);

    // 2026-06-01 (月曜) に instance がある
    const instances: InstanceInput[] = [{
      id: 200, date: '2026-06-01', start_time: '19:00', end_time: '20:00',
      instructor_id: 1, studio_id: 10, master_id: 1, status: 'scheduled',
      class_name: 'HIPHOP', studio_name: 'StudioA', duration_minutes: 60,
      transit_fee_override: null,
    }];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);

    // 月曜のマスター
    const masters: MasterInput[] = [{
      id: 1, class_name: 'HIPHOP', default_day_of_week: 1,
      default_start_time: '19:00', default_end_time: '20:00',
      duration_minutes: 60, override_rate: null,
      default_instructor_id: 1, default_studio_id: 10, studio_name: 'StudioA',
    }];

    expandMasters('2026-06', masters, resultsMap, rateMap, transitMap, expandedKeys, transitCharged);
    const r = resultsMap.get(1)!;
    // 2026-06 の月曜: 1, 8, 15, 22, 29 → instance が 6/1 を埋めるので master 展開は 4回
    // 合計 5 行 (instance 1 + master 4)
    expect(r.lines).toHaveLength(5);
    expect(r.lines.filter(l => l.source === 'lesson_instance')).toHaveLength(1);
    expect(r.lines.filter(l => l.source === 'lesson_master_expanded')).toHaveLength(4);
  });

  it('休講 instance がある日も master 展開しない (二重計上防止)', () => {
    const instructors: InstructorInput[] = [
      { id: 1, name: 'TARO', salary_type: 'per_lesson', monthly_fixed_amount: null },
    ];
    const rateMap = new Map<string, number>([['1_60', 6000]]);
    const transitMap = new Map<string, number>();
    const resultsMap = buildResultsMap(instructors);
    const expandedKeys = new Set<string>();
    const transitCharged = new Set<string>();
    const masterOverrideMap = new Map<number, number | null>();

    // 6/1 が休講
    const instances: InstanceInput[] = [{
      id: 201, date: '2026-06-01', start_time: '19:00', end_time: '20:00',
      instructor_id: 1, studio_id: 10, master_id: 1, status: 'cancelled',
      class_name: 'HIPHOP', studio_name: 'StudioA', duration_minutes: 60,
      transit_fee_override: null,
    }];

    aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);

    const masters: MasterInput[] = [{
      id: 1, class_name: 'HIPHOP', default_day_of_week: 1,
      default_start_time: '19:00', default_end_time: '20:00',
      duration_minutes: 60, override_rate: null,
      default_instructor_id: 1, default_studio_id: 10, studio_name: 'StudioA',
    }];

    expandMasters('2026-06', masters, resultsMap, rateMap, transitMap, expandedKeys, transitCharged);
    const r = resultsMap.get(1)!;
    // 休講は lines に入らない + master も 6/1 をスキップ → 4行
    expect(r.lines).toHaveLength(4);
    expect(r.total_lesson_amount).toBe(24000); // 6000 x 4
  });
});

// ── M2: resolveRateWithFallback（実時間バケット優先＋master分数フォールバック）──
describe('resolveRateWithFallback (M2)', () => {
  // AOI(id1)想定: 60分¥4000 / 90分¥6000
  const rateMap = new Map<string, number>([['1_60', 4000], ['1_90', 6000]]);
  it('実時間バケットがあれば実時間で払う(延長=90分→¥6000)', () => {
    const r = resolveRateWithFallback(null, rateMap, 1, 90, 60);
    expect(r).toEqual({ rate: 6000, rateMissing: false, bucketFallback: false });
  });
  it('実時間==master分数なら通常どおり', () => {
    const r = resolveRateWithFallback(null, rateMap, 1, 60, 60);
    expect(r).toEqual({ rate: 4000, rateMissing: false, bucketFallback: false });
  });
  it('実時間バケット欠落→master分数で代用しfallback警告(120分未登録→60分で代用)', () => {
    const r = resolveRateWithFallback(null, rateMap, 1, 120, 60);
    expect(r).toEqual({ rate: 4000, rateMissing: false, bucketFallback: true });
  });
  it('override_rateがあれば最優先', () => {
    const r = resolveRateWithFallback(9999, rateMap, 1, 90, 60);
    expect(r).toEqual({ rate: 9999, rateMissing: false, bucketFallback: false });
  });
  it('実時間もmaster分数も未登録ならrate_missing', () => {
    const r = resolveRateWithFallback(null, rateMap, 1, 45, 30);
    expect(r).toEqual({ rate: 0, rateMissing: true, bucketFallback: false });
  });
});
