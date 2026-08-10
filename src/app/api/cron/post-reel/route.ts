import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import { configured as igConfigured, publishReel, parseCollaborators, refreshTokenIfStale } from '@/lib/instagram';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// リール自動投稿 (毎日 JST 19:00 に GitHub Actions cron から叩かれる)。
// 19-20時 = boom_sendaiフォロワーのオンライン活動ピーク帯(実測)。
// reel_queue から期限が来た scheduled を1件だけ公開する(複数期限切れでも1回1件=連投防止。
// リトライcronが後続を拾う)。
// 冪等性: UPDATE ... WHERE status='scheduled' のclaimで多重発火・リトライから保護。
// 認証: post-story と同パターン (Bearer CRON_SECRET / x-cron-secret)
// Cloudflare Workers(boom-cron)からの起動用に、第2の鍵 CRON_SECRET_CF も受け付ける。
// 既存の CRON_SECRET は GitHub Actions の全ワークフローが使っており、値が読み出せない
// (Vercelは[SENSITIVE]としてマスクする / GH Secretsは書き込み専用)ため、
// 鍵を回さずに増やす方式にした(2026-08-03)。どちらか一方が一致すれば通す。
function cronAuthorized(req: NextRequest): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.CRON_SECRET_CF].filter(Boolean) as string[];
  if (secrets.length === 0) return false;
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!igConfigured()) {
    return NextResponse.json({ ok: true, configured: false, note: 'Instagram連携env未設定のためスキップ' });
  }

  const now = nowUtcIso();
  const due = await getOne(
    `SELECT id, title, video_path, cover_path, caption, collaborators FROM reel_queue
     WHERE status = 'scheduled' AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 1`,
    [now]
  );
  if (!due) {
    return NextResponse.json({ ok: true, posted: false, note: '期限が来たリールなし' });
  }

  // claim (多重発火ガード): scheduled のままの時だけ posting に遷移できる
  const claim = await execute(
    `UPDATE reel_queue SET status = 'posting', updated_at = ? WHERE id = ? AND status = 'scheduled'`,
    [now, due.id]
  );
  if ((claim.rowsAffected ?? 0) === 0) {
    return NextResponse.json({ ok: true, posted: false, note: `#${due.id} は別プロセスが処理中` });
  }

  try {
    await refreshTokenIfStale();
  } catch {
    // トークン更新失敗は公開試行を止めない(まだ有効な可能性)
  }

  const origin = new URL(req.url).origin;
  // 素材URLは必ずパーセントエンコードして渡す(2026-07-28障害: ファイル名に日本語が入ると
  // Instagram側のフェッチが失敗し status_code=ERROR になり投稿されなかった)。
  const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
  const videoUrl = `${origin}${encodePath(String(due.video_path))}`;
  const coverUrl = due.cover_path ? `${origin}${encodePath(String(due.cover_path))}` : undefined;

  try {
    const collaborators = parseCollaborators(due.collaborators as string | null);
    const { mediaId, permalink, collaboratorsApplied, collaboratorsDropped } =
      await publishReel(videoUrl, String(due.caption), coverUrl, collaborators);
    await execute(
      `UPDATE reel_queue SET status = 'posted', ig_media_id = ?, permalink = ?, posted_at = ?, updated_at = ? WHERE id = ?`,
      [mediaId, permalink ?? null, nowUtcIso(), nowUtcIso(), due.id]
    );
    // 共同投稿だけ落ちた場合はリールは出ている。黙って消えると気づけないのでTAROへ知らせる。
    if (collaboratorsDropped.length > 0) {
      await notifyTaro({
        subject: 'リールの共同投稿だけ付きませんでした',
        body:
          `「${due.title}」は投稿できましたが、共同投稿の指定 [${collaboratorsDropped.join(', ')}] は反映されませんでした。\n` +
          '相手が非公開アカウント、またはユーザー名が変わっている可能性があります。\n' +
          (permalink ?? ''),
      }).catch(() => {});
    }
    return NextResponse.json({
      ok: true, posted: true, id: due.id, mediaId, permalink,
      collaborators: collaboratorsApplied, collaboratorsDropped,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await execute(
      `UPDATE reel_queue SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
      [msg.slice(0, 500), nowUtcIso(), due.id]
    );
    return NextResponse.json({ ok: false, posted: false, id: due.id, error: msg }, { status: 500 });
  }
}
