// 「今週のレッスン」X投稿の下書き生成ロジック (2026-07-17設計・WS S)。
// 予定の正 = 生徒に公開しているGoogleカレンダー「BOOMレッスンスケジュール」
// (アプリDBを直接読まない。手動変更・代講の最終反映先がカレンダーであるため)。
// イベント形式は googleCalendar.ts の syncLessons が書き込む
//   summary: `【休講】?【講師名】クラス名` / location: スタジオ名
// を前提とする。純関数のみ — カレンダー読取とDB挿入は route 側。

export type WeeklyCalEvent = {
  summary: string;
  location?: string | null;
  /** イベント開始 (ISO8601・UTCでもオフセット付きでも可) */
  startIso: string;
};

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** ツイート1本の本文上限の目安 (全角換算で140字だが余裕を持たせる) */
const PART_CHAR_BUDGET = 130;

/** ISO日時をJSTの {month, day, weekday} に変換 */
function jstParts(iso: string): { month: number; day: number; weekday: number; ymd: string } {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return {
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    ymd: d.toISOString().slice(0, 10),
  };
}

/** `【講師】クラス名` からクラス名だけを取り出す (休講プレフィックスは呼び出し前に除外済み想定) */
export function classNameFromSummary(summary: string): string {
  return summary.replace(/^【[^】]*】/, '').trim();
}

/**
 * `【講師】クラス名` を投稿用の `【講師】クラス名` に整形する (2026-08-21・TARO指示のC案)。
 * クラス名だけだと「HIPHOP 中級」のように誰のクラスか分からないため講師名を残す。
 * クラス名が講師名で始まる場合(例: `【SAYUKI】SAYUKI FREESTYLE`)は重複を除去する。
 */
export function classLabelWithInstructor(summary: string): string {
  const m = summary.match(/^【([^】]*)】\s*(.*)$/);
  const instructor = m ? m[1].trim() : '';
  let name = (m ? m[2] : summary).trim();
  if (instructor && name.toLowerCase().startsWith(instructor.toLowerCase())) {
    name = name.slice(instructor.length).trim() || name;
  }
  if (!name) return '';
  return instructor ? `【${instructor}】${name}` : name;
}

/** スタジオ名を投稿向けに短縮 (最初の空白まで。7文字を超える場合は6文字に丸める) */
export function shortVenue(location: string | null | undefined): string {
  if (!location) return '';
  const head = location.trim().split(/\s+/)[0] ?? '';
  return head.length > 7 ? head.slice(0, 6) : head;
}

export type WeeklyDayLine = { ymd: string; line: string };

/** 1行(1日分チャンク)の文字数上限。ツイート予算(130)より小さくして行単位の詰め込みを保証する */
const LINE_CHAR_BUDGET = 110;

/**
 * カレンダーイベント → 曜日ごとの行に整形。
 * - 【休講】イベントは除外
 * - 同名クラスの重複(同日)は1つに
 * - クラス数が多く1行がLINE_CHAR_BUDGETを超える日は複数行に分割 (2行目以降のラベルは `▫7/26(日)…`)
 * 例: `▫7/20(月) キッズHIPHOP(長町コナスポ)・HOUSE(GOAT)`
 */
export function buildDayLines(events: WeeklyCalEvent[]): WeeklyDayLine[] {
  const byDay = new Map<string, { label: string; items: string[] }>();
  const sorted = [...events].sort((a, b) => (a.startIso < b.startIso ? -1 : 1));
  for (const ev of sorted) {
    if (ev.summary.includes('【休講】')) continue;
    const { month, day, weekday, ymd } = jstParts(ev.startIso);
    const name = classNameFromSummary(ev.summary);
    if (!name) continue;
    const venue = shortVenue(ev.location);
    const item = venue ? `${name}(${venue})` : name;
    let entry = byDay.get(ymd);
    if (!entry) {
      entry = { label: `▫${month}/${day}(${WEEKDAY_JA[weekday]})`, items: [] };
      byDay.set(ymd, entry);
    }
    if (!entry.items.includes(item)) entry.items.push(item);
  }

  const lines: WeeklyDayLine[] = [];
  for (const [ymd, e] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    let label = e.label;
    let current = '';
    for (const item of e.items) {
      const candidate = current ? `${current}・${item}` : `${label} ${item}`;
      if (candidate.length > LINE_CHAR_BUDGET && current) {
        lines.push({ ymd, line: current });
        label = `${e.label}…`;
        current = `${label} ${item}`;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push({ ymd, line: current });
  }
  return lines;
}

/**
 * 週次投稿のツリー本文を組み立てる。
 * part1 = ヘッダー + 前半の曜日 / 中間 = 続きの曜日 / 最終 = CTA。
 * イベント0件なら null (下書きを作らない)。
 */
export function buildWeeklyPostParts(
  events: WeeklyCalEvent[],
  weekStart: { month: number; day: number },
  weekEnd: { month: number; day: number }
): string[] | null {
  const dayLines = buildDayLines(events);
  if (dayLines.length === 0) return null;

  const header = `【今週のレッスン】${weekStart.month}/${weekStart.day}(月)〜${weekEnd.month}/${weekEnd.day}(日)`;
  const cta = '体験レッスンのお申し込みは公式LINEからどうぞ。最新の予定・変更はレッスンカレンダーをご確認ください🗓';

  const parts: string[] = [];
  let current = header;
  for (const { line } of dayLines) {
    const candidate = `${current}\n${line}`;
    if (candidate.length > PART_CHAR_BUDGET && current !== header) {
      parts.push(current);
      current = line;
    } else if (candidate.length > PART_CHAR_BUDGET) {
      // ヘッダー直後の1行で予算超過 — 行が長すぎてもそのまま積む(次から分割)
      parts.push(candidate);
      current = '';
      continue;
    } else {
      current = candidate;
      continue;
    }
  }
  if (current) parts.push(current);

  // CTAは最後のpartに収まるなら結合、無理なら独立part
  const last = parts[parts.length - 1];
  if (last && `${last}\n\n${cta}`.length <= PART_CHAR_BUDGET + 20) {
    parts[parts.length - 1] = `${last}\n\n${cta}`;
  } else {
    parts.push(cta);
  }
  return parts;
}

/**
 * 「次の月曜」のJST日付(YYYY-MM-DD)を返す。日曜夜に実行する前提。
 * 今日が月曜なら今日ではなく翌週の月曜 (日曜21時実行なら常に翌日=月曜になる)。
 */
export function nextMondayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const wd = jst.getUTCDay(); // 0=日
  const add = wd === 0 ? 1 : 8 - wd; // 日曜→+1、月曜→+7、火曜→+6…
  jst.setUTCDate(jst.getUTCDate() + add);
  return jst.toISOString().slice(0, 10);
}

/** YYYY-MM-DD (JST) の 00:00 JST をUTC ISOで返す */
export function jstMidnightUtcIso(ymd: string): string {
  return new Date(`${ymd}T00:00:00+09:00`).toISOString();
}

/** YYYY-MM-DD に日数を足す */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO日時をJSTの HH:MM に変換 */
function jstHhmm(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * 「本日のレッスン」投稿の本文を組み立てる (2026-08-07・TARO指示の層0レーン)。
 * 週次と同じカレンダーイベントを日次で時刻付きに整形する。
 * イベント0件(または全件休講)なら null (投稿を作らない)。
 */
export function buildDailyPostParts(
  events: WeeklyCalEvent[],
  today: { month: number; day: number; weekday: number }
): string[] | null {
  const sorted = [...events]
    .filter((ev) => !ev.summary.includes('【休講】'))
    .sort((a, b) => (a.startIso < b.startIso ? -1 : 1));

  const lines: string[] = [];
  for (const ev of sorted) {
    const label = classLabelWithInstructor(ev.summary);
    if (!label) continue;
    // 会場は載せない(TARO指示2026-08-20): カレンダーの場所欄は住所等で「(K)」のような
    // 意味不明な断片になる+水金は会場週替わりのため誤誘導リスク。会場はLINE/カレンダー参照に倒す
    // 講師名は載せる(TARO指示2026-08-21・C案): クラス名だけでは誰のクラスか伝わらない
    const line = `▫${jstHhmm(ev.startIso)} ${label}`;
    if (!lines.includes(line)) lines.push(line);
  }
  if (lines.length === 0) return null;

  const header = `【本日のレッスン】${today.month}/${today.day}(${WEEKDAY_JA[today.weekday]})`;
  const cta = '体験・お問い合わせは公式LINEからどうぞ🗓';

  const parts: string[] = [];
  let current = header;
  for (const line of lines) {
    const candidate = `${current}\n${line}`;
    if (candidate.length > PART_CHAR_BUDGET && current !== header) {
      parts.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);

  const last = parts[parts.length - 1];
  if (last && `${last}\n\n${cta}`.length <= PART_CHAR_BUDGET + 20) {
    parts[parts.length - 1] = `${last}\n\n${cta}`;
  } else {
    parts.push(cta);
  }
  return parts;
}
