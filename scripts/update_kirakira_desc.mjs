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

const newDesc = `BOOM 5周年を記念して、立ち上げ初期メンバーのインストラクター 6名 のきらきらシールを制作しました(全6種)。

🎁 BOOMくんシール プレゼント特典
・6種コンプリートした方
・他の物販アイテムを購入した方
どちらの場合も1枚無料でプレゼント！

※取り置きはできません。物販ブースで直接お買い求めください。`;

const r = await client.execute({
  sql: 'UPDATE merchandise SET description = ? WHERE id = 8',
  args: [newDesc],
});
console.log('rows updated:', r.rowsAffected);

const check = await client.execute('SELECT description FROM merchandise WHERE id = 8');
console.log('---new description---');
console.log(check.rows[0].description);
