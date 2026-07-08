#!/usr/bin/env node
// マイグレーション台帳ツール（PR-4b / 技術的負債改修設計 2026-07-06）。
// scripts/migrations/*.sql を schema_migrations 台帳で管理し、再実行事故(D-2)を防ぐ。
//
// 使い方:
//   node scripts/migrate.mjs --baseline  … 既存の全migrationファイルを「適用済み」として記録
//                                          (SQLは実行しない)。本番の初回セットアップ用・冪等。
//   node scripts/migrate.mjs --dry-run   … 適用済み/未適用の一覧を表示(書き込みなし)
//   node scripts/migrate.mjs             … 未適用の .sql を昇順に適用し記録(1ファイル=1トランザクション)
//
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (未設定ならローカル file:./data/bw5.db)
// 注: .js マイグレーション(例: 20260607_bcrypt_sessions.js)は自動実行対象外。
//     baselineでは記録し、以後の apply では skip する(手動適用が前提)。
import { createClient } from '@libsql/client';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const url = process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db';
const c = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const mode = process.argv.includes('--baseline') ? 'baseline'
  : process.argv.includes('--dry-run') ? 'dry-run'
  : 'apply';

/** ';' 区切りでSQL文へ分割(行末の ; のみ・素朴版)。トリガー等 ; を含む複雑DDLは今のところ無い。 */
function splitSql(sql) {
  return sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
}

async function main() {
  await c.execute('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT)');
  const appliedRows = await c.execute('SELECT name FROM schema_migrations');
  const applied = new Set(appliedRows.rows.map((r) => r.name));
  const files = readdirSync(MIG_DIR).filter((f) => /\.(sql|js)$/.test(f)).sort();
  const pending = files.filter((f) => !applied.has(f));

  if (mode === 'dry-run') {
    console.log(`台帳: 既適用 ${applied.size} / ディレクトリ ${files.length} / 未適用 ${pending.length}`);
    for (const f of pending) console.log('  未適用:', f);
    return;
  }

  if (mode === 'baseline') {
    // 既存ファイルを「適用済み」として記録するのみ(SQL不実行)。本番は既に適用済みのため。
    let n = 0;
    const at = new Date().toISOString();
    for (const f of files) {
      const r = await c.execute({ sql: 'INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)', args: [f, at] });
      if (Number(r.rowsAffected) > 0) n++;
    }
    console.log(`baseline: ${n} 件を新規に記録 (ディレクトリ計 ${files.length} 件)`);
    return;
  }

  // apply: 未適用の .sql のみ実行。
  if (pending.length === 0) { console.log('apply: 未適用なし'); return; }
  for (const f of pending) {
    if (!f.endsWith('.sql')) { console.log('  skip(非SQL・手動適用):', f); continue; }
    const stmts = splitSql(readFileSync(join(MIG_DIR, f), 'utf8'));
    console.log(`  適用: ${f} (${stmts.length} statements)`);
    await c.batch(stmts, 'write');
    await c.execute({ sql: 'INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)', args: [f, new Date().toISOString()] });
  }
  console.log('apply 完了');
}

main().catch((e) => { console.error('MIGRATE FAILED:', e.message); process.exit(1); });
