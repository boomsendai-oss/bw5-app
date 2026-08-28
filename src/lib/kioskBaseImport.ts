// BASEネットショップの商品をkioskの販売会へ取り込むための変換(純関数)。
// BASEのバリエーション名は「ブラック S」のような「カラー サイズ」形式が慣習のため、
// 最初の空白で分解する(空白なしはサイズのみ扱い=kiosk側の規約と同じ)。
import type { BaseItem } from '@/lib/base';

export interface MappedKioskVariant {
  color: string;
  size: string;
  stock: number;
}

export interface MappedKioskProduct {
  name: string;
  price: number;
  imageUrl: string;
  stock: number;
  variants: MappedKioskVariant[];
}

function splitVariationName(name: string): { color: string; size: string } {
  const trimmed = name.trim();
  const idx = trimmed.indexOf(' ');
  if (idx < 0) return { color: '', size: trimmed };
  return { color: trimmed.slice(0, idx), size: trimmed.slice(idx + 1).trim() };
}

export function mapBaseItemToKioskProduct(item: BaseItem): MappedKioskProduct {
  const variants = (item.variations ?? []).map((v) => ({
    ...splitVariationName(String(v.variation ?? '')),
    stock: Number(v.variation_stock ?? 0),
  }));
  return {
    name: String(item.title ?? ''),
    price: Number(item.price ?? 0),
    imageUrl: String(item.img1_origin ?? item.list_image_url ?? item.detail_image_url ?? ''),
    stock: variants.length > 0 ? 0 : Number(item.stock ?? 0),
    variants,
  };
}
