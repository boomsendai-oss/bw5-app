// kiosk のカート操作(純関数)。iPad UI(/kiosk)から使う。
// 行の同一性は productId + variantId。max は行ごとの数量上限(在庫と注文上限の小さい方を渡す)。
import { KIOSK_MAX_QTY_PER_ORDER } from '@/lib/kioskShared';

export interface CartLine {
  productId: number;
  variantId: number | null;
  name: string;
  variantLabel: string;
  price: number;
  qty: number;
  max: number;
}

export interface CartAddInput {
  productId: number;
  variantId: number | null;
  name: string;
  variantLabel: string;
  price: number;
  max?: number;
}

function sameLine(l: CartLine, productId: number, variantId: number | null): boolean {
  return l.productId === productId && l.variantId === variantId;
}

export function addToCart(cart: CartLine[], input: CartAddInput, qty = 1): CartLine[] {
  const max = input.max ?? KIOSK_MAX_QTY_PER_ORDER;
  const add = Math.max(1, qty);
  const existing = cart.find((l) => sameLine(l, input.productId, input.variantId));
  if (existing) {
    return cart.map((l) =>
      sameLine(l, input.productId, input.variantId) ? { ...l, qty: Math.min(l.qty + add, max), max } : l
    );
  }
  return [
    ...cart,
    {
      productId: input.productId,
      variantId: input.variantId,
      name: input.name,
      variantLabel: input.variantLabel,
      price: input.price,
      qty: Math.min(add, max),
      max,
    },
  ];
}

export function changeQty(cart: CartLine[], productId: number, variantId: number | null, delta: number): CartLine[] {
  return cart
    .map((l) => (sameLine(l, productId, variantId) ? { ...l, qty: Math.min(l.qty + delta, l.max) } : l))
    .filter((l) => l.qty > 0);
}

export function removeFromCart(cart: CartLine[], productId: number, variantId: number | null): CartLine[] {
  return cart.filter((l) => !sameLine(l, productId, variantId));
}

export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((s, l) => s + l.price * l.qty, 0);
}

export function cartCount(cart: CartLine[]): number {
  return cart.reduce((s, l) => s + l.qty, 0);
}
