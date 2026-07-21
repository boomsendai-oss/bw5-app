import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * リール自動生成パイプライン — 下書き入力API (WS: リール自動生成)
 * 設計: ~/BOOM/SNS戦略/リール自動生成パイプライン設計_v1.md
 *
 * GET   : 下書き一覧(status別)。TAROが入力する need_input を先頭に。
 * PATCH : 1件の下書きを更新。cover(候補タップ or 秒指定)・踊り出し/終わり秒・
 *         クラス/講師/曜日時間 を保存。全部揃ったら status を ready にできる(action:'submit')。
 * POST  : {signal:'sync'|'generate'} で Mac常駐に「今すぐ」を要求(reel_pipeline_signal に時刻を立てる)。
 *
 * Mac側(reel_pipeline.mjs)は 0/6/12/18時の定期 + 1分watch でこのDBを読み、
 * need_input を作り、ready を生成して reel_queue に投入する。ここは"入力"だけを担う。
 */

const EDITABLE = ['class_name', 'instructor', 'daytime', 'caption_style', 'dance_start', 'dance_end', 'cover_at', 'cover_choice'] as const;

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  // 表示順: 入力待ち → 生成中 → 完了/エラー(直近)
  const rows = await getAll(
    `SELECT id, drive_file_id, drive_name, kind, shot_at, class_name, instructor, daytime,
            caption_style, duration_sec, preview_path, cover_candidates,
            dance_start, dance_end, cover_at, cover_choice, status, reel_queue_id, error,
            created_at, updated_at
     FROM reel_draft
     ORDER BY CASE status
        WHEN 'need_input' THEN 0 WHEN 'ready' THEN 1 WHEN 'generating' THEN 2
        WHEN 'error' THEN 3 WHEN 'done' THEN 4 ELSE 5 END,
       updated_at DESC
     LIMIT 100`
  );
  const signal = await getOne('SELECT sync_requested_at, generate_requested_at, updated_at FROM reel_pipeline_signal WHERE id = 1').catch(() => null);
  return NextResponse.json({ drafts: rows, signal });
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const draft = await getOne('SELECT * FROM reel_draft WHERE id = ?', [id]);
  if (!draft) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of EDITABLE) {
    if (k in body) {
      sets.push(`${k} = ?`);
      const v = body[k];
      args.push(v === '' || v === undefined ? null : v);
    }
  }

  // action:'submit' → 入力が揃っていれば ready にする。'reset' → need_input に戻す。
  const action = body.action;
  const merged = { ...draft, ...Object.fromEntries(EDITABLE.filter((k) => k in body).map((k) => [k, body[k]])) } as Record<string, unknown>;
  if (action === 'submit') {
    const missing: string[] = [];
    if (!merged.class_name) missing.push('クラス名');
    if (merged.dance_start == null || merged.dance_start === '') missing.push('踊り出し秒');
    if (merged.dance_end == null || merged.dance_end === '') missing.push('踊り終わり秒');
    if (merged.cover_at == null || merged.cover_at === '') missing.push('カバー(候補タップ or 秒指定)');
    if (missing.length) {
      return NextResponse.json({ error: `未入力: ${missing.join(' / ')}` }, { status: 400 });
    }
    if (Number(merged.dance_end) <= Number(merged.dance_start)) {
      return NextResponse.json({ error: '踊り終わりは踊り出しより後にしてください' }, { status: 400 });
    }
    sets.push('status = ?');
    args.push('ready');
    sets.push('error = NULL');
  } else if (action === 'reset') {
    sets.push('status = ?');
    args.push('need_input');
  }

  if (!sets.length) return NextResponse.json({ error: '変更なし' }, { status: 400 });
  sets.push('updated_at = ?');
  args.push(new Date().toISOString());
  args.push(id);
  await execute(`UPDATE reel_draft SET ${sets.join(', ')} WHERE id = ?`, args);
  const updated = await getOne('SELECT * FROM reel_draft WHERE id = ?', [id]);
  return NextResponse.json({ ok: true, draft: updated });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  let body: { signal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const now = new Date().toISOString();
  if (body.signal === 'sync') {
    await execute('UPDATE reel_pipeline_signal SET sync_requested_at = ?, updated_at = ? WHERE id = 1', [now, now]);
    return NextResponse.json({ ok: true, requested: 'sync', at: now });
  }
  if (body.signal === 'generate') {
    await execute('UPDATE reel_pipeline_signal SET generate_requested_at = ?, updated_at = ? WHERE id = 1', [now, now]);
    return NextResponse.json({ ok: true, requested: 'generate', at: now });
  }
  return NextResponse.json({ error: "signal は 'sync' か 'generate'" }, { status: 400 });
}
