// BW6 発表会（段階1）のマイページの「作品を足す・やめる」（Task 15）の純関数。DB にさわらない（client の部品からも読める）。
// ボタンを出すか（workEditOptions）と、押す前に見せる文（editConfirmText）。文の正本は設計書 04 4-2「マイページでの変え方」。
// 通すかどうかの本当の確かめは recitalEntryDb.ts の applyHouseholdEdits（家庭・スタッフ・dryRun の同じ道）。ここは見せ方だけ。
import type { CastStatus } from './recital';
import { yenJa } from './recitalPublic';

export type EditCastLite = { workId: number; status: CastStatus };
export type EditWorkLite = { id: number; title: string; status: string; selectable: boolean }; // selectable = entry_mode 'form' かつ status 'open'
export type EditRow = { workId: number; title: string; status: CastStatus; dropped: boolean; canToIn: boolean; canOut: boolean; lineOnly: boolean; lastBeforePay: boolean };

const LIVE: readonly CastStatus[] = ['in', 'maybe'];

/**
 * 1人ぶんのボタン（05 5-5・K222）。casts はその人の出演だけ。
 * 取りやめ（dropped）の作品の行はボタン無しで、「出る＋迷っている」の数にも入れない。
 * 払ったあと、最後の「出る」はやめるボタンの代わりに LINE の文（lineOnly）。払う前の最後の1作品は取りやめの文（lastBeforePay）。
 * 足せるのは selectable の作品のうち、その人が出る・迷っているでない物（やめた作品は入る）。数が maxWorks に届いていれば無し。
 */
export function workEditOptions(x: { paid: number; casts: EditCastLite[]; works: EditWorkLite[]; maxWorks: number }): { addable: number[]; rows: EditRow[] } {
  const workById = new Map(x.works.map((w) => [w.id, w]));
  const isDropped = (workId: number) => workById.get(workId)?.status === 'dropped';
  const live = x.casts.filter((c) => LIVE.includes(c.status) && !isDropped(c.workId));
  const inCount = live.filter((c) => c.status === 'in').length;

  const rows: EditRow[] = [];
  for (const c of x.casts) {
    const w = workById.get(c.workId);
    if (!w) continue;
    const dropped = w.status === 'dropped';
    const isLive = !dropped && LIVE.includes(c.status);
    const lineOnly = isLive && x.paid > 0 && c.status === 'in' && inCount === 1;
    rows.push({
      workId: c.workId,
      title: w.title,
      status: c.status,
      dropped,
      canToIn: !dropped && c.status === 'maybe',
      canOut: isLive && !lineOnly,
      lineOnly,
      lastBeforePay: isLive && x.paid === 0 && live.length === 1,
    });
  }

  const taken = new Set(live.map((c) => c.workId));
  const addable = live.length >= x.maxWorks ? [] : x.works.filter((w) => w.selectable && !taken.has(w.id)).map((w) => w.id);
  return { addable, rows };
}

export type EditItem = { kind: 'add' | 'to_in' | 'out' | 'last_out'; title: string; personName: string; wasIn: boolean };

/**
 * 「金額を見る」のあとに見せる文と、決定のボタンの字（04 4-2）。品目ごとに1行、そのあとに金額の文。
 * 払う前：「金額が A から B に変わります。」（変わらなければ出さない）。
 * 払ったあと：残りがふえれば「追加で ◯円」。足す品目があって残りがふえず、合計がふえた時だけ「お支払いずみの分が当たる」（入れ替えで合計が同じなら出さない）。
 * 出ていた作品をやめる品目があれば、最後に「お返しできません」。
 */
export function editConfirmText(x: {
  paid: number; items: EditItem[]; totalBefore: number; totalAfter: number; remainingBefore: number; remainingAfter: number;
}): { lines: string[]; confirmLabel: string } {
  const paidAlready = x.paid > 0;
  const lines = x.items.map((it) => {
    switch (it.kind) {
      case 'add': return `『${it.title}』を足します。`;
      case 'to_in': return paidAlready ? `『${it.title}』を足します。` : `『${it.title}』に出ます。`;
      case 'out': return `『${it.title}』をやめます。`;
      case 'last_out': return `${it.personName}さんの出演を取りやめます。Tシャツも取り消します。`;
    }
  });
  if (!paidAlready) {
    if (x.totalAfter !== x.totalBefore) lines.push(`金額が ${yenJa(x.totalBefore)} から ${yenJa(x.totalAfter)} に変わります。`);
  } else {
    const extra = x.remainingAfter - x.remainingBefore;
    const hasAdd = x.items.some((it) => it.kind === 'add' || it.kind === 'to_in');
    if (extra > 0) lines.push(`作品を足すと、追加で ${yenJa(extra)} のお支払いが出ます。`);
    else if (hasAdd && extra === 0 && x.totalAfter > x.totalBefore) lines.push('お支払いずみの分が当たるので、追加のお支払いはありません。');
    if (x.items.some((it) => it.kind === 'out' && it.wasIn)) lines.push('お支払いずみの分は、お返しできません。よろしいですか？');
  }
  const confirmLabel = paidAlready && x.items.length === 1 && x.items[0].kind === 'out' ? 'この作品をやめる' : '決定する';
  return { lines, confirmLabel };
}
