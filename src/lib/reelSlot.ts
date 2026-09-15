// 投稿枠ルール(発表会リール制作フロー_v1.md): 火曜=レッスン(クラス)リール / 金曜=発表会リール、いずれも19:00 JST。
//
// ⚠️ この規則は「1箇所だけ」に置く。以前は画面(reel-drafts/page.tsx)とAPI(api/staff/reel-drafts)が
//    それぞれ独立に同じ計算を持っていて、画面は「今日を含む」・APIは「今日を飛ばす」とズレていた。
//    その結果、火曜の昼に「次の火曜19時で投稿」を押すと黙って翌週に入った
//    (2026-09-15: 今日19時に出したかったHOUSEエキスパートが9/22に予約された)。
//
// 「次の火曜」という相対表現はUIに出さない。今日が火曜でまだ19時前のとき、それが今日を指すのか
// 来週を指すのか読み手に判断がつかないため。画面には nextReelSlotIso() の実日付を出す。

/** kind に対応する投稿曜日 (0=日 … 6=土)。発表会→金 / それ以外(クラス)→火 */
export function reelSlotDow(kind?: string): number {
  return kind === '発表会' || kind === 'stage' ? 5 : 2;
}

/**
 * 次の投稿枠(該当曜日の19:00 JST)を返す。今日が該当曜日でまだ19:00前なら「今日」。
 * `now` は判定基準時刻(テスト用。既定=現在)。2週間先まで見て見つからなければ null。
 */
export function nextReelSlot(kind?: string, now: Date = new Date()): Date | null {
  const targetDow = reelSlotDow(kind);
  const nowJst = new Date(now.getTime() + 9 * 3600 * 1000);
  for (let i = 0; i <= 14; i++) {
    const d = new Date(nowJst.getTime() + i * 86400000);
    if (d.getUTCDay() !== targetDow) continue;
    if (i === 0 && nowJst.getUTCHours() >= 19) continue; // 今日の枠はもう過ぎている→次の週へ
    return new Date(`${d.toISOString().slice(0, 10)}T19:00:00+09:00`);
  }
  return null;
}

/** 次の投稿枠をISO(UTC)で返す。API側の scheduled_at 既定値。 */
export function nextReelSlotIso(kind?: string, now: Date = new Date()): string {
  const d = nextReelSlot(kind, now);
  return (d ?? new Date(now.getTime() + 86400000)).toISOString();
}

/** 次の投稿枠を datetime-local 入力の値 'YYYY-MM-DDT19:00' (JST) で返す。 */
export function nextReelSlotLocal(kind?: string, now: Date = new Date()): string {
  const d = nextReelSlot(kind, now);
  if (!d) return '';
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}T${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}
