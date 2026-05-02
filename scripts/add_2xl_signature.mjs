import { createClient } from '@libsql/client';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.production.local', 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const c = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

// 既存の variants を確認
const cur = await c.execute("SELECT * FROM merch_variants WHERE merch_id = 5 ORDER BY color, sort_order");
console.log('--- Before (id=5 シグネチャーTシャツ) ---');
for (const r of cur.rows) console.log(`  ${r.color} / ${r.size} stock=${r.stock} sort=${r.sort_order}`);

// 各色の最大 sort_order を取得
const maxSort = await c.execute("SELECT color, MAX(sort_order) as m FROM merch_variants WHERE merch_id = 5 GROUP BY color");
const sortMap = new Map();
for (const r of maxSort.rows) sortMap.set(r.color, Number(r.m));

// 2XL を各色に追加 (既に存在していればスキップ)
const colors = ['ホワイト', 'ブラック', 'ブルー'];
for (const color of colors) {
  const existing = await c.execute({
    sql: "SELECT id FROM merch_variants WHERE merch_id = 5 AND color = ? AND size = '2XL'",
    args: [color],
  });
  if (existing.rows.length > 0) {
    console.log(`skip ${color} 2XL (already exists)`);
    continue;
  }
  const newSort = (sortMap.get(color) || 0) + 1;
  await c.execute({
    sql: 'INSERT INTO merch_variants (merch_id, color, size, stock, sort_order) VALUES (?, ?, ?, ?, ?)',
    args: [5, color, '2XL', 0, newSort],
  });
  console.log(`added ${color} / 2XL sort=${newSort}`);
}

const after = await c.execute("SELECT color, size, stock, sort_order FROM merch_variants WHERE merch_id = 5 ORDER BY color, sort_order");
console.log('\n--- After ---');
for (const r of after.rows) console.log(`  ${r.color} / ${r.size} stock=${r.stock} sort=${r.sort_order}`);
