// WS O: 公開ナレッジのホワイトリスト整形。ここに書いたフィールド以外は出力されない。
// studiosのhourly_rate/block_pricing/notes等はBOOM側の内部原価・メモであり絶対に含めない。

export type PublicKnowledge = {
  generated_at: string;
  faqs: { category: string; question: string; answer: string }[];
  prices: { type: string; category: string | null; name: string; price: number }[];
  studios: { name: string; address: string | null; map_url: string | null }[];
};

type Row = Record<string, unknown>;
type Rows = { faqRows: Row[]; productRows: Row[]; studioRows: Row[] };

export function buildKnowledge({ faqRows, productRows, studioRows }: Rows): PublicKnowledge {
  return {
    generated_at: new Date().toISOString(),
    faqs: faqRows
      .filter((r) => Number(r.is_public) === 1)
      .map((r) => ({ category: String(r.category), question: String(r.question), answer: String(r.answer) })),
    prices: productRows
      .filter((r) => Number(r.active) === 1)
      .map((r) => ({
        type: String(r.product_type),
        category: r.category == null ? null : String(r.category),
        name: String(r.name),
        price: Number(r.price),
      })),
    studios: studioRows
      .filter((r) => Number(r.active) === 1)
      .map((r) => ({
        name: String(r.name),
        address: r.address == null ? null : String(r.address),
        map_url: r.google_map_url == null ? null : String(r.google_map_url),
      })),
  };
}
