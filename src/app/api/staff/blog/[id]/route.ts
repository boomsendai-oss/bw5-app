import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
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

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const row = await getOne(`SELECT * FROM blog_posts WHERE id = ?`, [numId]);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ post: row });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of ALLOWED) {
    if (k in body) {
      sets.push(`${k} = ?`);
      vals.push((body as Record<string, unknown>)[k]);
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields' }, { status: 400 });
  // 「公開する」にチェックを入れたのに公開日時が空のままだと、HP側の公開判定
  // (published_at <= now) を永遠に通らず、承認したつもりで出ない事故になる。
  // 公開ONで日時未指定なら今の時刻を入れる(既に入っていればそれを尊重)。
  const publishing = Number((body as Record<string, unknown>).is_published) === 1;
  const noDate = !('published_at' in body) || !(body as Record<string, unknown>).published_at;
  if (publishing && noDate) {
    const idx = sets.indexOf('published_at = ?');
    if (idx >= 0) {
      sets.splice(idx, 1);
      vals.splice(idx, 1);
    }
    sets.push(`published_at = COALESCE(published_at, CURRENT_TIMESTAMP)`);
  }
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  vals.push(numId);
  try {
    await execute(`UPDATE blog_posts SET ${sets.join(', ')} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await execute(`DELETE FROM blog_posts WHERE id = ?`, [numId]);
  return NextResponse.json({ ok: true });
}
