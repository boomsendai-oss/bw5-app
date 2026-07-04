// Turso本番DBを丸ごとSQLダンプする（バックアップ用）。
// GitHub Actions (.github/workflows/turso-backup.yml) から日次実行される。
// 出力: backup/turso_dump_YYYY-MM-DD.sql （CREATE + INSERT で復元可能）
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
const { createClient } = require('@libsql/client');
const fs = require('fs');

const c = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function val(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Uint8Array) return "X'" + Buffer.from(v).toString('hex') + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

(async () => {
  const t = await c.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name"
  );
  const out = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
  let total = 0;
  for (const tb of t.rows) {
    out.push('\n-- ===== ' + tb.name + ' =====');
    out.push(tb.sql + ';');
    const r = await c.execute('SELECT * FROM "' + tb.name + '"');
    for (const row of r.rows) {
      const vals = r.columns.map((cn) => val(row[cn]));
      out.push(
        'INSERT INTO "' + tb.name + '" (' +
          r.columns.map((x) => '"' + x + '"').join(',') +
          ') VALUES (' + vals.join(',') + ');'
      );
    }
    total += r.rows.length;
  }
  out.push('COMMIT;');
  fs.mkdirSync('backup', { recursive: true });
  const d = new Date().toISOString().slice(0, 10);
  const file = 'backup/turso_dump_' + d + '.sql';
  fs.writeFileSync(file, out.join('\n'));
  console.log('OK tables=' + t.rows.length + ' rows=' + total + ' -> ' + file +
    ' (' + (fs.statSync(file).size / 1024 / 1024).toFixed(1) + 'MB)');
})().catch((e) => {
  console.error('BACKUP FAILED:', e.message);
  process.exit(1);
});
