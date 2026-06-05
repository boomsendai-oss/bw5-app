import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED = [
  'slug',
  'title',
  'excerpt',
  'content_markdown',
  'keywords',
  'cover_image_url',
  'author',
  'category',
  'is_published',
  'published_at',
] as const;

// GET /api/staff/blog → 管理用：全件 (公開・下書き両方)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const posts = await getAll(
    `SELECT id, slug, title, excerpt, keywords, cover_image_url, author, category,
            is_published, auto_generated, published_at, created_at, updated_at
       FROM blog_posts
      ORDER BY COALESCE(published_at, created_at) DESC, id DESC`
  );
  return NextResponse.json({ posts });
}

// POST /api/staff/blog → 新規作成
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.slug || !body.title) {
    return NextResponse.json({ error: 'slug と title は必須です' }, { status: 400 });
  }
  const cols = ALLOWED.filter(k => k in body);
  if (!cols.includes('slug')) cols.push('slug');
  if (!cols.includes('title')) cols.push('title');
  const vals = cols.map(k => (body as Record<string, unknown>)[k] ?? null);
  try {
    const result = await execute(
      `INSERT INTO blog_posts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      vals as unknown[]
    );
    return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
