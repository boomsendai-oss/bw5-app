// WS O: 公開ナレッジのホワイトリスト整形。ここに書いたフィールド以外は出力されない。
// studiosのhourly_rate/block_pricing/notes等はBOOM側の内部原価・メモであり絶対に含めない。

export type PublicKnowledge = {
  generated_at: string;
  faqs: { category: string; question: string; answer: string }[];
  prices: { type: string; category: string | null; name: string; price: number }[];
  studios: { name: string; address: string | null; access: string | null; map_url: string | null }[];
};

// libSQLは数値列をnumberではなくbigintで返すことがあるため is_public/active/price は number | bigint。
// Number(r.x)===1 判定・Number(r.price) はどちらの型でも同じ結果になるためガード分岐は不要。
export type FaqRow = { category: string; question: string; answer: string; is_public: number | bigint };
export type ProductRow = { product_type: string; name: string; price: number | bigint; category: string | null; active: number | bigint };
export type StudioRow = { name: string; address: string | null; access_text: string | null; google_map_url: string | null; active: number | bigint; is_public: number | bigint };

type Rows = { faqRows: FaqRow[]; productRows: ProductRow[]; studioRows: StudioRow[] };

export function buildKnowledge({ faqRows, productRows, studioRows }: Rows): PublicKnowledge {
  return {
    generated_at: new Date().toISOString(),
    // faq_entriesは全列NOT NULLのため category/question/answer は String() 直・nullガード不要。
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
    // 公開条件は active=1 かつ is_public=1(本番HP boom-hp/src/lib/studios.ts と同一条件)。
    // is_public/access_text/map_embed_url は本番DBに実在する列(ローカルはschema.ts/migrations.tsで追補)。
    studios: studioRows
      .filter((r) => Number(r.active) === 1 && Number(r.is_public) === 1)
      .map((r) => ({
        name: String(r.name),
        address: r.address == null ? null : String(r.address),
        access: r.access_text == null ? null : String(r.access_text),
        map_url: r.google_map_url == null ? null : String(r.google_map_url),
      })),
  };
}
