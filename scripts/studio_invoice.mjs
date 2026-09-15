#!/usr/bin/env node
/**
 * スタジオごとの利用明細を、LINEでそのまま送れる形で出す。
 *
 *   node scripts/studio_invoice.mjs 2026-10            全スタジオ
 *   node scripts/studio_invoice.mjs 2026-10 GOAT       名前で絞り込み
 *   node scripts/studio_invoice.mjs 2026-08 AZUMA
 *
 * 出どころ: studio_billing_lines(本番Turso)。カレンダー実績＋マスタ展開＋日次バッファ。
 * GOATは大(A)と小(B)を**同じ日付の行にまとめる**(TARO要望 2026-09-15・先方が日単位で
 * 押さえているため)。他のスタジオは1会場=1明細。
 *
 * ⚠️ 金額の出どころが `lesson_master_expanded` の行は**カレンダーの予定を読めずマスタから補完した**ぶん。
 *    実際に開催される回(代講で単価未定など)も、開催しない回も混ざる。
 *    明細の末尾に注記を出すので、先方に送る前に必ず開催の有無を確認すること。
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  for (const f of ['.env.local', '.env.production.local']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
const yen = (n) => `¥${n.toLocaleString()}`;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
function md(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
}
/** 1.0h→「1時間」 1.5h→「1時間30分」 */
function hhmm(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const mi = total % 60;
  return mi === 0 ? `${h}時間` : h === 0 ? `${mi}分` : `${h}時間${mi}分`;
}

// GOATは大と小を1つの明細にまとめる
const GROUPS = [{ label: 'GOAT DANCE STUDIO', match: (n) => n.startsWith('GOAT'), sub: (n) => (n.includes('小') ? 'B' : 'A') }];

async function main() {
  const ym = process.argv[2];
  const filter = process.argv[3] ?? '';
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    console.error('使い方: node scripts/studio_invoice.mjs YYYY-MM [スタジオ名の一部]');
    process.exit(1);
  }
  loadEnv();
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const rows = (
    await db.execute({
      sql: `SELECT s.id AS sid, s.name AS studio, l.lesson_date AS d, l.hours, l.amount, l.source
              FROM studio_billing_lines l
              JOIN studio_billing_runs r ON r.id = l.studio_billing_run_id
              JOIN studios s ON s.id = r.studio_id
             WHERE r.year_month = ? AND l.amount > 0
             ORDER BY s.id, l.lesson_date`,
      args: [ym],
    })
  ).rows;
  if (rows.length === 0) {
    console.log(`${ym} の明細はありません`);
    return;
  }

  // グループ(GOAT)か単体かでまとめ先を決める
  const buckets = new Map(); // label -> { days: Map<date,{hours,amount,parts:Map}>, total, estimated }
  for (const r of rows) {
    const g = GROUPS.find((x) => x.match(String(r.studio)));
    const label = g ? g.label : String(r.studio);
    if (filter && !label.includes(filter) && !String(r.studio).includes(filter)) continue;
    let b = buckets.get(label);
    if (!b) { b = { days: new Map(), total: 0, estimated: 0 }; buckets.set(label, b); }
    const key = String(r.d);
    let day = b.days.get(key);
    if (!day) { day = { hours: 0, amount: 0, parts: new Map() }; b.days.set(key, day); }
    day.hours += Number(r.hours ?? 0);
    day.amount += Number(r.amount ?? 0);
    if (g) {
      const sub = g.sub(String(r.studio));
      const cur = day.parts.get(sub) ?? { hours: 0, amount: 0 };
      cur.hours += Number(r.hours ?? 0);
      cur.amount += Number(r.amount ?? 0);
      day.parts.set(sub, cur);
    }
    b.total += Number(r.amount ?? 0);
    if (String(r.source) === 'lesson_master_expanded') b.estimated += Number(r.amount ?? 0);
  }

  const [, mm] = ym.split('-');
  for (const [label, b] of buckets) {
    console.log('────────────────────────────');
    console.log(`${label}`);
    console.log(`${Number(mm)}月 ご利用分  合計 ${yen(b.total)}`);
    console.log('');
    for (const [d, day] of [...b.days.entries()].sort()) {
      if (day.parts.size > 0) {
        const parts = [...day.parts.entries()].sort().map(([k, v]) => `${k} ${hhmm(v.hours)}`).join(' ＋ ');
        console.log(`${md(d)}  ${parts}  ${yen(day.amount)}`);
      } else {
        console.log(`${md(d)}  ${hhmm(day.hours)}  ${yen(day.amount)}`);
      }
    }
    console.log('');
    console.log(`合計 ${yen(b.total)}`);
    if (b.estimated > 0) {
      console.log(`※送信前に確認: うち ${yen(b.estimated)} はカレンダーの予定が読めずマスタ予定から補完したぶんです(開催の有無を確認)`);
    }
  }
  console.log('────────────────────────────');
}
main().catch((e) => { console.error(e); process.exit(1); });
