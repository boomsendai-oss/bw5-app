// イベント後にkioskの売上をBASE在庫へ反映するための純ロジック。
// 集計(何を何枚減らすか)と、BASEの現在バリエーションへの適用(全量送信用の配列生成)を確かめる。
import { describe, it, expect } from 'vitest';
import { computeBaseSyncPlan, applyPlanToBaseItem } from '../kioskBaseSync';

describe('computeBaseSyncPlan', () => {
  it('base_item_id+バリエーション単位で売れた数を合算する', () => {
    const plan = computeBaseSyncPlan([
      { baseItemId: 100, variantLabel: 'ブラック S', qty: 1 },
      { baseItemId: 100, variantLabel: 'ブラック S', qty: 2 },
      { baseItemId: 100, variantLabel: 'ブルー M', qty: 1 },
      { baseItemId: 200, variantLabel: '', qty: 3 },
    ]);
    expect(plan).toEqual([
      { baseItemId: 100, variantLabel: 'ブラック S', soldQty: 3 },
      { baseItemId: 100, variantLabel: 'ブルー M', soldQty: 1 },
      { baseItemId: 200, variantLabel: '', soldQty: 3 },
    ]);
  });
});

describe('applyPlanToBaseItem', () => {
  const baseItem = {
    item_id: 100,
    title: 'シグネチャーT',
    stock: 0,
    variations: [
      { variation_id: 11, variation: 'ブラック S', variation_stock: 4 },
      { variation_id: 12, variation: 'ブルー M', variation_stock: 1 },
      { variation_id: 13, variation: 'ホワイト L', variation_stock: 2 },
    ],
  };

  it('売れた分を引いた全バリエーション配列を返す(触らないサイズも含む=BASE全量送信仕様)', () => {
    const res = applyPlanToBaseItem(baseItem, [
      { baseItemId: 100, variantLabel: 'ブラック S', soldQty: 3 },
      { baseItemId: 100, variantLabel: 'ブルー M', soldQty: 1 },
    ]);
    expect(res.variations).toEqual([
      { variationId: 11, name: 'ブラック S', stock: 1 },
      { variationId: 12, name: 'ブルー M', stock: 0 },
      { variationId: 13, name: 'ホワイト L', stock: 2 },
    ]);
    expect(res.warnings).toEqual([]);
  });

  it('BASE在庫が売れた数より少なくても0で止め、警告を返す(マイナスにしない)', () => {
    const res = applyPlanToBaseItem(baseItem, [{ baseItemId: 100, variantLabel: 'ブルー M', soldQty: 5 }]);
    expect(res.variations.find((v) => v.variationId === 12)?.stock).toBe(0);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain('ブルー M');
  });

  it('BASE側に無いバリエーション名は警告してスキップ', () => {
    const res = applyPlanToBaseItem(baseItem, [{ baseItemId: 100, variantLabel: 'レッド XL', soldQty: 1 }]);
    expect(res.variations).toHaveLength(3);
    expect(res.warnings[0]).toContain('レッド XL');
  });

  it('バリエーションなし商品は商品在庫から引く', () => {
    const res = applyPlanToBaseItem(
      { item_id: 200, title: 'キャップ', stock: 6, variations: [] },
      [{ baseItemId: 200, variantLabel: '', soldQty: 2 }]
    );
    expect(res.stock).toBe(4);
    expect(res.variations).toEqual([]);
  });
});
