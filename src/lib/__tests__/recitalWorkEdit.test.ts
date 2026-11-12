// BW6 発表会（段階1）のマイページの「作品を足す・やめる」の純関数の試験（Task 15）。DB にさわらない。
import { describe, it, expect } from 'vitest';
import { workEditOptions, editConfirmText } from '../recitalWorkEdit';

const works = [1, 2, 3, 4, 5, 6].map((id) => ({ id, title: `W0${id}の作品`, status: 'open', selectable: true }))
  .concat([{ id: 7, title: 'W07の作品', status: 'draft', selectable: false }, { id: 9, title: 'W09の作品', status: 'dropped', selectable: false }]);

describe('workEditOptions（05 5-5・K222）', () => {
  it('払う前・最後の1作品はやめられる（取りやめの文になる）。足せるのは open だけ', () => {
    const o = workEditOptions({ paid: 0, casts: [{ workId: 1, status: 'in' }], works, maxWorks: 5 });
    expect(o.rows[0]).toMatchObject({ workId: 1, canOut: true, lastBeforePay: true, lineOnly: false });
    expect(o.addable).toEqual([2, 3, 4, 5, 6]);
  });
  it('払ったあと・最後の「出る」はボタンの代わりに LINE の文（迷っているは数えない）', () => {
    const o = workEditOptions({ paid: 26500, casts: [{ workId: 1, status: 'in' }, { workId: 2, status: 'maybe' }], works, maxWorks: 5 });
    expect(o.rows.find((r) => r.workId === 1)).toMatchObject({ canOut: false, lineOnly: true });
    expect(o.rows.find((r) => r.workId === 2)).toMatchObject({ canToIn: true, canOut: true });
  });
  it('出る＋迷っているが5つなら足せない', () => {
    const casts = [1, 2, 3, 4, 5].map((workId) => ({ workId, status: 'in' as const }));
    expect(workEditOptions({ paid: 0, casts, works, maxWorks: 5 }).addable).toEqual([]);
  });
  it('やめた作品はボタン無しで、もう1回足せる。取りやめの作品はボタン無し', () => {
    const o = workEditOptions({ paid: 0, casts: [{ workId: 1, status: 'in' }, { workId: 3, status: 'out' }, { workId: 9, status: 'in' }], works, maxWorks: 5 });
    expect(o.rows.find((r) => r.workId === 3)).toMatchObject({ canToIn: false, canOut: false });
    expect(o.addable).toContain(3);
    expect(o.rows.find((r) => r.workId === 9)).toMatchObject({ dropped: true, canToIn: false, canOut: false, lineOnly: false });
  });
});

describe('editConfirmText（04 4-2 マイページでの変え方の文）', () => {
  const one = (kind: 'add' | 'to_in' | 'out' | 'last_out', wasIn = true) => [{ kind, title: 'W02の作品', personName: 'ヤマダ ハナコ', wasIn }];
  it('払う前に足す', () => {
    expect(editConfirmText({ paid: 0, items: one('add'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 26500, remainingAfter: 32500 }).lines)
      .toEqual(['『W02の作品』を足します。', '金額が 26,500円 から 32,500円 に変わります。']);
  });
  it('払う前にやめる・迷っている→出る・最後の1作品', () => {
    expect(editConfirmText({ paid: 0, items: one('out'), totalBefore: 32500, totalAfter: 26500, remainingBefore: 32500, remainingAfter: 26500 }).lines)
      .toEqual(['『W02の作品』をやめます。', '金額が 32,500円 から 26,500円 に変わります。']);
    expect(editConfirmText({ paid: 0, items: one('to_in'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 26500, remainingAfter: 32500 }).lines[0]).toBe('『W02の作品』に出ます。');
    expect(editConfirmText({ paid: 0, items: one('last_out'), totalBefore: 26500, totalAfter: 0, remainingBefore: 26500, remainingAfter: 0 }).lines)
      .toEqual(['ヤマダ ハナコさんの出演を取りやめます。Tシャツも取り消します。', '金額が 26,500円 から 0円 に変わります。']);
  });
  it('払ったあとに足す（迷っている→出るも同じ文）＝追加分は残りのふえた分', () => {
    const t = editConfirmText({ paid: 26500, items: one('add'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000 });
    expect(t.lines).toEqual(['『W02の作品』を足します。', '作品を足すと、追加で 6,000円 のお支払いが出ます。']);
    expect(editConfirmText({ paid: 26500, items: one('to_in'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 6000 }).lines[0]).toBe('『W02の作品』を足します。');
  });
  it('払ったあとにやめる', () => {
    expect(editConfirmText({ paid: 35500, items: one('out'), totalBefore: 35500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 0 }))
      .toEqual({ lines: ['『W02の作品』をやめます。', 'お支払いずみの分は、お返しできません。よろしいですか？'], confirmLabel: 'この作品をやめる' });
  });
  it('払ったあと、お支払いずみの分が当たって追加が0円（場面C）', () => {
    expect(editConfirmText({ paid: 32500, items: one('add'), totalBefore: 26500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 0 }).lines)
      .toEqual(['『W02の作品』を足します。', 'お支払いずみの分が当たるので、追加のお支払いはありません。']);
  });
  it('入れ替え（外す・足すを一緒に。決定1回）', () => {
    const t = editConfirmText({ paid: 32500, items: [{ kind: 'out', title: 'W01の作品', personName: 'ヤマダ ハナコ', wasIn: true }, { kind: 'add', title: 'W03の作品', personName: 'ヤマダ ハナコ', wasIn: false }],
      totalBefore: 32500, totalAfter: 32500, remainingBefore: 0, remainingAfter: 0 });
    expect(t.lines).toEqual(['『W01の作品』をやめます。', '『W03の作品』を足します。', 'お支払いずみの分は、お返しできません。よろしいですか？']);
    expect(t.confirmLabel).toBe('決定する');
  });
});
