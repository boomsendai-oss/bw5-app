import { describe, it, expect } from 'vitest';
import { buildKnowledge } from '../faqKnowledge';

const faqRows = [
  { category: '体験', question: '体験したい', answer: 'LINEでご連絡ください', is_public: 1, sort_order: 1 },
];
const productRows = [
  { product_type: 'plan', name: 'マンスリー4', price: 8800, category: '月謝', active: 1, notes: null },
];
const studioRows = [
  { name: '仙台本店', address: '仙台市青葉区…', google_map_url: 'https://maps.google.com/x', active: 1,
    is_public: 1, access_text: '仙台駅から徒歩5分',
    hourly_rate: 3000, pricing_model: 'hourly', block_pricing: null, notes: '内部メモ',
    bank_account_number: '1234567' }, // bank_*は実DBのstudiosに実在する内部列(漏洩保険テスト用)
];
const instructorRows = [
  { name: 'TARO', genre: 'HIPHOP', active: 1, slug: 'taro',
    profile_text: 'ダンス歴15年、初心者に寄り添う指導が得意', career_text: '全国大会入賞多数', crews: 'BOOM CREW',
    contact_email: 'taro@example.com', contact_phone: '090-1234-5678', bank_account_number: '9876543',
    salary_type: 'monthly_fixed', monthly_fixed_amount: 300000, pin_hash: 'HASHEDPIN123' },
    // profile_text/career_text/crewsはHPが公開表示している列(ボットにも開示する)。
    // contact_*/bank_*/salary_*/monthly_fixed_amount/pin_hashは実DBのinstructorsに実在する内部列(漏洩保険テスト用)
];
const classRows = [
  { class_name: 'キッズ 強化', level: '初級', default_day_of_week: 1, default_start_time: '17:00', default_end_time: '18:00',
    active: 1, is_public: 1, studio_name: '仙台本店', instructor_name: 'TARO',
    target: '小学生', description_text: 'リズム感と基礎を楽しく身につけるクラス',
    notes: '時給計算用の内部メモ' },
    // target/description_textはHPが公開表示している列(ボットにも開示する)。
    // notesはHP自身が「HPには表示しない」と明記する内部メモ列(漏洩保険テスト用)
];

const publicStudio = {
  name: '仙台本店', address: '仙台市青葉区…', access: '仙台駅から徒歩5分', map_url: 'https://maps.google.com/x',
};
const publicInstructor = { name: 'TARO', genre: 'HIPHOP', bio: 'ダンス歴15年、初心者に寄り添う指導が得意', career: '全国大会入賞多数', crews: 'BOOM CREW' };
const publicClass = {
  name: 'キッズ 強化', day: '月', start_time: '17:00', end_time: '18:00', level: '初級', instructor: 'TARO', studio: '仙台本店',
  target: '小学生', description: 'リズム感と基礎を楽しく身につけるクラス',
};

describe('buildKnowledge', () => {
  it('公開フィールドだけを含むJSONを組み立てる', () => {
    const k = buildKnowledge({ faqRows, productRows, studioRows, instructorRows, classRows });
    expect(k.faqs).toEqual([{ category: '体験', question: '体験したい', answer: 'LINEでご連絡ください' }]);
    expect(k.prices).toEqual([{ type: 'plan', category: '月謝', name: 'マンスリー4', price: 8800 }]);
    expect(k.studios).toEqual([publicStudio]);
    expect(k.instructors).toEqual([publicInstructor]);
    expect(k.classes).toEqual([publicClass]);
  });

  it('内部情報フィールドがJSON文字列のどこにも漏れない', () => {
    const s = JSON.stringify(buildKnowledge({ faqRows, productRows, studioRows, instructorRows, classRows }));
    expect(s).not.toContain('hourly_rate');
    expect(s).not.toContain('3000');
    expect(s).not.toContain('内部メモ');
    expect(s).not.toContain('1234567');
    expect(s).not.toContain('bank');
    expect(s).not.toContain('taro@example.com');
    expect(s).not.toContain('090-1234-5678');
    expect(s).not.toContain('9876543');
    expect(s).not.toContain('monthly_fixed');
    expect(s).not.toContain('300000');
    expect(s).not.toContain('HASHEDPIN');
    expect(s).not.toContain('時給計算用');
  });

  it('generated_atを持つ', () => {
    expect(buildKnowledge({ faqRows: [], productRows: [], studioRows: [] }).generated_at).toBeTruthy();
  });

  it('instructorRows/classRowsを省略してもエラーにならず空配列になる', () => {
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [] });
    expect(k.instructors).toEqual([]);
    expect(k.classes).toEqual([]);
  });

  it('is_public=0のFAQは除外される', () => {
    const rows = [
      ...faqRows,
      { category: '料金・支払い', question: '非公開の下書き', answer: '下書き回答', is_public: 0, sort_order: 2 },
    ];
    const k = buildKnowledge({ faqRows: rows, productRows: [], studioRows: [] });
    expect(k.faqs).toEqual([{ category: '体験', question: '体験したい', answer: 'LINEでご連絡ください' }]);
  });

  it('active=0の商品は除外される', () => {
    const rows = [
      ...productRows,
      { product_type: 'plan', name: '廃止プラン', price: 5000, category: '月謝', active: 0, notes: null },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: rows, studioRows: [] });
    expect(k.prices).toEqual([{ type: 'plan', category: '月謝', name: 'マンスリー4', price: 8800 }]);
  });

  it('active=0のスタジオは除外される', () => {
    const rows = [
      ...studioRows,
      { name: '閉店した店舗', address: '旧住所', google_map_url: null, active: 0, is_public: 1, access_text: null,
        hourly_rate: 2000, pricing_model: 'hourly', block_pricing: null, notes: null },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: rows });
    expect(k.studios).toEqual([publicStudio]);
  });

  it('active=1でもis_public=0のスタジオは除外される(HPと同じ公開条件)', () => {
    const rows = [
      ...studioRows,
      { name: '非公開スタジオ', address: '非公開住所', google_map_url: null, active: 1, is_public: 0, access_text: null,
        hourly_rate: 2500, pricing_model: 'hourly', block_pricing: null, notes: null },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: rows });
    expect(k.studios).toEqual([publicStudio]);
  });

  it('公開スタジオのaddress/access_text/google_map_urlがnullならそれぞれnullを出力する', () => {
    const rows = [
      { name: '新規スタジオ', address: null, access_text: null, google_map_url: null, active: 1, is_public: 1 },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: rows });
    expect(k.studios).toEqual([{ name: '新規スタジオ', address: null, access: null, map_url: null }]);
  });

  it('category=adminの内部運用SKUはpricesから除外される', () => {
    const rows = [
      ...productRows,
      { product_type: 'plan', name: '🔑管理者プラン🔑', price: 0, category: 'admin', active: 1, notes: null },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: rows, studioRows: [] });
    expect(k.prices).toEqual([{ type: 'plan', category: '月謝', name: 'マンスリー4', price: 8800 }]);
  });

  it('内部運用SKU(admin/instructor/pause)の名称がJSON文字列のどこにも漏れない', () => {
    const rows = [
      ...productRows,
      { product_type: 'plan', name: '🔑管理者プラン🔑', price: 0, category: 'admin', active: 1, notes: null },
      { product_type: 'plan', name: '👨‍🏫BOOMインストラクター', price: 0, category: 'instructor', active: 1, notes: null },
      { product_type: 'plan', name: '💤休会', price: 0, category: 'pause', active: 1, notes: null },
    ];
    const s = JSON.stringify(buildKnowledge({ faqRows: [], productRows: rows, studioRows: [] }));
    expect(s).not.toContain('管理者');
    expect(s).not.toContain('インストラクター');
    expect(s).not.toContain('休会');
  });

  it('trial/event/ticket_memberの内部運用でないカテゴリはpricesに残る', () => {
    const rows = [
      { product_type: 'plan', name: '体験レッスン', price: 0, category: 'trial', active: 1, notes: null },
      { product_type: 'plan', name: '発表会イベント', price: 0, category: 'event', active: 1, notes: null },
      { product_type: 'plan', name: 'チケット会員', price: 0, category: 'ticket_member', active: 1, notes: null },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: rows, studioRows: [] });
    expect(k.prices).toEqual([
      { type: 'plan', category: 'trial', name: '体験レッスン', price: 0 },
      { type: 'plan', category: 'event', name: '発表会イベント', price: 0 },
      { type: 'plan', category: 'ticket_member', name: 'チケット会員', price: 0 },
    ]);
  });

  it('active=0のインストラクターは除外される', () => {
    const rows = [...instructorRows, { name: '退職済み講師', genre: 'HOUSE', active: 0, slug: 'retired' }];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: rows, classRows: [] });
    expect(k.instructors).toEqual([publicInstructor]);
  });

  it('slugが未設定(null)のインストラクターは除外される(HPと同じ公開条件)', () => {
    const rows = [...instructorRows, { name: '準備中講師', genre: 'JAZZ', active: 1, slug: null }];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: rows, classRows: [] });
    expect(k.instructors).toEqual([publicInstructor]);
  });

  it('slugが空文字のインストラクターは除外される(HPと同じ公開条件)', () => {
    const rows = [...instructorRows, { name: '準備中講師2', genre: 'JAZZ', active: 1, slug: '' }];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: rows, classRows: [] });
    expect(k.instructors).toEqual([publicInstructor]);
  });

  it('genre/bio/career/crewsが未設定(null)のインストラクターはnullで出力する', () => {
    const rows = [{ name: 'ゲスト講師', genre: null, active: 1, slug: 'guest', profile_text: null, career_text: null, crews: null }];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: rows, classRows: [] });
    expect(k.instructors).toEqual([{ name: 'ゲスト講師', genre: null, bio: null, career: null, crews: null }]);
  });

  it('bio/career/crews/target/descriptionが空文字なら空文字ノイズを載せずnullに正規化する', () => {
    const iRows = [{ name: '空欄講師', genre: 'HOUSE', active: 1, slug: 'empty', profile_text: '', career_text: '   ', crews: '' }];
    const cRows = [{ class_name: '空欄クラス', level: '初級', default_day_of_week: 1, default_start_time: '17:00', default_end_time: '18:00',
      active: 1, is_public: 1, studio_name: '仙台本店', instructor_name: 'TARO', target: '', description_text: '  ' }];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: iRows, classRows: cRows });
    expect(k.instructors[0]).toEqual({ name: '空欄講師', genre: 'HOUSE', bio: null, career: null, crews: null });
    expect(k.classes[0].target).toBeNull();
    expect(k.classes[0].description).toBeNull();
  });

  it('is_public=0のクラスは除外される', () => {
    const rows = [
      ...classRows,
      { class_name: '非公開クラス', level: '中級', default_day_of_week: 2, default_start_time: '19:00', default_end_time: '20:00',
        active: 1, is_public: 0, studio_name: '仙台本店', instructor_name: 'KEIKO' },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: [], classRows: rows });
    expect(k.classes).toEqual([publicClass]);
  });

  it('active=0のクラスは除外される(is_public=1でも、HPと同じ公開条件)', () => {
    const rows = [
      ...classRows,
      { class_name: '終了したクラス', level: '中級', default_day_of_week: 2, default_start_time: '19:00', default_end_time: '20:00',
        active: 0, is_public: 1, studio_name: '仙台本店', instructor_name: 'KEIKO' },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: [], classRows: rows });
    expect(k.classes).toEqual([publicClass]);
  });

  it('曜日番号0〜6を日/月/火/水/木/金/土へ正しく変換する(bigint互換含む)', () => {
    const rows = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      class_name: `クラス${i}`,
      level: null,
      default_day_of_week: i === 3 ? BigInt(i) : i,
      default_start_time: '10:00',
      default_end_time: '11:00',
      active: 1,
      is_public: 1,
      studio_name: '仙台本店',
      instructor_name: 'TARO',
    }));
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: [], classRows: rows });
    expect(k.classes.map((c) => c.day)).toEqual(['日', '月', '火', '水', '木', '金', '土']);
  });

  it('day/start_time/end_time/level/instructor/studioがnullならnullを出力する(未設定を0=日曜と誤って断定しない)', () => {
    const rows = [
      { class_name: '未設定クラス', level: null, default_day_of_week: null, default_start_time: null, default_end_time: null,
        active: 1, is_public: 1, studio_name: null, instructor_name: null },
    ];
    const k = buildKnowledge({ faqRows: [], productRows: [], studioRows: [], instructorRows: [], classRows: rows });
    expect(k.classes).toEqual([
      { name: '未設定クラス', day: null, start_time: null, end_time: null, level: null, instructor: null, studio: null, target: null, description: null },
    ]);
  });
});
