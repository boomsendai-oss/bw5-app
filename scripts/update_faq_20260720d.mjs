import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// JAZZ強化クラスの受講条件と料金をTAROに確認できたので回答本文に追記する。
// (条件=JAZZの基礎が固まっている人向け / 料金=通常プラン内でもチケットでも受講可)
const Q = 'JAZZの強化クラスはありますか？';
const A =
  '2026年7月から、KEIKO先生のSTREET JAZZ強化クラスを月1回のペースで開催しているよ！火曜19:00〜20:30が目安だけど、開催日と会場は月ごとに変わるから、最新の日程は公式LINEやカレンダーで確認してね📅 通常の多賀城JAZZ(月曜18:30〜)も続いているよ。\n' +
  'JAZZの基礎がある程度固まっている人に向けたクラスだよ。料金は普段の月謝プランの中で受けられるし、チケットを購入して受けることもできるから、気になったら気軽に聞いてね😊';

const r = await c.execute({ sql: 'UPDATE faq_entries SET answer=? WHERE question=?', args: [A, Q] });
console.log(`FAQ更新: ${r.rowsAffected}件`);
