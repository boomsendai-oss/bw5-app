import { describe, it, expect } from 'vitest';
import { pulseToken, pulseChanged, shouldPoll } from '../bf6Pulse';

describe('pulseToken', () => {
  it('同じ中身なら同じ合図になる', () => {
    const a = { checkin: 45, draw: 53, match: '12/8' };
    const b = { checkin: 45, draw: 53, match: '12/8' };
    expect(pulseToken(a)).toBe(pulseToken(b));
  });

  it('キーの並び順が違っても同じ合図になる(SQLの列順に依存させない)', () => {
    expect(pulseToken({ a: 1, b: 2 })).toBe(pulseToken({ b: 2, a: 1 }));
  });

  it('どこか1つでも変われば違う合図になる', () => {
    const base = { checkin: 45, draw: 53, qualifier: 8 };
    expect(pulseToken({ ...base, checkin: 46 })).not.toBe(pulseToken(base));
    expect(pulseToken({ ...base, draw: 54 })).not.toBe(pulseToken(base));
    expect(pulseToken({ ...base, qualifier: 9 })).not.toBe(pulseToken(base));
  });

  it('null と 0 と空文字を区別する(集計が空のときと0件を混同しない)', () => {
    expect(pulseToken({ x: null })).not.toBe(pulseToken({ x: 0 }));
    expect(pulseToken({ x: null })).not.toBe(pulseToken({ x: '' }));
    expect(pulseToken({ x: 0 })).not.toBe(pulseToken({ x: '' }));
  });

  it('値の区切りをまたいだ取り違えが起きない', () => {
    // 素朴に連結すると {a:'1|2', b:'3'} と {a:'1', b:'2|3'} が同じになってしまう
    expect(pulseToken({ a: '1|2', b: '3' })).not.toBe(pulseToken({ a: '1', b: '2|3' }));
  });

  it('中身が空でも例外にならない', () => {
    expect(typeof pulseToken({})).toBe('string');
  });
});

describe('pulseChanged', () => {
  it('初回(まだ何も知らない)では作り直さない', () => {
    // ⚠️ ここで true を返すと、画面を開いた直後に必ず1回 router.refresh() が走る
    expect(pulseChanged(null, 'abc')).toBe(false);
  });

  it('前回と同じなら作り直さない', () => {
    expect(pulseChanged('abc', 'abc')).toBe(false);
  });

  it('前回と違えば作り直す', () => {
    expect(pulseChanged('abc', 'abd')).toBe(true);
  });
});

describe('shouldPoll', () => {
  const base = { enabled: true, hidden: false, inFlight: false };

  it('ふつうの状態では見に行く', () => {
    expect(shouldPoll(base)).toBe(true);
  });

  it('画面を伏せている端末は叩かない', () => {
    expect(shouldPoll({ ...base, hidden: true })).toBe(false);
  });

  it('前の問い合わせが返っていなければ重ねない(会場のWi-Fiが遅いとき)', () => {
    expect(shouldPoll({ ...base, inFlight: true })).toBe(false);
  });

  it('止められている間は見に行かない(くじのルーレットが回っている最中など)', () => {
    expect(shouldPoll({ ...base, enabled: false })).toBe(false);
  });
});
