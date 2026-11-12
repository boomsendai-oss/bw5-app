// POST/GET /api/cron/recital-morning[?retry=1] — BW6 発表会（段階1）の朝8時の「ア」。
// Cloudflare Worker(boom-cron)が毎朝 08:00 JST に叩く。08:05・08:10 は ?retry=1 の追い打ち（待ちが20通をこえた朝のため）。
//
// ⚠️ proxy の matcher 外(セッション認証なし)。理由: cron から叩く入口なので、
// 他の cron と同じく CRON_SECRET(GitHub Actions) / CRON_SECRET_CF(Cloudflare Worker) を
// Authorization: Bearer か x-cron-secret で受け取り、一致しなければ 401 で弾く(下の cronAuthorized)。鍵の設定が無ければ全部 401。
//
// やること：
//  1. 全部の発表会（試しの発表会も）で、夜に待たせた振込の確認メールを出す（flushWaitingMails。1回20通まで。発表会ごとに try/catch）。
//  2. retry が無い時だけ、試しでない発表会で、休み明けの朝（bank_rest_to の次の日）なら TARO に1回声をかける。
// 毎朝の見回り（①・イ・②）は後の計画でここに足す。
// 返す物とログに、名前・金額・宛先を入れない（返すのは数だけ）。
import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';
import { notifyTaro } from '@/lib/notify';
import { payGate } from '@/lib/recital';
import { MORNING_SLOT, buildAskMessage, nowJstOf, shouldAskTaro } from '@/lib/recitalAsk';
import { getBankAskFacts } from '@/lib/recitalBankDb';
import { getRecitalSettings } from '@/lib/recitalDb';
import { flushWaitingMails } from '@/lib/recitalMail';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** 声かけの文の url（休み明けの文には出ないが、buildAskMessage の形に合わせて渡す） */
const BANK_URL = 'https://bw5-app.vercel.app/staff/bw6/bank';

async function handle(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const retry = req.nextUrl.searchParams.get('retry') === '1';
  const now = new Date();
  const rows = await getAll('SELECT event_key, is_test FROM recital_events', []);

  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const eventKey = String(r.event_key);
    try {
      const res = await flushWaitingMails(eventKey, now);
      sent += res.sent;
      failed += res.failed;
    } catch (e) {
      // ほかの発表会は続ける。メールの応答文は宛先を含むことがあるので、recital_ の決まった言葉のほかは出さない
      console.error(`[recital-morning] 待ちのメールを出せませんでした event=${eventKey}`, e instanceof Error && e.message.startsWith('recital_') ? e.message : 'error');
    }
  }

  let asked = 0;
  if (!retry) {
    const nowJst = nowJstOf(now);
    for (const r of rows.filter((x) => Number(x.is_test) === 0)) {
      const eventKey = String(r.event_key);
      const s = await getRecitalSettings(eventKey);
      if (!shouldAskTaro({ nowJst, slot: MORNING_SLOT, s, gate: payGate(s, now.getTime()), okBatchToday: false })) continue;
      const f = await getBankAskFacts(eventKey, now);
      await notifyTaro({
        ...buildAskMessage({ startDate: f.startDate, lastShotOn: f.lastShotOn, reviewCount: f.reviewCount, url: BANK_URL, afterRest: true }),
        subjectPrefix: '【BOOM】BW6',
      });
      asked++;
    }
  }
  return NextResponse.json({ ok: true, sent, failed, asked });
}

export const POST = handle;
export const GET = handle;
