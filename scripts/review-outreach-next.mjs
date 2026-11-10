#!/usr/bin/env node
// クチコミ声がけ: 次にお願いする家族と、そのまま送れる本文を出す (M5セッション用)
//
// TAROが M5 のチャットで「送って」と言ったら、M5セッションがこれで5家族を受け取り、
// boom-events-hub の tools/line_mac_send/ でTAROの個人LINEから送る。
// 選び方・呼び名・本文は src/lib/reviewOutreachPick.ts (画面 /staff/review-outreach と共通)。
//
// 使い方:
//   node scripts/review-outreach-next.mjs --prod            次の5家族を表示 (読むだけ)
//   node scripts/review-outreach-next.mjs --prod --json     同じ内容をJSONで
//   node scripts/review-outreach-next.mjs --prod --mark 60,44   送れた家族に依頼日時(今)を記録
//
// 送る前の照合 (2026-11-10 の5家族で確立):
//   1. LINE検索は「LINE登録名」で。トーク履歴に子どもの名前(漢字かひらがな)が出れば送る
//   2. 出なければ、Lステップの同じ友だちとアイコン・名前が同じかを確かめて送る
//   3. どちらも確かめられなければ送らずにTAROへ報告
//   ※ 姓が同じでも別の家族のトークがある(例: 同名の保護者)。照合できないときは送らない
import { loadOutreachCandidates, pickNextFamilies, greetingFor, buildReviewRequest } from '../src/lib/reviewOutreachPick.ts';
import { makeClient } from './seed_recurring_expenses.mjs';

function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const argv = process.argv;
  const c = makeClient(argv);
  const query = async (sql, args = []) => (await c.execute({ sql, args })).rows;

  const markIdx = argv.indexOf('--mark');
  if (markIdx >= 0) {
    const keys = String(argv[markIdx + 1] ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (keys.length === 0) throw new Error('--mark の後に家族番号をカンマ区切りで');
    const now = new Date().toISOString();
    for (const k of keys) {
      await c.execute({
        sql: `INSERT INTO review_outreach (family_key, asked_at, updated_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(family_key) DO UPDATE SET asked_at = excluded.asked_at, updated_at = datetime('now')`,
        args: [k, now],
      });
    }
    console.log(`依頼済みに記録: ${keys.join(', ')} (${now})`);
    return;
  }

  const today = todayJst();
  const reviewCount = Number((await query('SELECT COUNT(*) AS n FROM gbp_reviews'))[0]?.n ?? 0);
  const picked = pickNextFamilies(await loadOutreachCandidates(query), today);
  const out = picked.map((f) => {
    const greeting = greetingFor(f, today);
    return {
      familyKey: f.familyKey,
      greeting,
      lineNames: [...new Set(f.lineLinks.map((l) => l.lineName).filter(Boolean))],
      childNames: f.members.map((m) => `${m.name}(${m.kana ?? ''})`),
      checkins: f.checkins,
      lastCheckin: f.lastCheckin,
      message: buildReviewRequest(greeting, reviewCount),
    };
  });

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ today, reviewCount, families: out }, null, 2));
    return;
  }
  console.log(`\n${today} 現在の口コミ ${reviewCount}件 / 次の${out.length}家族\n`);
  for (const f of out) {
    console.log(`■ 家族${f.familyKey}  呼び名「${f.greeting}」  LINE登録名: ${f.lineNames.join(' / ') || '(未取込)'}`);
    console.log(`  照合する名前: ${f.childNames.join('、')}  来館${f.checkins}回・最終${f.lastCheckin}`);
  }
  if (out[0]) console.log(`\n--- 本文(1件目の例) ---\n${out[0].message}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
