// WS AB: TARO向け 週次経営レポートの整形(純粋関数)。
//
// DB集計は `weeklyMetrics.ts`、メール送信は cron route が行い、ここは
// 「受け取った数字を本文に組む」+「数字から解釈と次の一手を導く」だけを持つ。
// こうしておくと文面と判断ルールをテストで固定でき、集計SQLを変えても崩れに気づける。
//
// 設計方針(TARO合意 2026-07-27):
//   - 数字だけだと見て終わるので、必ず「解釈」と「次の一手」まで書く
//   - ただし **推測を断定で書かない**。理由の推測は候補として出し、断定しない
//   - 不明な指標は 0 ではなく「未計測」と明記する(捏造しない)
//   - 金額の算出根拠を必ず併記する(TAROの経営判断に使われるため)

import { formatAdCost } from './adCostFormat';
import { yen } from './utils';

export type WindowCounts = {
  new_signups: number;
  churned: number;
  /** 体験のレッスン日がこの週にあるもの（キャンセル含む・従来互換） */
  trials: number;
  /**
   * 体験の申込日(trial_records.created_at)がこの週にあるもの・キャンセル除外。
   * 広告や施策の効果は「いつ申し込んだか」で出るので、判断にはこちらを使う
   * (2026-09-14 Ultracode再検証で「レッスン日基準は週次の増減が読めない」と指摘)。
   */
  trial_bookings: number;
  line_new: number;
};

export type WeeklyReportInput = {
  /** 対象週(先週)の月曜 'YYYY-MM-DD' */
  week_start: string;
  /** 対象週(先週)の日曜 'YYYY-MM-DD' */
  week_end: string;
  /** 対象週の翌日(=レポート生成日)基準の在籍数 */
  members_now: number;
  /** 在籍数が取れなかった場合 true(DB未到達など) */
  members_unavailable?: boolean;
  this_week: WindowCounts;
  prev_week: WindowCounts;

  /** 当月 'YYYY-MM' */
  year_month: string;
  /** 前月 'YYYY-MM' */
  prev_year_month: string;

  revenue: {
    /** 当月の本業売上(月謝+チケット+入会金) */
    core: number;
    breakdown: Record<string, number>;
    /** 前月の同じ日付までの本業売上(進捗どうしの比較用) */
    prev_to_date: number;
    /** 前月の最終着地 */
    prev_full: number;
    data_available: boolean;
  };

  profit: {
    operating_profit: number;
    profit_margin: number;
    revenue: number;
    payroll: number;
    studio: number;
    expenses_total: number;
    expense_breakdown: Record<string, number>;
    profit_confirmed: boolean;
    missing_sources: string[];
    provisional_sources: string[];
  };

  entry: {
    /** 当月の体験予約数(CPA分母) */
    trials_month: number;
    /** 当月の広告費(expenses の「広告費」カテゴリ計上額)。未計上なら null */
    ad_spend_month: number | null;
    /**
     * GA4の実広告費(当月1日〜今日)。WS AAが整備した getAdCost の結果。
     * 取得できなければ null(この場合は経費計上ベースの ad_spend_month にフォールバック)。
     * currency は GA4プロパティの通貨。JPY以外の可能性があるため必ず併記して表示する。
     */
    ad_cost_ga4: { amount: number; currency: string; clicks: number } | null;
  };

  /**
   * GA4の流入チャネル(sessionDefaultChannelGroup別セッション数・2026-09-01追加)。
   * 取得できない週は null(「未計測」と明記して表示)。
   */
  traffic: {
    this_week: { channels: { channel: string; sessions: number; users: number }[]; total: number } | null;
    prev_week: { channels: { channel: string; sessions: number; users: number }[]; total: number } | null;
  };

  /**
   * SEO週次サマリー(GSC自動取込・2026-09-01追加)。
   * seo-snapshot(毎週日曜)が貯めたDBから月曜のレポート生成時に読む。
   * データが無い週(取込失敗・初回)は null → 「未計測」表示。
   */
  /**
   * 体験→入会CVR(2026-09-01追加)。
   * 🔴読み方のルール(2026-09-01の誤読の再発防止):
   *  - 分母はキャンセル除外(来なかった人に案内はできない)
   *  - 入会の紐付け(enrolled_after)は体験から何週間も遅れて増える熟成指標。
   *    月末から45日経つまでそのコホートは「暫定」であり、確定値のように扱わない
   */
  trial_cvr: {
    months: { month: string; trials: number; cancelled: number; enrolled: number; settled: boolean }[];
  } | null;

  /**
   * プランの動き(値上げの離脱検知・2026-09-03追加)。
   * 値上げによる離脱は「退会」ではなく「休会」「下位プランへの変更」の形で現れる(2026-09-02クリティック指摘)。
   * 退会数だけ見ていると12月改定の反応が数字に出ないまま3月まで気づかないため、
   * プラン別の実請求額と、プラン変更/休会の手続き件数(システム変更手数料)を毎週出す。
   */
  plan_movement: {
    month: string;
    prev_month: string;
    /** 当月の月謝プラン実請求額(チケット会員の¥0は含まない) */
    plan_revenue: number;
    prev_plan_revenue: number;
    /** プラン別の請求人数(当月) */
    plans: { name: string; count: number; amount: number }[];
    /** プラン変更・休会の手続き件数(システム変更手数料の請求件数) */
    change_fees_this_week: number;
    change_fees_prev_week: number;
    change_fees_month: number;
    /** 休会中(当月に休会月会費が請求された人数) */
    on_leave: number;
  } | null;

  seo: {
    /** 追跡キーワードの現在順位と前回差分(source=gsc の直近2回のmeasured_onを比較) */
    keywords: { query: string; position: number | null; prev_position: number | null; impressions: number; clicks: number }[];
    /** 今回初めて表示が付いたクエリ(前回スナップショットに無かった語・表示回数順) */
    new_queries: { query: string; impressions: number; position: number }[];
    /** クリックの多いページ上位(パスのみ) */
    top_pages: { page: string; clicks: number; impressions: number }[];
    /** 直近スナップショットの合計 */
    totals: { clicks: number; impressions: number } | null;
    measured_on: string | null;
    prev_measured_on: string | null;
  } | null;

  /** STATE.md 由来。GitHub Actions が抽出して渡す(取れなければ空配列) */
  state: {
    /** TARO判断待ちのボトルネック(先頭数件) */
    bottlenecks: string[];
    /** 14日以内の締切 [{date, title, owner}] */
    deadlines: Array<{ date: string; title: string; owner: string }>;
    /** STATE.md を読めたか。false なら「取得できず」と明記する */
    available: boolean;
  };

  /**
   * 冒頭3行(TARO方針 2026-11-13: スクールの大事な数字は「体験の予約数」「体験→入会の率」、
   * 売上ではなく「利益」を見る)。無い場合は冒頭3行を出さない(旧入力との互換)。
   */
  headline?: {
    /** 体験申込の累計を数えた月 'YYYY-MM'(=対象週の最終日の月。月曜1日の実行では前月になる) */
    trial_bookings_ym?: string;
    /** その月の1日〜対象週の最終日までの体験申込(申込日基準・キャンセル除外) */
    trial_bookings_month: number;
    /** 前月1日〜前月の同じ日までの体験申込(同条件) */
    trial_bookings_prev_month_to_date: number;
    /**
     * 直近の「確定月」の営業利益。確定月 = 締まった月で4財源(売上・給与・スタジオ料・経費)が揃い、
     * 給与が確定している月。見つからなければ null。
     */
    confirmed_profit: {
      month: string;
      operating_profit: number;
      /** 確定月でもまだ仮の金額の項目(スタジオ料・決済手数料など)。行に注記する */
      provisional?: string[];
      /** 確定月の前月の営業利益(比較用)。前月が未確定なら null */
      prev_month: string;
      prev_operating_profit: number | null;
    } | null;
  };

  /** 見張り(止まっている取り込み・仮の金額・LINEの急減)。無い場合は欄を出さない */
  alerts?: {
    /** 経費(expenses)に最後に行が入ってからの日数。経費が1件も無ければ null */
    expense_stale_days: number | null;
    /** 最後に経費が入った日 'YYYY-MM-DD'(JST) */
    expense_last_import_on: string | null;
    /** スタジオ代が仮(draft)のままの月 'YYYY-MM'(古い順) */
    studio_provisional_months: string[];
    /** LINE友だち数(ブロック除く)。Lstepの取込スナップショットから数える */
    line_friends: { now: number; now_on: string; prev: number | null; prev_on: string | null } | null;
  };

  insights_url: string;
};

/** 経費の取り込みがこの日数以上止まったら警告する */
export const EXPENSE_STALE_DAYS = 7;

/** LINE友だち数(ブロック除く)が1週間でこれ以上減ったら「急減」とみなす(人数と率のどちらか大きい方) */
export const LINE_DROP_MIN_PEOPLE = 5;
export const LINE_DROP_MIN_RATE = 0.03;

export type WeeklyReport = { subject: string; text: string };

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → 'M/D(曜)'。TZ非依存(UTCアンカーで曜日を出す)。 */
export function mdLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}(${WEEKDAYS[w]})`;
}

/**
 * 基準日(JST 'YYYY-MM-DD')から見た「直前の完結した1週間」= 月曜〜日曜。
 * 月曜朝に走らせると必ず前週の月〜日になる。月曜以外に手動実行しても
 * 「直近で終わった週」を返すので、途中の週の数字を確定値として出さない。
 */
export function lastFullWeek(todayIso: string): { start: string; end: string } {
  const [y, m, d] = todayIso.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const dow = new Date(base).getUTCDay(); // 0=日
  // 直近の月曜(今日を含む)までの日数。日曜(0)は6日戻る。
  const backToMonday = dow === 0 ? 6 : dow - 1;
  const startMs = base - (backToMonday + 7) * 86400000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(startMs), end: iso(startMs + 6 * 86400000) };
}

function signed(nv: number): string {
  if (nv === 0) return '±0';
  return nv > 0 ? `+${nv}` : `${nv}`;
}

/** 増減を「x件 (先週 y件 / 増減±z)」形式で書く。 */
function vsPrev(label: string, now: number, prev: number, unit: string): string {
  const diff = now - prev;
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  return `  ${label}: ${now}${unit} (先週 ${prev}${unit} ${arrow}${signed(diff)})`;
}

/** 'YYYY-MM' → 'M月' */
function monthLabel(ym: string): string {
  return `${Number(ym.slice(5, 7))}月`;
}

function arrowOf(diff: number): string {
  return diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
}

/**
 * 冒頭3行: 体験の予約数 / 体験→入会の率 / 営業利益(確定月)。
 * headline が無い入力では空配列(旧形式のレポートはそのまま)。
 */
export function buildHeadlineLines(i: WeeklyReportInput): string[] {
  const h = i.headline;
  if (!h) return [];
  const out: string[] = [];

  // 1) 体験の予約数(申込日基準・キャンセル除外)
  {
    const w = i.this_week.trial_bookings;
    const pw = i.prev_week.trial_bookings;
    const m = h.trial_bookings_month;
    const pm = h.trial_bookings_prev_month_to_date;
    const bym = h.trial_bookings_ym ?? i.year_month;
    const [by, bm] = bym.split('-').map(Number);
    const bpym = `${bm === 1 ? by - 1 : by}-${String(bm === 1 ? 12 : bm - 1).padStart(2, '0')}`;
    out.push(
      `① 体験の予約: 今週 ${w}件（前週 ${pw}件 ${arrowOf(w - pw)}${signed(w - pw)}）／${monthLabel(bym)}累計 ${m}件（${monthLabel(bpym)}の同じ日まで ${pm}件 ${arrowOf(m - pm)}${signed(m - pm)}）`
    );
  }

  // 2) 体験→入会の率(分母はキャンセル除外)。確定した月どうしで比べ、暫定の月は参考で添える
  {
    const months = i.trial_cvr?.months ?? [];
    const rate = (x: { trials: number; cancelled: number; enrolled: number }) => {
      const d = x.trials - x.cancelled;
      return d > 0 ? Math.round((100 * x.enrolled) / d) : null;
    };
    const settled = months.filter((x) => x.settled && rate(x) !== null);
    const latest = settled[settled.length - 1];
    const before = settled[settled.length - 2];
    // 暫定の参考は「締まった月」のうち一番新しいもの。当月は体験そのものがまだ増えている途中で
    // 入会の紐付けも追いついておらず、極端に低く出て誤読を招くため出さない。
    const prov = months.filter((x) => !x.settled && rate(x) !== null && x.month < i.year_month);
    const provLatest = prov[prov.length - 1];
    if (!latest && !provLatest) {
      out.push('② 体験→入会の率: 未計測');
    } else {
      const parts: string[] = [];
      if (latest) {
        const r = rate(latest)!;
        let s = `${monthLabel(latest.month)} ${r}%（確定`;
        if (before) {
          const rb = rate(before)!;
          s += `・${monthLabel(before.month)} ${rb}% ${arrowOf(r - rb)}${signed(r - rb)}pt`;
        }
        parts.push(s + '）');
      }
      if (provLatest) {
        parts.push(`${monthLabel(provLatest.month)} ${rate(provLatest)}%（暫定・これから上がる）`);
      }
      out.push(`② 体験→入会の率: ${parts.join('／')}`);
    }
  }

  // 3) 営業利益(確定月)
  {
    const c = h.confirmed_profit;
    const note = c && c.provisional && c.provisional.length > 0 ? ` ※${c.provisional.join('・')}は仮の金額` : '';
    if (!c) {
      out.push('③ 営業利益（確定月）: 確定した月がありません（売上・給与・スタジオ代・経費のどれかが未取込か、給与が未確定）');
    } else if (c.prev_operating_profit === null) {
      out.push(`③ 営業利益（確定月）: ${monthLabel(c.month)} ${yen(c.operating_profit)}（${monthLabel(c.prev_month)}は未確定のため比較なし）${note}`);
    } else {
      const d = c.operating_profit - c.prev_operating_profit;
      out.push(
        `③ 営業利益（確定月）: ${monthLabel(c.month)} ${yen(c.operating_profit)}（${monthLabel(c.prev_month)} ${yen(c.prev_operating_profit)} ${arrowOf(d)}${d >= 0 ? '+' : '−'}${yen(Math.abs(d))}）${note}`
      );
    }
  }
  return out;
}

/** LINE友だち数の減り方が「急減」か(純関数) */
export function isLineFriendDrop(now: number, prev: number): boolean {
  const drop = prev - now;
  if (drop <= 0) return false;
  return drop >= Math.max(LINE_DROP_MIN_PEOPLE, Math.ceil(prev * LINE_DROP_MIN_RATE));
}

/** 見張りの警告(該当なしなら空配列) */
export function buildAlertLines(i: WeeklyReportInput): string[] {
  const a = i.alerts;
  if (!a) return [];
  const out: string[] = [];
  if (a.expense_stale_days === null) {
    out.push('⚠️ 経費が1件も取り込まれていません。営業利益が実際より大きく出ます。');
  } else if (a.expense_stale_days >= EXPENSE_STALE_DAYS) {
    out.push(
      `⚠️ 経費の取り込みが${a.expense_stale_days}日止まっています（最後は${a.expense_last_import_on ? mdLabel(a.expense_last_import_on) : '不明'}）。止まっている間の営業利益は実際より大きく出ます。`
    );
  }
  if (a.studio_provisional_months.length > 0) {
    out.push(
      `⚠️ スタジオ代が仮の金額のままの月: ${a.studio_provisional_months.map(monthLabel).join('・')}（請求の確定で営業利益が変わります）`
    );
  }
  const lf = a.line_friends;
  if (lf && lf.prev !== null && isLineFriendDrop(lf.now, lf.prev)) {
    out.push(
      `⚠️ LINE友だちが急に減っています: ${lf.prev}人（${lf.prev_on ? mdLabel(lf.prev_on) : '1週間前'}）→ ${lf.now}人（${mdLabel(lf.now_on)}）、${lf.prev - lf.now}人減。配信直後のブロックが無いか確認したい。`
    );
  }
  return out;
}

function pctStr(v: number): string {
  return `${v >= 0 ? '' : ''}${v.toFixed(1)}%`;
}

/**
 * 数字から「今週の変化」を導く。
 * ルールベースなので、断定してよい事実(差分)だけを断定し、
 * 理由は必ず「〜の可能性」「確認したい」という候補提示にとどめる。
 */
export function buildChangeLines(i: WeeklyReportInput): string[] {
  const out: string[] = [];
  const t = i.this_week;
  const p = i.prev_week;
  const net = t.new_signups - t.churned;
  const prevNet = p.new_signups - p.churned;

  if (net !== prevNet) {
    out.push(
      `会員の純増が ${signed(prevNet)}人 → ${signed(net)}人 に変化(入会${t.new_signups}/退会${t.churned})。`
    );
  } else {
    out.push(`会員の純増は先週と同じ ${signed(net)}人(入会${t.new_signups}/退会${t.churned})。`);
  }

  if (t.churned >= 3) {
    out.push(
      `⚠️ 退会が${t.churned}人と多め。退会理由(月謝/曜日/講師/引越し)がHACOMONO側に残っているか確認したい。`
    );
  } else if (t.churned > p.churned && t.churned > 0) {
    out.push(`退会が先週より${t.churned - p.churned}人増加。単月のブレか継続傾向かは翌週まで判断保留。`);
  }

  if (t.trial_bookings === 0) {
    out.push('⚠️ 体験申込が0件。広告の配信状況とLINEの導線が生きているかを見たい。');
  } else if (t.trial_bookings > p.trial_bookings) {
    out.push(`体験申込が${p.trial_bookings}件→${t.trial_bookings}件に増加。増えた分の流入経路を残しておきたい。`);
  } else if (t.trial_bookings < p.trial_bookings) {
    out.push(`体験申込が${p.trial_bookings}件→${t.trial_bookings}件に減少。季節要因か配信量の変化かを切り分けたい。`);
  }

  if (t.line_new === 0 && p.line_new > 0) {
    out.push('⚠️ LINE友だち追加が0人。前週は追加があったので、同期の失敗も含めて確認したい。');
  }

  if (!i.profit.profit_confirmed) {
    out.push(
      `利益は未確定(${i.profit.missing_sources.join('・')}が未取込)。黒字赤字の判断はデータが揃ってから。`
    );
  } else if (i.profit.operating_profit < 0) {
    out.push(`⚠️ ${i.year_month}の営業利益がマイナス(${yen(i.profit.operating_profit)})。`);
  }

  return out;
}

/** 「来週の注目」= STATE.md の締切(14日以内)とTARO判断待ち。 */
export function buildWatchLines(i: WeeklyReportInput): string[] {
  const out: string[] = [];
  if (!i.state.available) {
    out.push('（STATE.md を読み取れなかったため、締切・判断待ちは未取得）');
    return out;
  }
  for (const d of i.state.deadlines) {
    out.push(`[締切 ${mdLabel(d.date)}] ${d.title}${d.owner ? `（${d.owner}）` : ''}`);
  }
  for (const b of i.state.bottlenecks) {
    out.push(`[TARO判断待ち] ${b}`);
  }
  if (out.length === 0) out.push('14日以内の締切・TARO判断待ちはありません。');
  return out;
}

export function formatWeeklyReport(i: WeeklyReportInput): WeeklyReport {
  const period = `${mdLabel(i.week_start)}〜${mdLabel(i.week_end)}`;
  const subject = `【BOOM 週次経営レポート】${period}`;
  const L: string[] = [];

  L.push(`BOOM 週次経営レポート ${period}`);
  L.push('');

  // ── 冒頭3行(大事な数字) ──
  const headline = buildHeadlineLines(i);
  if (headline.length > 0) {
    for (const line of headline) L.push(line);
    L.push('');
  }
  const alerts = buildAlertLines(i);
  if (alerts.length > 0) {
    L.push('■ 見張り');
    for (const line of alerts) L.push(`  ${line}`);
    L.push('');
  }

  // ── 会員 ──
  L.push('■ 会員');
  if (i.members_unavailable) {
    L.push('  現在の在籍: 未計測(会員データを取得できませんでした)');
  } else {
    L.push(`  現在の在籍: ${i.members_now}人（課金対象のみ / staff・休会・visitorを除く）`);
  }
  const net = i.this_week.new_signups - i.this_week.churned;
  L.push(`  今週の純増: ${signed(net)}人（入会 ${i.this_week.new_signups} − 退会 ${i.this_week.churned}）`);
  L.push(
    `  先週の純増: ${signed(i.prev_week.new_signups - i.prev_week.churned)}人（入会 ${i.prev_week.new_signups} − 退会 ${i.prev_week.churned}）`
  );
  L.push('');

  // ── 売上 ──
  L.push(`■ 売上（${i.year_month} 途中経過）`);
  if (!i.revenue.data_available) {
    L.push('  未計測: 当月の課金記録がまだ取り込まれていません。');
  } else {
    const b = i.revenue.breakdown;
    L.push(`  本業売上: ${yen(i.revenue.core)}`);
    L.push(
      `    内訳 — 月謝 ${yen(b.plan ?? 0)} / チケット ${yen(b.ticket ?? 0)} / 入会金 ${yen(b.enrollment_fee ?? 0)}`
    );
    if (i.revenue.prev_to_date > 0) {
      const diff = ((i.revenue.core - i.revenue.prev_to_date) / i.revenue.prev_to_date) * 100;
      L.push(
        `  前月同日比: ${diff >= 0 ? '+' : ''}${pctStr(diff)}（${i.prev_year_month}の同日まで ${yen(i.revenue.prev_to_date)}）`
      );
    } else {
      L.push(`  前月同日比: 未計測（${i.prev_year_month}の同日までの課金記録なし）`);
    }
    L.push(`  前月の着地: ${yen(i.revenue.prev_full)}`);
    L.push('  ※ HACOMONO課金記録(billing_date)ベース。月謝+チケット+入会金＝本業売上。物販/動画は含まない。');
  }
  L.push('');

  // ── 利益 ──
  L.push(`■ 利益（${i.year_month}）`);
  if (!i.profit.profit_confirmed) {
    L.push(`  ⚠️ ${i.profit.missing_sources.join('・')} が未取込のため、以下は参考値（確定値ではありません）。`);
  }
  if (i.profit.provisional_sources.length > 0) {
    L.push(`  ⚠️ ${i.profit.provisional_sources.join('・')} は未確定(draft)の計算値を使用中。確定で数字が変わります。`);
  }
  // 給与・スタジオ料が未取込の月は「営業利益」がほぼ売上と同額になる。
  // 参考値と断っても、メールを流し読みしたときに黒字幅として誤読されるので、
  // 主要コストが欠けている月は金額を見出しに出さない(insights側の警告と同じ立場)。
  const costGapCritical =
    i.profit.missing_sources.includes('給与') || i.profit.missing_sources.includes('スタジオ料');
  if (costGapCritical) {
    L.push(`  営業利益: 算出できません（${i.profit.missing_sources.join('・')} が未取込のため）`);
  } else {
    L.push(
      `  営業利益: ${yen(i.profit.operating_profit)}${i.profit.profit_confirmed ? `（利益率 ${pctStr(i.profit.profit_margin)}）` : '（参考値）'}`
    );
  }
  L.push(
    `    = 売上 ${yen(i.profit.revenue)} − 給与 ${yen(i.profit.payroll)} − スタジオ料 ${yen(i.profit.studio)} − 経費 ${yen(i.profit.expenses_total - i.profit.payroll - i.profit.studio)}`
  );
  const exp = Object.entries(i.profit.expense_breakdown)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${yen(v)}`);
  if (exp.length > 0) L.push(`    経費内訳 — ${exp.join(' / ')}`);
  L.push(`  ※ /staff/insights の「収益性」と同じ計算(同一関数)を使っています。`);
  L.push('');

  // ── 入口の数字 ──
  L.push('■ 入口の数字');
  L.push(vsPrev('体験申込（申込日基準・キャンセル除外）', i.this_week.trial_bookings, i.prev_week.trial_bookings, '件'));
  L.push(vsPrev('体験実施予定（レッスン日基準・キャンセル含む）', i.this_week.trials, i.prev_week.trials, '件'));
  L.push(vsPrev('LINE友だち追加', i.this_week.line_new, i.prev_week.line_new, '人'));
  L.push('    ※ LINE追加は日次同期で新しく現れた友だちの数（Lstepの登録日そのものではない）');
  // 広告費は GA4の実費用を優先し、取れないときだけ経費計上ベースへ落とす。
  // どちらの基準で出しているかを必ず併記する(基準が混ざると前月比が意味を失うため)。
  const ga4 = i.entry.ad_cost_ga4;
  if (ga4) {
    L.push(
      `  広告費（${i.year_month} 1日〜昨日・GA4実費用）: ${formatAdCost(ga4.amount, ga4.currency)}（クリック ${ga4.clicks}回）`
    );
    if (ga4.currency && ga4.currency !== 'JPY') {
      L.push(
        `    ※ GA4プロパティの通貨が ${ga4.currency} のままです。円で見たい場合はGA4の通貨設定をJPYに変更してください。`
      );
    }
    if (i.entry.trials_month > 0) {
      L.push(
        `  体験1件あたり: ${formatAdCost(ga4.amount / i.entry.trials_month, ga4.currency)}（当月の体験 ${i.entry.trials_month}件で割った概算）`
      );
    } else {
      L.push('  体験1件あたり: 未計測（当月の体験予約が0件）');
    }
  } else if (i.entry.ad_spend_month === null) {
    L.push(`  広告費（${i.year_month}）: 未計測（GA4から取得できず、経費にも未計上）`);
  } else {
    L.push(`  広告費（${i.year_month} 経費計上ベース）: ${yen(i.entry.ad_spend_month)}`);
    if (i.entry.trials_month > 0) {
      L.push(
        `  体験1件あたり: ${yen(Math.round(i.entry.ad_spend_month / i.entry.trials_month))}（当月の体験 ${i.entry.trials_month}件で割った概算）`
      );
    } else {
      L.push('  体験1件あたり: 未計測（当月の体験予約が0件）');
    }
  }

  // ── 体験→入会CVR(2026-09-01追加) ──
  // 暫定/確定を必ず区別する。09-01に「暫定値を確定と誤読→誤った経営判断寸前」の実害があった
  {
    const t = i.trial_cvr;
    L.push('');
    L.push('■ 体験→入会CVR（分母はキャンセル除外）');
    if (!t || t.months.length === 0) {
      L.push('  未計測');
    } else {
      for (const m of t.months) {
        const denom = m.trials - m.cancelled;
        const pct = denom > 0 ? Math.round((100 * m.enrolled) / denom) : null;
        const tag = m.settled ? '確定' : '暫定・今後上がる';
        L.push(
          `  ${m.month}: ${pct === null ? '—' : pct + '%'}（${m.enrolled}/${denom}人・${tag}）`
        );
      }
      L.push('    ※ 入会の紐付けは体験から数週間遅れて増えます。「暫定」の月を確定値として判断しないこと。');
    }
  }

  // ── プランの動き(値上げの離脱検知・2026-09-03追加) ──
  {
    const pm = i.plan_movement;
    L.push('');
    L.push('■ プランの動き（値上げの離脱はここに出る）');
    if (!pm) {
      L.push('  未計測');
    } else {
      L.push(
        `  月謝プラン実請求額（${pm.month} 当月累計）: ${yen(pm.plan_revenue)}（前月の同日まで ${yen(pm.prev_plan_revenue)}）`
      );
      L.push('    ※ 月謝は20日前後に請求されるため、月半ばまでは小さい値が出ます。月末の値で判断してください。');
      if (pm.plans.length > 0) {
        L.push('  ' + pm.plans.map((p) => `${p.name} ${p.count}人`).join(' / '));
      }
      L.push(
        `  プラン変更・休会の手続き: 今週 ${pm.change_fees_this_week}件（先週 ${pm.change_fees_prev_week}件）／当月 ${pm.change_fees_month}件`
      );
      L.push(`  休会中: ${pm.on_leave}人`);
      L.push('    ※ 12月の値上げ後は「退会」より先に、この手続き件数と受け放題の人数が動きます。');
    }
  }

  // ── SEO(GSC・2026-09-01追加) ──
  // 毎週日曜のseo-snapshotが貯めたGSC実測。PMセッションの月曜手動観測をこの欄で置き換える。
  {
    const g = i.seo;
    L.push('');
    L.push('■ SEO（Google検索・直近28日平均）');
    if (!g || g.keywords.length === 0) {
      L.push('  未計測（GSC取込のデータがまだありません）');
    } else {
      const arrow = (cur: number | null, prev: number | null) => {
        if (cur === null) return '圏外';
        if (prev === null) return `${cur.toFixed(1)}位（前回 圏外→NEW）`;
        const d = prev - cur; // 順位は小さいほど良い
        const sign = d > 0.05 ? `↑+${d.toFixed(1)}` : d < -0.05 ? `↓${d.toFixed(1)}` : '→';
        return `${cur.toFixed(1)}位（${sign}）`;
      };
      for (const k of g.keywords) {
        L.push(`  ${k.query}: ${arrow(k.position, k.prev_position)}${k.clicks > 0 ? ` クリック${k.clicks}` : ''}`);
      }
      if (g.totals) {
        L.push(`  サイト全体: クリック${g.totals.clicks} / 表示${g.totals.impressions}`);
      }
      if (g.new_queries.length > 0) {
        L.push(`  新しく表示され始めた語(記事キュー候補): ${g.new_queries
          .map((q) => `「${q.query}」(表示${q.impressions}・${q.position.toFixed(0)}位)`)
          .join(' / ')}`);
      }
      if (g.top_pages.length > 0) {
        L.push('  クリックの多いページ:');
        for (const p of g.top_pages) {
          L.push(`    ${p.page}: クリック${p.clicks} / 表示${p.impressions}`);
        }
      }
    }
  }

  // ── サイト流入チャネル(GA4・2026-09-01追加) ──
  // 「HPに人がどこから来ているか」。日本語ラベルはGA4標準チャネル分類の意訳。
  // 前週値は「同チャネルのセッション数」を括弧で併記(順位でなく実数で比較する)。
  {
    const t = i.traffic ?? { this_week: null, prev_week: null };
    if (!t.this_week) {
      L.push('  サイト流入（GA4）: 未計測（GA4から取得できず）');
    } else {
      const prevMap = new Map((t.prev_week?.channels ?? []).map((c) => [c.channel, c.sessions]));
      const label = (ch: string) =>
        ({
          'Organic Search': '検索(自然)',
          'Paid Search': '検索(広告)',
          'Organic Social': 'SNS',
          'Paid Social': 'SNS広告',
          Direct: '直接',
          Referral: '他サイト',
          Email: 'メール',
          Unassigned: '不明',
          'Cross-network': '広告(クロス)',
          Display: '広告(ディスプレイ)',
          Video: '広告(動画)',
          'Paid Video': '広告(動画)',
          'Paid Other': '広告(その他)',
          'Organic Video': '動画',
        })[ch] ?? ch;
      const totalPrev = t.prev_week?.total ?? null;
      L.push(
        `  サイト流入（GA4セッション数）: 計${t.this_week.total}${totalPrev !== null ? `（先週 ${totalPrev}）` : ''}`
      );
      for (const c of t.this_week.channels.slice(0, 5)) {
        const pv = prevMap.get(c.channel);
        L.push(`    ${label(c.channel)}: ${c.sessions}${pv !== undefined ? `（先週 ${pv}）` : ''}`);
      }
    }
  }
  L.push('');

  // ── 今週の変化 ──
  L.push('■ 今週の変化');
  for (const line of buildChangeLines(i)) L.push(`  ・${line}`);
  L.push('');

  // ── 来週の注目 ──
  L.push('■ 来週の注目');
  for (const line of buildWatchLines(i)) L.push(`  ・${line}`);
  L.push('');

  L.push('─────────────');
  L.push(`詳しい数字: ${i.insights_url}`);

  return { subject, text: L.join('\n') };
}
