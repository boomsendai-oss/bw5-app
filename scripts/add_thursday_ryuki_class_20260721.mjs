import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// 2026年8月開講の新クラスをlesson_masterへ登録。真実カレンダー(boom.sendai@gmail.com)に
// 【Ryuki】HIPHOP 初級 木19:00-20:30(初回2026-08-06)として登録済みのものをDB化する。
// これでFAQボットの公開ナレッジ(/api/public/knowledge)とHP(boom-hp getLessons)に自動反映される。
// 会場は週替わり(8/6=宮城野区文化センター, 8/20・27=戦災復興記念館…)なので、
// default_studioは名目(宮城野区文化センター=12)にとどめ、案内は「週替わり・LINE/カレンダー確認」へ倒す
// (水金クラスと同じ方針。ボットPERSONA側にも木曜を追記する)。
const SLUG = 'thu-hiphop-basic';
const INSTRUCTOR_RYUKI = 5;
const STUDIO_MIYAGINO = 12; // 宮城野区文化センター リハーサル室(初回会場・名目)

const exists = await c.execute({ sql: 'SELECT id FROM lesson_master WHERE slug = ?', args: [SLUG] });
if (exists.rows.length) {
  console.log(`既に存在 (id=${exists.rows[0].id})。スキップ。`);
} else {
  const r = await c.execute({
    sql: `INSERT INTO lesson_master
      (class_name, target, level, default_studio_id, default_instructor_id,
       default_day_of_week, default_start_time, default_end_time, duration_minutes,
       frequency_type, active, is_public, start_date, end_date, description_text, slug)
      VALUES (?, NULL, NULL, ?, ?, 4, '19:00', '20:30', 90, NULL, 1, 1, '2026-08-06', NULL, ?, ?)`,
    args: [
      'HIPHOP 初級',
      STUDIO_MIYAGINO,
      INSTRUCTOR_RYUKI,
      '2026年8月に新しく始まる木曜夜のクラス。会場は週によって変わるので、最新の会場は公式LINEやカレンダーで確認してね。',
      SLUG,
    ],
  });
  console.log(`登録完了 id=${r.lastInsertRowid}`);
}

// 確認
const chk = await c.execute({
  sql: `SELECT lm.id, lm.class_name, lm.default_day_of_week AS dow, lm.default_start_time AS st,
               lm.default_end_time AS et, i.name AS instructor, s.name AS studio, lm.start_date, lm.is_public, lm.active
        FROM lesson_master lm
        LEFT JOIN instructors i ON i.id = lm.default_instructor_id
        LEFT JOIN studios s ON s.id = lm.default_studio_id
        WHERE lm.slug = ?`,
  args: [SLUG],
});
console.log(JSON.stringify(chk.rows[0]));
