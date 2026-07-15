import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';
import { configured, connectionStatus } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const status = await connectionStatus();
  const logs = await getAll(
    'SELECT date, weekday, video_path, status, ig_media_id, error, created_at FROM story_post_log ORDER BY id DESC LIMIT 14'
  );

  return NextResponse.json({
    envConfigured: configured(),
    ...status,
    logs,
  });
}
