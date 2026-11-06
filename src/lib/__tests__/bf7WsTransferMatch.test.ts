// HIRO ワークショップの振込照合: 受付番号+金額が合うものだけ自動、それ以外は人が確かめる一覧へ。
import { describe, it, expect } from 'vitest';
import { matchBf7WsTransfers, readWsOrderNumber, type WsTransferOrder } from '../bf7WsTransferMatch';

const order = (id: number, over: Partial<WsTransferOrder> = {}): WsTransferOrder => ({
  id,
  kana: 'ヤマダ ハナコ',
  amountTotal: 7000,
  payMethod: 'transfer',
  paymentStatus: 'transfer_due',
  ...over,
});
const dep = (description: string, amount = 7000) => ({ date: '2026/11/24', description, amount });

describe('readWsOrderNumber', () => {
  it('半角・全角・ハイフン・空白のゆれを読む', () => {
    expect(readWsOrderNumber('振込  WS001ﾔﾏﾀﾞ ﾊﾅｺ')).toBe(1);
    expect(readWsOrderNumber('振込  ＷＳ０１２　ヤマダ')).toBe(12);
    expect(readWsOrderNumber('振込  WS-3 ﾔﾏﾀﾞ')).toBe(3);
    expect(readWsOrderNumber('振込  ﾔﾏﾀﾞ ﾊﾅｺ')).toBeNull();
  });
});

describe('matchBf7WsTransfers', () => {
  it('受付番号と金額が合い、振込待ちなら自動', () => {
    const r = matchBf7WsTransfers([dep('振込  WS001ﾔﾏﾀﾞ ﾊﾅｺ')], [order(1)]);
    expect(r).toEqual([{ kind: 'auto', orderId: 1, deposit: dep('振込  WS001ﾔﾏﾀﾞ ﾊﾅｺ') }]);
  });

  it('金額が違えば自動にしない', () => {
    const r = matchBf7WsTransfers([dep('振込  WS001ﾔﾏﾀﾞ', 6000)], [order(1)]);
    expect(r[0].kind).toBe('review');
  });

  it('入金済みは「済み」として分け、二重に処理しない', () => {
    const r = matchBf7WsTransfers([dep('振込  WS001ﾔﾏﾀﾞ')], [order(1, { paymentStatus: 'paid' })]);
    expect(r[0].kind).toBe('already_paid');
  });

  it('取消済み・カード決済・番号違いは確かめる一覧へ', () => {
    expect(matchBf7WsTransfers([dep('振込  WS001')], [order(1, { paymentStatus: 'canceled' })])[0].kind).toBe('review');
    expect(matchBf7WsTransfers([dep('振込  WS001')], [order(1, { payMethod: 'prepaid' })])[0].kind).toBe('review');
    expect(matchBf7WsTransfers([dep('振込  WS009')], [order(1)])[0]).toMatchObject({ kind: 'review', orderId: 9 });
  });

  it('同じ受付番号の入金が2回あれば2回目は確かめる一覧へ', () => {
    const r = matchBf7WsTransfers([dep('振込  WS001'), dep('振込  WS001')], [order(1)]);
    expect(r.map((m) => m.kind)).toEqual(['auto', 'review']);
  });

  it('受付番号が無くても名前と金額が合えば、確かめる一覧にだけ出す', () => {
    const r = matchBf7WsTransfers([dep('振込  ﾔﾏﾀﾞ ﾊﾅｺ')], [order(1)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'review', orderId: 1 });
  });

  it('関係ない入金(レッスン代・ATM・利息・出金)は無視する', () => {
    const r = matchBf7WsTransfers(
      [dep('振込  ｽｽﾞｷ ﾀﾛｳ', 8800), dep('ATM ｾﾌﾞﾝ銀行', 7000), dep('普通預金 利息', 1), dep('振込  WS001', 0)],
      [order(1)]
    );
    expect(r).toEqual([]);
  });
});
