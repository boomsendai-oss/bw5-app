// 当日の受付端末(出場者が自分で操作する)の進行判断。純ロジック・DBに触らない。
//
// 流れ: 部門を選ぶ → 自分の名前を選ぶ → (未払いなら支払い案内) → 抽選 → 完了
// 2部門に出ている人は、片方が終わったらもう片方の受付へ続けて進める。

export type KioskEntrant = {
  itemId: number;
  dancerName: string;
  /** エントリーしている部門 */
  divisions: string[];
  paymentStatus: string;
  /** 当日現金の未収額。0なら支払い済み */
  amountDue: number;
  /** すでに抽選が済んでいる部門 */
  drawnDivisions: string[];
};

export type KioskStep =
  | { kind: 'pay'; amount: number }
  | { kind: 'draw'; division: string; phase: 'block' | 'bracket' }
  | { kind: 'done' };

/**
 * その人がこの部門で次にやること。
 * 支払いは部門ごとではなく1回で済むので、未収があれば部門に関係なく先に案内する。
 */
export function nextKioskStep(e: KioskEntrant, division: string): KioskStep {
  if (e.amountDue > 0) return { kind: 'pay', amount: e.amountDue };
  if (e.drawnDivisions.includes(division)) return { kind: 'done' };
  return { kind: 'draw', division, phase: phaseForDivision(division) };
}

/** まだ抽選していない部門。ダブルエントリーの「続き」を出すのに使う。 */
export function remainingDivisions(e: KioskEntrant): string[] {
  return e.divisions.filter((d) => !e.drawnDivisions.includes(d));
}

/**
 * 部門ごとの抽選の種類。
 * ビギナーは16名フルトーナメントなので、受付でトーナメントの位置まで決まる。
 * 小中学生・一般は予選があるので、まずA/Bブロックだけを決める。
 */
export function phaseForDivision(division: string): 'block' | 'bracket' {
  return division === 'beginner' ? 'bracket' : 'block';
}

/**
 * 受付の時点で写真撮影を案内するか。
 * ビギナーはこの後すぐトーナメント戦に入るので、受付で撮ってもらう。
 * 小中学生・一般は予選で8名に絞られてから撮るため、ここでは案内しない。
 */
export function needsPhotoGuide(divisions: string[]): boolean {
  return divisions.includes('beginner');
}
