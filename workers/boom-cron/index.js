// BOOM 自動投稿トリガー。毎分起動し、JSTの時刻表に一致する仕事だけアプリのcron APIを叩く。
// 秘密(CRON_SECRET_CF)は wrangler secret で登録済み。アプリ側は x-cron-secret ヘッダで認可する。
//
// なぜCloudflareが一次トリガーなのか(2026-08-03導入 / 2026-09-10に時刻表を総点検):
//   GitHub Actionsのscheduleは実測で +1.5〜5時間 遅れる(定期WFが19本あり後回しにされる)。
//   Cloudflare Cron Triggersは分単位で正確なので、発火役はこちらに寄せる。
//
// 冪等性はアプリ側が担保している(story_post_claim / reel_queue のatomic claim)ので、
// GitHub Actions側の遅延発火と重なっても二重投稿にはならない。

const JOBS = [
  // ── ストーリー枠(TARO確定の5枠 / 各枠に+3分の予備発火を1本)。
  // post-story は「slot_time <= 現在のJST時刻 でまだ出していない枠」を出す期限方式なので、
  // 枠の時刻ちょうど(以降)に着火する必要がある。07:59のような前倒しだと 08:00 の枠が
  // 「まだ予定時刻前」と判定され取りこぼすため、必ず定刻に撃つ。
  { at: '08:00', path: '/api/cron/post-story', label: 'story-08' },
  { at: '08:03', path: '/api/cron/post-story', label: 'story-08-retry' },
  { at: '12:00', path: '/api/cron/post-story', label: 'story-1200' },
  { at: '12:03', path: '/api/cron/post-story', label: 'story-1200-retry' },
  { at: '12:30', path: '/api/cron/post-story', label: 'story-1230' },
  { at: '12:33', path: '/api/cron/post-story', label: 'story-1230-retry' },
  // 18:30枠は2026-08-21にアプリ側(story_day_slot)へ追加されたのに、この時刻表に入れ忘れていた。
  // そのため 9/9 の18:30枠(battle_0913.jpg)が次の21:00枠まで待たされ、watchdogが
  // 「予定時刻を1時間41分過ぎても未投稿」の要対応メールを出した。その穴を埋めたもの。
  { at: '18:30', path: '/api/cron/post-story', label: 'story-1830' },
  { at: '18:33', path: '/api/cron/post-story', label: 'story-1830-retry' },
  { at: '21:00', path: '/api/cron/post-story', label: 'story-21' },
  { at: '21:03', path: '/api/cron/post-story', label: 'story-21-retry' },

  // ── リール: 19:00枠(クラス)と20:00枠(発表会)。予約時刻を過ぎたものを投稿する実装なので定刻に叩く。
  { at: '19:00', path: '/api/cron/post-reel', label: 'reel-19' },
  { at: '19:12', path: '/api/cron/post-reel', label: 'reel-19-retry' },
  { at: '20:00', path: '/api/cron/post-reel', label: 'reel-20' },
  { at: '20:12', path: '/api/cron/post-reel', label: 'reel-20-retry' },

  // ── 見張り役(2026-09-10に vercel.json のcron枠から移設。Vercel Hobbyは2枠しか持てず、
  // しかも分精度の保証がないため)。朝=ストーリー中心 / 夜=リール中心の2回運用。
  // GETのみのエンドポイントなので method を明示する。
  { at: '09:10', path: '/api/cron/story-watchdog', label: 'watchdog-morning', method: 'GET' },
  { at: '19:40', path: '/api/cron/story-watchdog', label: 'watchdog-evening', method: 'GET' },

  // ── 七ヶ浜レッスン会場の自動予約(WS AQ)。予約サイトの解禁=深夜0:00(応当日)。
  // GitHub Actionsのscheduleは深夜に約3時間遅れる(2026-09-11実測: 23:40設定→02:35発火)ため、
  // ここから workflow_dispatch で23:40に起動し、スクリプト側が0:15まで20秒おきに粘る。
  // 認証は GH_DISPATCH_TOKEN(wrangler secret)。二重発火は workflow の concurrency で直列化される。
  { at: '23:40', kind: 'gh-dispatch', repo: 'boomsendai-oss/shichigahama-yoyaku', workflow: 'reserve.yml', label: 'shichigahama-2340' },
  { at: '23:43', kind: 'gh-dispatch', repo: 'boomsendai-oss/shichigahama-yoyaku', workflow: 'reserve.yml', label: 'shichigahama-2343' },
];

/** UTCのepochミリ秒 → JSTの 'HH:MM' */
function jstHhmm(epochMs) {
  return new Date(epochMs + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

async function runJob(job, env) {
  try {
    if (job.kind === 'gh-dispatch') {
      // GitHub Actions の workflow_dispatch。inputs は渡さない(repo変数 DRY_RUN を効かせる)。
      const url = `https://api.github.com/repos/${job.repo}/actions/workflows/${job.workflow}/dispatches`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'boom-cron',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      });
      const body = await res.text();
      console.log(`[${job.label}] gh-dispatch ${res.status} ${body.slice(0, 200)}`);
      return { status: res.status, body: body.slice(0, 500) };
    }
    const url = `${env.APP_ORIGIN}${job.path}`;
    const method = job.method ?? 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'x-cron-secret': env.CRON_SECRET_CF, 'content-type': 'application/json' },
    });
    const body = await res.text();
    console.log(`[${job.label}] ${method} ${res.status} ${body.slice(0, 300)}`);
    return { status: res.status, body: body.slice(0, 500) };
  } catch (e) {
    console.error(`[${job.label}] 失敗: ${e}`);
    return { status: 0, body: String(e) };
  }
}

export default {
  async scheduled(event, env, ctx) {
    const hhmm = jstHhmm(event.scheduledTime);
    const due = JOBS.filter((j) => j.at === hhmm);
    if (due.length === 0) return;
    ctx.waitUntil(Promise.all(due.map((j) => runJob(j, env))));
  },

  // 動作確認用。秘密は出さず、時刻表と現在のJST時刻だけ返す。
  // ?run=<label> を付けるとその仕事を手で1回だけ撃てる(導入時の実地検証用)。
  // ただし投稿を起こせる操作なので、アプリと同じ鍵を x-cron-secret で出せた時だけ許す
  // (workers.devのURLは推測可能なため、無認証で置くと第三者が投稿を叩ける)。
  async fetch(req, env) {
    const label = new URL(req.url).searchParams.get('run');
    if (label) {
      if (req.headers.get('x-cron-secret') !== env.CRON_SECRET_CF) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const job = JOBS.find((j) => j.label === label);
      if (!job) return Response.json({ error: `unknown job: ${label}` }, { status: 404 });
      const r = await runJob(job, env);
      return Response.json({ ran: label, ...r });
    }
    return Response.json({
      now_jst: jstHhmm(Date.now()),
      app: env.APP_ORIGIN,
      jobs: JOBS.map((j) => `${j.at} ${j.label}`),
    });
  },
};
