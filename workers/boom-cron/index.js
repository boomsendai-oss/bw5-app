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
  // BF6のエントリー締切(9/24 24:00)直後に「締め切りました」を出すための臨時枠(2026-09-24)。
  // 平時は0時台に枠を置かないので、この2本は9/25以降は空振りするだけ(害はない)。
  { at: '00:05', path: '/api/cron/post-story', label: 'story-0005' },
  { at: '00:08', path: '/api/cron/post-story', label: 'story-0005-retry' },
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
  // デッドマンスイッチ: 00:40に「今夜の予約runが成功したか」をGitHubに問い合わせ、
  // 走っていない/失敗していたら🚨メール(件名に「失敗」=Gmail緊急ラベル)＋1回だけ再起動する。
  // 鍵: GH_DISPATCH_TOKEN(Actions R/W) / VENUE_NOTIFY_SECRET・NOTIFY_URL(bw5-appの通知API)
  { at: '00:40', kind: 'deadman', repo: 'boomsendai-oss/shichigahama-yoyaku', workflow: 'reserve.yml', label: 'shichigahama-deadman' },

  // ── 受信箱アラート(2026-09-11)。5分おきに新着メールを判定し、毎朝8:00にまとめを送る。
  // 8:10はまとめを送り損ねた時の予備(JSTの同じ日に送信済みならアプリ側で何もしない)。
  { every: 5, path: '/api/cron/inbox-alert', label: 'inbox-alert' },
  { at: '08:00', path: '/api/cron/inbox-alert-digest', label: 'inbox-digest' },
  { at: '08:10', path: '/api/cron/inbox-alert-digest', label: 'inbox-digest-retry' },

  // ── メール送信の健康診断(2026-10-20)。Gmail SMTPにログインできるかだけ確かめ、ダメならPushoverで知らせる。
  // 2026-10-16にGoogleのパスワード変更でアプリパスワードが無効になり、アプリのメールが全部止まったのに
  // 障害通知もメール頼みで誰も気づけなかったための再発防止。メールは送らないので何度撃っても害はない。
  { at: '07:30', path: '/api/cron/mail-health', label: 'mail-health' },

  // ── メロジョイ在庫見張り(2026-10-24 TAROの依頼)。クリパ景品用のスクイーズ玩具(公式ストア)。
  // ストアは毎日12:00に在庫更新・入荷は数秒〜数分で売り切れるので、11:56〜12:30は毎分見る。
  // 遅れて入る入荷も拾うため12:45と13:30に1回ずつ。入荷したらアプリがPushover(高優先度)でTAROのiPhoneへ知らせる。
  // ⚠️ 読むだけ(公開JSONを1回GETするだけ)。カート投入・購入は一切しない。1日37回なのでストアにも軽い。
  { from: '11:56', to: '12:30', every: 1, path: '/api/cron/mellojoy-watch', label: 'mellojoy-noon' },
  { at: '12:45', path: '/api/cron/mellojoy-watch', label: 'mellojoy-1245' },
  { at: '13:30', path: '/api/cron/mellojoy-watch', label: 'mellojoy-1330' },
];

/**
 * この分に撃つ仕事か。
 * - at: 'HH:MM' … その時刻ちょうど
 * - every: N … 毎時 N分おき(分が N で割り切れる時)
 * - from/to + every … JSTの同じ日の from〜to(両端を含む)の間だけ every 分おき(2026-10-24 メロジョイ見張りで追加)。
 *   'HH:MM' は文字列のまま大小比較できる。日をまたぐ窓(23:50〜00:10 等)は未対応。
 */
function isDue(job, hhmm) {
  if (job.at) return job.at === hhmm;
  if (!job.every) return false;
  if (job.from && hhmm < job.from) return false;
  if (job.to && hhmm > job.to) return false;
  return Number(hhmm.slice(3)) % job.every === 0;
}

/** 動作確認画面(GET /)用の1行 */
function describeJob(j) {
  if (j.at) return `${j.at} ${j.label}`;
  const win = j.from || j.to ? `${j.from ?? '00:00'}-${j.to ?? '23:59'} ` : '';
  return `${win}every ${j.every}m ${j.label}`;
}

/** UTCのepochミリ秒 → JSTの 'HH:MM' */
function jstHhmm(epochMs) {
  return new Date(epochMs + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

async function runJob(job, env, opts = {}) {
  try {
    if (job.kind === 'deadman') {
      return await deadman(job, env, opts);
    }
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

function ghHeaders(env) {
  return {
    authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'boom-cron',
    'content-type': 'application/json',
  };
}

/** 今夜(23:25 JST以降)の reserve.yml が成功しているか確認し、ダメなら通知+再起動 */
async function deadman(job, env, opts = {}) {
  const now = Date.now();
  const jstToday = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 23:25 JST = 当日0:40の75分前。test時は「今」以降=必ず0件にして通知経路を試す
  const since = new Date(opts.test ? now : now - 75 * 60 * 1000).toISOString();
  const url = `https://api.github.com/repos/${job.repo}/actions/workflows/${job.workflow}/runs?per_page=30&created=${encodeURIComponent('>=' + since)}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) {
    return await deadmanAlert(env, jstToday, `GitHubに問い合わせできませんでした（HTTP ${res.status}）。トークン期限切れの可能性があります。`, opts);
  }
  const runs = ((await res.json()).workflow_runs || []);
  const okRun = runs.find((r) => r.conclusion === 'success');
  const running = runs.find((r) => r.status !== 'completed');
  console.log(`[deadman] runs=${runs.length} ok=${!!okRun} running=${!!running}`);
  if (okRun || running) return { status: 200, body: `deadman ok: runs=${runs.length}` };
  const failed = runs.find((r) => r.conclusion && r.conclusion !== 'success');
  const reason = failed
    ? `今夜の自動予約が「${failed.conclusion}」で終了しています。\n記録: ${failed.html_url}`
    : '今夜23:40に起動するはずの自動予約が、GitHub上で1回も動いていません。';
  // 復旧: 1回だけ再起動(0時を過ぎていても毎時巡回で空き枠は拾える)
  let redispatch = 'テストのため再起動はしていません';
  if (!opts.test) {
    const d = await fetch(`https://api.github.com/repos/${job.repo}/actions/workflows/${job.workflow}/dispatches`, {
      method: 'POST', headers: ghHeaders(env), body: JSON.stringify({ ref: 'main' }),
    });
    redispatch = d.status === 204 ? '自動で1回再起動しました（取れれば「確保」メールが届きます）' : `再起動にも失敗しました（HTTP ${d.status}）`;
  }
  return await deadmanAlert(env, jstToday, `${reason}\n\n■ 対応\n${redispatch}`, opts);
}

async function deadmanAlert(env, jstToday, detail, opts = {}) {
  const t = opts.test ? '【テスト】' : '';
  const subject = `${t}🚨【予約失敗】七ヶ浜 自動予約が今夜動いていません（${jstToday}）`;
  const body = `${t}🚨 七ヶ浜レッスン会場の自動予約が、今夜正しく動いていません 🚨\n\n` +
    `0時に開いた枠を取れていない可能性があります。\n\n■ 状況\n${detail}\n\n` +
    `■ お願い\n1. 朝に予約サイトの「予約申込一覧」で、2ヶ月後の金曜の予約があるか確認してください\n` +
    `2. 無ければ手動で確保するか、Claude に「七ヶ浜の自動予約が止まった」と伝えてください\n\n` +
    `■ 連絡先\n・七ヶ浜国際村 022-357-5931\n・アクアリーナ 022-357-7890\n・予約サイト https://k3.p-kashikan.jp/town-shichigahama/index.php`;
  const res = await fetch(env.NOTIFY_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.VENUE_NOTIFY_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ date: jstToday, subject, body, dedupe_key: opts.test ? `test:deadman:${now2()}` : `deadman:${jstToday}` }),
  });
  const txt = await res.text();
  console.log(`[deadman] alert ${res.status} ${txt.slice(0, 200)}`);
  return { status: res.status, body: `deadman ALERT sent: ${txt.slice(0, 300)}` };
}

function now2() { return new Date().toISOString().slice(0, 16); }

export default {
  async scheduled(event, env, ctx) {
    const hhmm = jstHhmm(event.scheduledTime);
    const due = JOBS.filter((j) => isDue(j, hhmm));
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
      const r = await runJob(job, env, { test: new URL(req.url).searchParams.get('test') === '1' });
      return Response.json({ ran: label, ...r });
    }
    return Response.json({
      now_jst: jstHhmm(Date.now()),
      app: env.APP_ORIGIN,
      jobs: JOBS.map(describeJob),
    });
  },
};
