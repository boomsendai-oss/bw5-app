#!/usr/bin/env node
// Rebuild performances + performers from v5 timetable + cast CSV,
// and convert cutout group photos to WebP.
//
// Usage: node scripts/rebuild-cast-and-photos.mjs
//
// Inputs:
//   - v5 timetable (hardcoded below)
//   - cast CSV: https://docs.google.com/spreadsheets/d/1s6YYbaAsFVzZy30p-mRrpOPgU8Pv1UaIP6n8T3T2W_E/export?format=csv&gid=136418188
//   - photos: iCloud folder (PHOTO_SRC_DIR)
//
// Outputs:
//   - DB: performances, performers tables fully rebuilt
//   - /public/performances/M*.webp

import { createClient } from '@libsql/client';
import sharp from 'sharp';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_URL = process.env.TURSO_DATABASE_URL || ('file:' + path.join(ROOT, 'data/bw5.db'));
const DB_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

const PHOTO_SRC_DIR = '/Users/kimurashintarou/Library/Mobile Documents/com~apple~CloudDocs/2026_5_5 BW5/13_パンフレット/BW5_クラス集合写真_切り抜き後_アプリ用';
const PHOTO_OUT_DIR = path.join(ROOT, 'public/performances');
const CSV_URL = 'https://docs.google.com/spreadsheets/d/1s6YYbaAsFVzZy30p-mRrpOPgU8Pv1UaIP6n8T3T2W_E/export?format=csv&gid=136418188';

// ── v5 performances (from src/lib/timetableData.ts) ───────────────
// Only performance / guest / special entries (breaks excluded).
const PERFORMANCES = [
  // Part 1
  { m_id: 'M3',  part: 1, type: 'performance', title: 'Sunshine',           instructor: 'TARO',           genre: 'HIPHOP 初級' },
  { m_id: 'M4',  part: 1, type: 'performance', title: 'Best Pals',          instructor: 'Ryuki',          genre: 'はじめての HIPHOP' },
  { m_id: 'M5',  part: 1, type: 'performance', title: 'Waack The Soul',     instructor: 'YURI',           genre: '長町 WAACK 入門' },
  { m_id: 'M6',  part: 1, type: 'performance', title: '諏訪GALS!!',          instructor: 'HARUKA',         genre: 'キッズ ガールズ' },
  { m_id: 'M7',  part: 1, type: 'performance', title: 'Funkastic Beats',    instructor: 'K@TTSU & AOI',   genre: '多賀城 HOUSE' },
  { m_id: 'M8',  part: 1, type: 'performance', title: 'Little Wave',        instructor: 'TARO',           genre: '長町 キッズ HIPHOP' },
  { m_id: 'M10', part: 1, type: 'guest',       title: 'ZIEL',               instructor: '',               genre: 'GUEST' },
  { m_id: 'M11', part: 1, type: 'performance', title: "Teddy's Fam",        instructor: 'おっちゃん',      genre: 'NEW JACK SWING' },
  // Part 2
  { m_id: 'M14', part: 2, type: 'performance', title: 'Keep Grinding',      instructor: 'AOI',            genre: '多賀城 HIPHOP 基礎' },
  { m_id: 'M15', part: 2, type: 'performance', title: 'Grown ups',          instructor: 'Ryuki & TARO',   genre: 'ベーシックダンスクラス' },
  { m_id: 'M16', part: 2, type: 'performance', title: 'Focus',              instructor: 'KEIKO',          genre: '多賀城 JAZZ' },
  { m_id: 'M17', part: 2, type: 'performance', title: 'Mini Wave',          instructor: 'KOKEKO & TARO',  genre: '長町 ちびっこ HIPHOP' },
  { m_id: 'M19', part: 2, type: 'performance', title: 'Beat Theory',        instructor: 'AOI',            genre: '多賀城 HIPHOP 初級' },
  { m_id: 'M20', part: 2, type: 'performance', title: 'そのまま',            instructor: 'SAYUKI',         genre: 'FREE STYLE' },
  { m_id: 'M21', part: 2, type: 'guest',       title: 'TARO & TAKE',        instructor: '',               genre: 'GUEST' },
  { m_id: 'M22', part: 2, type: 'performance', title: 'Change',             instructor: 'K@TTSU',         genre: 'K@TTSU HOUSE' },
  { m_id: 'M23', part: 2, type: 'guest',       title: 'FOODIES',            instructor: '',               genre: 'GUEST' },
  { m_id: 'M24', part: 2, type: 'special',     title: 'GRAFFITI',           instructor: 'TARO & Ryuki',   genre: 'SPECIAL ナンバー' },
  // Part 3
  { m_id: 'M27', part: 3, type: 'performance', title: 'SEVEN BEATS',        instructor: 'TARO',           genre: '七ヶ浜 HIPHOP 初級' },
  { m_id: 'M28', part: 3, type: 'performance', title: 'Turn It Up',         instructor: 'KEIKO',          genre: '長町 ガールズ 合同' },
  { m_id: 'M29', part: 3, type: 'performance', title: 'Slay Force',         instructor: 'Ryuki',          genre: 'キッズ HIPHOP' },
  { m_id: 'M30', part: 3, type: 'performance', title: "Dreamin' Smoke",     instructor: 'ちゃんなつ',      genre: 'HIPHOP' },
  { m_id: 'M31', part: 3, type: 'performance', title: '7BOOM BAP C.R.E.W',  instructor: 'AOI',            genre: '七ヶ浜 HIPHOP 入門' },
  { m_id: 'M33', part: 3, type: 'performance', title: 'Drum Line',          instructor: 'TARO',           genre: 'キッズ 強化' },
  { m_id: 'M34', part: 3, type: 'guest',       title: 'クレアラシル',        instructor: '',               genre: 'GUEST' },
  { m_id: 'M35', part: 3, type: 'performance', title: 'full blast',         instructor: 'K@TTSU',         genre: 'HOUSE エキスパート' },
  { m_id: 'M36', part: 3, type: 'guest',       title: 'NEW STYLERS',        instructor: '',               genre: 'GUEST' },
  { m_id: 'M37', part: 3, type: 'performance', title: 'Vibrant',            instructor: 'TARO',           genre: 'TARO HIP HOP 中級' },
];

// ── Sheet column (1-indexed) → v5 M_ID mapping ────────────────────
// Confirmed with user (列11 multi-possibility resolved to M14)
const SHEET_COL_TO_MID = {
  1:  'M24', // GRAFFITIナンバー (SPECIAL)
  2:  'M20', // SAYUKI フリースタイル
  3:  'M30', // ちゃんなつ HIPHOP
  4:  'M11', // おっちゃん NJS
  5:  'M5',  // YURI WAACK 入門
  6:  'M33', // キッズ 強化
  7:  'M35', // HOUSE エキスパート
  8:  'M4',  // はじめてのHIPHOP
  9:  'M29', // キッズ HIPHOP
  10: 'M15', // ベーシックダンスクラス
  11: 'M14', // 多賀城 HIPHOP 入門/基礎
  12: 'M19', // 多賀城 HIPHOP 初級
  13: 'M16', // 多賀城 JAZZ
  14: 'M37', // TARO HIPHOP 中級
  15: 'M3',  // TARO HIPHOP 初級
  16: 'M22', // K@TTSU HOUSE
  17: 'M31', // 七ヶ浜 HIPHOP 入門
  18: 'M27', // 七ヶ浜 HIPHOP 初級
  19: 'M7',  // 多賀城 HOUSE
  20: 'M28', // 長町ガールズ合同
  21: 'M17', // 長町 ちびっこ HIPHOP
  22: 'M8',  // 長町 キッズ HIPHOP
  23: 'M6',  // 諏訪キッズ
};

// ── CSV parser (minimal; handles quoted fields) ───────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const db = createClient({ url: DB_URL, authToken: DB_AUTH_TOKEN });

  console.log('🧹  Clearing performances + performers…');
  await db.execute('DELETE FROM performers');
  await db.execute('DELETE FROM performances');

  console.log('🎭  Inserting v5 performances (' + PERFORMANCES.length + ')…');
  for (const p of PERFORMANCES) {
    await db.execute({
      sql: `INSERT INTO performances (m_id, title, title_reading, instructor, performer_count, genre, song_name, part)
            VALUES (?, ?, '', ?, 0, ?, '', ?)`,
      args: [p.m_id, p.title, p.instructor, p.genre, p.part],
    });
  }

  console.log('📥  Fetching cast CSV…');
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error('CSV fetch failed: ' + res.status);
  const csvText = await res.text();
  const rows = parseCSV(csvText);
  console.log('    CSV rows: ' + rows.length);

  // Row 0: header (we already mapped). Each performance takes 2 cols: name, furigana.
  // Col layout: [人数, perf1_name, perf1_kana, perf2_name, perf2_kana, ...]
  // perf index (1..23) → col pair (2*i - 1, 2*i)

  let insertedPerformers = 0;
  const perfCounts = {}; // m_id → count

  // Iterate data rows (skip header row 0).
  // Also skip the "→パンフコピペ用" aggregated row at the bottom: col 0 is non-numeric.
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const rankCell = (row[0] ?? '').trim();
    if (!/^\d+$/.test(rankCell)) continue;

    for (let sheetCol = 1; sheetCol <= 23; sheetCol++) {
      const nameColIdx = 2 * sheetCol - 1;
      const kanaColIdx = 2 * sheetCol;
      const name = (row[nameColIdx] ?? '').trim();
      // const kana = (row[kanaColIdx] ?? '').trim();
      if (!name) continue;

      const mId = SHEET_COL_TO_MID[sheetCol];
      if (!mId) continue;

      perfCounts[mId] = (perfCounts[mId] ?? 0) + 1;
      const sortOrder = perfCounts[mId];

      await db.execute({
        sql: `INSERT INTO performers (name, m_id, sort_order) VALUES (?, ?, ?)`,
        args: [name, mId, sortOrder],
      });
      insertedPerformers++;
    }
  }

  console.log('👥  Inserted performers: ' + insertedPerformers);

  // Update performer_count on performances
  for (const [mId, count] of Object.entries(perfCounts)) {
    await db.execute({
      sql: `UPDATE performances SET performer_count = ? WHERE m_id = ?`,
      args: [count, mId],
    });
  }

  // ── Photos: convert PNG → WebP ────────────────────────────────
  if (process.env.SKIP_PHOTOS === '1') {
    console.log('🖼   SKIP_PHOTOS=1 → skipping photo conversion.');
    console.log('\n✅  Done (DB only).');
    return;
  }
  await mkdir(PHOTO_OUT_DIR, { recursive: true });
  let files = [];
  try {
    files = (await readdir(PHOTO_SRC_DIR)).filter((f) => /\.png$/i.test(f));
  } catch (e) {
    console.log('🖼   Photo source dir not available (' + e.code + ') → skipping.');
    console.log('\n✅  Done (DB only).');
    return;
  }
  console.log('🖼   Photos found: ' + files.length);

  let converted = 0, skipped = 0;
  for (const f of files) {
    const mId = f.replace(/\.png$/i, '');
    const src = path.join(PHOTO_SRC_DIR, f);
    const dst = path.join(PHOTO_OUT_DIR, mId + '.webp');
    try {
      await sharp(src)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(dst);
      converted++;
    } catch (e) {
      console.warn('    ⚠️  failed ' + f + ': ' + e.message);
      skipped++;
    }
  }
  console.log('    Converted: ' + converted + ', skipped: ' + skipped);

  // Summary
  console.log('\n📊  Summary per performance:');
  const summary = await db.execute(
    `SELECT pf.m_id, pf.title, pf.performer_count
     FROM performances pf
     ORDER BY pf.part ASC, CAST(SUBSTR(pf.m_id, 2) AS INTEGER) ASC`
  );
  for (const row of summary.rows) {
    console.log('    ' + row.m_id.padEnd(4) + ' ' + String(row.performer_count).padStart(2) + '名  ' + row.title);
  }

  console.log('\n✅  Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
