#!/usr/bin/env node
/**
 * 単発WS・イベントの申込状況を HACOMONO のデータから出す。
 *
 * 2026-09-01、SHOKO WSの申込を出典不明の古いメモから「5名」と報告して誤った。
 * 憶測で答えないために、1コマンドで取れるようにしたもの。
 *
 *   node scripts/ws-signups.mjs SHOKO           商品名に SHOKO を含むものを集計
 *   node scripts/ws-signups.mjs SHOKO --json
 *
 * 数字の出どころ:
 *   - 申込(本命) = `hacomono_reservations`(RL001予約一覧。2026-09-01から未来90日ぶんも取込)
 *   - 入金       = `hacomono_billing_records`(PL001売上一覧)
 *
 * ⚠️ 「申込数」と「入金数」は一致しない。当日現金払いを選ぶと予約だけ先に立つ。
 *    逆に「チケットは買ったが枠を予約していない」人も出る(2026-09-01に実在1名)。
 *    どちらもこのスクリプトが差分として表示する。
 *
 * ⚠️ 必ず「データ時点」も一緒に読むこと。daily_syncは前日ぶんまでなので、
 *    今日の申込はまだ入っていない。差があれば HACOMONO 管理画面が正。
 * ⚠️ HACOMONO外(公式LINEの個別受付・当日現金)はここに出ない。
 *    受付を2箇所に割ったイベントは、この数字だけで「全部」と言ってはいけない。
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

async function main() {
  const keyword = process.argv[2];
  const asJson = process.argv.includes('--json');
  if (!keyword) {
    console.error('使い方: node scripts/ws-signups.mjs <商品名の一部>  (例: SHOKO)');
    process.exit(1);
  }
  loadEnv();
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

  const rows = await q(
    `SELECT billing_date, member_id, product_name, amount, payment_method
       FROM hacomono_billing_records
      WHERE product_name LIKE ?
      ORDER BY billing_date`,
    [`%${keyword}%`]
  );
  const reservations = await q(
    `SELECT lesson_date, start_time, program_name, hacomono_member_id, status, booked_at
       FROM hacomono_reservations
      WHERE program_name LIKE ? AND status <> 'キャンセル'
      ORDER BY booked_at`,
    [`%${keyword}%`]
  );
  const resFresh = (
    await q(`SELECT MAX(imported_at) AS imported FROM hacomono_reservations`)
  )[0];
  const fresh = (
    await q(`SELECT MAX(billing_date) AS latest, MAX(imported_at) AS imported FROM hacomono_billing_records`)
  )[0];

  // 同じ人が複数枚買うこともあるので、人数と枚数を分けて出す
  const members = new Set(rows.map((r) => String(r.member_id)));
  const revenue = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const cash = rows.filter((r) => Number(r.amount ?? 0) === 0).length; // 当日現金は0円計上

  const paidMembers = new Set(rows.map((r) => String(r.member_id)));
  const bookedMembers = new Set(reservations.map((r) => String(r.hacomono_member_id)));
  const paidNotBooked = [...paidMembers].filter((m) => !bookedMembers.has(m));
  const bookedNotPaid = [...bookedMembers].filter((m) => !paidMembers.has(m));

  const out = {
    keyword,
    reserved: reservations.length,
    reservationsAsOf: resFresh?.imported ?? null,
    paidNotBooked,
    bookedNotPaid,
    signups: rows.length,
    uniqueMembers: members.size,
    revenue,
    payLaterCount: cash,
    dataAsOf: fresh?.latest ?? null,
    importedAt: fresh?.imported ?? null,
    rows: rows.map((r) => ({
      date: r.billing_date,
      member_id: String(r.member_id),
      product: r.product_name,
      amount: Number(r.amount ?? 0),
      method: r.payment_method,
    })),
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`\n【${keyword}】HACOMONO`);
  console.log(`  ■ 申込(予約) ${out.reserved}名   ← 人数はこれが正`);
  console.log(`     取込 ${out.reservationsAsOf ?? '未取込'}`);
  console.log(`  ■ 入金済み   ${out.signups}件 / ${out.uniqueMembers}名 / ${yen(revenue)}`);
  if (paidNotBooked.length > 0) {
    console.log(`  🔴 支払い済みだが予約が無い: 会員 ${paidNotBooked.join(', ')} … 枠を取れているか要確認`);
  }
  if (bookedNotPaid.length > 0) {
    console.log(`  💴 予約済みで未入金(=当日現金の見込み): 会員 ${bookedNotPaid.join(', ')}`);
  }
  if (cash > 0) console.log(`  ※うち ${cash}件 は当日支払い(0円計上)`);
  console.log(`  📅 データ時点: ${out.dataAsOf}（取込 ${out.importedAt}）`);
  console.log(`  ⚠️ 今日ぶんの申込はまだ入っていない可能性があります。HACOMONO管理画面が正。`);
  console.log(`  ⚠️ 公式LINE等のHACOMONO外の受付はここに出ません。\n`);
  for (const r of out.rows) {
    console.log(`   ${r.date}  会員${r.member_id}  ${yen(r.amount)}  ${r.method}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
