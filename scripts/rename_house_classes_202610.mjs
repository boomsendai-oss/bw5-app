// HOUSEクラスの名前の整理 (2026-10-20 / TARO決定「今すぐ全部そろえる」)
//
//   水曜 K@TTSU HOUSE → HOUSE 初級 (講師名入りはこのクラスだけで不自然・初級=はじめて向けから外す)
//   土曜 多賀城 HOUSE → 多賀城 HOUSE 入門 (12月から毎週・K@TTSU/AOI/MYU の交代制)
//   土曜 HOUSE 強化 の時間を実開催(Googleカレンダー)に合わせて 11:00〜12:30 へ
//
// URLのslug(kattsu-house / tagajo-house / house-expert)は変えない(旧URLを404にしないため)。
//
// 使い方:
//   node scripts/rename_house_classes_202610.mjs            # 何も書き込まない。変更予定を表示するだけ
//   node scripts/rename_house_classes_202610.mjs --apply    # 本番DBへ反映
//
// 触らないもの(過去の記録なので旧名のまま残す):
//   hacomono_reservations / hacomono_cancellations / payroll_lines / studio_billing_lines / lesson_utilization /
//   lesson_instances / trial_records / media_insights / reel_* / x_posts / threads_posts / performances / schedule(BW5演目表) /
//   monthly_reports / staff_notifications / sync_runs
//   hacomono_schedule_map.hacomono_name は HACOMONO 側の実際の名前なので、HACOMONOを変えるまで触らない。
//
// 冪等: 2回実行しても同じ結果になる。
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.env.local' });
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const plan = [];
const add = (label, sql, args) => plan.push({ label, sql, args });
const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];

// 1) クラスのマスター
const DESC_13 = [
  '毎回ひとつのステップをテーマに、前半でその基礎を練習し、後半でそのステップを使った振り付けに挑戦。ステップの基礎から「実際のダンスへの落とし込み」まで、一通り学べるHOUSEクラスです。',
  '',
  '内容は初級レベル。月曜の「HOUSE 入門」や土曜の「多賀城 HOUSE 入門」で基本のステップに慣れてきた方が、次に進むクラスです。キッズと大人が混ざって一緒に踊っています。',
].join('\n');
const DESC_20 = [
  '「多賀城・七ヶ浜方面でもハウスダンスをやりたい」という声から生まれたクラスです。目標は、シンプルなことをハウスダンスでかっこよくやること。始めやすさを大切にしているので、ハウスがはじめての方にもおすすめです。',
  '',
  '2026年12月からは毎週土曜の開催になり、K@TTSU・AOI・MYUの3人が交代で教えます。',
].join('\n');

const masters = [
  { id: 13, from: 'K@TTSU HOUSE', to: 'HOUSE 初級', desc: DESC_13 },
  { id: 20, from: '多賀城 HOUSE', to: '多賀城 HOUSE 入門', desc: DESC_20 },
];
for (const m of masters) {
  const r = await one('SELECT id,class_name,description_text FROM lesson_master WHERE id=?', [m.id]);
  if (!r) throw new Error(`lesson_master id=${m.id} が見つかりません`);
  if (![m.from, m.to].includes(r.class_name)) throw new Error(`想定外のクラス名です: ${r.class_name}`);
  if (r.class_name !== m.to) add(`lesson_master#${m.id} クラス名 「${r.class_name}」→「${m.to}」`,
    "UPDATE lesson_master SET class_name=?, updated_at=datetime('now') WHERE id=? AND class_name=?", [m.to, m.id, m.from]);
  if (r.description_text !== m.desc) add(`lesson_master#${m.id} HP紹介文を差し替え`,
    "UPDATE lesson_master SET description_text=?, updated_at=datetime('now') WHERE id=?", [m.desc, m.id]);
}
const k = await one('SELECT default_start_time s, default_end_time e, description_text d FROM lesson_master WHERE id=22');
if (k.s !== '11:00' || k.e !== '12:30') add('lesson_master#22 HOUSE 強化 の時間 →11:00〜12:30',
  "UPDATE lesson_master SET default_start_time='11:00', default_end_time='12:30', duration_minutes=90, updated_at=datetime('now') WHERE id=22", []);
const d22 = String(k.d).split('水曜のK@TTSU HOUSEや多賀城HOUSEに').join('水曜の「HOUSE 初級」や土曜の「多賀城 HOUSE 入門」に');
if (d22 !== k.d) add('lesson_master#22 紹介文の旧クラス名を置換',
  "UPDATE lesson_master SET description_text=?, updated_at=datetime('now') WHERE id=22", [d22]);

// 2) HACOMONO対応表 (クラス名の文字列で引くので、マスターと必ず同時に変える)
for (const m of masters) {
  const r = await one("SELECT id,bw5_key FROM hacomono_schedule_map WHERE entity_type='program' AND lesson_master_id=?", [m.id]);
  if (!r) throw new Error(`hacomono_schedule_map に master ${m.id} の行がありません`);
  if (r.bw5_key !== m.to) add(`hacomono_schedule_map#${r.id} bw5_key 「${r.bw5_key}」→「${m.to}」`,
    'UPDATE hacomono_schedule_map SET bw5_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [m.to, r.id]);
}

// 3) 旧スケジュール表の表示名・時間
const ls = (await db.execute("SELECT id,class_name,start_time,end_time FROM lesson_schedule WHERE id IN (4,24,25,26)")).rows;
for (const r of ls) {
  let name = r.class_name;
  if (r.id === 4) name = 'HOUSE 初級';
  if (r.id === 25 || r.id === 26) name = name.replace('多賀城HOUSE', '多賀城 HOUSE 入門');
  if (name !== r.class_name) add(`lesson_schedule#${r.id} 「${r.class_name}」→「${name}」`,
    "UPDATE lesson_schedule SET class_name=?, updated_at=datetime('now') WHERE id=?", [name, r.id]);
  if (r.id === 24 && (r.start_time !== '11:00' || r.end_time !== '12:30')) add('lesson_schedule#24 HOUSE 強化 の時間 →11:00〜12:30',
    "UPDATE lesson_schedule SET start_time='11:00', end_time='12:30', updated_at=datetime('now') WHERE id=24", []);
}

// 4) 文章の中の旧名 (FAQ・ブログ)
const FAQ_33 = '多賀城のHOUSEクラス（多賀城 HOUSE 入門）は、2026年11月までは月2回、12月からは毎週土曜11:00〜12:30の開催です。担当はK@TTSU(カッツ)先生・AOI先生・MYU先生の3人が交代で受け持ちます。最新の日程は公式LINEやカレンダーでご確認ください。';
const f = await one('SELECT answer FROM faq_entries WHERE id=33');
if (f && f.answer !== FAQ_33) add('faq_entries#33 多賀城HOUSEの開催頻度と担当を12月からの形に',
  "UPDATE faq_entries SET answer=?, updated_at=datetime('now') WHERE id=33", [FAQ_33]);
const b = await one('SELECT content_markdown c FROM blog_posts WHERE id=8');
const b2 = String(b.c).split('| 土曜 | 多賀城 HOUSE | 11:00-12:30 |').join('| 土曜 | 多賀城 HOUSE 入門 | 11:00-12:30 |');
if (b2 !== b.c) add('blog_posts#8 (多賀城ガイド) 表のクラス名', 'UPDATE blog_posts SET content_markdown=? WHERE id=8', [b2]);

// ---- 表示と実行 ----
console.log(APPLY ? '【本番反映】' : '【確認のみ・書き込みなし】 --apply を付けると反映します');
if (plan.length === 0) { console.log('変更はありません(反映済み)。'); process.exit(0); }
plan.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. ${p.label}`));
if (APPLY) {
  const res = await db.batch(plan.map((p) => ({ sql: p.sql, args: p.args })), 'write');
  res.forEach((r, i) => console.log(`   ${i + 1}: rowsAffected=${r.rowsAffected}`));
}
