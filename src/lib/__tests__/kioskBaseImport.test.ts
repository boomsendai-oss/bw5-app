// BASE商品→kiosk商品への変換(純関数)。バリエーション名「カラー サイズ」の分解と
// バリエーションなし商品の在庫の扱いを確かめる。
import { describe, it, expect } from 'vitest';
import { mapBaseItemToKioskProduct } from '../kioskBaseImport';

describe('mapBaseItemToKioskProduct', () => {
  it('バリエーションあり: 「カラー サイズ」を分解し、商品在庫は0(在庫はvariant側)', () => {
    const mapped = mapBaseItemToKioskProduct({
      item_id: 144023455,
      title: 'BOOM シグネチャーTシャツ',
      price: 5800,
      img1_origin: 'https://base-ec2.akamaized.net/images/item/origin/abc.png',
      variations: [
        { variation_id: 1, variation: 'ブラック S', variation_stock: 1 },
        { variation_id: 2, variation: 'ブラック M', variation_stock: 2 },
        { variation_id: 3, variation: 'F', variation_stock: 3 },
      ],
    });
    expect(mapped.name).toBe('BOOM シグネチャーTシャツ');
    expect(mapped.price).toBe(5800);
    expect(mapped.imageUrl).toContain('base-ec2');
    expect(mapped.stock).toBe(0);
    expect(mapped.variants).toEqual([
      { color: 'ブラック', size: 'S', stock: 1 },
      { color: 'ブラック', size: 'M', stock: 2 },
      { color: '', size: 'F', stock: 3 },
    ]);
  });

  it('バリエーションなし: 商品在庫をそのまま使う', () => {
    const mapped = mapBaseItemToKioskProduct({
      item_id: 144022902,
      title: 'BM フェルトロゴキャップ',
      price: 5500,
      stock: 6,
      list_image_url: 'https://base-ec2.akamaized.net/images/item/abc.png',
      variations: [],
    });
    expect(mapped.stock).toBe(6);
    expect(mapped.variants).toEqual([]);
  });

  it('価格や在庫が欠けていても壊れない(0扱い)', () => {
    const mapped = mapBaseItemToKioskProduct({ item_id: 1, title: 'X', variations: undefined });
    expect(mapped.price).toBe(0);
    expect(mapped.stock).toBe(0);
    expect(mapped.imageUrl).toBe('');
  });
});
