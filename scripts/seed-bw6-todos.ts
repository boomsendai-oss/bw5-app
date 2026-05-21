/**
 * seed-bw6-todos.ts
 *
 * 反省ToDo (Markdown) を読み込んで event_todos に投入する雛形スクリプト。
 * 実行は TARO が手動で行う。Claudeは自動実行しない。
 *
 * 使い方:
 *   npx tsx scripts/seed-bw6-todos.ts \
 *     --md "/path/to/反省ToDo_BW6改善.md" \
 *     --event-code BW6
 *
 * 動作:
 *   1. --event-code で指定したイベントが events テーブルになければ作成
 *   2. Markdown を見出し (## カテゴリ) + 箇条書き (- アクション) でパース
 *   3. event_todos に INSERT (status='open')
 *
 * 注意:
 *   - ローカル DB (file:./data/bw5.db) と本番 Turso で別々に実行する必要あり
 *   - 既に同じ action が登録されているかは確認しない (重複防止は手動 or 別途実装)
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';

type Parsed = { category: string; action: string };

function parseMarkdown(md: string): Parsed[] {
  const lines = md.split(/\r?\n/);
  const out: Parsed[] = [];
  let currentCategory = '';
  for (const raw of lines) {
    const line = raw.trim();
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      currentCategory = h[1].trim();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      out.push({ category: currentCategory, action: bullet[1].trim() });
    }
  }
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const mdPath = arg('md');
  const eventCode = arg('event-code') ?? 'BW6';
  if (!mdPath) {
    console.error('Usage: tsx scripts/seed-bw6-todos.ts --md <path> [--event-code BW6]');
    process.exit(1);
  }

  const url = process.env.TURSO_DATABASE_URL ?? 'file:./data/bw5.db';
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const c = createClient({ url, authToken });

  // 1) ensure event row
  let eventRow = await c.execute({
    sql: 'SELECT id FROM events WHERE code = ?',
    args: [eventCode],
  });
  let eventId: number;
  if (eventRow.rows.length === 0) {
    const ins = await c.execute({
      sql: 'INSERT INTO events (code, name, status) VALUES (?, ?, ?)',
      args: [eventCode, eventCode, 'planning'],
    });
    eventId = Number(ins.lastInsertRowid);
    console.log(`Created event ${eventCode} (id=${eventId})`);
  } else {
    eventId = Number(eventRow.rows[0].id);
    console.log(`Using existing event ${eventCode} (id=${eventId})`);
  }

  // 2) parse & insert
  const md = readFileSync(mdPath, 'utf8');
  const items = parseMarkdown(md);
  console.log(`Parsed ${items.length} todos`);

  for (const it of items) {
    await c.execute({
      sql: `INSERT INTO event_todos (event_id, category, action, status) VALUES (?, ?, ?, 'open')`,
      args: [eventId, it.category || null, it.action],
    });
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
