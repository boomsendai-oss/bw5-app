// src/lib/crosspostStaleDate.ts — 二次配信(reel_crossposts)の「日付切れの告知」判定。純関数のみ(DB・通信なし)。
//
// 2026-11-13: XとThreadsの転載が3週間止まっていた後に再開したら、11/10のリールが
// 「明日11/11(水)のお試しレッスン」という本文のまま11/13にXへ出てしまった。
// 転載は Instagram 公開より遅れて出ることがある(枠待ち・鍵切れ・残高切れ)ので、
// 本文の日付付き告知が過ぎていたら自動で外す。
//
// 判定のきまり:
//   - 本文(キャプション)から日付の言及を拾う
//       相対: 今日/本日/今夜/今晩 = 公開日、明日/あした = +1、明後日/あさって = +2、今週末 = 公開日以降の最初の日曜
//       絶対: 11/11・11月11日・2026/11/11・2026年11月11日(年なしは公開日に最も近い年で解釈)
//   - **公開時点で今日以降だった日付**(=告知)が、**今日(JST)より前**になっていたら日付切れ
//   - 公開時点で既に過去だった日付は外さない。「動画は10/3のワークショップの様子」のような
//     撮影日の説明は告知ではないため(これで外すと普通のリールまで転載されなくなる)
//   - ハッシュタグだけの行は見ない
//   - 「12月から」のような月だけの言及は見ない(日付が決まらない)
//
// 呼び出し側:
//   - /api/cron/crosspost-reel … 配信候補を選ぶ前に通し、日付切れは status='cancelled' にする
//   - scripts/crosspost_revive.mjs … 打ち止めの行をまとめて pending に戻すときにも同じ判定を通す

const JST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 86_400_000;

/** Date → JSTの YYYY-MM-DD */
export function jstDate(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD を UTC 0時の Date に(日付計算専用) */
function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(iso: string, days: number): string {
  return new Date(parseIso(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** 実在する日付なら YYYY-MM-DD、そうでなければ null */
function makeIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** 年なしの月日を、公開日に最も近い年(前後半年)で解釈する */
function resolveYear(m: number, d: number, pubIso: string): string | null {
  const pubYear = Number(pubIso.slice(0, 4));
  const pubMs = parseIso(pubIso).getTime();
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const y of [pubYear - 1, pubYear, pubYear + 1]) {
    const iso = makeIso(y, m, d);
    if (!iso) continue;
    const diff = Math.abs(parseIso(iso).getTime() - pubMs);
    if (diff < bestDiff) {
      best = iso;
      bestDiff = diff;
    }
  }
  return best;
}

export type DateMention = { text: string; date: string };

/** 本文から日付の言及を拾う(公開日 pubIso を基準に相対表現を解決する) */
export function extractDateMentions(caption: string, pubIso: string): DateMention[] {
  const body = caption
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const out: DateMention[] = [];

  // 絶対(年あり): 2026/11/11, 2026-11-11, 2026.11.11, 2026年11月11日
  const withYear = /(?<!\d)(20\d{2})\s*(?:[/.\-]|年)\s*(\d{1,2})\s*(?:[/.\-]|月)\s*(\d{1,2})(?!\d)/g;
  const consumed: Array<[number, number]> = [];
  for (const m of body.matchAll(withYear)) {
    const iso = makeIso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) out.push({ text: m[0], date: iso });
    consumed.push([m.index!, m.index! + m[0].length]);
  }
  const inConsumed = (i: number) => consumed.some(([s, e]) => i >= s && i < e);

  // 絶対(年なし): 11/11, 11月11日
  const noYear = /(?<![\d/.\-])(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})(?![\d/])/g;
  for (const m of body.matchAll(noYear)) {
    if (inConsumed(m.index!)) continue;
    // 「月」区切りは「日」が続くときだけ日付として扱う(「12月10回」等の誤読を避ける)
    if (m[0].includes('月') && body[m.index! + m[0].length] !== '日') continue;
    const iso = resolveYear(Number(m[1]), Number(m[2]), pubIso);
    if (iso) out.push({ text: m[0], date: iso });
  }

  // 相対表現(長い語を先に。「明後日」は「明日」を含まないが、念のため順序を固定)
  const relative: Array<[RegExp, (pub: string) => string]> = [
    [/明後日|あさって/g, (p) => addDays(p, 2)],
    [/明日|あした/g, (p) => addDays(p, 1)],
    [/今日|本日|今夜|今晩/g, (p) => p],
    [
      /今週末/g,
      (p) => {
        const dow = parseIso(p).getUTCDay(); // 0=日
        return addDays(p, (7 - dow) % 7);
      },
    ],
  ];
  for (const [re, toDate] of relative) {
    for (const m of body.matchAll(re)) out.push({ text: m[0], date: toDate(pubIso) });
  }
  return out;
}

/**
 * 本文の告知が日付切れなら、その言及を返す。問題なければ null。
 * @param caption リールのキャプション(Instagram向けの原文)
 * @param publishedAt Instagramに公開した日時(reel_queue.posted_at)。無ければ判定しない
 * @param now 現在時刻
 */
export function findExpiredMention(
  caption: string | null | undefined,
  publishedAt: string | Date | null | undefined,
  now: Date = new Date()
): DateMention | null {
  if (!caption || !publishedAt) return null;
  const pub = typeof publishedAt === 'string' ? new Date(publishedAt) : publishedAt;
  if (Number.isNaN(pub.getTime())) return null;
  const pubIso = jstDate(pub);
  const today = jstDate(now);
  if (pubIso >= today) return null; // 公開当日はまだ何も過ぎていない
  for (const m of extractDateMentions(caption, pubIso)) {
    if (m.date >= pubIso && m.date < today) return m;
  }
  return null;
}

/** reel_crossposts.error に残す理由文 */
export function staleReason(m: DateMention): string {
  return `自動取消: 本文の日付「${m.text}」(${m.date})が過ぎたため転載しない`;
}
