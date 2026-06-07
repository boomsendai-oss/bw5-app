import type { Client } from '@libsql/client';

/**
 * Seed default data into empty tables.
 * Called once from initDb() in db.ts after schema + migrations.
 * Each section checks COUNT(*) and only inserts when the table is empty.
 */
export async function runSeeds(c: Client): Promise<void> {
  await seedSchedule(c);
  await seedMerchandise(c);
  await seedVoteCandidates(c);
  await seedSnsLinks(c);
  await seedSettings(c);
  await seedPerformances(c);
  await seedMusicReleases(c);
  await seedHacomonoScheduleMap(c);
}

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------
async function seedSchedule(c: Client): Promise<void> {
  const scheduleCount = await c.execute('SELECT COUNT(*) as count FROM schedule');
  if (Number(scheduleCount.rows[0].count) !== 0) return;

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

// ---------------------------------------------------------------------------
// merchandise
// ---------------------------------------------------------------------------
async function seedMerchandise(c: Client): Promise<void> {
  const merchCount = await c.execute('SELECT COUNT(*) as count FROM merchandise');
  if (Number(merchCount.rows[0].count) !== 0) return;

  await c.batch([
    { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['フェルトロゴキャップ ベージュ×グリーン', 4500, '/images/goods/cap_beige_green.png', 10, 'BOOM Dance School オリジナルフェルトロゴキャップ', 1] },
    { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['フェルトロゴキャップ ベージュ', 4500, '/images/goods/cap_beige.png', 10, 'BOOM Dance School オリジナルフェルトロゴキャップ', 2] },
    { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['コーデュロイキャップ ブラック', 4500, '/images/goods/cap_black.png', 10, 'BOOM Dance School オリジナルコーデュロイキャップ', 3] },
  ], 'write');
}

// ---------------------------------------------------------------------------
// vote_candidates
// ---------------------------------------------------------------------------
async function seedVoteCandidates(c: Client): Promise<void> {
  const voteCount = await c.execute('SELECT COUNT(*) as count FROM vote_candidates');
  if (Number(voteCount.rows[0].count) !== 0) return;

  await c.batch([
    { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ブーミー', 1] },
    { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ボンバー', 2] },
    { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ビーボ', 3] },
    { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ブースケ', 4] },
  ], 'write');
}

// ---------------------------------------------------------------------------
// sns_links
// ---------------------------------------------------------------------------
async function seedSnsLinks(c: Client): Promise<void> {
  const snsCount = await c.execute('SELECT COUNT(*) as count FROM sns_links');
  if (Number(snsCount.rows[0].count) !== 0) return;

  await c.batch([
    { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['youtube', 'https://www.youtube.com/@boom-sendai', 1] },
    { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['instagram', 'https://www.instagram.com/boom_sendai/', 2] },
    { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['line', 'https://lin.ee/example', 3] },
    { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['x', 'https://x.com/boom_sendai', 4] },
  ], 'write');
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
async function seedSettings(c: Client): Promise<void> {
  const settingsCount = await c.execute('SELECT COUNT(*) as count FROM settings');
  if (Number(settingsCount.rows[0].count) !== 0) return;

  await c.batch([
    { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['video_price', '2500'] },
    { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['admin_password', '$2b$10$zcwCpFeEfSBxTb9.DlMYJORgxBccPe6CEu0gUAUyPj9oE0WqN0AUe'] },
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

// ---------------------------------------------------------------------------
// performances
// ---------------------------------------------------------------------------
async function seedPerformances(c: Client): Promise<void> {
  const perfCount = await c.execute('SELECT COUNT(*) as count FROM performances');
  if (Number(perfCount.rows[0].count) !== 0) return;

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

// ---------------------------------------------------------------------------
// music_releases
// ---------------------------------------------------------------------------
async function seedMusicReleases(c: Client): Promise<void> {
  const musicCount = await c.execute('SELECT COUNT(*) as count FROM music_releases');
  if (Number(musicCount.rows[0].count) !== 0) return;

  await c.execute({
    sql: 'INSERT INTO music_releases (artist, title, jacket_url, apple_music_url, spotify_url, amazon_music_url, youtube_music_url, release_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: ['BOOM Dance School', 'Give Me A Reason', '/images/character/boomkun_2d.png', '', '', '', '', '2026-05-05T12:00:00', 1],
  });
}

// ---------------------------------------------------------------------------
// hacomono_schedule_map
// ---------------------------------------------------------------------------
async function seedHacomonoScheduleMap(c: Client): Promise<void> {
  // === HACOMONO スケジュールマッピング 初期seed (空の時のみ) ===
  // 実物HACOMONOエクスポートCSV (boom_studio_lesson_*.csv) を正として抽出した対応表。
  // program: [bw5_key, code, name, staffCode, spaceCode, trial, selectable, movable, publishFixed]
  type HacoProg = [string, string, string, string, string, number, number, number, number];
  const hacoPrograms: HacoProg[] = [
    ['HIPHOP 中級', 'PG0001', 'TARO / HIPHOP 中級', 'IN0001', 'S0001_SP0001', 0, 0, 0, 1],
    ['HIPHOP 初級', 'PG0002', 'TARO / HIPHOP初級', 'IN0001', 'S0001_SP0001', 0, 0, 0, 1],
    ['K@TTSU HOUSE', 'PG0003', 'K@TTSU / HOUSE', 'IN0007', 'S0001_SP0001', 0, 0, 0, 1],
    ['七ヶ浜 HH 入門', 'PG0005', '七ヶ浜 HIPHOP 入門', 'IN0017', 'S0001_SP0008', 5, 0, 0, 1],
    ['七ヶ浜 HH 初級', 'PG0006', '七ヶ浜 HIPHOP 初級', 'IN0001', 'S0001_SP0008', 5, 0, 0, 1],
    ['長町 ガールズ 入門', 'PG0007', '長町 キッズガールズ 入門', 'IN0005', 'S0001_SP0007', 0, 0, 0, 1],
    ['はじめてのHH', 'PG0008', '初めてのヒップホップ', 'IN0018', 'S0001_SP0002', 0, 0, 0, 1],
    ['キッズHH', 'PG0009', 'KIDS HIPHOP', 'IN0018', 'S0001_SP0001', 0, 0, 0, 1],
    ['ベーシックダンスクラス', 'PG0010', 'ベーシックダンスクラス', 'IN0018', 'S0001_SP0001', 0, 0, 0, 1],
    ['多賀城 HH 入門', 'PG0011', '多賀城 HIPHOP基礎', 'IN0011', 'S0001_SP0001', 5, 0, 0, 1],
    ['多賀城 HH 初級', 'PG0012', '多賀城 HIPHOP初級', 'IN0011', 'S0001_SP0001', 5, 0, 0, 1],
    ['ちゃんなつ HH', 'PG0013', 'ちゃんなつ / HIPHOP', 'IN0002', 'S0001_SP0001', 0, 1, 1, 0],
    ['SAYUKI FS', 'PG0014', 'SAYUKI / FREE STYLE', 'IN0003', 'S0001_SP0001', 0, 1, 1, 0],
    ['おっちゃん NJS', 'PG0015', 'おっちゃん / NEW JACK SWING', 'IN0004', 'S0001_SP0001', 0, 1, 1, 0],
    ['キッズ 強化', 'PG0016', 'キッズ強化クラス', 'IN0001', 'S0001_SP0001', 0, 1, 1, 0],
    ['多賀城 HOUSE', 'PG0017', '多賀城 HOUSE', 'IN0007', 'S0001_SP0001', 0, 1, 1, 0],
    ['ダンス部', 'PG0018', 'ダンス部', 'IN0015', 'S0001_SP0001', 0, 0, 0, 1],
    ['多賀城 JAZZ', 'PG0019', '多賀城 STREET JAZZ', 'IN0005', 'S0001_SP0001', 5, 0, 0, 0],
    ['長町 WAACK 入門', 'PG0024', 'YURI / 長町 WAACK 入門', 'IN0010', 'S0001_SP0001', 0, 0, 0, 0],
    ['長町 ガールズ 初級', 'PG0027', '長町 キッズガールズ 初級', 'IN0005', 'S0001_SP0001', 0, 0, 0, 0],
    ['向山 ちびっこ HH', 'PG0028', '向山 キッズヒップホップ 基礎', 'IN0001', 'S0001_SP0001', 0, 0, 0, 0],
    ['HOUSE エキスパート', 'PG0040', 'HOUSE エキスパート (選抜のみ)', 'IN0007', 'S0001_SP0001', 0, 1, 1, 0],
  ];
  // staff: [bw5_key (BW5 instructor名), INコード, HACOMONO名]
  const hacoStaff: [string, string, string][] = [
    ['TARO', 'IN0001', 'TARO'],
    ['ちゃんなつ', 'IN0002', 'ちゃんなつ'],
    ['SAYUKI', 'IN0003', 'SAYUKI'],
    ['おっちゃん', 'IN0004', 'おっちゃん'],
    ['KEIKO', 'IN0005', 'KEIKO'],
    ['Ryuki', 'IN0006', 'Ryuki'],
    ['K@TTSU', 'IN0007', 'K@TTSU'],
    ['YURI', 'IN0010', 'YURI'],
    ['AOI', 'IN0011', 'AOI'],
    ['ダンス部', 'IN0015', 'ダンス部'],
  ];
  // space: 参照用 (出力は program 既定スペースを優先)。HACOMONO側は収容人数別。
  const hacoSpaces: [string, string, string][] = [
    ['S0001_SP0001', 'S0001_SP0001', '20名'],
    ['S0001_SP0002', 'S0001_SP0002', '15名'],
    ['S0001_SP0007', 'S0001_SP0007', '30名'],
    ['S0001_SP0008', 'S0001_SP0008', '40名'],
  ];

  // 新規行は INSERT OR IGNORE で投入し、program行の実物準拠属性は常に UPDATE で
  // 上書きする (旧seed済みの本番DBに新カラム値をバックフィルするため・冪等)。
  await c.batch(
    [
      ...hacoPrograms.map(([key, code, name, staffCode, spaceCode, trial, sel, mov, pub]) => ({
        sql: 'INSERT OR IGNORE INTO hacomono_schedule_map (entity_type, bw5_key, hacomono_code, hacomono_name, default_staff_code, default_space_code, trial_capacity, space_selectable, space_movable, publish_fixed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: ['program', key, code, name, staffCode, spaceCode, trial, sel, mov, pub] as (string | number)[],
      })),
      ...hacoStaff.map(([key, code, name]) => ({
        sql: 'INSERT OR IGNORE INTO hacomono_schedule_map (entity_type, bw5_key, hacomono_code, hacomono_name) VALUES (?, ?, ?, ?)',
        args: ['staff', key, code, name],
      })),
      ...hacoSpaces.map(([key, code, name]) => ({
        sql: 'INSERT OR IGNORE INTO hacomono_schedule_map (entity_type, bw5_key, hacomono_code, hacomono_name) VALUES (?, ?, ?, ?)',
        args: ['space', key, code, name],
      })),
      ...hacoPrograms.map(([key, code, name, staffCode, spaceCode, trial, sel, mov, pub]) => ({
        sql: `UPDATE hacomono_schedule_map
              SET hacomono_code = ?, hacomono_name = ?, default_staff_code = ?, default_space_code = ?,
                  trial_capacity = ?, space_selectable = ?, space_movable = ?, publish_fixed = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE entity_type = 'program' AND bw5_key = ?`,
        args: [code, name, staffCode, spaceCode, trial, sel, mov, pub, key] as (string | number)[],
      })),
    ],
    'write'
  );
}
