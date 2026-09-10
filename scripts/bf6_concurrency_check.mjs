/**
 * 受付iPadの同時操作テスト(本番DBに対して実行する)。
 *
 *   node scripts/bf6_concurrency_check.mjs
 *
 * 本番のくじ引きSQLをそのまま使い、架空の部門 __conc_test に16枠を作って叩く。
 * 本物のエントリー・抽選には一切触らず、最後に自分で消す。
 *
 * 見ているもの:
 *   ① iPad3台が同時に引いて枠が重複しないか
 *   ② 同じ人が連打したときに1枠に収まり、かつエラー画面を出さないか
 *   ③ 枠より人数が多いときに正しく満席になるか
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.production.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const DIV = '__conc_test';

async function reset(slots) {
  await db.execute(`DELETE FROM bf_draw WHERE division = '${DIV}'`);
  for (let n = 1; n <= slots; n++) await db.execute({ sql: 'INSERT INTO bf_draw (division, phase, slot_no) VALUES (?,?,?)', args: [DIV, 'bracket', n] });
}

// アプリと同じSQLを使う(bf6DrawDb.ts の claimBf6Slot 相当)
async function claim(itemId) {
  const t0 = Date.now();
  const pre = await db.execute({ sql: 'SELECT slot_no FROM bf_draw WHERE division=? AND phase=? AND item_id=?', args: [DIV,'bracket',itemId] });
  if (pre.rows.length) return { itemId, slot: Number(pre.rows[0].slot_no), already: true, ms: Date.now()-t0 };
  for (let a = 0; a < 12; a++) {
    try {
      const r = await db.execute({ sql:
        `UPDATE bf_draw SET item_id = ?, drawn_at = ?
          WHERE id = (SELECT id FROM bf_draw WHERE division=? AND phase=? AND item_id IS NULL ORDER BY RANDOM() LIMIT 1)
            AND item_id IS NULL`, args: [itemId, new Date().toISOString(), DIV, 'bracket'] });
      if ((r.rowsAffected ?? 0) > 0) {
        const row = await db.execute({ sql: 'SELECT slot_no FROM bf_draw WHERE division=? AND phase=? AND item_id=?', args: [DIV,'bracket',itemId] });
        if (!row.rows.length) continue;
        return { itemId, slot: Number(row.rows[0].slot_no), already: false, ms: Date.now()-t0 };
      }
      const free = await db.execute({ sql: 'SELECT COUNT(*) n FROM bf_draw WHERE division=? AND phase=? AND item_id IS NULL', args: [DIV,'bracket'] });
      if (Number(free.rows[0].n) === 0) return { itemId, slot: null, full: true, ms: Date.now()-t0 };
    } catch (e) {
      // 修正後の挙動: 自分の枠を読み直して返す
      const mine = await db.execute({ sql: 'SELECT slot_no FROM bf_draw WHERE division=? AND phase=? AND item_id=?', args: [DIV,'bracket',itemId] });
      if (mine.rows.length) return { itemId, slot: Number(mine.rows[0].slot_no), already: true, ms: Date.now()-t0 };
      return { itemId, slot: null, error: String(e.message || e).slice(0, 90), ms: Date.now()-t0 };
    }
  }
  return { itemId, slot: null, exhausted: true, ms: Date.now()-t0 };
}

// ① 3人が完全同時に引く(iPad3台) × 5回
console.log('## ① 別々の3人が同時に引く(iPad3台想定) — 5回繰り返し');
let bad1 = 0;
for (let round = 1; round <= 5; round++) {
  await reset(16);
  const res = await Promise.all([claim(9001), claim(9002), claim(9003)]);
  const slots = res.map(r => r.slot);
  const dup = new Set(slots).size !== slots.length || slots.includes(null);
  if (dup) bad1++;
  console.log(`  ${round}回目: 枠 ${slots.join(' / ')}  ${dup ? '❌ 重複または失敗' : '✅ 全員別の枠'}  (応答 ${res.map(r=>r.ms+'ms').join(' ')})`);
}

// ② 同じ人が3連打(iPadの二度押し・別端末で同一人物)
console.log('\n## ② 同じ人が同時に3連打(二度押し)');
let bad2 = 0;
for (let round = 1; round <= 5; round++) {
  await reset(16);
  const res = await Promise.all([claim(9100), claim(9100), claim(9100)]);
  const got = await db.execute({ sql: 'SELECT slot_no FROM bf_draw WHERE division=? AND item_id=?', args: [DIV, 9100] });
  const rows = got.rows.length;
  const errs = res.filter(r => r.error).length;
  if (rows !== 1) bad2++;
  console.log(`  ${round}回目: DBに残った枠 ${rows}個 ${rows===1?'✅':'❌ 二重取り'} / 画面にエラーが出た回数 ${errs}  返した枠 ${res.map(r=>r.slot ?? 'エラー').join(' / ')}`);
}

// ③ 16枠に17人が殺到(満席の扱い)
console.log('\n## ③ 16枠に17人が同時に殺到');
await reset(16);
const many = await Promise.all(Array.from({length:17}, (_,i) => claim(9200+i)));
const gotSlots = many.map(m=>m.slot).filter(s=>s!==null);
console.log(`  取れた ${gotSlots.length}人 / 重複 ${gotSlots.length - new Set(gotSlots).size}件 / 満席で断られた ${many.filter(m=>m.full).length}人 / エラー ${many.filter(m=>m.error).length}人`);
console.log(`  応答時間: 最速 ${Math.min(...many.map(m=>m.ms))}ms / 最遅 ${Math.max(...many.map(m=>m.ms))}ms`);

await db.execute(`DELETE FROM bf_draw WHERE division = '${DIV}'`);
console.log('\nテスト用データは削除しました');
console.log(`\n判定: ①重複 ${bad1}回 / ②二重取り ${bad2}回`);
