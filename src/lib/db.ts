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
      variant_id INTEGER,
      color TEXT DEFAULT '',
      size TEXT DEFAULT '',
      buyer_name TEXT NOT NULL,
      email TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      payment_method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      square_payment_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS merch_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      color TEXT DEFAULT '',
      size TEXT DEFAULT '',
      stock INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
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
    {
      sql: `CREATE TABLE IF NOT EXISTS performances (
      m_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      title_reading TEXT DEFAULT '',
      instructor TEXT DEFAULT '',
      instructor_photo_url TEXT DEFAULT '',
      performer_count INTEGER DEFAULT 0,
      genre TEXT DEFAULT '',
      song_name TEXT DEFAULT '',
      part INTEGER DEFAULT 1
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS performers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      m_id TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (m_id) REFERENCES performances(m_id)
    )`,
      args: [],
    },
    {
      // 抽選エントリー (1人1回, fingerprint で重複防止)
      sql: `CREATE TABLE IF NOT EXISTS lottery_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      ip TEXT DEFAULT '',
      won INTEGER DEFAULT 0,
      prize_name TEXT DEFAULT '',
      prize_tier TEXT DEFAULT 'normal',
      winner_name TEXT DEFAULT '',
      keyword_used TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      // 舞台裏ライブフォト
      sql: `CREATE TABLE IF NOT EXISTS backstage_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT NOT NULL,
      caption TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      uploaded_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      // 映像データ販売の事前予約（後日メールで案内）
      sql: `CREATE TABLE IF NOT EXISTS video_preorders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      buyer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'waiting',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
    )`,
      args: [],
    },
    {
      // 売り切れ商品の追加注文（後日発送）
      sql: `CREATE TABLE IF NOT EXISTS restock_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      variant_id INTEGER,
      color TEXT DEFAULT '',
      size TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      buyer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      address TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      shipping_fee INTEGER NOT NULL DEFAULT 800,
      total_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending_payment',
      payment_deadline TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
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
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['open_time', '13:45'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['start_time', '14:30'] },
      // Section visibility defaults (1=visible, 0=Coming Soon)
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_schedule_visible', '1'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_merch_visible', '1'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_video_visible', '0'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_music_visible', '0'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_vote_visible', '0'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_sns_visible', '1'] },
    ], 'write');
  }

  const perfCount = await c.execute('SELECT COUNT(*) as count FROM performances');
  if (Number(perfCount.rows[0].count) === 0) {
    // m_id, title, title_reading, instructor, instructor_photo_url, performer_count, genre, song_name, part
    const perfSql = 'INSERT INTO performances (m_id, title, title_reading, instructor, instructor_photo_url, performer_count, genre, song_name, part) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    await c.batch([
      // --- Part 1 ---
      { sql: perfSql, args: ['M1',  'BOOMインストラクターナンバー', 'ブームインストラクターナンバー', 'ALL INSTRUCTORS', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M2',  'TARO HH 初級', 'タロー ヒップホップ しょきゅう', 'TARO', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M3',  'はじめてHH', 'はじめてヒップホップ', 'Ryuki', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M4',  'YURI WAACK', 'ユリ ワック', 'YURI', '', 0, 'WAACK', '', 1] },
      { sql: perfSql, args: ['M5',  '諏訪キッズ', 'すわキッズ', 'HARUKA', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M6',  '多賀城HOUSE', 'たがじょうハウス', 'K@TTSU & AOI', '', 0, 'HOUSE', '', 1] },
      { sql: perfSql, args: ['M7',  '長町キッズ', 'ながまちキッズ', 'TARO', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M8',  'ダンス部', 'ダンスぶ', '', '', 0, '', '', 1] },
      { sql: perfSql, args: ['M9',  'ZIEL ゲスト', 'ジール ゲスト', 'ZIEL', '', 0, '', '', 1] },
      { sql: perfSql, args: ['M10', 'おっちゃんNJS', 'おっちゃんエヌジェイエス', 'おっちゃん', '', 0, 'NJS', '', 1] },
      // --- Part 2 ---
      { sql: perfSql, args: ['M11', '多賀城HH入門', 'たがじょうヒップホップにゅうもん', 'AOI', '', 0, 'HIPHOP', '', 2] },
      { sql: perfSql, args: ['M12', 'ベーシックダンスクラス', 'ベーシックダンスクラス', 'Ryuki & TARO', '', 0, 'HIPHOP', '', 2] },
      { sql: perfSql, args: ['M13', '多賀城JAZZ', 'たがじょうジャズ', 'KEIKO', '', 0, 'JAZZ', '', 2] },
      { sql: perfSql, args: ['M14', '長町ちびっこ', 'ながまちちびっこ', 'TARO', '', 0, 'HIPHOP', '', 2] },
      { sql: perfSql, args: ['M15', '多賀城HH初級', 'たがじょうヒップホップしょきゅう', 'AOI', '', 0, 'HIPHOP', '', 2] },
      { sql: perfSql, args: ['M16', 'SAYUKIフリースタイル', 'サユキフリースタイル', 'SAYUKI', '', 0, 'FREESTYLE', '', 2] },
      { sql: perfSql, args: ['M17', 'TARO&TAKE', 'タローアンドタケ', 'TARO & TAKE', '', 0, '', '', 2] },
      { sql: perfSql, args: ['M18', 'K@TTSU HOUSE', 'カッツハウス', 'K@TTSU', '', 0, 'HOUSE', '', 2] },
      { sql: perfSql, args: ['M19', 'FOODIES', 'フーディーズ', '', '', 0, '', '', 2] },
      { sql: perfSql, args: ['M20', 'GRAFFITIナンバー', 'グラフィティナンバー', 'Ryuki & TARO', '', 0, 'HIPHOP', '', 2] },
      // --- Part 3 ---
      { sql: perfSql, args: ['M21', '七ヶ浜HH初級', 'しちがはまヒップホップしょきゅう', 'TARO', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M22', '長町ガールズ合同', 'ながまちガールズごうどう', 'KEIKO', '', 0, 'GIRLS', '', 3] },
      { sql: perfSql, args: ['M23', '日曜キッズHH', 'にちようキッズヒップホップ', 'Ryuki', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M24', 'ちゃんなつHH', 'ちゃんなつヒップホップ', 'ちゃんなつ', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M25', '七ヶ浜HH入門', 'しちがはまヒップホップにゅうもん', 'AOI', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M26', 'キッズ強化', 'キッズきょうか', 'TARO', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M27', 'クレアラシル', 'クレアラシル', '', '', 0, '', '', 3] },
      { sql: perfSql, args: ['M28', 'HOUSEエキスパート', 'ハウスエキスパート', 'K@TTSU', '', 0, 'HOUSE', '', 3] },
      { sql: perfSql, args: ['M29', 'NEW STYLERS', 'ニュースタイラーズ', '', '', 0, '', '', 3] },
      { sql: perfSql, args: ['M30', 'TARO HH中級', 'タローヒップホップちゅうきゅう', 'TARO', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M31', 'エンディングナンバー', 'エンディングナンバー', 'ALL', '', 0, '', '', 3] },
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
