// ストーリー自動投稿の「その日だけの指示」API (TARO 2026-08-03)。
//   GET  … その日に指定できる素材の候補一覧(埋め草キュー / 曜日ライブラリ / アップロード済み)
//   POST … {date, action:'skip'|'pin'|'clear', mediaPath?, mediaType?, note?}
//   PUT  … スマホから素材をアップロード(multipart)。DBに保存し /api/story-media/{id} で配信する。
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { execute, getAll } from '@/lib/db';
import { isIsoDate, nowUtcIso, todayJst } from '@/lib/dateJst';
import { setDayPlan, clearDayPlan, getDayPlan } from '@/lib/storyDayPlan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_UPLOAD = 8 * 1024 * 1024; // 8MB。ストーリー画像は数百KB、短い動画で数MB
const ALLOWED_MIME: Record<string, 'image' | 'video'> = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/quicktime': 'video',
};

type Candidate = {
  group: '埋め草' | 'ライブラリ' | 'アップロード';
  label: string;
  mediaPath: string;
  mediaType: 'image' | 'video';
};

export const GET = withAuth(async (req: NextRequest) => {
  const origin = new URL(req.url).origin;
  const candidates: Candidate[] = [];

  const queue = await getAll(
    "SELECT id, media_path, media_type, title FROM story_queue WHERE status IN ('pending','approved') ORDER BY id"
  ).catch(() => []);
  for (const q of queue) {
    candidates.push({
      group: '埋め草',
      label: String(q.title || q.media_path),
      mediaPath: String(q.media_path),
      mediaType: q.media_type === 'video' ? 'video' : 'image',
    });
  }

  // 曜日ライブラリ(台帳に載っている素材)。ファイル一覧はVercel上でfs列挙できないのでmanifest経由。
  try {
    const res = await fetch(`${origin}/stories/library/manifest.json`, { cache: 'no-store' });
    if (res.ok) {
      const manifest = (await res.json()) as { entries?: Array<{ file: string }> };
      for (const e of manifest.entries ?? []) {
        candidates.push({
          group: 'ライブラリ',
          label: e.file,
          mediaPath: `/stories/library/${e.file}`,
          mediaType: e.file.toLowerCase().endsWith('.mp4') ? 'video' : 'image',
        });
      }
    }
  } catch {
    // manifestが読めなくても候補が減るだけ
  }

  const uploads = await getAll(
    'SELECT id, filename, media_type, created_at FROM story_upload ORDER BY id DESC LIMIT 50'
  ).catch(() => []);
  for (const u of uploads) {
    candidates.push({
      group: 'アップロード',
      label: `${u.filename || `素材#${u.id}`}（${String(u.created_at).slice(0, 10)}）`,
      mediaPath: `/api/story-media/${u.id}`,
      mediaType: u.media_type === 'video' ? 'video' : 'image',
    });
  }

  return NextResponse.json({ candidates });
});

export const POST = withAuth(async (req: NextRequest) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const date = String(body.date ?? '');
  if (!isIsoDate(date)) return NextResponse.json({ error: '日付の形式が不正です' }, { status: 400 });
  // 過去日をいじっても投稿は変わらない(cronは当日しか見ない)ので誤操作として弾く
  if (date < todayJst()) return NextResponse.json({ error: '過去の日付は変更できません' }, { status: 400 });

  const action = String(body.action ?? '');
  if (action === 'clear') {
    await clearDayPlan(date);
    return NextResponse.json({ ok: true, plan: null });
  }
  if (action === 'skip') {
    await setDayPlan(date, 'skip', null, null, body.note ? String(body.note) : null);
    return NextResponse.json({ ok: true, plan: await getDayPlan(date) });
  }
  if (action === 'pin') {
    const mediaPath = String(body.mediaPath ?? '').trim();
    // サイト内の相対パスのみ許可(外部URLを投げ込めないようにする)
    if (!/^\/(stories|api\/story-media)\//.test(mediaPath)) {
      return NextResponse.json({ error: '素材のパスが不正です' }, { status: 400 });
    }
    const mediaType = body.mediaType === 'video' ? 'video' : 'image';
    await setDayPlan(date, 'pin', mediaPath, mediaType, body.note ? String(body.note) : null);
    return NextResponse.json({ ok: true, plan: await getDayPlan(date) });
  }
  return NextResponse.json({ error: 'action は skip / pin / clear のいずれかです' }, { status: 400 });
});

export const PUT = withAuth(async (req: NextRequest) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 });
  if (file.size > MAX_UPLOAD) {
    return NextResponse.json({ error: `ファイルが大きすぎます(${Math.round(file.size / 1024 / 1024)}MB / 上限8MB)` }, { status: 400 });
  }
  const mediaType = ALLOWED_MIME[file.type];
  if (!mediaType) {
    return NextResponse.json({ error: `対応していない形式です(${file.type || '不明'})` }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const res = await execute(
    'INSERT INTO story_upload (filename, mime, media_type, size, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [file.name || null, file.type, mediaType, bytes.byteLength, bytes, nowUtcIso()]
  );
  const id = String(res.lastInsertRowid);
  return NextResponse.json({ ok: true, mediaPath: `/api/story-media/${id}`, mediaType, id });
});
