import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';

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

  await c.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS merchandise (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      image_url TEXT DEFAULT '',
      stock INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS merch_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      buyer_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      payment_method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS video_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS vote_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS vote_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      candidate_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS music_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      jacket_url TEXT DEFAULT '',
      apple_music_url TEXT DEFAULT '',
      spotify_url TEXT DEFAULT '',
      amazon_music_url TEXT DEFAULT '',
      youtube_music_url TEXT DEFAULT '',
      release_at TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS sns_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS pamphlet_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
  ], 'write');

  // Seed defaults if tables empty
  const scheduleCount = await c.execute('SELECT COUNT(*) as count FROM schedule');
  if (Number(scheduleCount.rows[0].count) === 0) {
    const items: [string, string, string, number][] = [
      ['', 'GRAFFITI ナンバー / Ryuki & TARO', 'No.1', 1],
      ['', 'フリースタイル / SAYUKI', 'No.2', 2],
      ['', 'HIPHOP / ちゃんなつ', 'No.3', 3],
      ['', 'NJS / おっちゃん', 'No.4', 4],
      ['', 'WAACK入門 / YURI', 'No.5', 5],
      ['', 'キッズ強化 / TARO', 'No.6', 6],
      ['', 'HOUSE エキスパート / K@TTSU', 'No.7', 7],
      ['', 'はじめてのHIPHOP / Ryuki', 'No.8', 8],
      ['', '日曜キッズHIPHOP / Ryuki', 'No.9', 9],
      ['', 'ベーシックダンスクラス / Ryuki & TARO', 'No.10', 10],
      ['', '多賀城 HIPHOP 入門 / AOI', 'No.11', 11],
      ['', '多賀城 HIPHOP 初級 / AOI', 'No.12', 12],
      ['', '多賀城 JAZZ / KEIKO', 'No.13', 13],
      ['', 'HIPHOP 中級 / TARO', 'No.14', 14],
      ['', 'HIPHOP 初級 / TARO', 'No.15', 15],
      ['', '水曜 HOUSE / K@TTSU', 'No.16', 16],
      ['', '七ヶ浜 HH 入門 / AOI', 'No.17', 17],
      ['', '七ヶ浜 HH 初級 / TARO', 'No.18', 18],
      ['', '多賀城 HOUSE / K@TTSU & AOI', 'No.19', 19],
      ['', '長町ガールズ合同 / KEIKO', 'No.20', 20],
      ['', '長町 KONAMI ちびっこ / TARO', 'No.21', 21],
      ['', '長町 KONAMI キッズ / TARO', 'No.22', 22],
      ['', '諏訪キッズ / HARUKA', 'No.23', 23],
    ];
    await c.batch(
      items.map(([time, title, description, sort_order]) => ({
        sql: 'INSERT INTO schedule (time, title, description, sort_order) VALUES (?, ?, ?, ?)',
        args: [time, title, description, sort_order],
      })),
      'write'
    );
  }

  const merchCount = await c.execute('SELECT COUNT(*) as count FROM merchandise');
  if (Number(merchCount.rows[0].count) === 0) {
    await c.batch([
      { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['フェルトロゴキャップ ベージュ×グリーン', 4500, '/images/goods/cap_beige_green.png', 10, 'BOOM Dance School オリジナルフェルトロゴキャップ', 1] },
      { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['フェルトロゴキャップ ベージュ', 4500, '/images/goods/cap_beige.png', 10, 'BOOM Dance School オリジナルフェルトロゴキャップ', 2] },
      { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['コーデュロイキャップ ブラック', 4500, '/images/goods/cap_black.png', 10, 'BOOM Dance School オリジナルコーデュロイキャップ', 3] },
    ], 'write');
  }

  const voteCount = await c.execute('SELECT COUNT(*) as count FROM vote_candidates');
  if (Number(voteCount.rows[0].count) === 0) {
    await c.batch([
      { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ブーミー', 1] },
      { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ボンバー', 2] },
      { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ビーボ', 3] },
      { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ブースケ', 4] },
    ], 'write');
  }

  const snsCount = await c.execute('SELECT COUNT(*) as count FROM sns_links');
  if (Number(snsCount.rows[0].count) === 0) {
    await c.batch([
      { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['youtube', 'https://www.youtube.com/@boom-sendai', 1] },
      { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['instagram', 'https://www.instagram.com/boom_sendai/', 2] },
      { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['line', 'https://lin.ee/example', 3] },
      { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['x', 'https://x.com/boom_sendai', 4] },
    ], 'write');
  }

  const settingsCount = await c.execute('SELECT COUNT(*) as count FROM settings');
  if (Number(settingsCount.rows[0].count) === 0) {
    await c.batch([
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['video_price', '2500'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['admin_password', 'boom2026'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['event_date', '2026-05-05'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['event_name', 'BOOM WOP vol.5'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['venue', '太白区文化センター 楽楽楽ホール'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['venue_address', '仙台市太白区長町5-3-2'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['paypay_link', ''] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['square_app_id', 'sandbox-sq0idb-PLACEHOLDER'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['square_location_id', 'PLACEHOLDER'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['video_sale_active', 'true'] },
    ], 'write');
  }

  const musicCount = await c.execute('SELECT COUNT(*) as count FROM music_releases');
  if (Number(musicCount.rows[0].count) === 0) {
    await c.execute({
      sql: 'INSERT INTO music_releases (artist, title, jacket_url, apple_music_url, spotify_url, amazon_music_url, youtube_music_url, release_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: ['BOOM Dance School', 'Give Me A Reason', '/images/character/boomkun_2d.png', '', '', '', '', '2026-05-05T12:00:00', 1],
    });
  }
}

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

export async function batch(statements: InStatement[], mode: 'write' | 'read' | 'deferred' = 'write'): Promise<ResultSet[]> {
  await initDb();
  return getClient().batch(statements, mode);
}
