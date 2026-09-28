// HOUSE エキスパート → HOUSE 強化 へのクラス名変更 (2026-10 / TARO・K@TTSU 決定)
//
// 位置づけの変更: 「選抜のクラス」→「やる気があれば技術を問わず参加できるが、取り組みには厳しいクラス」。
// クラス名はキッズと同じ並び(キッズ 強化 / HOUSE 強化)に揃える。URLのslug(house-expert)は変えない(旧URLを404にしないため)。
//
// 使い方:
//   node scripts/rename_house_expert_to_kyoka.mjs            # 何も書き込まない。変更予定を表示するだけ
//   node scripts/rename_house_expert_to_kyoka.mjs --apply    # 本番DBへ反映
//   --keep-description を付けるとHPの紹介文は変えない(名前だけ変える)
//
// 触らないもの(過去の記録なので旧名のまま残す):
//   hacomono_reservations / hacomono_billing_records / payroll_lines / studio_billing_lines /
//   lesson_utilization / media_insights / reel_* / x_posts / threads_posts / performances / schedule(BW5演目表)
//   hacomono_products(26,27) は HACOMONO の商品名と完全一致で突き合わせるので、HACOMONO側を変えるまで触らない。
//
// 冪等: 2回実行しても同じ結果になる。
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.env.local' });
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');
const KEEP_DESC = process.argv.includes('--keep-description');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const MASTER_ID = 22;
const OLD_NAME = 'HOUSE エキスパート';
const NEW_NAME = 'HOUSE 強化';
const HACOMONO_CODE = 'PG0039'; // 2026-07〜09 の実開催はすべて PG0039 (PG0040「選抜のみ」は 2026-05 が最後)
const HACOMONO_NAME = 'HOUSE 強化クラス';

const NEW_DESCRIPTION = [
  'HOUSEを本気で上手くなりたい人のための、月1〜2回・不定期開催のクラスです。',
  '',
  '今の技術は問いません。問うのは取り組み方です。あいさつ、練習への向き合い方、普段のレッスンでの姿勢。できていないことは「できていない」とはっきり伝えます。',
  '',
  'クラスの中では、毎回いちばんを争うつもりで踊ってもらいます。水曜のK@TTSU HOUSEや多賀城HOUSEに通いながら、もう一段上を目指したい方はぜひどうぞ。',
].join('\n');

const plan = [];
const add = (label, sql, args) => plan.push({ label, sql, args });

// 1) クラスのマスター
const m = (await db.execute({ sql: 'SELECT id,class_name,slug,description_text FROM lesson_master WHERE id=?', args: [MASTER_ID] })).rows[0];
if (!m) throw new Error(`lesson_master id=${MASTER_ID} が見つかりません`);
if (![OLD_NAME, NEW_NAME].includes(m.class_name)) throw new Error(`想定外のクラス名です: ${m.class_name}`);
if (m.class_name !== NEW_NAME) {
  add(`lesson_master#${MASTER_ID} クラス名 「${m.class_name}」→「${NEW_NAME}」`,
    "UPDATE lesson_master SET class_name=?, updated_at=datetime('now') WHERE id=? AND class_name=?", [NEW_NAME, MASTER_ID, OLD_NAME]);
}
if (!KEEP_DESC && m.description_text !== NEW_DESCRIPTION) {
  add(`lesson_master#${MASTER_ID} HP紹介文を新しい位置づけに差し替え`,
    "UPDATE lesson_master SET description_text=?, updated_at=datetime('now') WHERE id=?", [NEW_DESCRIPTION, MASTER_ID]);
}

// 2) HACOMONO対応表 (クラス名の文字列で引くので、マスターと必ず同時に変える)
const maps = (await db.execute({
  sql: "SELECT id,bw5_key,hacomono_code,hacomono_name,lesson_master_id FROM hacomono_schedule_map WHERE entity_type='program' AND bw5_key IN (?,?)",
  args: [OLD_NAME, NEW_NAME],
})).rows;
const linked = maps.find((r) => Number(r.lesson_master_id) === MASTER_ID) ?? maps.find((r) => r.bw5_key === OLD_NAME);
if (!linked) throw new Error('hacomono_schedule_map に対象行がありません');
for (const r of maps) {
  if (r.id !== linked.id) {
    add(`hacomono_schedule_map#${r.id} 重複行(${r.bw5_key}/${r.hacomono_code})を削除`,
      'DELETE FROM hacomono_schedule_map WHERE id=?', [r.id]);
  }
}
if (linked.bw5_key !== NEW_NAME || linked.hacomono_code !== HACOMONO_CODE || linked.hacomono_name !== HACOMONO_NAME) {
  add(`hacomono_schedule_map#${linked.id} 「${linked.bw5_key}/${linked.hacomono_code}/${linked.hacomono_name}」→「${NEW_NAME}/${HACOMONO_CODE}/${HACOMONO_NAME}」`,
    "UPDATE hacomono_schedule_map SET bw5_key=?, hacomono_code=?, hacomono_name=?, lesson_master_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [NEW_NAME, HACOMONO_CODE, HACOMONO_NAME, MASTER_ID, linked.id]);
}

// 3) 旧スケジュール表の表示名
const ls = (await db.execute("SELECT id,class_name FROM lesson_schedule WHERE class_name LIKE '%HOUSE エキスパート%'")).rows;
for (const r of ls) {
  const next = r.class_name.replace('HOUSE エキスパートクラス', 'HOUSE 強化クラス').replace('HOUSE エキスパート', 'HOUSE 強化');
  add(`lesson_schedule#${r.id} 「${r.class_name}」→「${next}」`,
    "UPDATE lesson_schedule SET class_name=?, updated_at=datetime('now') WHERE id=?", [next, r.id]);
}

// 4) 文章の中の旧名 (FAQ・講師紹介・ブログ)
const replaceIn = async (table, col, idCol, extraSet, pairs) => {
  const rows = (await db.execute(`SELECT ${idCol} AS id, ${col} AS v FROM ${table} WHERE ${col} LIKE '%エキスパート%'`)).rows;
  for (const r of rows) {
    let next = r.v;
    for (const [a, b] of pairs) next = next.split(a).join(b);
    if (next !== r.v) {
      add(`${table}#${r.id}.${col} の旧名を置換`, `UPDATE ${table} SET ${col}=?${extraSet} WHERE ${idCol}=?`, [next, r.id]);
    } else {
      console.log(`  (確認) ${table}#${r.id}.${col} は「エキスパート」を含むが置換対象の表記に一致せず、触りません`);
    }
  }
};
await replaceIn('faq_entries', 'question', 'id', ", updated_at=datetime('now')", [
  ['HOUSEエキスパートは12月から', 'HOUSE強化クラス（旧エキスパート）は12月から'],
]);
await replaceIn('faq_entries', 'answer', 'id', ", updated_at=datetime('now')", [
  ['これまでどおり、HOUSEの基礎が身についた方向けのクラスです。', '2026年10月に「HOUSE エキスパート」から名前が変わりました。今の技術に関係なく、本気で上手くなりたい方が参加できるクラスです。'],
  ['HOUSEエキスパートクラスのように', 'HOUSE強化クラスのように'],
  ['HOUSEエキスパートは月謝プラン', 'HOUSE強化クラス（旧エキスパート）は月謝プラン'],
]);
await replaceIn('instructors', 'profile_text', 'id', '', [
  ['入門からエキスパートまで', '入門から強化クラスまで'],
]);
await replaceIn('blog_posts', 'content_markdown', 'id', '', [
  ['HOUSE エキスパート', 'HOUSE 強化'],
]);

// ---- 表示と実行 ----
console.log(`\n対象DB: ${String(process.env.TURSO_DATABASE_URL).replace(/^libsql:\/\//, '').split('.')[0]}`);
console.log(APPLY ? '【本番反映】' : '【確認のみ・書き込みなし】 --apply を付けると反映します');
if (plan.length === 0) { console.log('変更はありません(反映済み)。'); process.exit(0); }
plan.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. ${p.label}`));

if (APPLY) {
  const res = await db.batch(plan.map((p) => ({ sql: p.sql, args: p.args })), 'write');
  res.forEach((r, i) => console.log(`   ${i + 1}: rowsAffected=${r.rowsAffected}`));
  const after = (await db.execute({ sql: 'SELECT id,class_name,slug FROM lesson_master WHERE id=?', args: [MASTER_ID] })).rows[0];
  const am = (await db.execute({ sql: "SELECT bw5_key,hacomono_code,hacomono_name FROM hacomono_schedule_map WHERE lesson_master_id=?", args: [MASTER_ID] })).rows;
  console.log('AFTER lesson_master:', JSON.stringify(after));
  console.log('AFTER schedule_map :', JSON.stringify(am));
  console.log('\n次の手順: HPの再ビルド(boom-hp へ空コミット or 6時間ごとの自動再構築を待つ) / 連携ハブでGoogleカレンダー同期');
}
