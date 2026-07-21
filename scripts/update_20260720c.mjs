import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// ① 地図URL未登録2件を補完(既存DBと同じ ?q= 形式・住所ベース)
const MAPS = [
  { name: "T's STUDIO", q: '〒985-0863 宮城県多賀城市東田中2丁目40-1' },
  { name: 'アクアスタジオ', q: '〒985-0802 宮城県宮城郡七ヶ浜町吉田浜字野山5-1 七ヶ浜健康スポーツセンター アクアリーナ内' },
];
for (const m of MAPS) {
  const url = 'https://maps.google.com/?q=' + encodeURIComponent(m.q);
  const r = await c.execute({
    sql: "UPDATE studios SET google_map_url=? WHERE name=? AND (google_map_url IS NULL OR google_map_url='')",
    args: [url, m.name],
  });
  console.log(`地図URL ${m.name}: 更新${r.rowsAffected}件`);
}

// ②③ FAQ追加(冪等)
const INSERTS = [
  {
    category: 'スケジュール',
    question: 'JAZZの強化クラスはありますか？',
    answer:
      '2026年7月から、KEIKO先生のSTREET JAZZ強化クラスを月1回のペースで開催しているよ！火曜19:00〜20:30が目安だけど、開催日と会場は月ごとに変わるから、最新の日程は公式LINEやカレンダーで確認してね📅 通常の多賀城JAZZ(月曜18:30〜)も続いているよ。',
  },
  {
    category: 'その他',
    question: '発表会はありますか？次はいつ？',
    answer:
      'BOOMでは毎年発表会を開催しているよ！次回の開催も計画が進んでいるところで、正式な日程は決まり次第まず公式LINEでお知らせするね😊 楽しみに待っててね！',
  },
];
const maxRow = await c.execute('SELECT COALESCE(MAX(sort_order),0) AS m FROM faq_entries');
let sort = Number(maxRow.rows[0].m), ins = 0, skip = 0;
for (const x of INSERTS) {
  const ex = await c.execute({ sql: 'SELECT id FROM faq_entries WHERE question=?', args: [x.question] });
  if (ex.rows.length) { skip++; continue; }
  sort++;
  await c.execute({ sql: 'INSERT INTO faq_entries (category,question,answer,is_public,sort_order) VALUES (?,?,?,1,?)', args: [x.category, x.question, x.answer, sort] });
  ins++;
}
console.log(`FAQ: inserted=${ins} skipped=${skip}`);
