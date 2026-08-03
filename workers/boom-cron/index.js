// BOOM 自動投稿トリガー。毎分起動し、JSTの時刻表に一致する仕事だけアプリのcron APIを叩く。
// 秘密(CRON_SECRET_CF)は wrangler secret で登録済み。アプリ側は x-cron-secret ヘッダで認可する。
//
// 冪等性はアプリ側が担保している(story_post_claim / reel_queue のatomic claim)ので、
// GitHub Actions側の遅延発火と重なっても二重投稿にはならない。

const JOBS = [
  // ストーリー: 毎朝8時ちょうどに出したい。publishに30〜60秒かかるので07:59に着火する。
  { at: '07:59', path: '/api/cron/post-story', label: 'story' },
  { at: '08:15', path: '/api/cron/post-story', label: 'story-retry' },
  // 昼と夜の枠(TARO 2026-08-03: 1日2〜3本を時間をずらして出す)。
  // 枠が設定されていない日は「次の枠は…」で何もせず返るだけなので、毎日叩いても無害。
  { at: '12:30', path: '/api/cron/post-story', label: 'story-noon' },
  { at: '12:45', path: '/api/cron/post-story', label: 'story-noon-retry' },
  { at: '21:00', path: '/api/cron/post-story', label: 'story-night' },
  { at: '21:15', path: '/api/cron/post-story', label: 'story-night-retry' },
  // リール: 19:00枠(クラス)と20:00枠(発表会)。予約時刻を過ぎたものを投稿する実装なので定刻に叩く。
  { at: '19:00', path: '/api/cron/post-reel', label: 'reel-19' },
  { at: '19:12', path: '/api/cron/post-reel', label: 'reel-19-retry' },
  { at: '20:00', path: '/api/cron/post-reel', label: 'reel-20' },
  { at: '20:12', path: '/api/cron/post-reel', label: 'reel-20-retry' },
];

/** UTCのepochミリ秒 → JSTの 'HH:MM' */
function jstHhmm(epochMs) {
  return new Date(epochMs + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

async function runJob(job, env) {
  const url = `${env.APP_ORIGIN}${job.path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-cron-secret': env.CRON_SECRET_CF, 'content-type': 'application/json' },
    });
    const body = await res.text();
    console.log(`[${job.label}] ${res.status} ${body.slice(0, 300)}`);
  } catch (e) {
    console.error(`[${job.label}] 失敗: ${e}`);
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
  async fetch(_req, env) {
    return Response.json({
      now_jst: jstHhmm(Date.now()),
      app: env.APP_ORIGIN,
      jobs: JOBS.map((j) => `${j.at} ${j.label}`),
    });
  },
};
