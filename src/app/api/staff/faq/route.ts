import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// WS O: FAQ AIチャットボット「BOOMくんに質問」の正本テーブルに対するスタッフCRUD。
// 認証は既存eventAuthに統一。is_public=1の行のみ /api/public/knowledge (buildKnowledge) 経由で公開される。

/** id を正の整数として検証。不正 (欠落/非数値/0以下/小数) なら null。 */
function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 文字数上限 (POST/PATCH共通): ボットのプロンプトに直接入るため事故的な巨大テキストを防ぐ
const MAX_LEN = { category: 50, question: 200, answer: 2000 } as const;
const TEXT_FIELDS = ['category', 'question', 'answer'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

/** trim済みテキストの共通検証。OKなら null、NGなら400用エラーメッセージ。 */
function validateText(field: TextField, value: string): string | null {
  if (!value) return `${field} must not be empty`;
  if (value.length > MAX_LEN[field]) return `${field} too long (max ${MAX_LEN[field]})`;
  return null;
}

// GET /api/staff/faq → 管理用: 全件(下書き含む)。カテゴリ→表示順
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const entries = await getAll(
    `SELECT * FROM faq_entries ORDER BY category, sort_order, id`
  );
  return NextResponse.json({ entries });
}

// POST /api/staff/faq → 新規作成 {category, question, answer, is_public?, sort_order?}
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));

  if (!body.category || !String(body.category).trim() ||
      !body.question || !String(body.question).trim() ||
      !body.answer || !String(body.answer).trim()) {
    return NextResponse.json({ error: 'category, question, answer required' }, { status: 400 });
  }
  const texts: Record<TextField, string> = {
    category: String(body.category).trim(),
    question: String(body.question).trim(),
    answer: String(body.answer).trim(),
  };
  for (const f of TEXT_FIELDS) {
    const err = validateText(f, texts[f]);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  const { category, question, answer } = texts;
  const isPublic = body.is_public ? 1 : 0;
  const sortOrderNum = Number(body.sort_order ?? 0);
  const sortOrder = Number.isFinite(sortOrderNum) ? sortOrderNum : 0;

  try {
    const result = await execute(
      `INSERT INTO faq_entries (category, question, answer, is_public, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [category, question, answer, isPublic, sortOrder]
    );
    return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// PATCH /api/staff/faq → 更新 {id, category?, question?, answer?, is_public?, sort_order?}
export async function PATCH(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));

  const id = parseId(body.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const existing = await getOne(`SELECT id FROM faq_entries WHERE id = ?`, [id]);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // 動的SET句の列名はこのリストの固定リテラルのみ (リクエスト由来の文字列を列名に使わない)
  const sets: string[] = [];
  const vals: unknown[] = [];

  // 文字列フィールド: キー未指定はスキップ可だが、指定されてtrim後空なら黙殺せず400を返す
  for (const f of TEXT_FIELDS) {
    if (body[f] === undefined) continue;
    const v = String(body[f] ?? '').trim();
    const err = validateText(f, v);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    sets.push(`${f} = ?`);
    vals.push(v);
  }
  // 公開反映は /api/public/knowledge のTTLキャッシュ(600s)+CDN(600s)で最大20分遅延(スタッフ画面の説明文と整合)
  if (body.is_public !== undefined) {
    sets.push('is_public = ?');
    vals.push(body.is_public ? 1 : 0);
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (Number.isFinite(n)) {
      sets.push('sort_order = ?');
      vals.push(n);
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'no fields' }, { status: 400 });
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);

  try {
    await execute(`UPDATE faq_entries SET ${sets.join(', ')} WHERE id = ?`, vals);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// DELETE /api/staff/faq?id=X → 物理削除
export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const id = parseId(url.searchParams.get('id'));
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await execute(`DELETE FROM faq_entries WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true });
}
