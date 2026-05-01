import { createClient } from '@libsql/client';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.production.local', 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

const updates = [
  {
    id: 5,
    desc: `BOOMロゴをワンポイントに刺繍した 5周年記念 シグネチャーTシャツ。サイズ：S / M / L / XL\n\n🎁 ご購入の方には限定 BOOMくんシール を1枚プレゼントします`,
  },
  {
    id: 6,
    desc: `BOOM の「BM」ロゴをフェルトで立体的にあしらったオリジナルキャップ。フリーサイズ。\n\n🎁 ご購入の方には限定 BOOMくんシール を1枚プレゼントします`,
  },
];

for (const u of updates) {
  const r = await client.execute({
    sql: 'UPDATE merchandise SET description = ? WHERE id = ?',
    args: [u.desc, u.id],
  });
  console.log(`id=${u.id}: rows updated = ${r.rowsAffected}`);
}
