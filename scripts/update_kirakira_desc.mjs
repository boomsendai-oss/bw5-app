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

📥 お買い求め方法
物販ブースの貯金箱に 1枚300円 を入れて、お好みのデザインを1枚お持ちください。
クレジットカード・PayPay 等でのお支払いをご希望の場合は、お気軽にスタッフにお声がけください。

🎁 BOOMくん限定シール プレゼント特典
通常販売はしていない BOOMくんシール を、下記のいずれかの条件を満たす方に1枚プレゼントします:
・きらきらシール 全6種 をコンプリートした方 → スタッフに6枚揃ったところを見せてください
・<BM> フェルトロゴキャップ または シグネチャーTシャツ を購入した方

※取り置きはできません。物販ブースで直接お買い求めください。`;

const r = await client.execute({
  sql: 'UPDATE merchandise SET description = ? WHERE id = 8',
  args: [newDesc],
});
console.log('rows updated:', r.rowsAffected);

const check = await client.execute('SELECT description FROM merchandise WHERE id = 8');
console.log('---new description---');
console.log(check.rows[0].description);
