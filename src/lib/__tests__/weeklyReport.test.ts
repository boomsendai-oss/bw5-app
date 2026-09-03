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
    traffic: { this_week: null, prev_week: null },
    seo: null,
    trial_cvr: null,
    plan_movement: null,
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

describe('サイト流入チャネル(GA4)', () => {
  it('今週と先週のセッション数を併記して上位チャネルを出す', () => {
    const i = baseInput({
      traffic: {
        this_week: {
          total: 120,
          channels: [
            { channel: 'Organic Search', sessions: 60, users: 50 },
            { channel: 'Direct', sessions: 30, users: 28 },
            { channel: 'Organic Social', sessions: 20, users: 18 },
            { channel: 'Paid Search', sessions: 10, users: 9 },
          ],
        },
        prev_week: {
          total: 90,
          channels: [
            { channel: 'Organic Search', sessions: 40, users: 30 },
            { channel: 'Direct', sessions: 35, users: 30 },
          ],
        },
      },
    });
    const { text } = formatWeeklyReport(i);
    expect(text).toContain('サイト流入（GA4セッション数）: 計120（先週 90）');
    expect(text).toContain('検索(自然): 60（先週 40）');
    expect(text).toContain('直接: 30（先週 35）');
    expect(text).toContain('SNS: 20');
    expect(text).toContain('検索(広告): 10');
  });

  it('取得できない週は未計測と明記する', () => {
    const { text } = formatWeeklyReport(baseInput({ traffic: { this_week: null, prev_week: null } }));
    expect(text).toContain('サイト流入（GA4）: 未計測');
  });
});

describe('SEO欄(GSC)', () => {
  it('順位差分・新規クエリ・上位ページを描画する', () => {
    const { text } = formatWeeklyReport(
      baseInput({
        seo: {
          keywords: [
            { query: '長町 ダンス', position: 5.9, prev_position: 8.2, impressions: 90, clicks: 2 },
            { query: '仙台 ダンススクール', position: 11.0, prev_position: 11.0, impressions: 17, clicks: 0 },
            { query: '七ヶ浜 ダンス', position: null, prev_position: null, impressions: 0, clicks: 0 },
            { query: 'ダンス 何歳から', position: 9.0, prev_position: null, impressions: 31, clicks: 1 },
          ],
          new_queries: [{ query: '仙台 ダンス 大人 初心者', impressions: 6, position: 12 }],
          top_pages: [{ page: '/blog/dance-school-cost-guide/', clicks: 9, impressions: 300 }],
          totals: { clicks: 45, impressions: 1200 },
          measured_on: '2026-09-06',
          prev_measured_on: '2026-08-30',
        },
      })
    );
    expect(text).toContain('■ SEO（Google検索・直近28日平均）');
    expect(text).toContain('長町 ダンス: 5.9位（↑+2.3） クリック2');
    expect(text).toContain('仙台 ダンススクール: 11.0位（→）');
    expect(text).toContain('七ヶ浜 ダンス: 圏外');
    expect(text).toContain('ダンス 何歳から: 9.0位（前回 圏外→NEW） クリック1');
    expect(text).toContain('サイト全体: クリック45 / 表示1200');
    expect(text).toContain('「仙台 ダンス 大人 初心者」(表示6・12位)');
    expect(text).toContain('/blog/dance-school-cost-guide/: クリック9 / 表示300');
  });

  it('データが無ければ未計測と出す', () => {
    const { text } = formatWeeklyReport(baseInput({ seo: null }));
    expect(text).toContain('■ SEO（Google検索・直近28日平均）');
    expect(text).toContain('未計測（GSC取込のデータがまだありません）');
  });
});

describe('体験→入会CVR欄', () => {
  it('確定と暫定を区別して表示する', () => {
    const { text } = formatWeeklyReport(
      baseInput({
        trial_cvr: {
          months: [
            { month: '2026-06', trials: 17, cancelled: 3, enrolled: 8, settled: true },
            { month: '2026-07', trials: 12, cancelled: 3, enrolled: 3, settled: true },
            { month: '2026-08', trials: 13, cancelled: 2, enrolled: 5, settled: false },
          ],
        },
      })
    );
    expect(text).toContain('■ 体験→入会CVR（分母はキャンセル除外）');
    expect(text).toContain('2026-06: 57%（8/14人・確定）');
    expect(text).toContain('2026-07: 33%（3/9人・確定）');
    expect(text).toContain('2026-08: 45%（5/11人・暫定・今後上がる）');
    expect(text).toContain('「暫定」の月を確定値として判断しないこと');
  });
});

describe('プランの動き欄', () => {
  it('実請求額の前月比・プラン別人数・変更手続き件数・休会人数を出す', () => {
    const { text } = formatWeeklyReport(
      baseInput({
        plan_movement: {
          month: '2026-12', prev_month: '2026-11',
          plan_revenue: 930000, prev_plan_revenue: 839600,
          plans: [{ name: '受け放題', count: 22, amount: 345400 }, { name: '60分4回', count: 40, amount: 268000 }],
          change_fees_this_week: 5, change_fees_prev_week: 1, change_fees_month: 9, on_leave: 4,
        },
      })
    );
    expect(text).toContain('■ プランの動き（値上げの離脱はここに出る）');
    expect(text).toContain('月謝プラン実請求額（2026-12 当月累計）: ¥930,000（前月の同日まで ¥839,600）');
    expect(text).toContain('受け放題 22人 / 60分4回 40人');
    expect(text).toContain('プラン変更・休会の手続き: 今週 5件（先週 1件）／当月 9件');
    expect(text).toContain('休会中: 4人');
  });
});
