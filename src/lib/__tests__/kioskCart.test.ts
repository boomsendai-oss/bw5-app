// kiosk のカート操作(iPad UIの中核ロジック)。純関数としてここでテストする。
import { describe, it, expect } from 'vitest';
import { addToCart, removeFromCart, changeQty, cartTotal, cartCount, type CartLine } from '../kioskCart';

const tee = { productId: 1, variantId: 10, name: '黒×黒Tシャツ', variantLabel: 'M', price: 3500 };
const sticker = { productId: 2, variantId: null, name: 'ステッカー', variantLabel: '', price: 500 };

describe('kioskCart', () => {
  it('追加すると行が増え、同じ商品+サイズは数量がまとまる', () => {
    let cart: CartLine[] = [];
    cart = addToCart(cart, tee);
    cart = addToCart(cart, sticker);
    cart = addToCart(cart, tee);
    expect(cart).toHaveLength(2);
    expect(cart.find((l) => l.variantId === 10)?.qty).toBe(2);
  });

  it('同じ商品でもサイズ違いは別の行になる', () => {
    let cart: CartLine[] = [];
    cart = addToCart(cart, tee);
    cart = addToCart(cart, { ...tee, variantId: 11, variantLabel: 'L' });
    expect(cart).toHaveLength(2);
  });

  it('合計金額と合計点数', () => {
    let cart: CartLine[] = [];
    cart = addToCart(cart, tee);
    cart = addToCart(cart, tee);
    cart = addToCart(cart, sticker);
    expect(cartTotal(cart)).toBe(7500);
    expect(cartCount(cart)).toBe(3);
  });

  it('数量変更で0以下になったら行ごと消える', () => {
    let cart: CartLine[] = [];
    cart = addToCart(cart, tee);
    cart = changeQty(cart, tee.productId, tee.variantId, -1);
    expect(cart).toHaveLength(0);
  });

  it('数量は上限(在庫または注文上限)でクリップされる', () => {
    let cart: CartLine[] = [];
    cart = addToCart(cart, { ...sticker, max: 3 });
    cart = changeQty(cart, sticker.productId, null, +9);
    expect(cart[0].qty).toBe(3);
  });

  it('行の削除', () => {
    let cart: CartLine[] = [];
    cart = addToCart(cart, tee);
    cart = addToCart(cart, sticker);
    cart = removeFromCart(cart, tee.productId, tee.variantId);
    expect(cart).toHaveLength(1);
    expect(cart[0].productId).toBe(2);
  });
});
