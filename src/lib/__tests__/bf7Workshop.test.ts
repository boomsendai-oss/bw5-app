// 1/31 HIRO WORKSHOP の告知内容。HIROさん側の正式な文面・表記がずれていないことを確かめる。
import { describe, it, expect } from 'vitest';
import { BF7_WORKSHOP } from '../bf7';

describe('BF7_WORKSHOP', () => {
  it('クラスは2本で、時間は 13:30〜15:00 / 15:15〜16:45', () => {
    expect(BF7_WORKSHOP.classes.map((c) => `${c.start}-${c.end}`)).toEqual(['13:30-15:00', '15:15-16:45']);
  });

  it('説明文は正式な文面のまま(言い換えない)', () => {
    expect(BF7_WORKSHOP.classes[0].description).toBe('リズムトレーニング、STEP、ROUTINEレクチャーのクラス');
    expect(BF7_WORKSHOP.classes[1].description).toBe(
      'テーマとして特定したStepを細かな体の使い方や質感、バリエーション等をレクチャー。振り付けは行わず、徹底的にStepを深掘りするクラス。'
    );
  });

  it('対象Stepは3つで、3つ目は伏せる(HIROさんの意向)', () => {
    expect(BF7_WORKSHOP.classes[1].steps).toEqual(['Robo Cop', 'The Skate (chicken&twist)', '???']);
  });

  it('料金は一般価格・定員は各25名', () => {
    expect(BF7_WORKSHOP.price).toEqual({ one: 4000, two: 7000 });
    expect(BF7_WORKSHOP.capacity).toBe(25);
  });
});
