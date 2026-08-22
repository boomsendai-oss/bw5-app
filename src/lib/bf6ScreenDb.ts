// LEDパネル演出の状態管理。
//
// 機器構成(TARO確定 2026-08-21): iPad 1台では実現できない。
// HDMI接続はミラーリングになり、Safariでは外部ディスプレイに別映像を出せないため、
// LED出力用の機器と操作用iPadの2台構成にし、この状態をサーバ経由で同期する。
//   LED側   … /bf6/screen を全画面表示(1秒ごとに状態をポーリング)
//   操作側 … /staff/bf6/control
import { getAll, getOne, execute } from './db';
import { nowUtcIso } from './dateJst';
import { roundsFor, seedRound1, advanceRound, isRoundComplete, nextUndecided, type Match, type Round } from './bf6Bracket';
import type { Bf6DrawDivision } from './bf6Draw';

export type ScreenMode = 'logo' | 'bracket' | 'vs';

export type ScreenState = {
  mode: ScreenMode;
  division: Bf6DrawDivision;
  round: Round | null;
  matchNo: number | null;
  rev: number;
};

export async function getBf6ScreenState(): Promise<ScreenState> {
  const r = await getOne('SELECT mode, division, round, match_no, rev FROM bf_screen_state WHERE id = 1').catch(() => null);
  return {
    mode: (r?.mode as ScreenMode) ?? 'logo',
    division: (r?.division as Bf6DrawDivision) ?? 'beginner',
    round: (r?.round as Round) ?? null,
    matchNo: r?.match_no === null || r?.match_no === undefined ? null : Number(r.match_no),
    rev: Number(r?.rev ?? 0),
  };
}

/** rev を必ず増やす。LED側は rev の変化で「更新があった」と判断する。 */
export async function setBf6ScreenState(p: Partial<ScreenState>): Promise<void> {
  const cur = await getBf6ScreenState();
  const next = { ...cur, ...p };
  await execute(
    'UPDATE bf_screen_state SET mode = ?, division = ?, round = ?, match_no = ?, rev = rev + 1, updated_at = ? WHERE id = 1',
    [next.mode, next.division, next.round, next.matchNo, nowUtcIso()]
  );
}

// ───────── トーナメント ─────────

export async function listBf6Matches(division: Bf6DrawDivision): Promise<Match[]> {
  const rows = await getAll(
    'SELECT round, match_no, slot_a, slot_b, winner_slot FROM bf_match WHERE division = ? ORDER BY round, match_no',
    [division]
  ).catch(() => []);
  return rows.map((r) => ({
    round: String(r.round) as Round,
    matchNo: Number(r.match_no),
    slotA: r.slot_a === null ? null : Number(r.slot_a),
    slotB: r.slot_b === null ? null : Number(r.slot_b),
    winnerSlot: r.winner_slot === null ? null : Number(r.winner_slot),
  }));
}

async function upsertMatches(division: Bf6DrawDivision, matches: Match[]): Promise<void> {
  for (const m of matches) {
    await execute(
      `INSERT INTO bf_match (division, round, match_no, slot_a, slot_b, winner_slot, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(division, round, match_no) DO UPDATE SET
         slot_a = excluded.slot_a, slot_b = excluded.slot_b, updated_at = excluded.updated_at`,
      [division, m.round, m.matchNo, m.slotA, m.slotB, m.winnerSlot, nowUtcIso()]
    );
  }
}

/** くじ引きの結果(bf_draw)から1回戦を作る。締切後・抽選後に一度実行する。 */
export async function seedBf6Bracket(division: Bf6DrawDivision): Promise<{ created: number }> {
  const row = await getOne(
    "SELECT COUNT(*) AS n FROM bf_draw WHERE division = ? AND phase = 'bracket'",
    [division]
  );
  const slotCount = Number(row?.n ?? 0);
  if (slotCount === 0) return { created: 0 };
  const r1 = seedRound1(division, slotCount);
  await upsertMatches(division, r1);
  return { created: r1.length };
}

/**
 * 勝者を確定し、ラウンドが埋まったら次のラウンドを自動で作る。
 * 二度押ししても同じ結果になる(同じ勝者を書くだけ)。
 */
export async function setBf6Winner(
  division: Bf6DrawDivision,
  round: Round,
  matchNo: number,
  winnerSlot: number
): Promise<void> {
  await execute(
    'UPDATE bf_match SET winner_slot = ?, updated_at = ? WHERE division = ? AND round = ? AND match_no = ?',
    [winnerSlot, nowUtcIso(), division, round, matchNo]
  );
  const all = await listBf6Matches(division);
  const cur = all.filter((m) => m.round === round);
  if (isRoundComplete(cur)) {
    const nextMatches = advanceRound(division, round, cur);
    if (nextMatches.length > 0) await upsertMatches(division, nextMatches);
  }
}

/** 操作が必要な次の試合。組み合わせは確定済みなので一意に決まる。 */
export function findNextMatch(division: Bf6DrawDivision, all: Match[]): Match | null {
  for (const round of roundsFor(division)) {
    const inRound = all.filter((m) => m.round === round);
    if (inRound.length === 0) continue;
    const next = nextUndecided(inRound);
    if (next) return next;
  }
  return null;
}

// ───────── 表示用のデータ ─────────

export type SlotName = { slotNo: number; dancerName: string; rep: string; hasPhoto: boolean };

export async function listBf6SlotNames(division: Bf6DrawDivision): Promise<Map<number, SlotName>> {
  const rows = await getAll(
    `SELECT d.slot_no, i.id AS item_id, i.dancer_name, i.rep,
            (SELECT COUNT(*) FROM bf_photo p WHERE p.item_id = i.id) AS has_photo
       FROM bf_draw d
       LEFT JOIN bf_order_items i ON i.id = d.item_id
      WHERE d.division = ? AND d.phase = 'bracket'
      ORDER BY d.slot_no`,
    [division]
  ).catch(() => []);
  const map = new Map<number, SlotName>();
  for (const r of rows) {
    map.set(Number(r.slot_no), {
      slotNo: Number(r.slot_no),
      dancerName: r.dancer_name ? String(r.dancer_name) : '',
      rep: r.rep ? String(r.rep) : '',
      hasPhoto: Number(r.has_photo ?? 0) > 0,
    });
  }
  return map;
}

/** トーナメントをリセット(試合結果と組み合わせを消す)。抽選(bf_draw)は消さない。 */
export async function resetBf6Bracket(division: Bf6DrawDivision): Promise<void> {
  await execute('DELETE FROM bf_match WHERE division = ?', [division]);
  await setBf6ScreenState({ mode: 'logo', round: null, matchNo: null });
}
