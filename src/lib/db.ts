import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';
import { getSchemaStatements } from './db/schema';
import { runMigrations } from './db/migrations';
import { runSeeds } from './db/seed';

let client: Client | null = null;
let initialized = false;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (url) {
      client = createClient({
        url,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
    } else {
      client = createClient({ url: 'file:./data/bw5.db' });
    }
  }
  return client;
}

export async function initDb(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const c = getClient();

  // 1. Create all tables and indexes
  await c.batch(getSchemaStatements(), 'write');

  // 2. Run column migrations (idempotent ALTER TABLE)
  await runMigrations(c);

  // 3. Seed default data into empty tables
  await runSeeds(c);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DBの結果は動的キーアクセス多用のため any を維持 */
export async function query(sql: string, args: any[] = []): Promise<ResultSet> {
  await initDb();
  return getClient().execute({ sql, args });
}

export async function execute(sql: string, args: any[] = []): Promise<ResultSet> {
  await initDb();
  return getClient().execute({ sql, args });
}

export async function getAll(sql: string, args: any[] = []): Promise<any[]> {
  await initDb();
  const result = await getClient().execute({ sql, args });
  return result.rows as any[];
}

export async function getOne(sql: string, args: any[] = []): Promise<any | null> {
  await initDb();
  const result = await getClient().execute({ sql, args });
  return (result.rows[0] as any) || null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function batch(statements: InStatement[], mode: 'write' | 'read' | 'deferred' = 'write'): Promise<ResultSet[]> {
  await initDb();
  return getClient().batch(statements, mode);
}
