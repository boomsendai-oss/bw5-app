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

const publicStudio = {
  name: '仙台本店', address: '仙台市青葉区…', access: '仙台駅から徒歩5分', map_url: 'https://maps.google.com/x',
};

describe('buildKnowledge', () => {
  it('公開フィールドだけを含むJSONを組み立てる', () => {
    const k = buildKnowledge({ faqRows, productRows, studioRows });
    expect(k.faqs).toEqual([{ category: '体験', question: '体験したい', answer: 'LINEでご連絡ください' }]);
    expect(k.prices).toEqual([{ type: 'plan', category: '月謝', name: 'マンスリー4', price: 8800 }]);
    expect(k.studios).toEqual([publicStudio]);
  });

  it('内部情報フィールドがJSON文字列のどこにも漏れない', () => {
    const s = JSON.stringify(buildKnowledge({ faqRows, productRows, studioRows }));
    expect(s).not.toContain('hourly_rate');
    expect(s).not.toContain('3000');
    expect(s).not.toContain('内部メモ');
    expect(s).not.toContain('1234567');
    expect(s).not.toContain('bank');
  });

  it('generated_atを持つ', () => {
    expect(buildKnowledge({ faqRows: [], productRows: [], studioRows: [] }).generated_at).toBeTruthy();
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
});
