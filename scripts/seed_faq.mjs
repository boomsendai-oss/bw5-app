#!/usr/bin/env node
// FAQ初期データ投入スクリプト (WS O: FAQ AIチャットボット「BOOMくんに質問」)
//
// 転記元 (読み取りのみ・このスクリプトからは変更しない):
//   - boom-hp/src/app/faq/page.tsx   … faqCategories の11問。answerは一字一句そのまま転記(要約・創作禁止)
//   - boom-hp/src/app/price/page.tsx … 料金Q&A。ページに実在する文言・金額のみを使用(記載の無い金額・条件は書かない)
//
// カテゴリマッピング (HPの4カテゴリ → アプリの5カテゴリ):
//   体験について               → 体験
//   入会について               → 入会
//   チケット・お支払いについて → 料金・支払い
//   ダンス部について           → その他
//   (「レッスン」はHP側に対応カテゴリが無いため今回は未使用)
//
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (未設定なら file:./data/bw5.db)
// 冪等性: 同じ question が既に存在する行は INSERT せず skip する(何度実行してもDBは増えない)。
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db';
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

// 文字数上限: スタッフCRUD API (src/app/api/staff/faq/route.ts の MAX_LEN) と同じ値に揃える。
const MAX_LEN = { category: 50, question: 200, answer: 2000 };

// faq_entries が未作成の環境(移行前のTursoプロジェクト等)でも動くように、
// scripts/migrations/20260711_faq_entries.sql と同一定義のCREATE TABLE IF NOT EXISTSを
// 保険として実行する。既に適用済みの環境では完全に no-op。
const ENSURE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS faq_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;
const ENSURE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_faq_entries_public ON faq_entries(is_public, category, sort_order)`;

// === HP FAQ 11問 (boom-hp/src/app/faq/page.tsx の faqCategories より一字一句転記) ===
const SEED = [
  // 体験について → 体験 (7問)
  { category: '体験', question: '体験したい場合どうしたらいいの？', answer: 'LINEまたはメールでお気軽にお問い合わせください。ご希望のクラスと日時をお伝えいただければ、体験レッスンのご予約を承ります。' },
  { category: '体験', question: '初心者ですが、参加できますか？', answer: 'もちろんです！BOOMには初心者さま専用クラスがあり、ダンスが初めての方でも安心してご参加いただけます。' },
  { category: '体験', question: 'レッスン受けるときに必要なものは？', answer: '動きやすい服装、室内用のスニーカー、タオル、飲み物をお持ちください。更衣室がございます。' },
  { category: '体験', question: '見学は可能ですか？', answer: 'はい、見学も大歓迎です。事前にLINEまたはメールでご連絡いただけるとスムーズです。' },
  { category: '体験', question: '予約したけどキャンセルしたい時は？', answer: 'LINEまたはメールでご連絡ください。当日キャンセルも対応いたします。' },
  { category: '体験', question: '体験レッスンにかかる時間はどれくらい？', answer: 'クラスによって60分〜90分です。着替えを含めて前後15分ほど余裕を見ていただけると安心です。' },
  { category: '体験', question: '子供は参加できますか？', answer: 'はい！4歳から参加可能なキッズクラスがあります。お子さまの年齢に合ったクラスをご案内します。' },

  // 入会について → 入会 (1問)
  { category: '入会', question: '入門クラスから始めなければなりませんか？', answer: '経験者の方は入門以外のクラスからでもOKです。レベルに迷う場合はお気軽にご相談ください。' },

  // チケット・お支払いについて → 料金・支払い (2問)
  { category: '料金・支払い', question: '支払い方法は？', answer: '現金、またはクレジットカード（マンスリープランの場合）でお支払いいただけます。' },
  { category: '料金・支払い', question: 'チケットの有効期限は？', answer: '5回チケットは購入日から2ヶ月間有効です。ビジターチケットは当日のみ有効です。' },

  // ダンス部について → その他 (1問)
  { category: 'その他', question: 'BOOMダンス部とは？', answer: '中学生向けの「BOOMストリートダンス部」プログラムです。在校中の学校へ活動報告し、ダンス活動を校内評価に繋げる取り組みです。' },

  // === 料金Q&A 4問 (boom-hp/src/app/price/page.tsx に実在する文言・金額のみを使用。
  //     ページに書かれていない金額・条件は書かない。新規に作成した質問文だが、回答内容は
  //     すべてページ記載の価格・注記に基づく) ===
  { category: '料金・支払い', question: '90分レッスンの料金はいくらですか？', answer: '体験レッスンは¥1,000（1回・初回限定）、ビジターは¥2,000（1回）、5回チケットは¥9,000（1回あたり¥1,800・購入日から2ヶ月有効）です。' },
  { category: '料金・支払い', question: '60分レッスンの料金はいくらですか？', answer: 'ビジターは¥1,700（1回）、5回チケットは¥7,500（1回あたり¥1,500・購入日から2ヶ月有効）です。' },
  { category: '料金・支払い', question: '体験レッスンは有料ですか？', answer: '体験レッスンは¥1,000（1回・初回限定）です。クーポンコードで体験レッスンが無料になるチャンスもあります。' },
  { category: '料金・支払い', question: '全額返金保証はありますか？', answer: 'はい、BOOMは全額返金保証付きです。レッスンにご満足いただけなかった場合、受講後でも全額返金いたします。' },
];

/** SEED配列がCRUD APIと同じ文字数上限内かを検証。超過や空文字があれば例外を投げてDB書き込み前に止める。 */
function assertSeedWithinLimits() {
  SEED.forEach((entry, i) => {
    for (const field of /** @type {const} */ (['category', 'question', 'answer'])) {
      const value = entry[field];
      if (!value || !value.trim()) {
        throw new Error(`SEED[${i}].${field} is empty (question="${entry.question ?? '(none)'}")`);
      }
      if (value.length > MAX_LEN[field]) {
        throw new Error(`SEED[${i}].${field} exceeds ${MAX_LEN[field]} chars (actual ${value.length}): question="${entry.question}"`);
      }
    }
  });
}

async function main() {
  assertSeedWithinLimits();

  await client.execute(ENSURE_TABLE_SQL);
  await client.execute(ENSURE_INDEX_SQL);

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < SEED.length; i++) {
    const { category, question, answer } = SEED[i];
    const sortOrder = i + 1; // sort_orderはSEED配列順の連番

    const existing = await client.execute({
      sql: 'SELECT id FROM faq_entries WHERE question = ?',
      args: [question],
    });

    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    await client.execute({
      sql: 'INSERT INTO faq_entries (category, question, answer, is_public, sort_order) VALUES (?, ?, ?, 1, ?)',
      args: [category, question, answer, sortOrder],
    });
    inserted++;
  }

  console.log(`inserted=${inserted} skipped=${skipped}`);
}

main().catch((e) => {
  console.error('SEED FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
