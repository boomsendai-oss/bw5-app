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

const EDITABLE = ['class_name', 'instructor', 'daytime', 'caption_style', 'dance_start', 'dance_end', 'cover_at', 'cover_choice', 'caption', 'stage_kf'] as const;

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  // 表示順: 入力待ち → 生成中 → 完了/エラー(直近)
  const rows = await getAll(
    `SELECT d.id, d.drive_file_id, d.drive_name, d.kind, d.shot_at, d.class_name, d.instructor, d.daytime,
            d.caption_style, d.duration_sec, d.preview_path, d.cover_candidates, d.stage_kf,
            d.dance_start, d.dance_end, d.cover_at, d.cover_choice, d.status, d.reel_queue_id, d.error,
            d.reel_path, d.cover_path, d.caption, d.created_at, d.updated_at,
            q.scheduled_at AS queue_scheduled_at, q.status AS queue_status, q.permalink AS queue_permalink
     FROM reel_draft d
     LEFT JOIN reel_queue q ON q.id = d.reel_queue_id
     ORDER BY CASE d.status
        WHEN 'need_input' THEN 0 WHEN 'review' THEN 1 WHEN 'ready' THEN 2 WHEN 'generating' THEN 3
        WHEN 'error' THEN 4 WHEN 'scheduled' THEN 5 WHEN 'done' THEN 6 ELSE 7 END,
       d.updated_at DESC
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
  // 予約済みのキャプション編集は、実際に投稿へ使われる reel_queue 側にも同期する
  // (予約時にコピーされるため、draft だけ直しても投稿文は変わらない事故の防止)
  if ('caption' in body && draft.reel_queue_id) {
    const q = await getOne('SELECT status FROM reel_queue WHERE id = ?', [draft.reel_queue_id]);
    if (q && q.status === 'scheduled') {
      await execute('UPDATE reel_queue SET caption = ? WHERE id = ?', [body.caption ?? '', draft.reel_queue_id]);
    }
  }
  const updated = await getOne('SELECT * FROM reel_draft WHERE id = ?', [id]);
  return NextResponse.json({ ok: true, draft: updated });
}

// 投稿枠ルール(発表会リール制作フロー_v1.md): 火曜=レッスン(クラス)リール / 金曜=発表会リール。
// kind に応じて次の該当曜日19:00 JST を返す。クラスが金曜に、発表会が火曜に出ないようにする。
function nextReelSlotIso(kind?: string): string {
  const targetDow = kind === '発表会' || kind === 'stage' ? 5 : 2; // 発表会→金(5) / それ以外(クラス)→火(2)
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  for (let i = 1; i <= 14; i++) {
    const d = new Date(nowJst.getTime() + i * 86400000);
    if (d.getUTCDay() === targetDow) {
      const day = d.toISOString().slice(0, 10);
      return new Date(`${day}T19:00:00+09:00`).toISOString();
    }
  }
  return new Date(Date.now() + 86400000).toISOString();
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  let body: {
    signal?: string; action?: string; id?: number; scheduled_at?: string;
    stage_no?: string; title?: string; class_name?: string; instructor?: string;
    dance_start?: number; dance_end?: number; cover_at?: number; stage_kf?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const now = new Date().toISOString();

  // 発表会リールの新規作成(TARO 2026-07-25): 素材はDriveでなくSSDの本番映像(M01〜M38)。
  // 2段階方式: SSDが要るのは切り出し+追従だけ。Mac常駐が本編を確定してプレビュー+カバー候補を
  // 出したら(need_input)、以降のカバー選定・キャプションはスマホのアプリだけで完結する。
  if (body.action === 'create_stage') {
    const stageNo = String(body.stage_no ?? '').trim().toUpperCase();
    if (!/^M\d{2}$/.test(stageNo)) return NextResponse.json({ error: '演目番号はM01〜M38の形式で入力してください' }, { status: 400 });
    const title = String(body.title ?? '').trim();
    if (!title) return NextResponse.json({ error: '演目名を入力してください' }, { status: 400 });
    const ds = Number(body.dance_start), de = Number(body.dance_end);
    if (!Number.isFinite(ds) || !Number.isFinite(de)) return NextResponse.json({ error: '見せ場の開始秒・終了秒を入力してください' }, { status: 400 });
    if (de <= ds) return NextResponse.json({ error: '終了秒は開始秒より後にしてください' }, { status: 400 });
    if (de - ds < 3 || de - ds > 90) return NextResponse.json({ error: `クリップ長が${Math.round(de - ds)}秒です(3〜90秒にしてください)` }, { status: 400 });
    const coverAt = body.cover_at == null || body.cover_at === undefined ? null : Number(body.cover_at);
    const kfRaw = String(body.stage_kf ?? '').trim();
    if (kfRaw && !/^\d+(\.\d+)?=(0(\.\d+)?|1(\.0+)?)(,\d+(\.\d+)?=(0(\.\d+)?|1(\.0+)?))*$/.test(kfRaw)) {
      return NextResponse.json({ error: '主役位置の形式が不正です(例: 0=0.5 または 0=0.5,10=0.3)' }, { status: 400 });
    }
    const fileId = `stage:${stageNo}:${crypto.randomUUID().slice(0, 8)}`;
    const r = await execute(
      `INSERT INTO reel_draft (drive_file_id, drive_name, kind, class_name, instructor, dance_start, dance_end, cover_at, stage_kf, status, updated_at)
       VALUES (?, ?, '発表会', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
      [fileId, `${stageNo}.mp4`, title, String(body.instructor ?? '').trim() || null, ds, de, coverAt, kfRaw || null, now]
    );
    return NextResponse.json({ ok: true, id: String(r.lastInsertRowid), status: 'ready' });
  }
  if (body.signal === 'sync') {
    await execute('UPDATE reel_pipeline_signal SET sync_requested_at = ?, updated_at = ? WHERE id = 1', [now, now]);
    return NextResponse.json({ ok: true, requested: 'sync', at: now });
  }
  if (body.signal === 'generate') {
    await execute('UPDATE reel_pipeline_signal SET generate_requested_at = ?, updated_at = ? WHERE id = 1', [now, now]);
    return NextResponse.json({ ok: true, requested: 'generate', at: now });
  }

  // 投稿予約(手動GO): 投稿待ち(review)の完成リールを reel_queue に scheduled で投入する。
  // ここで初めて自動投稿の対象になる。scheduled_at 未指定なら次の火/金19時。
  if (body.action === 'schedule') {
    const id = Number(body.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const d = await getOne('SELECT * FROM reel_draft WHERE id = ?', [id]);
    if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (d.status !== 'review' || !d.reel_path) {
      return NextResponse.json({ error: '完成した投稿待ちリールのみ予約できます' }, { status: 400 });
    }
    let scheduledAt = nextReelSlotIso(String(d.kind ?? 'class'));
    if (body.scheduled_at) {
      const t = new Date(body.scheduled_at);
      if (isNaN(t.getTime())) return NextResponse.json({ error: '日時が不正です' }, { status: 400 });
      if (t.getTime() < Date.now() - 60000) return NextResponse.json({ error: '過去の日時は指定できません' }, { status: 400 });
      scheduledAt = t.toISOString();
    }
    const title = `${d.class_name || d.drive_name}${d.instructor ? '（' + d.instructor + '）' : ''}`;
    const q = await execute(
      `INSERT INTO reel_queue (title, video_path, cover_path, caption, scheduled_at, status)
       VALUES (?, ?, ?, ?, ?, 'scheduled')`,
      [title, d.reel_path, d.cover_path, d.caption ?? '', scheduledAt]
    );
    await execute('UPDATE reel_draft SET status = ?, reel_queue_id = ?, updated_at = ? WHERE id = ?',
      ['scheduled', String(q.lastInsertRowid), now, id]);
    return NextResponse.json({ ok: true, scheduled_at: scheduledAt, reel_queue_id: String(q.lastInsertRowid) });
  }

  // 予約取り消し: まだ投稿されていない予約を取り消して投稿待ちに戻す。
  if (body.action === 'unschedule') {
    const id = Number(body.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const d = await getOne('SELECT * FROM reel_draft WHERE id = ?', [id]);
    if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (d.reel_queue_id) {
      const q = await getOne('SELECT status FROM reel_queue WHERE id = ?', [d.reel_queue_id]);
      if (q && (q.status === 'posted' || q.status === 'posting')) {
        return NextResponse.json({ error: 'すでに投稿済み/投稿中のため取り消せません' }, { status: 400 });
      }
      await execute("UPDATE reel_queue SET status = 'canceled' WHERE id = ?", [d.reel_queue_id]);
    }
    await execute('UPDATE reel_draft SET status = ?, reel_queue_id = NULL, updated_at = ? WHERE id = ?',
      ['review', now, id]);
    return NextResponse.json({ ok: true, status: 'review' });
  }

  return NextResponse.json({ error: "signal は 'sync'/'generate'、action は 'schedule'/'unschedule'" }, { status: 400 });
}
