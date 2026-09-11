// LEDパネル演出の状態管理。
//
// 機器構成(TARO確定 2026-08-21): iPad 1台では実現できない。
// HDMI接続はミラーリングになり、Safariでは外部ディスプレイに別映像を出せないため、
// LED出力用の機器と操作用iPadの2台構成にし、この状態をサーバ経由で同期する。
//   LED側   … /bf6/screen を全画面表示(1秒ごとに状態をポーリング)
//   操作側 … /staff/bf6/control
import { getAll, getOne, execute } from './db';
import { nowUtcIso } from './dateJst';
import {
  roundsFor,
  advanceRound,
  applyByes,
  isRoundComplete,
  nextUndecided,
  planBracketReflect,
  seedRound1,
  undrawnSlotCount,
  type Match,
  type Round,
} from './bf6Bracket';
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

export type ReflectResult =
  | { ok: true; changed: number; undrawn: number }
  | { ok: false; reason: string };

/**
 * くじ引きの結果をトーナメントに反映する。試合前なら何度押してもよい。
 *
 * ⚠️ 以前の「作る」は1回きりで、受付の途中で押すと未受付の枠が不戦勝のまま固まり、
 *    リセットして作り直すしかなかった(TARO 2026-09-11)。
 *    今は「今のくじ引き状態に合わせ直す」ので、遅れて来た人が後から引いても、
 *    その人の試合がまだなら押し直せば対戦に戻る。決着した試合は壊さない。
 */
export async function reflectBf6Bracket(division: Bf6DrawDivision): Promise<ReflectResult> {
  const slots = await getAll(
    "SELECT slot_no, item_id FROM bf_draw WHERE division = ? AND phase = 'bracket'",
    [division]
  ).catch(() => []);
  if (slots.length === 0) {
    return { ok: false, reason: 'トーナメントの枠がまだありません。先に受付でくじを引いてください' };
  }
  const holders = new Set(slots.filter((r) => r.item_id !== null).map((r) => Number(r.slot_no)));
  if (holders.size === 0) return { ok: false, reason: 'まだ誰もくじを引いていません' };

  const stored = await listBf6Matches(division);
  const plan = planBracketReflect(division, stored, slots.length, holders);
  if (plan.kind === 'blocked') return { ok: false, reason: plan.reason };

  const undrawn = undrawnSlotCount(slots.length, holders);
  if (plan.changed === 0) return { ok: true, changed: 0, undrawn };

  for (const r of plan.dropRounds) {
    await execute('DELETE FROM bf_match WHERE division = ? AND round = ?', [division, r]);
  }
  for (const m of plan.matches) {
    await execute(
      `INSERT INTO bf_match (division, round, match_no, slot_a, slot_b, winner_slot, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(division, round, match_no) DO UPDATE SET
         slot_a = excluded.slot_a, slot_b = excluded.slot_b,
         winner_slot = excluded.winner_slot, updated_at = excluded.updated_at`,
      [division, m.round, m.matchNo, m.slotA, m.slotB, m.winnerSlot, nowUtcIso()]
    );
  }
  // 不戦勝だけで埋まったラウンドは、操作を待たずに次を作る(VSを出さない・TARO 2026-09-10)
  await advanceWhileComplete(division, roundsFor(division)[0]);
  return { ok: true, changed: plan.changed, undrawn };
}

/**
 * LEDと操作卓に出す試合。くじ引きの結果は自動で反映する(ボタンを押さない・TARO 2026-09-11)。
 *
 * - トーナメント開始前(試合がまだ保存されていない): くじ引きの結果から1回戦を組み立てて返す。
 *   pending=true のあいだは、まだ引いていない枠を不戦勝として扱わない
 *   (扱うと、先に引いた人が上の段へ勝ち上がって見えてしまう)。
 * - 開始後: 保存されている試合をそのまま返す。
 */
export async function listBf6ScreenMatches(
  division: Bf6DrawDivision
): Promise<{ matches: Match[]; pending: boolean }> {
  const stored = await listBf6Matches(division);
  if (stored.length > 0) return { matches: stored, pending: false };
  const slots = await getAll(
    "SELECT slot_no, item_id FROM bf_draw WHERE division = ? AND phase = 'bracket'",
    [division]
  ).catch(() => []);
  if (slots.length === 0) return { matches: [], pending: true };
  const holders = new Set(slots.filter((r) => r.item_id !== null).map((r) => Number(r.slot_no)));
  return { matches: applyByes(seedRound1(division, slots.length), holders), pending: true };
}

/**
 * トーナメントを始める操作(VSを出す・勝者を押す)の直前に呼ぶ。まだ試合が無ければ作る。
 * この時点でまだ引いていない枠は不戦勝になる(来ていない人を待たない)。
 */
export async function ensureBf6Bracket(division: Bf6DrawDivision): Promise<void> {
  const stored = await listBf6Matches(division);
  if (stored.length === 0) await reflectBf6Bracket(division);
}

/**
 * くじ引き・キャンセルの後に呼ぶ。トーナメントが始まっていれば今のくじ引き状態に合わせ直す。
 * 遅れて来た人が引いたら、その人の試合がまだなら不戦勝が対戦に戻る。
 * 始まる前は何もしない(表示は listBf6ScreenMatches がくじ引きから組み立てる)。
 * 決着した試合にぶつかる場合は何も変えない(reflect が止める)。
 */
export async function autoReflectIfStarted(division: Bf6DrawDivision): Promise<void> {
  const stored = await listBf6Matches(division);
  if (stored.length === 0) return;
  const r = await reflectBf6Bracket(division);
  if (!r.ok) console.error('[bf6] auto reflect skipped:', division, r.reason);
}

/** 操作卓で「反映すると不戦勝になる枠」を先に見せるための数。 */
export async function countBf6Undrawn(division: Bf6DrawDivision): Promise<{ slots: number; undrawn: number }> {
  const slots = await getAll(
    "SELECT slot_no, item_id FROM bf_draw WHERE division = ? AND phase = 'bracket'",
    [division]
  ).catch(() => []);
  const holders = new Set(slots.filter((r) => r.item_id !== null).map((r) => Number(r.slot_no)));
  return { slots: slots.length, undrawn: undrawnSlotCount(slots.length, holders) };
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
  await advanceWhileComplete(division, round);
}

/**
 * そのラウンドが完了していれば次のラウンドを作り、それも完了していればさらに次へ。
 * 不戦勝が連鎖する(人が少ない)ときに、操作なしで自動的に進めるため。
 */
async function advanceWhileComplete(division: Bf6DrawDivision, from: Round): Promise<void> {
  const rounds = roundsFor(division);
  let round: Round | undefined = from;
  while (round) {
    const all = await listBf6Matches(division);
    const cur = all.filter((m) => m.round === round);
    if (cur.length === 0 || !isRoundComplete(cur)) return;
    const next: Round | undefined = rounds[rounds.indexOf(round) + 1];
    if (!next) return;
    if (all.some((m) => m.round === next)) {
      round = next; // 既に作ってある(二度押し・再入)なら、その先を見る
      continue;
    }
    const nextMatches = advanceRound(division, round, cur);
    if (nextMatches.length === 0) return;
    await upsertMatches(division, nextMatches);
    round = next;
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

export type SlotName = { slotNo: number; dancerName: string; rep: string; hasPhoto: boolean; photoAt: string | null };

export async function listBf6SlotNames(division: Bf6DrawDivision): Promise<Map<number, SlotName>> {
  const rows = await getAll(
    `SELECT d.slot_no, i.id AS item_id, i.dancer_name, i.rep,
            (SELECT COUNT(*) FROM bf_photo p WHERE p.item_id = i.id) AS has_photo,
            (SELECT p.created_at FROM bf_photo p WHERE p.item_id = i.id) AS photo_at
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
      // 切り抜き係が差し替えたときにLEDが古い画像をキャッシュから出さないよう、URLに混ぜる
      photoAt: r.photo_at ? String(r.photo_at) : null,
    });
  }
  return map;
}

/** トーナメントをリセット(試合結果と組み合わせを消す)。抽選(bf_draw)は消さない。 */
export async function resetBf6Bracket(division: Bf6DrawDivision): Promise<void> {
  await execute('DELETE FROM bf_match WHERE division = ?', [division]);
  await setBf6ScreenState({ mode: 'logo', round: null, matchNo: null });
}
