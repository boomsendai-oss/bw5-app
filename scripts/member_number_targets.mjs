// 会員番号の自動付与（2026-11-17 TARO決定・業務ルール「会員番号は在籍者全員に自動で付ける」）の対象を出す。読むだけ。
// 出力(JSON)：{ max, targets:[{id, enrolled_at, no}], fix:[{id, from, no}] }
//   targets = 在籍・会員番号が空欄・スタッフと訪問者（入会日なし）以外。入会の古い順に max+1 から4桁で振る。
//   fix     = 3桁など4桁でない番号を4桁にそろえる（番号そのものは変えない）。
//   max     = 在籍・退会・全メンバー表を通した最大（退会者の番号も使い回さない）。
import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const nums = (await c.execute(
  "SELECT hacomono_kaiin_no k FROM boom_members WHERE coalesce(hacomono_kaiin_no,'')<>'' " +
  "UNION ALL SELECT kaiin_no FROM hacomono_all_members WHERE coalesce(kaiin_no,'')<>''")).rows.map(r => String(r.k).trim());
const bad = nums.filter(k => !/^\d+$/.test(k));
if (bad.length) { console.error('数字でない会員番号があるので止めます'); process.exit(2); }
const max = Math.max(0, ...nums.map(Number));
const seen = new Map();
for (const k of nums) seen.set(Number(k), (seen.get(Number(k)) || new Set()).add(k));
const rows = (await c.execute(
  "SELECT hacomono_member_id id, enrolled_at, hacomono_kaiin_no k, member_type FROM boom_members " +
  "WHERE status='active' AND coalesce(member_type,'') NOT IN ('staff','visitor') AND enrolled_at IS NOT NULL " +
  "ORDER BY enrolled_at, CAST(hacomono_member_id AS INTEGER)")).rows;
let next = max;
const targets = [], fix = [];
for (const r of rows) {
  const k = String(r.k ?? '').trim();
  if (!k) targets.push({ id: String(r.id), enrolled_at: r.enrolled_at, no: String(++next).padStart(4, '0') });
  else if (k.length < 4) fix.push({ id: String(r.id), from: k, no: k.padStart(4, '0') });
}
console.log(JSON.stringify({ max, targets, fix }));
