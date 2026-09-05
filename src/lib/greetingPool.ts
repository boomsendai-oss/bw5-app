// 「本日のレッスン」「今週のレッスン」投稿の1行目に添える一言プール (2026-09-05)
//
// 経緯: 自動投稿のロボット感を消すため、TAROと「感じのいい受付の人」の声で60本の叩き台を作り、
// TAROが判定して47本を採用(hub docs/sns/一言プール_叩き台v2.md が正本)。AI生成ではなく固定プール
// (費用ゼロ・変な文が出ない・AIクレジット停止の影響を受けない)。
//
// ルール:
// - 同じ文は14日以上あけて再登場(x-daily-schedule / x-weekly-schedule-draft が settings に使用履歴を残す)
// - ★推し(weight 2)は少し出やすい
// - 週次には「今日/本日」を含む文は使わない(weekly: true のものだけ)
// - {n} はその日のレッスン本数に置き換える

export type Greeting = { id: number; text: string; weight?: number; weekly?: boolean };

export const GREETINGS: Greeting[] = [
  // A. 予定を貼る
  { id: 1, text: '今日もスタジオでお待ちしています🙂' },
  { id: 2, text: '今日の予定はこちらです🗓' },
  { id: 3, text: '今日もよろしくお願いします🙌' },
  { id: 4, text: '今日はこのラインナップです🎶' },
  { id: 6, text: '今日のスケジュールを載せておきますね📝' },
  { id: 7, text: '今日の分、貼っておきます📌' },
  { id: 8, text: '本日のレッスン予定です🗓' },
  { id: 9, text: '今日のクラスをまとめました📋' },
  { id: 10, text: '今日はこちらのクラスがあります🙂' },
  { id: 11, text: '本日の予定、更新しました🔄' },
  { id: 13, text: '今日のレッスン、確認用にどうぞ📝' },
  { id: 15, text: '今日の時間割です⏰' },
  { id: 16, text: '本日のクラス一覧はこちら📋' },
  { id: 18, text: '予定を貼っておきますね🗓', weekly: true },
  { id: 19, text: '今日の開催クラスです🎶' },
  { id: 20, text: '本日のラインナップ、どうぞ👇' },
  { id: 21, text: '今日はこの{n}本です📌' },
  { id: 22, text: '今日のレッスン情報、置いておきます📝' },
  { id: 23, text: '本日の予定です。ご確認ください🙂' },
  { id: 24, text: '今日のクラス、載せました🗓' },
  { id: 25, text: '今日も通常通り開催です🙌' },
  // B. 軽い前向きさ
  { id: 26, text: '今日の一曲、楽しみにしててください🎧' },
  { id: 27, text: '今日は少し新しいこと、やるかもしれません✨' },
  { id: 28, text: '焦らなくて大丈夫。今日も自分のペースで🙂' },
  { id: 29, text: '今日もいい曲が流れる予定です🎶', weight: 2 },
  { id: 33, text: '今日も気持ちよく踊れる時間になりますように🎶' },
  { id: 34, text: '今日はどんな一曲になるか、私も楽しみです🎧' },
  { id: 35, text: '今日も基礎からしっかり。いつも通りです👟' },
  { id: 36, text: '今日の空き状況は公式LINEでお答えできます💬' },
  // C. 初めての人・体験の案内
  { id: 41, text: '体験は動きやすい服と飲み物があれば大丈夫です👟', weekly: true },
  { id: 42, text: 'はじめての方は、見るだけでも大丈夫です🙂', weekly: true },
  { id: 43, text: '見学だけでも歓迎です👋', weekly: true },
  { id: 44, text: '気になるクラスがあれば、公式LINEからどうぞ💬', weekly: true },
  { id: 45, text: '体験のご予約は公式LINEで受け付けています📩', weekly: true },
  { id: 46, text: 'どのクラスがいいか迷ったら、LINEでご相談ください💬', weekly: true },
  { id: 47, text: 'お一人で来られる方もたくさんいます🙂', weekly: true },
  { id: 48, text: '体験は無料です。お気軽にどうぞ🙌', weekly: true },
  { id: 49, text: '経験がなくても入れるクラスがあります🙂', weekly: true },
  { id: 50, text: '途中参加でも大丈夫なように進めています👋', weekly: true },
  // D. スタジオからのひとこと
  { id: 51, text: '送迎の保護者の方、いつもありがとうございます🚗', weight: 2, weekly: true },
  { id: 52, text: '会場は週によって変わるので、カレンダーでご確認ください🗓', weekly: true },
  { id: 53, text: '変更があれば公式LINEでお知らせします📩', weekly: true },
  { id: 54, text: '水分補給、忘れずに🥤', weekly: true },
  { id: 55, text: '最新の予定はレッスンカレンダーが正確です🗓', weekly: true },
  { id: 56, text: 'お問い合わせは公式LINEが早いです💬', weekly: true },
  { id: 57, text: '今日も駐車場は各会場のルールでお願いします🚗' },
  { id: 60, text: '今日もスタッフ一同、お待ちしています🙌' },
];

/** 同じ文を再登場させない最短日数 */
export const GREETING_COOLDOWN_DAYS = 14;

export type GreetingUse = { id: number; ymd: string };

/** 直近 cooldown 日以内に使った id の集合 */
export function recentGreetingIds(uses: GreetingUse[], todayYmd: string, cooldownDays = GREETING_COOLDOWN_DAYS): Set<number> {
  const today = new Date(`${todayYmd}T00:00:00Z`).getTime();
  const out = new Set<number>();
  for (const u of uses) {
    const t = new Date(`${u.ymd}T00:00:00Z`).getTime();
    if (Number.isFinite(t) && (today - t) / 86400000 < cooldownDays) out.add(u.id);
  }
  return out;
}

/**
 * 一言を1本選ぶ(純関数)。直近使用分を除き、weight で重み付き抽選。
 * 全部が直近使用済みなら除外せずに選ぶ(投稿を止めない)。候補ゼロなら null。
 */
export function pickGreeting(
  excludeIds: Set<number>,
  opts: { weekly?: boolean; rand?: () => number } = {}
): Greeting | null {
  const base = GREETINGS.filter((g) => (opts.weekly ? g.weekly === true : true));
  if (base.length === 0) return null;
  let pool = base.filter((g) => !excludeIds.has(g.id));
  if (pool.length === 0) pool = base;
  const rand = opts.rand ?? Math.random;
  const total = pool.reduce((s, g) => s + (g.weight ?? 1), 0);
  let r = rand() * total;
  for (const g of pool) {
    r -= g.weight ?? 1;
    if (r < 0) return g;
  }
  return pool[pool.length - 1];
}

/** {n} をレッスン本数に置き換える */
export function renderGreeting(g: Greeting, ctx: { count: number }): string {
  return g.text.replace(/\{n\}/g, String(ctx.count));
}

/** 使用履歴を追記して cooldown より古いものを捨てる(settings に保存する形) */
export function appendGreetingUse(uses: GreetingUse[], id: number, ymd: string, keepDays = GREETING_COOLDOWN_DAYS * 2): GreetingUse[] {
  const today = new Date(`${ymd}T00:00:00Z`).getTime();
  return [...uses, { id, ymd }].filter((u) => {
    const t = new Date(`${u.ymd}T00:00:00Z`).getTime();
    return Number.isFinite(t) && (today - t) / 86400000 <= keepDays;
  });
}
