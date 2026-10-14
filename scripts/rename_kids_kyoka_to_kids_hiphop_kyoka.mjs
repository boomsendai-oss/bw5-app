// キッズ 強化 → キッズHIPHOP 強化 へのクラス名変更 (2026-10-14 TARO)
//
// HACOMONO側(PG0016)は「キッズHIPHOP強化クラス」に変更済み。アプリ・HP・カレンダー表示を揃える。
// hacomono_schedule_map.bw5_key はクラス名の文字列で引くので、マスターと必ず同時に変える。
// slug(kids-special)は変えない(旧URLを404にしないため)。過去の記録(予約・給与・演目表など)は触らない。
//
// 使い方: node scripts/rename_kids_kyoka_to_kids_hiphop_kyoka.mjs [--apply]
// 冪等: 2回実行しても同じ結果になる。
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.env.local' });
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const MASTER_ID = 21;
const OLD_NAME = 'キッズ 強化';
const NEW_NAME = 'キッズHIPHOP 強化';
const plan = [];
const add = (label, sql, args) => plan.push({ label, sql, args });

const m = (await db.execute({ sql: 'SELECT id,class_name FROM lesson_master WHERE id=?', args: [MASTER_ID] })).rows[0];
if (![OLD_NAME, NEW_NAME].includes(m?.class_name)) throw new Error(`想定外のクラス名です: ${m?.class_name}`);
if (m.class_name !== NEW_NAME)
  add(`lesson_master#${MASTER_ID} 「${m.class_name}」→「${NEW_NAME}」`,
    "UPDATE lesson_master SET class_name=?, updated_at=datetime('now') WHERE id=? AND class_name=?", [NEW_NAME, MASTER_ID, OLD_NAME]);

for (const r of (await db.execute({ sql: "SELECT id,bw5_key FROM hacomono_schedule_map WHERE entity_type='program' AND bw5_key=?", args: [OLD_NAME] })).rows)
  add(`hacomono_schedule_map#${r.id} bw5_key 「${OLD_NAME}」→「${NEW_NAME}」`,
    'UPDATE hacomono_schedule_map SET bw5_key=?, lesson_master_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [NEW_NAME, MASTER_ID, r.id]);

for (const r of (await db.execute("SELECT id,class_name FROM lesson_schedule WHERE class_name LIKE '%キッズ 強化%' OR class_name LIKE '%キッズ強化%'")).rows) {
  const next = String(r.class_name).replace('キッズ 強化', NEW_NAME).replace('キッズ強化', 'キッズHIPHOP強化');
  add(`lesson_schedule#${r.id} 「${r.class_name}」→「${next}」`, "UPDATE lesson_schedule SET class_name=?, updated_at=datetime('now') WHERE id=?", [next, r.id]);
}

// 公開文章(FAQ)の中の旧名。表記の揺れが多いので一覧だけ出して人が判断する
for (const r of (await db.execute("SELECT id, question, answer FROM faq_entries WHERE question LIKE '%キッズ強化%' OR answer LIKE '%キッズ強化%' OR question LIKE '%キッズ 強化%' OR answer LIKE '%キッズ 強化%'")).rows)
  console.log(`  (確認) faq_entries#${r.id}: ${String(r.question).slice(0, 60)}`);

console.log(APPLY ? '【本番反映】' : '【確認のみ】 --apply で反映');
plan.forEach((p, i) => console.log(`${i + 1}. ${p.label}`));
if (APPLY && plan.length) {
  const res = await db.batch(plan.map((p) => ({ sql: p.sql, args: p.args })), 'write');
  res.forEach((r, i) => console.log(`   ${i + 1}: rowsAffected=${r.rowsAffected}`));
}
