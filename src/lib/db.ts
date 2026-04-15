import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'bw5.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeDb(db);
  }
  return db;
}

function initializeDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS merchandise (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      image_url TEXT DEFAULT '',
      stock INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS merch_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      buyer_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      payment_method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
    );

    CREATE TABLE IF NOT EXISTS video_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS vote_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS vote_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      candidate_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS music_releases (
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
    );

    CREATE TABLE IF NOT EXISTS sns_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pamphlet_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
  `);

  // Seed defaults if tables empty
  const scheduleCount = db.prepare('SELECT COUNT(*) as count FROM schedule').get() as { count: number };
  if (scheduleCount.count === 0) {
    const ins = db.prepare('INSERT INTO schedule (time, title, description, sort_order) VALUES (?, ?, ?, ?)');
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
    for (const item of items) ins.run(...item);
  }

  const merchCount = db.prepare('SELECT COUNT(*) as count FROM merchandise').get() as { count: number };
  if (merchCount.count === 0) {
    const ins = db.prepare('INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('フェルトロゴキャップ ベージュ×グリーン', 4500, '/images/goods/cap_beige_green.png', 10, 'BOOM Dance School オリジナルフェルトロゴキャップ', 1);
    ins.run('フェルトロゴキャップ ベージュ', 4500, '/images/goods/cap_beige.png', 10, 'BOOM Dance School オリジナルフェルトロゴキャップ', 2);
    ins.run('コーデュロイキャップ ブラック', 4500, '/images/goods/cap_black.png', 10, 'BOOM Dance School オリジナルコーデュロイキャップ', 3);
  }

  const voteCount = db.prepare('SELECT COUNT(*) as count FROM vote_candidates').get() as { count: number };
  if (voteCount.count === 0) {
    const ins = db.prepare('INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)');
    ins.run('ブーミー', 1);
    ins.run('ボンバー', 2);
    ins.run('ビーボ', 3);
    ins.run('ブースケ', 4);
  }

  const snsCount = db.prepare('SELECT COUNT(*) as count FROM sns_links').get() as { count: number };
  if (snsCount.count === 0) {
    const ins = db.prepare('INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)');
    ins.run('youtube', 'https://www.youtube.com/@boom-sendai', 1);
    ins.run('instagram', 'https://www.instagram.com/boom_sendai/', 2);
    ins.run('line', 'https://lin.ee/example', 3);
    ins.run('x', 'https://x.com/boom_sendai', 4);
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
  if (settingsCount.count === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    ins.run('video_price', '2500');
    ins.run('admin_password', 'boom2026');
    ins.run('event_date', '2026-05-05');
    ins.run('event_name', 'BOOM WOP vol.5');
    ins.run('venue', '太白区文化センター 楽楽楽ホール');
    ins.run('venue_address', '仙台市太白区長町5-3-2');
    ins.run('paypay_link', '');
    ins.run('square_app_id', 'sandbox-sq0idb-PLACEHOLDER');
    ins.run('square_location_id', 'PLACEHOLDER');
    ins.run('video_sale_active', 'true');
  }

  const musicCount = db.prepare('SELECT COUNT(*) as count FROM music_releases').get() as { count: number };
  if (musicCount.count === 0) {
    db.prepare(
      'INSERT INTO music_releases (artist, title, jacket_url, apple_music_url, spotify_url, amazon_music_url, youtube_music_url, release_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('BOOM Dance School', 'Give Me A Reason', '/images/character/boomkun_2d.png', '', '', '', '', '2026-05-05T12:00:00', 1);
  }
}

export default getDb;
