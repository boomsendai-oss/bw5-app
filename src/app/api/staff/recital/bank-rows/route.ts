// BW6 発表会（段階1）の入金の束の入口（Task 27。決まりの紙 2-17）。
// 呼ぶのは scripts/recital_bank_push.mjs（読む役）。返すのは数字だけ（名義・摘要・世帯の名前・残高は返さない。K146）。
// ⚠️ proxy は cookie の有無しか見ないので withAuth で本検証（規約4.5）。
// 束の行の上限は validateBatchShape（BANK_BATCH_MAX_ROWS）。関数は60秒まで（その場で送るメールは1つの束で10通まで）。
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { validateBatchShape } from '@/lib/recitalBankBatch';
import { ingestBankBatch } from '@/lib/recitalBankDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const IMPORTED_BY_MAX = 40;

export const POST = withAuth(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '本文が JSON ではありません' }, { status: 400 });
  }
  const o = (typeof body === 'object' && body !== null ? body : {}) as { mode?: unknown; imported_by?: unknown; batch?: unknown };
  if (o.mode !== 'dry' && o.mode !== 'commit') return NextResponse.json({ error: 'mode は dry か commit' }, { status: 400 });
  const v = validateBatchShape(o.batch);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const importedBy = typeof o.imported_by === 'string' && o.imported_by.trim() !== '' ? o.imported_by.trim().slice(0, IMPORTED_BY_MAX) : 'chat';
  try {
    const result = await ingestBankBatch(v.batch, o.mode, importedBy);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Error && e.message === 'no_event') return NextResponse.json({ error: 'no_event' }, { status: 404 });
    console.error('[recital] 入金の束を入れられませんでした', e instanceof Error && e.message.startsWith('recital_') ? e.message : 'error');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
});
