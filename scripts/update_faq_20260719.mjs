#!/usr/bin/env node
// FAQ更新スクリプト (WS O・ベータ監査#2のTARO回答反映・2026-07-19)
// 既存3問を正しい仕様に更新 + 新規2問を追加(冪等)。
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db';
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const MAX_LEN = { category: 50, question: 200, answer: 2000 };

// 既存問の回答差し替え(question完全一致でUPDATE)。
const UPDATES = [
  {
    question: '休会したい時は？',
    answer:
      '休会は1ヶ月単位で、開始・復帰はいずれも月の1日からです(月の途中からの休会はできません)。最長4ヶ月まで休会でき、期間が終わると自動的に復会します。翌月から休会するには毎月10日までの手続きが必要です(11日以降は翌々月から)。休会には所定のシステム変更手数料¥1,500がかかります。手続き方法は公式LINEでスタッフにご相談ください。',
  },
  {
    question: 'チケットの有効期限は？',
    answer:
      '1枚チケット・5回チケットとも購入日から2ヶ月間有効です。ビジターチケットは当日のみ有効です。',
  },
  {
    question: '予約をキャンセルしたい時は？(会員の方)',
    answer:
      'BOOMポータルの「予定管理」から予約状況を開き、該当のレッスンをキャンセルできます。キャンセルはそのレッスンの終了後5時間以内まで可能で、うっかりレッスン時間を過ぎても即座にチケットが消費されることはありません。チケットで予約していた場合、キャンセルすると使わなかったチケットは手元に戻り、2ヶ月の有効期限内に別のレッスンでお使いいただけます。操作がうまくできない場合は公式LINEでご連絡ください。',
  },
];

// 新規追加(question未存在時のみINSERT)。sort_orderは既存最大+連番。
const INSERTS = [
  {
    category: '入会',
    question: '入会金はかかりますか？',
    answer:
      'はい、ご入会時に入会金¥4,000をいただいています。ただし体験レッスンから2週間以内にご入会いただくと、入会金0円・初月の月謝半額・BOOMオリジナルTシャツプレゼントの特典があります。詳しくは公式LINEでご案内します。',
  },
  {
    category: 'その他',
    question: '多賀城のHOUSEクラスはいつやっていますか？',
    answer:
      '多賀城のHOUSEクラスは月2回の開催です。AOI先生とK@TTSU(カッツ)先生が1回ずつ持ち回りで担当します。開催日はその月ごとに決まるので、最新の日程は公式LINEやカレンダーでご確認ください。',
  },
];

function assertLimits(rows) {
  for (const r of rows) {
    for (const [f, max] of Object.entries(MAX_LEN)) {
      const v = r[f];
      if (v != null && v.length > max) throw new Error(`${f} exceeds ${max} (actual ${v.length}): ${r.question}`);
    }
  }
}

async function main() {
  assertLimits([...UPDATES, ...INSERTS]);

  let updated = 0;
  let notFound = 0;
  for (const u of UPDATES) {
    const res = await client.execute({
      sql: "UPDATE faq_entries SET answer = ?, updated_at = datetime('now') WHERE question = ?",
      args: [u.answer, u.question],
    });
    if (res.rowsAffected > 0) updated++;
    else {
      notFound++;
      console.warn('UPDATE対象なし(question不一致):', u.question);
    }
  }

  const maxRow = await client.execute('SELECT COALESCE(MAX(sort_order),0) AS m FROM faq_entries');
  let sort = Number(maxRow.rows[0].m);
  let inserted = 0;
  let skipped = 0;
  for (const ins of INSERTS) {
    const ex = await client.execute({ sql: 'SELECT id FROM faq_entries WHERE question = ?', args: [ins.question] });
    if (ex.rows.length > 0) {
      skipped++;
      continue;
    }
    sort++;
    await client.execute({
      sql: 'INSERT INTO faq_entries (category, question, answer, is_public, sort_order) VALUES (?, ?, ?, 1, ?)',
      args: [ins.category, ins.question, ins.answer, sort],
    });
    inserted++;
  }

  console.log(`updated=${updated} notFound=${notFound} inserted=${inserted} skipped=${skipped}`);
}

main().catch((e) => {
  console.error('UPDATE FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
