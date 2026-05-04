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

// 現在の状況確認
const before = await c.execute('SELECT id, name, votes, sort_order FROM vote_candidates ORDER BY sort_order ASC, id ASC');
console.log('--- BEFORE ---');
before.rows.forEach(r => console.log(r));

// sort_order 順で並べた状態の id を取得 → No.1〜No.4 へのマッピング
const ids = before.rows.map(r => r.id);
if (ids.length < 4) {
  console.error('候補が4件未満です。中止します。');
  process.exit(1);
}

const newNames = [
  'ブムローくん',   // No.1
  'ブーマーくん',   // No.2
  'ミスター B',    // No.3
  'ブームくん',     // No.4
];

// 名前を上書き + 投票数を0にリセット
for (let i = 0; i < 4; i++) {
  await c.execute({
    sql: 'UPDATE vote_candidates SET name = ?, votes = 0, sort_order = ? WHERE id = ?',
    args: [newNames[i], i + 1, ids[i]],
  });
}

// 投票記録も全削除（再投票可能に）
await c.execute('DELETE FROM vote_records');

// 5件目以降の余分な候補があれば削除
if (ids.length > 4) {
  const extraIds = ids.slice(4);
  for (const id of extraIds) {
    await c.execute({ sql: 'DELETE FROM vote_candidates WHERE id = ?', args: [id] });
    console.log('Deleted extra candidate id:', id);
  }
}

const after = await c.execute('SELECT id, name, votes, sort_order FROM vote_candidates ORDER BY sort_order ASC, id ASC');
console.log('--- AFTER ---');
after.rows.forEach(r => console.log(r));
