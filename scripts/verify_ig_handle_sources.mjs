#!/usr/bin/env node
// 会員InstagramハンドルのソースをA/B比較して、どの読み方が正しいかを機械的に決着させる。
//
// なぜ要るか: 収集フォームのセッションとリール制作のセッションで「ハンドルがある/ない」が
// 食い違い、原因の特定に往復が発生した(2026-08-18)。以後は双方がこれを実行して
// 同じ数字を見る。意見でなく実データで揃える。
//
//   node scripts/verify_ig_handle_sources.mjs               … 全体の突合
//   node scripts/verify_ig_handle_sources.mjs 2026-03-21    … その日のレッスン受講者で突合
//
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
import { createClient } from '@libsql/client';

const c = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const date = process.argv[2] || null;

// 正: 会員名簿の3枠を 本人 > 母 > 父 で読む
const SQL_CORRECT = `
  COALESCE(NULLIF(trim(m.instagram_handle), ''),
           NULLIF(trim(m.instagram_handle_mother), ''),
           NULLIF(trim(m.instagram_handle_father), '')) `;
// 誤: 本人列だけ / 受信箱で補う（2026-08-18以前の読み方）
const SQL_LEGACY = ` COALESCE(NULLIF(trim(m.instagram_handle), ''), NULLIF(trim(e.handle), '')) `;

const JOIN_ENTRY = `
  LEFT JOIN (SELECT matched_member_id, MIN(id) AS eid FROM instagram_entries
              WHERE match_state='approved' AND matched_member_id IS NOT NULL GROUP BY matched_member_id) pick
         ON pick.matched_member_id = m.id
  LEFT JOIN instagram_entries e ON e.id = pick.eid `;

async function main() {
  const one = async (sql, args = []) => (await c.execute({ sql, args })).rows;

  console.log('=== ① 会員名簿(boom_members)の内訳 — これが正本 ===');
  const [b] = await one(`SELECT
      SUM(CASE WHEN trim(COALESCE(instagram_handle,''))<>'' THEN 1 ELSE 0 END) AS self,
      SUM(CASE WHEN trim(COALESCE(instagram_handle_mother,''))<>'' THEN 1 ELSE 0 END) AS mother,
      SUM(CASE WHEN trim(COALESCE(instagram_handle_father,''))<>'' THEN 1 ELSE 0 END) AS father,
      SUM(CASE WHEN trim(COALESCE(instagram_handle,''))<>'' OR trim(COALESCE(instagram_handle_mother,''))<>''
                 OR trim(COALESCE(instagram_handle_father,''))<>'' THEN 1 ELSE 0 END) AS any_
    FROM boom_members`);
  console.log(`  本人=${b.self} 母=${b.mother} 父=${b.father} → メンションできる会員=${b.any_}人`);
  console.log(`  ⚠️ 本人列だけを数えると ${b.self}人 になる。母・父の ${Number(b.any_) - Number(b.self)}人 が視界から消える`);

  const [e] = await one(`SELECT COUNT(*) AS n FROM instagram_entries`);
  console.log(`\n=== ② 受信箱(instagram_entries) = ${e.n}件 ===`);
  console.log('  これはフォーム回答の生ログ。**参照先ではない**。');
  console.log(`  フォームを通していない会員(発表会名簿からの移行分)はここに行が無い`);

  console.log('\n=== ③ 読み方のA/B比較 ===');
  const where = date
    ? `WHERE r.lesson_date = ? AND r.status LIKE '%チェックイン%'`
    : `WHERE r.status LIKE '%チェックイン%'`;
  const rows = await one(`
    SELECT DISTINCT r.full_name, m.id AS mid,
           ${SQL_CORRECT} AS correct_h, ${SQL_LEGACY} AS legacy_h
    FROM hacomono_reservations r
    JOIN boom_members m ON m.id = r.boom_member_id
    ${JOIN_ENTRY}
    ${where}`, date ? [date] : []);

  const onlyCorrect = rows.filter((x) => x.correct_h && !x.legacy_h);
  const onlyLegacy = rows.filter((x) => !x.correct_h && x.legacy_h);
  console.log(`  対象: ${date ? date + ' の受講者' : 'チェックイン記録のある会員'} ${rows.length}人`);
  console.log(`  正しい読み方で当たる: ${rows.filter((x) => x.correct_h).length}人`);
  console.log(`  旧い読み方で当たる  : ${rows.filter((x) => x.legacy_h).length}人`);
  console.log(`  → 旧い読み方が取りこぼす人: ${onlyCorrect.length}人`);
  for (const x of onlyCorrect) console.log(`      - ${x.full_name} @${x.correct_h}`);
  if (onlyLegacy.length) {
    console.log(`  → ⚠️ 逆に旧い読み方だけが拾う人: ${onlyLegacy.length}人（要調査）`);
    for (const x of onlyLegacy) console.log(`      - ${x.full_name} @${x.legacy_h}`);
  }

  console.log('\n=== 結論 ===');
  if (onlyLegacy.length === 0 && onlyCorrect.length > 0) {
    console.log('  会員名簿の3枠(本人>母>父)を読むのが正しい。受信箱を読む必要は無い。');
  } else if (onlyLegacy.length === 0 && onlyCorrect.length === 0) {
    console.log('  両者一致。どちらでも同じ結果。');
  } else {
    console.log('  ⚠️ 旧い読み方だけが拾う人がいる = 会員名簿に反映漏れがある。要調査。');
  }
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
