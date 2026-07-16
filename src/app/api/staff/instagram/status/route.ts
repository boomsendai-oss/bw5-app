import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';
import { configured, connectionStatus } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const status = await connectionStatus();
  const [logs, queue] = await Promise.all([
    getAll(
      'SELECT date, weekday, video_path, status, ig_media_id, error, created_at FROM story_post_log ORDER BY id DESC LIMIT 14'
    ),
    getAll(
      `SELECT id, media_path, media_type, kind, title, valid_from, valid_until, status, last_posted_at, times_posted
       FROM story_queue
       WHERE status IN ('pending', 'approved')
       ORDER BY status DESC, id ASC` // pending を先に(承認待ちが上)
    ),
  ]);

  return NextResponse.json({
    envConfigured: configured(),
    ...status,
    logs,
    queue,
  });
}
