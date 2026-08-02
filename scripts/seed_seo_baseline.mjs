#!/usr/bin/env node
// 2026-07-14の手動実測ベースラインと、2026-08-02のTARO実測を seo_rank_snapshots に投入する。
//
// なぜ必要か: 順位の記録がSTATE.mdの散文にしか無く、比較に使えなかった。
// 「17位 → 12位で5つ上がった」を数字として持てるようにする。
//
// 冪等: UNIQUE(measured_on, source, query, target) で二重投入されない。
// 使い方: node scripts/seed_seo_baseline.mjs
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db';
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

// 2026-07-14 実測(TAROがシークレットモードで検索・スクショ22枚を解析)
// ⚠️ 検索キーワードの正確な文字列はスクショ側にしか残っていないため、STATE.mdの記録から復元。
//    順位の数値は記録どおり。
const BASELINE = [
  ['2026-07-14', '仙台 ダンススクール', 'hp', 17, 0],
  ['2026-07-14', '仙台 キッズダンス', 'hp', 23, 0],
  ['2026-07-14', '仙台 キッズダンス', 'instagram', 15, 0],
  ['2026-07-14', '仙台 ヒップホップ', 'hp', 20, 0],
  ['2026-07-14', '仙台 ダンス 初心者', 'hp', 6, 0],
  ['2026-07-14', '長町 ダンス', 'hp', 11, 0],
  ['2026-07-14', '長町 ダンス', 'instagram', 6, 0],
  // 70位まで見て見つからず = 圏外
  ['2026-07-14', '多賀城 ダンススクール', 'hp', null, 1],
  // 2026-08-02 TAROがシークレットモードで実測(2ページ目の上から2番目)
  ['2026-08-02', '仙台 ダンススクール', 'hp', 12, 0],
];

const NOTE = {
  '2026-07-14': '手動実測(シークレットモード・スクショ22枚)。移管前=旧Wixサイトの順位',
  '2026-08-02': '手動実測(シークレットモード・TARO)。2ページ目の上から2番目。移管前=旧Wixサイト',
};

let inserted = 0;
for (const [on, query, target, position, oor] of BASELINE) {
  const r = await db.execute({
    sql: `INSERT INTO seo_rank_snapshots
            (measured_on, source, query, target, position, out_of_range, note)
          VALUES (?, 'manual', ?, ?, ?, ?, ?)
          ON CONFLICT(measured_on, source, query, target) DO NOTHING`,
    args: [on, query, target, position, oor, NOTE[on] ?? null],
  });
  inserted += r.rowsAffected ?? 0;
}

const total = (await db.execute('SELECT COUNT(*) AS n FROM seo_rank_snapshots')).rows[0].n;
console.log(`投入 ${inserted}件 / テーブル合計 ${total}件`);
