// HACOMONO側でプログラム名を変えたあと、取り込み済みデータの program_name を新名に揃える (2026-10-14)
//
// なぜ要るか: 予約取り込み(import-reservations)は ON CONFLICT で program_name を上書きしない。
// HACOMONOで名前を変えると「既存予約=旧名／新規予約=新名」が同じクラス・同じ日に混在し、
//   - リール下書きの受講者候補(reel-drafts: start_time+program_name で絞る)が割れる
//   - クラス別KPI(lesson_utilization を program_name で GROUP BY)が2行に割れる
// プログラムコードは不変なので、コードで引いて名前だけ揃える。
//
// 使い方: node scripts/unify_hacomono_program_names_202610.mjs          (dry-run)
//         node scripts/unify_hacomono_program_names_202610.mjs --apply
import { createClient } from '@libsql/client';
import fs from 'node:fs';

const RENAMES = [
  { code: 'PG0039', name: 'HOUSE 強化クラス' },      // 旧「HOUSE エキスパート」
  { code: 'PG0016', name: 'キッズHIPHOP強化クラス' }, // 旧「キッズ強化クラス」
];
const TABLES = ['hacomono_reservations', 'hacomono_cancellations', 'lesson_utilization'];
const APPLY = process.argv.includes('--apply');

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

for (const { code, name } of RENAMES) {
  for (const t of TABLES) {
    const n = Number((await db.execute({ sql: `SELECT COUNT(*) c FROM ${t} WHERE program_code=? AND program_name<>?`, args: [code, name] })).rows[0].c);
    console.log(`${t} ${code} → 「${name}」: ${n}件`);
    if (APPLY && n) await db.execute({ sql: `UPDATE ${t} SET program_name=? WHERE program_code=? AND program_name<>?`, args: [name, code, name] });
  }
  const m = await db.execute({ sql: `SELECT id, hacomono_name FROM hacomono_schedule_map WHERE entity_type='program' AND hacomono_code=?`, args: [code] });
  for (const r of m.rows) {
    if (r.hacomono_name === name) continue;
    console.log(`hacomono_schedule_map#${r.id}.hacomono_name 「${r.hacomono_name}」→「${name}」`);
    if (APPLY) await db.execute({ sql: `UPDATE hacomono_schedule_map SET hacomono_name=?, updated_at=datetime('now') WHERE id=?`, args: [name, r.id] });
  }
}
console.log(APPLY ? '適用しました' : '(dry-run: --apply で適用)');
