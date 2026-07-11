// WS O: 公開ナレッジのホワイトリスト整形。ここに書いたフィールド以外は出力されない。
// studiosのhourly_rate/block_pricing/notes等はBOOM側の内部原価・メモであり絶対に含めない。
// instructorsのcontact_email/contact_phone/bank_*/salary_type/monthly_fixed_amount/pin_hash等、
// lesson_masterのnotes(HP自身が「HPには表示しない・後方互換のため残置」と明記する内部メモ)も同様に絶対に含めない。

export type PublicKnowledge = {
  generated_at: string;
  faqs: { category: string; question: string; answer: string }[];
  prices: { type: string; category: string | null; name: string; price: number }[];
  studios: { name: string; address: string | null; access: string | null; map_url: string | null }[];
  instructors: { name: string; genre: string | null }[];
  classes: {
    name: string;
    day: string | null;
    start_time: string | null;
    end_time: string | null;
    level: string | null;
    instructor: string | null;
    studio: string | null;
  }[];
};

// libSQLは数値列をnumberではなくbigintで返すことがあるため is_public/active/price は number | bigint。
// Number(r.x)===1 判定・Number(r.price) はどちらの型でも同じ結果になるためガード分岐は不要。
export type FaqRow = { category: string; question: string; answer: string; is_public: number | bigint };
export type ProductRow = { product_type: string; name: string; price: number | bigint; category: string | null; active: number | bigint };
export type StudioRow = { name: string; address: string | null; access_text: string | null; google_map_url: string | null; active: number | bigint; is_public: number | bigint };

// boom-hp/src/lib/instructors.ts と同一の公開条件(active=1 AND slug IS NOT NULL AND slug!='')で絞り込むための列のみ。
// role相当の列はinstructorsテーブルに存在しないため型に含めない(無い属性を追加しない方針)。
export type InstructorRow = { name: string; genre: string | null; active: number | bigint; slug: string | null };

// boom-hp/src/lib/classes.ts と同一の公開条件(active=1 AND is_public=1)で絞り込むための列のみ。
// notes(内部メモ)・description_text・video_url・target・slugはHPのLesson型定義上も非公開/非表示のため取得しない。
// classにgenre相当の列は無い(genreはinstructor側のみ)ため型に含めない。
export type ClassRow = {
  class_name: string;
  level: string | null;
  default_day_of_week: number | bigint | null;
  default_start_time: string | null;
  default_end_time: string | null;
  instructor_name: string | null;
  studio_name: string | null;
  active: number | bigint;
  is_public: number | bigint;
};

type Rows = {
  faqRows: FaqRow[];
  productRows: ProductRow[];
  studioRows: StudioRow[];
  instructorRows?: InstructorRow[];
  classRows?: ClassRow[];
};

// hacomono_products.category の内部運用カテゴリ(管理者プラン/インストラクター用/休会)はお客さん向けボットに不要・不適切なため除外。
// SELECT側(src/app/api/public/knowledge/route.ts)のWHERE句と二重防御(studiosのactive+is_public二重フィルタと同じ思想)。
// trial(体験)/event(イベント)/ticket_member(チケット会員)はお客さん向けに意味のある情報のため残す。
const INTERNAL_PRODUCT_CATEGORIES = new Set(['admin', 'instructor', 'pause']);

// 曜日番号(0=日〜6=土、boom-hp/src/lib/day-names.ts と同じ値)→日本語表記。
// このアプリの他画面(staff/schedule等)の慣習と同じくローカル定数として持つ(共有libは意図的に作らない)。
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

function dayName(dow: number | bigint | null): string | null {
  if (dow == null) return null;
  return DAY_NAMES[Number(dow)] ?? null;
}

export function buildKnowledge({ faqRows, productRows, studioRows, instructorRows = [], classRows = [] }: Rows): PublicKnowledge {
  return {
    generated_at: new Date().toISOString(),
    // faq_entriesは全列NOT NULLのため category/question/answer は String() 直・nullガード不要。
    faqs: faqRows
      .filter((r) => Number(r.is_public) === 1)
      .map((r) => ({ category: String(r.category), question: String(r.question), answer: String(r.answer) })),
    prices: productRows
      .filter((r) => Number(r.active) === 1 && !INTERNAL_PRODUCT_CATEGORIES.has(String(r.category ?? '')))
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
    // 公開条件は active=1 かつ slug設定済み(本番HP boom-hp/src/lib/instructors.ts と同一条件)。
    instructors: instructorRows
      .filter((r) => Number(r.active) === 1 && r.slug != null && String(r.slug) !== '')
      .map((r) => ({
        name: String(r.name),
        genre: r.genre == null ? null : String(r.genre),
      })),
    // 公開条件は active=1 かつ is_public=1(本番HP boom-hp/src/lib/classes.ts と同一条件)。
    // dayはdefault_day_of_week(0=日〜6=土)を日本語表記へ変換。未設定はnullのまま出力し、
    // 0=日曜と誤って断定しない(HPのgetLessons()はUI一覧表示用に0へフォールバックするが、
    // 本ボットは断定回答を避けたいためnull透過とする・意図的な差異)。
    classes: classRows
      .filter((r) => Number(r.active) === 1 && Number(r.is_public) === 1)
      .map((r) => ({
        name: String(r.class_name),
        day: dayName(r.default_day_of_week),
        start_time: r.default_start_time == null ? null : String(r.default_start_time),
        end_time: r.default_end_time == null ? null : String(r.default_end_time),
        level: r.level == null ? null : String(r.level),
        instructor: r.instructor_name == null ? null : String(r.instructor_name),
        studio: r.studio_name == null ? null : String(r.studio_name),
      })),
  };
}
