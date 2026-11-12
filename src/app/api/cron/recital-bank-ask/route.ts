// POST/GET /api/cron/recital-bank-ask?slot=HH:MM — BW6 発表会（段階1）の TARO への入金のスクショの声かけ。
// Cloudflare Worker(boom-cron)が夜 19:00・20:30 JST（設定 bank_ask_at の時刻）に叩く。
//
// ⚠️ proxy の matcher 外(セッション認証なし)。理由: cron から叩く入口なので、
// 他の cron と同じく CRON_SECRET(GitHub Actions) / CRON_SECRET_CF(Cloudflare Worker) を
// Authorization: Bearer か x-cron-secret で受け取り、一致しなければ 401 で弾く(下の cronAuthorized)。鍵の設定が無ければ全部 401。
//
// 出すかどうかは recitalAsk の shouldAskTaro が決める（「払う」が開いている・振込先の文がある・休みの外・総点検の日より前・
// 今日の合った束が無い）。開始日などの事実は recitalBankDb の getBankAskFacts（ここで計算し直さない）。
// 先に設定だけで決め（okBatchToday=false で）、出す日の時だけ事実を読んで、本当の okBatchToday で決め直す
// （出さない夜に listReviewRows の書きもどしを走らせないため）。1つの発表会が落ちても、ほかは続ける。
// 試しの発表会（is_test=1）には出さない（SQL とコードの両方で外す）。知らせの相手は TARO だけ。
// 返す物とログに、名前・金額を入れない（返すのは数だけ）。
import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { cronAuthorized } from '@/lib/inboxAlert/cronAuth';
import { notifyTaro } from '@/lib/notify';
import { payGate } from '@/lib/recital';
import { BANK_URL, MORNING_SLOT, buildAskMessage, nowJstOf, shouldAskTaro } from '@/lib/recitalAsk';
import { getBankAskFacts } from '@/lib/recitalBankDb';
import { getRecitalSettings } from '@/lib/recitalDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SLOT_RE = /^\d{2}:\d{2}$/;

async function handle(req: NextRequest) {
  if (!cronAuthorized(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const slot = req.nextUrl.searchParams.get('slot') ?? '';
  // 朝8時は休み明けの声かけ（recital-morning）の時刻。夜の入口では受けない
  if (!SLOT_RE.test(slot) || slot === MORNING_SLOT) {
    return NextResponse.json({ error: 'bad_slot' }, { status: 400 });
  }
  const now = new Date();
  const nowJst = nowJstOf(now);
  const rows = await getAll('SELECT event_key, is_test FROM recital_events WHERE is_test = 0', []);
  let asked = 0;
  for (const r of rows.filter((x) => Number(x.is_test) === 0)) {
    const eventKey = String(r.event_key);
    try {
      const s = await getRecitalSettings(eventKey);
      const gate = payGate(s, now.getTime());
      if (!shouldAskTaro({ nowJst, slot, s, gate, okBatchToday: false })) continue;
      const f = await getBankAskFacts(eventKey, now);
      if (!shouldAskTaro({ nowJst, slot, s, gate, okBatchToday: f.okBatchToday })) continue;
      await notifyTaro({
        ...buildAskMessage({ startDate: f.startDate, lastShotOn: f.lastShotOn, reviewCount: f.reviewCount, url: BANK_URL }),
        subjectPrefix: '【BOOM】BW6',
      });
      asked++;
    } catch (e) {
      // ほかの発表会は続ける。エラーの文は中身を含むことがあるので、recital_ の決まった言葉のほかは出さない
      console.error(`[recital-bank-ask] 声かけできませんでした event=${eventKey}`, e instanceof Error && e.message.startsWith('recital_') ? e.message : 'error');
    }
  }
  return NextResponse.json({ ok: true, asked });
}

export const POST = handle;
export const GET = handle;
