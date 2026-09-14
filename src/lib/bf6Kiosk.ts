// 当日の受付端末(出場者が自分で操作する)の進行判断。純ロジック・DBに触らない。
//
// 流れ: 部門を選ぶ → 自分の名前を選ぶ → (未払いなら支払い案内) → 抽選 → 完了
// 2部門に出ている人は、片方が終わったらもう片方の受付へ続けて進める。
//
// くじは2回ある(TARO確定 2026-08-21)。
//   受付時(くじ引き①) … ビギナーはトーナメントの位置、小中・一般はA/Bブロック
//   予選後(くじ引き②) … 予選を通過した8名がベスト8の位置を引く
// ⚠️ くじ引き②もこの端末でやる(TARO 2026-09-14)。ルーレットとトーナメント表の演出を
//    ビギナーと同じように見せたいため。誰が②に進むかは「予選通過者」の登録で決まる。

export type KioskDraw = { division: string; phase: string };

export type KioskEntrant = {
  itemId: number;
  dancerName: string;
  /** エントリーしている部門 */
  divisions: string[];
  paymentStatus: string;
  /** 当日現金の未収額。0なら支払い済み */
  amountDue: number;
  /** すでに引いたくじ(部門と種類) */
  draws: KioskDraw[];
  /** 予選通過者として登録されている部門 */
  qualifierDivisions: string[];
};

export type KioskStep =
  | { kind: 'pay'; amount: number }
  | { kind: 'draw'; division: string; phase: 'block' | 'bracket' }
  | { kind: 'done' };

/**
 * その人がその部門で「いま引くくじ」の種類。
 * ビギナーは受付でトーナメントの位置まで決まる。
 * 小中・一般は予選のA/Bブロック。予選通過者に登録されたらベスト8の位置。
 */
export function phaseForEntrant(e: KioskEntrant, division: string): 'block' | 'bracket' {
  if (division === 'beginner') return 'bracket';
  return e.qualifierDivisions.includes(division) ? 'bracket' : 'block';
}

/** いま引くべきくじを、その人がもう引いているか。 */
export function isDrawnFor(e: KioskEntrant, division: string): boolean {
  const phase = phaseForEntrant(e, division);
  return e.draws.some((d) => d.division === division && d.phase === phase);
}

/**
 * その人がこの部門で次にやること。
 * 支払いは部門ごとではなく1回で済むので、未収があれば部門に関係なく先に案内する。
 */
export function nextKioskStep(e: KioskEntrant, division: string): KioskStep {
  if (e.amountDue > 0) return { kind: 'pay', amount: e.amountDue };
  if (isDrawnFor(e, division)) return { kind: 'done' };
  return { kind: 'draw', division, phase: phaseForEntrant(e, division) };
}

/** まだ抽選していない部門。ダブルエントリーの「続き」を出すのに使う。 */
export function remainingDivisions(e: KioskEntrant): string[] {
  return e.divisions.filter((d) => !isDrawnFor(e, d));
}

/**
 * くじを引いたあとに写真撮影を案内するか。
 * ビギナーはこの後すぐトーナメント戦に入るので受付で撮る。
 * 小中・一般はベスト8の8名だけ撮るので、くじ引き②のあとに案内する。
 */
export function needsPhotoGuideAfterDraw(division: string, phase: 'block' | 'bracket'): boolean {
  return phase === 'bracket';
}
