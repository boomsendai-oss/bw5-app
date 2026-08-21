// src/lib/kyukaiWatch.ts — 休会の「自動復会」を事前に知らせるための判定(純関数)。
//
// 背景(2026-08-21): BOOMの休会は最長6ヶ月で、満了すると *本人の手続きなしに* 元のプランへ
// 自動復会し、月会費の引き落としが再開する。ところが本人への予告が無かったため、
// 復会に気づかないまま3ヶ月分の月会費を払い続けていた会員が実際に発生した。
// 会員規約v1 第9条6項「復会の1ヶ月前を目安にご案内します」を運用として成立させるのがこの判定。
//
// 設計の要点:
//   - 休会者は常時2〜4名しかいないため、専用画面は作らず「月1回TAROにメール」で足りる。
//     (画面を作っても見に行く習慣がつかず、結局見落とす)
//   - Vercel無料枠のcron本数上限を増やさないよう、既存 story-watchdog に相乗りさせる。
//   - 時刻・データを引数で受け取る純関数にして、単体テストで固定できるようにする。

/** 休会の上限(ヶ月)。満了で自動復会する。2026-08-21にTARO実機確認+ゼロベース再検討で6ヶ月確定。 */
export const KYUKAI_MAX_MONTHS = 6;

/** この日以前(月初何日まで)にだけ予告を出す。月1回に収め、20日の決済まで余裕を持たせる。 */
export const NOTIFY_WITHIN_DAY_OF_MONTH = 7;

export type KyukaiMemberRow = {
  /** 会員番号(表示用。氏名と違い社内表記として安全) */
  kaiin_no: string | null;
  full_name: string | null;
  /** 休会プランの契約開始日 'YYYY-MM-DD'(BOOMの休会は必ず月初) */
  plan_started_at: string | null;
};

export type UpcomingReturn = {
  kaiinNo: string;
  name: string;
  /** 休会開始日 'YYYY-MM-DD' */
  startedAt: string;
  /** 自動復会日 'YYYY-MM-DD'(必ず月初) */
  returnDate: string;
};

/** 'YYYY-MM-DD' または 'YYYY-MM-DD HH:MM:SS' から 'YYYY-MM' を取り出す。不正なら null。 */
function toYearMonth(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}`;
}

/** 'YYYY-MM' に n ヶ月足す。 */
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 今日(JST)が「予告を出す日」かどうか。
 * 月初1〜7日のみ true。休会は必ず月初開始なので、翌月復会する顔ぶれは月初時点で確定しており、
 * 月の途中で増えることはない(今月休会に入った人の復会は6ヶ月先)。
 */
export function isNotifyWindow(todayJstDate: string): boolean {
  const day = Number(todayJstDate.slice(8, 10));
  if (!Number.isFinite(day)) return false;
  return day >= 1 && day <= NOTIFY_WITHIN_DAY_OF_MONTH;
}

/**
 * 「翌月に自動復会する休会者」を抽出する。
 *
 * @param rows   現在 休会プラン中の会員(最新CSV hacomono_all_members 由来を想定)
 * @param todayJstDate 今日(JST) 'YYYY-MM-DD'
 * @param maxMonths 休会上限(既定6)
 */
export function findUpcomingReturns(
  rows: KyukaiMemberRow[],
  todayJstDate: string,
  maxMonths: number = KYUKAI_MAX_MONTHS
): UpcomingReturn[] {
  const thisMonth = toYearMonth(todayJstDate);
  if (!thisMonth) return [];
  const nextMonth = addMonths(thisMonth, 1);

  const out: UpcomingReturn[] = [];
  for (const r of rows) {
    const startYm = toYearMonth(r.plan_started_at);
    if (!startYm) continue; // 開始日が読めない行は鳴らさない(誤爆よりノイズ0を優先)
    const returnYm = addMonths(startYm, maxMonths);
    if (returnYm !== nextMonth) continue;
    out.push({
      kaiinNo: (r.kaiin_no ?? '').trim() || '(会員番号なし)',
      name: (r.full_name ?? '').trim() || '(氏名なし)',
      startedAt: String(r.plan_started_at).slice(0, 10),
      returnDate: `${returnYm}-01`,
    });
  }
  // 会員番号順で安定させる(通知本文の差分を読みやすくするため)
  out.sort((a, b) => a.kaiinNo.localeCompare(b.kaiinNo));
  return out;
}

/**
 * 通知本文を組み立てる。空配列を渡した場合は null(=通知しない)。
 * TARO本人宛なので氏名を含めてよい(誰に連絡すべきかが分からないと運用にならないため)。
 * ただしサーバーログには決して出さないこと。
 */
export function buildReturnNotice(items: UpcomingReturn[]): { subject: string; body: string } | null {
  if (items.length === 0) return null;
  const month = items[0].returnDate.slice(0, 7).replace('-', '年') + '月';
  const lines = items.map(
    (i) => `・会員${i.kaiinNo} ${i.name} さん(休会開始 ${i.startedAt} → ${i.returnDate} 復会予定)`
  );
  const body = [
    `${month}に、休会期間(最長${KYUKAI_MAX_MONTHS}ヶ月)の満了で自動的に復会する会員が ${items.length} 名います。`,
    '',
    ...lines,
    '',
    '【やること】',
    '本人に「来月から自動的に復会し、月会費のお支払いが再開します。もう少しお休みが必要な場合はご相談ください」とご連絡ください。',
    '',
    '継続してお休みされる場合は、HACOMONO管理サイトから改めて休会のプラン変更が必要です(メンバーサイトからは毎月10日を過ぎると翌々月からの手続きになります)。',
    `復会月の月会費は前月20日(カード)・27日頃(口座振替)に決済されます。それまでに手続きを終えてください。`,
  ].join('\n');
  return { subject: `${month} 自動復会のご案内(${items.length}名)`, body };
}
