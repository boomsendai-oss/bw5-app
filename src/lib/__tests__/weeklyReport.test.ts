import { describe, it, expect } from 'vitest';
import {
  buildChangeLines,
  buildWatchLines,
  formatWeeklyReport,
  lastFullWeek,
  mdLabel,
  type WeeklyReportInput,
} from '../weeklyReport';

function baseInput(over: Partial<WeeklyReportInput> = {}): WeeklyReportInput {
  return {
    week_start: '2026-07-20',
    week_end: '2026-07-26',
    members_now: 172,
    this_week: { new_signups: 2, churned: 1, trials: 4, line_new: 7 },
    prev_week: { new_signups: 1, churned: 1, trials: 2, line_new: 5 },
    year_month: '2026-07',
    prev_year_month: '2026-06',
    revenue: {
      core: 1_200_000,
      breakdown: { plan: 1_000_000, ticket: 150_000, enrollment_fee: 50_000, other: 0 },
      prev_to_date: 1_100_000,
      prev_full: 1_180_000,
      data_available: true,
    },
    profit: {
      operating_profit: 300_000,
      profit_margin: 25,
      revenue: 1_200_000,
      payroll: 600_000,
      studio: 200_000,
      expenses_total: 900_000,
      expense_breakdown: { 広告費: 30_000, システム費: 20_000, 通信費: 0, 備品: 0, その他: 50_000 },
      profit_confirmed: true,
      missing_sources: [],
      provisional_sources: [],
    },
    entry: { trials_month: 12, ad_spend_month: 30_000, ad_cost_ga4: null },
    state: {
      bottlenecks: ['マル経: 原子さんへ面談日程返信'],
      deadlines: [{ date: '2026-08-16', title: 'バイブス多賀城 出演チーム選定', owner: 'KEIKO' }],
      available: true,
    },
    insights_url: 'https://bw5-app.vercel.app/staff/insights',
    ...over,
  };
}

describe('lastFullWeek', () => {
  it('月曜に実行すると前週の月〜日を返す', () => {
    expect(lastFullWeek('2026-07-27')).toEqual({ start: '2026-07-20', end: '2026-07-26' });
  });

  it('日曜に手動実行しても「直近で終わった週」を返す(途中の週を確定値にしない)', () => {
    // 2026-07-26 は日曜。今週(7/20-7/26)はまだ当日なので前週(7/13-7/19)。
    expect(lastFullWeek('2026-07-26')).toEqual({ start: '2026-07-13', end: '2026-07-19' });
  });

  it('週の途中(木曜)でも前週の月〜日を返す', () => {
    expect(lastFullWeek('2026-07-23')).toEqual({ start: '2026-07-13', end: '2026-07-19' });
  });

  it('年またぎでも壊れない(2026-01-05は月曜 → 前週は12/29〜1/4)', () => {
    expect(lastFullWeek('2026-01-05')).toEqual({ start: '2025-12-29', end: '2026-01-04' });
  });
});

describe('mdLabel', () => {
  it('曜日はTZに依存しない', () => {
    expect(mdLabel('2026-07-20')).toBe('7/20(月)');
    expect(mdLabel('2026-07-26')).toBe('7/26(日)');
  });
});

describe('buildChangeLines', () => {
  it('純増の変化を事実として書く', () => {
    const lines = buildChangeLines(baseInput());
    expect(lines[0]).toContain('±0人 → +1人');
  });

  it('退会が3人以上なら警告し、理由は「確認したい」に留める(断定しない)', () => {
    const lines = buildChangeLines(
      baseInput({ this_week: { new_signups: 1, churned: 3, trials: 4, line_new: 7 } })
    );
    const warn = lines.find((l) => l.includes('退会が3人と多め'));
    expect(warn).toBeDefined();
    expect(warn).toContain('確認したい');
  });

  it('体験0件を警告する', () => {
    const lines = buildChangeLines(
      baseInput({ this_week: { new_signups: 0, churned: 0, trials: 0, line_new: 1 } })
    );
    expect(lines.some((l) => l.includes('体験予約が0件'))).toBe(true);
  });

  it('利益未確定の月は黒字赤字を断定しない', () => {
    const i = baseInput();
    i.profit.profit_confirmed = false;
    i.profit.missing_sources = ['給与'];
    i.profit.operating_profit = -50_000;
    const lines = buildChangeLines(i);
    expect(lines.some((l) => l.includes('利益は未確定'))).toBe(true);
    expect(lines.some((l) => l.includes('営業利益がマイナス'))).toBe(false);
  });
});

describe('buildWatchLines', () => {
  it('締切とTARO判断待ちを並べる', () => {
    const lines = buildWatchLines(baseInput());
    expect(lines[0]).toContain('[締切 8/16(日)]');
    expect(lines[1]).toContain('[TARO判断待ち]');
  });

  it('STATEを読めなかったときは「未取得」と明記する(空で誤魔化さない)', () => {
    const lines = buildWatchLines(
      baseInput({ state: { bottlenecks: [], deadlines: [], available: false } })
    );
    expect(lines[0]).toContain('読み取れなかった');
  });

  it('締切も判断待ちも無ければ「ありません」と書く', () => {
    const lines = buildWatchLines(
      baseInput({ state: { bottlenecks: [], deadlines: [], available: true } })
    );
    expect(lines[0]).toContain('ありません');
  });
});

describe('formatWeeklyReport', () => {
  it('件名に対象週が入る', () => {
    expect(formatWeeklyReport(baseInput()).subject).toBe('【BOOM 週次経営レポート】7/20(月)〜7/26(日)');
  });

  it('営業利益は算出根拠つきで書く', () => {
    const { text } = formatWeeklyReport(baseInput());
    expect(text).toContain('営業利益: ¥300,000（利益率 25.0%）');
    expect(text).toContain('= 売上 ¥1,200,000 − 給与 ¥600,000 − スタジオ料 ¥200,000 − 経費 ¥100,000');
    expect(text).toContain('/staff/insights の「収益性」と同じ計算');
  });

  it('給与・スタジオ料が未取込の月は営業利益の金額を見出しに出さない(売上と同額を黒字と誤読させない)', () => {
    const i = baseInput();
    i.profit.profit_confirmed = false;
    i.profit.missing_sources = ['給与', 'スタジオ料', '経費'];
    i.profit.payroll = 0;
    i.profit.studio = 0;
    i.profit.expenses_total = 0;
    i.profit.operating_profit = 1_200_000;
    const { text } = formatWeeklyReport(i);
    expect(text).toContain('営業利益: 算出できません（給与・スタジオ料・経費 が未取込のため）');
    expect(text).not.toContain('営業利益: ¥1,200,000');
    expect(text).not.toContain('利益率');
  });

  it('欠けているのが経費だけなら参考値として金額を出す', () => {
    const i = baseInput();
    i.profit.profit_confirmed = false;
    i.profit.missing_sources = ['経費'];
    const { text } = formatWeeklyReport(i);
    expect(text).toContain('営業利益: ¥300,000（参考値）');
    expect(text).toContain('経費 が未取込のため');
  });

  it('広告費が未計上の月はCPAを0円と書かず「未計測」にする', () => {
    const i = baseInput({ entry: { trials_month: 12, ad_spend_month: null, ad_cost_ga4: null } });
    const { text } = formatWeeklyReport(i);
    expect(text).toContain('広告費（2026-07）: 未計測');
    expect(text).not.toContain('体験1件あたり: ¥0');
  });

  it('当月の課金が未取込なら売上を0円と断定しない', () => {
    const i = baseInput();
    i.revenue.data_available = false;
    const { text } = formatWeeklyReport(i);
    expect(text).toContain('未計測: 当月の課金記録がまだ取り込まれていません');
  });

  it('在籍数が取れないときは0人と書かない', () => {
    const { text } = formatWeeklyReport(baseInput({ members_unavailable: true, members_now: 0 }));
    expect(text).toContain('現在の在籍: 未計測');
  });

  it('GA4の実広告費が取れたらそちらを使い、基準を明記する', () => {
    const { text } = formatWeeklyReport(
      baseInput({
        entry: { trials_month: 12, ad_spend_month: 30_000, ad_cost_ga4: { amount: 26_700, currency: 'JPY', clicks: 412 } },
      })
    );
    expect(text).toContain('GA4実費用）: ¥26,700（クリック 412回）');
    expect(text).toContain('体験1件あたり: ¥2,225');
    expect(text).not.toContain('経費計上ベース');
  });

  it('GA4の通貨がJPYでないときは通貨コードを併記し、円と誤認させない', () => {
    const { text } = formatWeeklyReport(
      baseInput({
        entry: { trials_month: 12, ad_spend_month: null, ad_cost_ga4: { amount: 160.54, currency: 'USD', clicks: 100 } },
      })
    );
    expect(text).toContain('USD 160.54');
    expect(text).toContain('通貨が USD のままです');
  });

  it('LINE追加の数え方の但し書きを必ず入れる(誤読防止)', () => {
    const { text } = formatWeeklyReport(baseInput());
    expect(text).toContain('日次同期で新しく現れた友だちの数');
  });
});
