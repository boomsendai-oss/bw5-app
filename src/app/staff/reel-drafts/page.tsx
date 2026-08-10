'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

// リール自動生成 — 下書き入力画面 (WS: リール自動生成)
// 設計: ~/BOOM/SNS戦略/リール自動生成パイプライン設計_v1.md
// インストラクターがDriveに上げたクリップをMacが取り込み(need_input)、ここでTAROが
// 「カバーのカット・踊り出し/終わり秒・クラス」を最小入力→生成待ち(ready)にする。
// 生成・投稿はMac常駐+既存cronが担当。この画面は入力だけ。

type Candidate = { n: number; t: number; url: string };
type Draft = {
  id: number;
  drive_file_id: string;
  drive_name: string | null;
  kind: string;
  shot_at: string | null;
  class_name: string | null;
  instructor: string | null;
  daytime: string | null;
  duration_sec: number | null;
  preview_path: string | null;
  wide_path: string | null;
  cover_candidates: string | null;
  stage_kf: string | null;
  dance_start: number | null;
  dance_end: number | null;
  cover_at: number | null;
  cover_choice: number | null;
  status: string;
  reel_queue_id: number | null;
  error: string | null;
  reel_path: string | null;
  cover_path: string | null;
  caption: string | null;
  queue_scheduled_at: string | null;
  queue_status: string | null;
  queue_permalink: string | null;
  lesson_master_id: number | null;
  mention_handles: string | null;
  collaborators: string | null;
  updated_at: string;
};
type Lesson = { id: number; class_name: string; dw: number; st: string; et: string | null; instructor: string | null };
type Signal = {
  sync_requested_at: string | null; generate_requested_at: string | null; updated_at: string | null;
  // Mac常駐の生存記録(TARO 2026-08-04)。Macがスリープしていると常駐が止まるので、
  // 「生成を押したのに何も起きない」を画面で気づけるようにする。
  last_run_at?: string | null; last_ok_at?: string | null; last_error?: string | null;
};

/** 常駐が最後に動いてからの分数。記録が無ければ null */
function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 60000);
}

const STATUS_LABEL: Record<string, string> = {
  new: '取込中', need_input: '入力待ち', ready: '生成待ち', generating: '生成中',
  review: '投稿待ち', scheduled: '投稿予約済み', done: '完了', error: 'エラー',
};
const STATUS_STYLE: Record<string, string> = {
  need_input: 'bg-amber-100 text-amber-800', ready: 'bg-brand-100 text-brand-700',
  generating: 'bg-blue-100 text-blue-700', review: 'bg-purple-100 text-purple-700',
  scheduled: 'bg-green-100 text-green-700', done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700', new: 'bg-sand-200 text-navy-700',
};

// JST表示ヘルパ
function fmtJst(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const w = ['日', '月', '火', '水', '木', '金', '土'][j.getUTCDay()];
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}(${w}) ${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}`;
}

export default function ReelDraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>('');

  const load = useCallback(async () => {
    const r = await fetch('/api/staff/reel-drafts', { cache: 'no-store' });
    if (!r.ok) { setMsg('読み込み失敗'); setLoading(false); return; }
    const j = await r.json();
    setDrafts(j.drafts ?? []);
    setSignal(j.signal ?? null);
    setLessons(j.lessons ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 生成中/生成待ちがある間は自動で更新する。
  // 「秒を直す→作り直す→出来上がりを見る」をスマホで手を動かさず追えるようにするため(TARO 2026-07-31)。
  const waiting = drafts.some((d) => d.status === 'ready' || d.status === 'generating');
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [waiting, load]);

  const sendSignal = async (kind: 'sync' | 'generate') => {
    setMsg(kind === 'sync' ? '同期を要求しました…(Macが1分以内に反応)' : '生成を要求しました…(Macが1分以内に反応)');
    await fetch('/api/staff/reel-drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signal: kind }),
    });
    setTimeout(load, 800);
  };

  // タブ(TARO 2026-07-25): クラスリール(Drive取込)と発表会リール(SSD本番映像)を分けて表示
  const [tab, setTab] = useState<'class' | 'stage'>('class');
  const isStage = (d: Draft) => d.kind === '発表会' || d.kind === 'stage';
  const shown = drafts.filter((d) => (tab === 'stage' ? isStage(d) : !isStage(d)));

  const pending = shown.filter((d) => d.status === 'need_input');
  const review = shown.filter((d) => d.status === 'review');
  const scheduled = shown.filter((d) => d.status === 'scheduled');
  const inFlight = shown.filter((d) => d.status === 'ready' || d.status === 'generating');
  const settled = shown.filter((d) => d.status === 'done' || d.status === 'error' || d.status === 'new');
  const stageCount = drafts.filter(isStage).length;
  const classCount = drafts.length - stageCount;

  return (
    <div className="min-h-screen bg-sand-50">
      <StaffPageHeader
        title="🎬 リール自動生成"
        description="インストラクターがDriveに上げたクリップを、カバー・秒数を入れるだけで完成リールにします"
        backHref="/staff"
        rightExtra={
          <div className="flex gap-2">
            <button onClick={() => sendSignal('sync')} className="px-3 py-1.5 text-xs rounded-md border border-brand-300 text-brand-700 hover:bg-brand-50">
              🔄 今すぐ同期
            </button>
            <button onClick={() => sendSignal('generate')} className="px-3 py-1.5 text-xs rounded-md bg-brand-600 text-white hover:bg-brand-700">
              ⚡ 今すぐ生成
            </button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto p-4 space-y-6">
        {msg && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded-md px-3 py-2">{msg}</p>}
        {signal && (signal.sync_requested_at || signal.generate_requested_at) && (
          <p className="text-xs text-amber-700">Mac処理待ち…(要求済み。反映まで最大1分)</p>
        )}
        {(() => {
          // 常駐が10分以上動いていない = Macがスリープ中/停止中。押しても進まないので明示する。
          const idle = minutesSince(signal?.last_run_at);
          if (idle == null || idle < 10) return null;
          const h = Math.floor(idle / 60);
          const ago = h > 0 ? `${h}時間${idle % 60}分` : `${idle}分`;
          return (
            <div className="rounded-lg bg-amber-50 border border-amber-300 px-3 py-2.5 text-xs text-amber-900">
              <p className="font-bold">⚠️ Macの生成処理が {ago} 動いていません</p>
              <p className="mt-1">
                生成はMac上でしか動きません（元動画と変換処理がMacにあるため）。
                Macがスリープしていると「生成」を押しても進みません。Macを開いて数分待つと自動で進みます。
              </p>
            </div>
          );
        })()}
        {signal?.last_error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            前回の生成でエラー: {signal.last_error}
          </p>
        )}
        {waiting && (
          <p className="text-xs text-brand-700">⏳ 生成の進み具合を15秒ごとに自動で確認しています（このまま待てば結果が出ます）</p>
        )}

        <div className="flex gap-1 bg-sand-100 rounded-xl p-1">
          <button onClick={() => setTab('class')}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${tab === 'class' ? 'bg-white text-navy-800 shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}>
            🕺 クラスリール ({classCount})
          </button>
          <button onClick={() => setTab('stage')}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${tab === 'stage' ? 'bg-white text-navy-800 shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}>
            🎭 発表会リール ({stageCount})
          </button>
        </div>

        {loading ? (
          <p className="text-navy-500">読み込み中…</p>
        ) : (
          <>
            {tab === 'stage' && <StageCreateForm onCreated={load} onMsg={setMsg} lessons={lessons} />}

            <Section title={`入力待ち (${pending.length})`}
              empty={tab === 'stage' ? '作成後、SSD接続中のMacが本編を確定するとここに出ます(カバー選定はスマホでOK)' : 'Driveに新しいクリップが上がると、ここに並びます'}>
              {/* key に updated_at を含める: 作り直しで素材が入れ替わったら入力状態(選択中のカバー等)を
                  作り直し前のまま持ち越さずリセットする */}
              {pending.map((d) => <DraftEditor key={`${d.id}:${d.updated_at}`} draft={d} onSaved={load} onMsg={setMsg} lessons={lessons} />)}
            </Section>

            {review.length > 0 && (
              <Section title={`投稿待ち・確認して投稿 (${review.length})`}>
                {review.map((d) => <ReviewCard key={`${d.id}:${d.updated_at}`} draft={d} onChanged={load} onMsg={setMsg} />)}
              </Section>
            )}

            {scheduled.length > 0 && (
              <Section title={`投稿予約済み (${scheduled.length})`}>
                {scheduled.map((d) => <CompactRow key={d.id} d={d} onReset={load} onMsg={setMsg} />)}
              </Section>
            )}

            {inFlight.length > 0 && (
              <Section title={`生成待ち・生成中 (${inFlight.length})`}>
                {inFlight.map((d) => (
                  <div key={`${d.id}:${d.updated_at}`} className="space-y-2">
                    <CompactRow d={d} onReset={load} onMsg={setMsg} />
                    {isStage(d) && d.status === 'ready' && (
                      <StageCutPanel draft={d} onDone={load} onMsg={setMsg} />
                    )}
                  </div>
                ))}
              </Section>
            )}

            {settled.length > 0 && (
              <Section title="完了・その他">
                {settled.map((d) => <CompactRow key={d.id} d={d} onReset={load} onMsg={setMsg} />)}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  const isEmpty = arr.flat().filter(Boolean).length === 0;
  return (
    <section>
      <h2 className="text-sm font-semibold text-navy-700 mb-2">{title}</h2>
      {isEmpty ? <p className="text-xs text-navy-400">{empty ?? 'なし'}</p> : <div className="space-y-4">{children}</div>}
    </section>
  );
}

function fmt(n: number | null | undefined) { return n == null ? '' : String(n); }

function DraftEditor({ draft, onSaved, onMsg, lessons = [] }: { draft: Draft; onSaved: () => void; onMsg: (s: string) => void; lessons?: Lesson[] }) {
  // 発表会draft: 本編は確定済み(SSD不要)。ここでの入力はカバー選定+演目名/講師だけ。
  const stage = draft.kind === '発表会' || draft.kind === 'stage';
  const [className, setClassName] = useState(draft.class_name ?? '');
  const [instructor, setInstructor] = useState(draft.instructor ?? '');
  const [daytime, setDaytime] = useState(draft.daytime ?? '');
  const [danceStart, setDanceStart] = useState(fmt(draft.dance_start));
  const [danceEnd, setDanceEnd] = useState(fmt(draft.dance_end));
  const [coverAt, setCoverAt] = useState<number | null>(draft.cover_at);
  const [coverChoice, setCoverChoice] = useState<number | null>(draft.cover_choice);
  const [lessonId, setLessonId] = useState<number | null>(draft.lesson_master_id ?? null);
  const [mentions, setMentions] = useState(draft.mention_handles ?? '');
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  let candidates: Candidate[] = [];
  try { candidates = draft.cover_candidates ? JSON.parse(draft.cover_candidates) : []; } catch { /* ignore */ }

  const grab = () => (videoRef.current ? Math.round(videoRef.current.currentTime * 10) / 10 : null);

  const patch = async (extra: Record<string, unknown>, action?: 'submit') => {
    setSaving(true);
    const body: Record<string, unknown> = {
      id: draft.id, class_name: className, instructor, daytime,
      dance_start: danceStart === '' ? null : Number(danceStart),
      dance_end: danceEnd === '' ? null : Number(danceEnd),
      cover_at: coverAt, cover_choice: coverChoice, lesson_master_id: lessonId, mention_handles: mentions, ...extra,
    };
    if (action) body.action = action;
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    setSaving(false);
    if (!r.ok) { onMsg(j.error ?? '保存失敗'); return false; }
    return true;
  };

  const submit = async () => {
    if (await patch({}, 'submit')) { onMsg(`「${className || draft.drive_name}」のリール生成を開始しました（完成すると"投稿待ち"に出ます）`); onSaved(); }
  };

  const seekTo = (t: number) => { if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.pause(); } };

  return (
    <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-navy-400 truncate">{draft.drive_name}{draft.shot_at ? ` ・${draft.shot_at.slice(0, 16).replace('T', ' ')}` : ''}</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[draft.status] ?? ''}`}>{STATUS_LABEL[draft.status] ?? draft.status}</span>
      </div>

      {/* プレビュー。発表会は本編確定済みなので「カバーに使う瞬間」を選ぶために見る */}
      {draft.preview_path && (
        <div className="mb-3">
          <video ref={videoRef} src={draft.preview_path} controls playsInline preload="metadata"
            className="w-full max-h-[46vh] rounded-lg bg-black" />
          <div className="flex flex-wrap gap-2 mt-2">
            {!stage && (
              <>
                <button onClick={() => { const t = grab(); if (t != null) setDanceStart(String(t)); }}
                  className="px-2.5 py-1 text-xs rounded-md border border-navy-200 text-navy-700 hover:bg-sand-100">⏱ 再生位置を踊り出しに</button>
                <button onClick={() => { const t = grab(); if (t != null) setDanceEnd(String(t)); }}
                  className="px-2.5 py-1 text-xs rounded-md border border-navy-200 text-navy-700 hover:bg-sand-100">⏱ 再生位置を踊り終わりに</button>
              </>
            )}
            <button onClick={() => { const t = grab(); if (t != null) { setCoverAt(t); setCoverChoice(null); } }}
              className="px-2.5 py-1 text-xs rounded-md border border-brand-300 text-brand-700 hover:bg-brand-50">🖼 この瞬間をカバーに</button>
          </div>
        </div>
      )}

      {/* 発表会: 切り出し秒・追従の微調整→作り直し(スマホ完結) */}
      {stage && (
        <div className="mb-3">
          <StageCutPanel draft={draft} onDone={onSaved} onMsg={onMsg} />
        </div>
      )}

      {/* カバー候補グリッド(タップで選択) */}
      {candidates.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-navy-500 mb-1">カバー候補(タップで選択・ブレの少ない順)</p>
          <div className="grid grid-cols-5 gap-1.5">
            {candidates.map((c) => {
              const active = coverChoice === c.n || (coverChoice == null && coverAt === c.t);
              return (
                <button key={c.n} onClick={() => { setCoverAt(c.t); setCoverChoice(c.n); seekTo(c.t); }}
                  className={`relative rounded-md overflow-hidden border-2 ${active ? 'border-brand-500 ring-2 ring-brand-300' : 'border-transparent'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt={`候補${c.n}`} className="w-full aspect-[9/16] object-cover" />
                  <span className="absolute bottom-0 left-0 text-[9px] bg-black/60 text-white px-1">{c.t}s</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 数値・テキスト入力(発表会は本編確定済みなので秒・曜日時間は出さない) */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {!stage && <Field label="踊り出し(秒)"><input type="number" step="0.1" value={danceStart} onChange={(e) => setDanceStart(e.target.value)} className="input" /></Field>}
        {!stage && <Field label="踊り終わり(秒)"><input type="number" step="0.1" value={danceEnd} onChange={(e) => setDanceEnd(e.target.value)} className="input" /></Field>}
        <Field label="カバー秒(候補タップで自動)"><input type="number" step="0.1" value={coverAt ?? ''} onChange={(e) => { setCoverAt(e.target.value === '' ? null : Number(e.target.value)); setCoverChoice(null); }} className="input" /></Field>
        {/* 発表会: カバーに載るのはクラス名(TARO 2026-07-31確定)。演目名はキャプション用 */}
        <Field label={stage ? 'クラス名(カバーに載る)' : '曜日・時間'}>
          <input value={daytime} onChange={(e) => setDaytime(e.target.value)} placeholder={stage ? '水曜TARO HIPHOP' : '日曜11:00'} className="input" />
        </Field>
        <Field label={stage ? '演目名(キャプション用)' : 'クラス名'}><input value={className} onChange={(e) => setClassName(e.target.value)} placeholder={stage ? 'そのまま' : 'はじめてのヒップホップ'} className="input" /></Field>
        <Field label={stage ? '講師(タグ用)' : '講師'}><input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder={stage ? 'SAYUKI' : 'KEIKO'} className="input" /></Field>
      </div>

      {stage && lessons.length > 0 && (
        <div className="mb-3">
          <LessonPicker value={lessonId} onChange={setLessonId} lessons={lessons} />
        </div>
      )}

      {/* 出演者メンション: 投稿時にキャプションへ入る。本人に通知が飛び、再シェアで知らない人へ届く */}
      {stage && (
        <label className="block mb-3">
          <span className="text-[11px] text-navy-500">
            出演者のインスタ（スペース/カンマ区切り・最大20人・@は不要）
          </span>
          <textarea value={mentions} onChange={(e) => setMentions(e.target.value)} rows={2}
            placeholder="taro_bsb  sayu_sayuki" className="w-full border border-sand-200 rounded-lg p-2 text-sm text-navy-800 mt-1" />
          <span className="text-[10px] text-navy-400">
            {mentions.trim() ? `${mentions.trim().split(/[\s,、，]+/).filter(Boolean).length}人` : '未入力'}
            ／ 本人に通知が飛ぶので、タグ付けの了承を得た人だけ入れてください
          </span>
        </label>
      )}

      <div className="flex justify-end gap-2">
        <button disabled={saving} onClick={() => patch({}).then((ok) => ok && onMsg('下書きを保存しました'))}
          className="px-3 py-1.5 text-xs rounded-md border border-navy-200 text-navy-600 hover:bg-sand-100 disabled:opacity-50">下書き保存</button>
        <button disabled={saving} onClick={submit}
          className="px-4 py-1.5 text-xs rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{stage ? '✅ カバー確定・リール仕上げ' : '✅ リールを作る'}</button>
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%; border: 1px solid #e5ddd0; border-radius: 0.5rem;
          padding: 0.4rem 0.6rem; font-size: 0.85rem; color: #101040;
        }
      `}</style>
    </div>
  );
}

const WD_JA = ['日', '月', '火', '水', '木', '金', '土'];
const lessonLabel = (l: Lesson) =>
  `${WD_JA[l.dw]} ${String(l.st).slice(0, 5)} ${l.class_name}${l.instructor ? ` / ${l.instructor}` : ''}`;

/**
 * クラスの紐づけ(TARO 2026-07-31)。キャプションの曜日・時間はここから引く。
 * 手入力の表記ゆれ(「多賀城HOUSE」vs「多賀城 HOUSE」)で自動一致に失敗した実績があるので、
 * 必ずレッスンマスターから選ばせる。時間割が変われば次の生成で自動的に新しい時間になる。
 */
function LessonPicker({ value, onChange, lessons }:
  { value: number | null; onChange: (v: number | null) => void; lessons: Lesson[] }) {
  const cur = lessons.find((l) => l.id === value) ?? null;
  return (
    <label className="block">
      <span className="text-[11px] text-navy-500">クラス（キャプションの曜日・時間に使う）</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="input">
        <option value="">— 紐づけない —</option>
        {lessons.map((l) => <option key={l.id} value={l.id}>{lessonLabel(l)}</option>)}
      </select>
      <span className="text-[10px] text-navy-400">
        {cur ? `キャプションに「${WD_JA[cur.dw]}曜 ${String(cur.st).slice(0, 5)}〜${cur.et ? String(cur.et).slice(0, 5) : ''}」が入ります`
             : '紐づけると曜日・時間が自動で入ります'}
      </span>
    </label>
  );
}

// 元素材(M**)の何秒〜何秒を使っているかを表示する
function stageNoOf(d: Draft): string {
  const m = String(d.drive_file_id ?? '').match(/^stage:(M\d{2})/);
  return m ? m[1] : String(d.drive_name ?? '').replace(/\.mp4$/i, '');
}
const fmtSec = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(1)}s`);

const KF_PRESET_LIST = [
  { label: '左', v: '0=0.25' }, { label: 'やや左', v: '0=0.375' }, { label: '中央', v: '0=0.5' },
  { label: 'やや右', v: '0=0.625' }, { label: '右', v: '0=0.75' },
];

/**
 * 追従(主役の位置)の指定UI(TARO 2026-07-31)。
 *   固定 … クリップ中ずっと同じ位置 → "0=0.55"
 *   パン … 開始→終わりへ直線移動   → "0=a,{尺}=b"
 *   詳細 … 「◯秒でこの位置」を何点でも打てる → "0=a,4=b,9=c,..."
 *          (主役が入れ替わる群舞用。点と点の間は自動で滑らかに繋がる)
 * ⚠️ 秒は「元素材の秒」ではなく**クリップ内の経過秒**(切り出しの先頭が0秒)。
 */
type KfPoint = { t: number; v: number };

function parseKf(kf: string): KfPoint[] {
  const pts = kf.split(',').map((p) => {
    const [t, v] = p.split('=');
    return { t: Number(t), v: Number(v) };
  }).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
  return pts.length ? pts : [{ t: 0, v: 0.5 }];
}
const r2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
const fmtKf = (pts: KfPoint[]) =>
  [...pts].sort((a, b) => a.t - b.t).map((p) => `${Math.max(0, Math.round(p.t * 10) / 10)}=${r2(p.v)}`).join(',');

/**
 * 追従を「見ながら」決めるエディタ(TARO 2026-07-31の要望そのまま)。
 *   再生 → 止める → 枠を左右にドラッグして中心を合わせる → 「ここをマーク」
 *   → また再生 → ずれたら止めてマーク … を繰り返すとキーフレームが出来上がる。
 * 切り取る前(16:9)の wide.mp4 に、実際に切り取られる 9:16 の枠を重ねて見せる。
 */
const WIN_W = (9 / 16) / (16 / 9); // 16:9 の中で 9:16 が占める横幅の割合 ≈ 0.316

function StageTrackEditor({ src, kf, setKf, clipLen, onUnavailable }:
  { src: string; kf: string; setKf: (v: string) => void; clipLen: number; onUnavailable: () => void }) {
  const vref = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(0.5);      // 現在の枠の中心(0〜1)
  const [t, setT] = useState(0);            // 現在の再生位置(秒)
  const [playing, setPlaying] = useState(false);
  const pts = parseKf(kf);

  // ドラッグ/タップで枠の中心を動かす
  const moveTo = useCallback((clientX: number) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;             // 0〜1
    const half = WIN_W / 2;
    setPos(Math.min(1, Math.max(0, (x - half) / (1 - WIN_W))));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    moveTo(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    moveTo(e.clientX);
  };

  const togglePlay = () => {
    const v = vref.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  const step = (by: number) => {
    const v = vref.current;
    if (!v) return;
    v.pause(); setPlaying(false);
    v.currentTime = Math.min(clipLen, Math.max(0, v.currentTime + by));
  };

  const mark = () => {
    const sec = Math.round(t * 10) / 10;
    const next = pts.filter((p) => Math.abs(p.t - sec) > 0.05);
    next.push({ t: sec, v: pos });
    setKf(fmtKf(next));
  };

  // 再生位置が変わったら、その時点の指定値に枠を合わせる(補間して表示)
  const kfAt = useCallback((sec: number) => {
    const s = [...pts].sort((a, b) => a.t - b.t);
    if (!s.length) return 0.5;
    if (sec <= s[0].t) return s[0].v;
    if (sec >= s[s.length - 1].t) return s[s.length - 1].v;
    for (let i = 0; i < s.length - 1; i++) {
      if (sec >= s[i].t && sec <= s[i + 1].t) {
        const r = (sec - s[i].t) / Math.max(0.001, s[i + 1].t - s[i].t);
        return s[i].v + (s[i + 1].v - s[i].v) * r;
      }
    }
    return 0.5;
  }, [pts]);

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        className="relative w-full overflow-hidden rounded-lg bg-black touch-none select-none"
      >
        <video
          ref={vref} src={src} playsInline preload="metadata" className="w-full block"
          onTimeUpdate={(e) => {
            const cur = e.currentTarget.currentTime;
            setT(cur);
            if (!e.currentTarget.paused) setPos(kfAt(cur)); // 再生中は指定どおりに枠が動く
          }}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          // 古い世代の下書きには切り取る前の映像が無い。壊れたプレーヤーを見せず数値指定に戻す
          onError={onUnavailable}
        />
        {/* 実際に切り取られる範囲(9:16) */}
        <div className="pointer-events-none absolute inset-y-0 border-[3px] border-brand-400 bg-brand-400/10"
          style={{ left: `${pos * (1 - WIN_W) * 100}%`, width: `${WIN_W * 100}%` }} />
        {/* 枠の外は暗くして、使われない部分を分かりやすく */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/55"
          style={{ width: `${pos * (1 - WIN_W) * 100}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/55"
          style={{ width: `${(1 - WIN_W - pos * (1 - WIN_W)) * 100}%` }} />
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] text-white">
          {t.toFixed(1)}s / 位置 {pos.toFixed(2)}
        </span>
      </div>

      {/* マークの位置が一目で分かる帯。タップでその秒へ飛ぶ */}
      <div className="relative h-7 rounded bg-sand-100"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const sec = ((e.clientX - r.left) / r.width) * clipLen;
          const v = vref.current;
          if (v) { v.pause(); v.currentTime = Math.max(0, Math.min(clipLen, sec)); }
        }}>
        {[...pts].sort((a, b) => a.t - b.t).map((p, i) => (
          <span key={i} className="absolute top-0 h-full w-[3px] bg-brand-600"
            style={{ left: `${Math.min(100, (p.t / Math.max(0.1, clipLen)) * 100)}%` }} />
        ))}
        <span className="absolute top-0 h-full w-[2px] bg-red-500"
          style={{ left: `${Math.min(100, (t / Math.max(0.1, clipLen)) * 100)}%` }} />
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={() => step(-0.5)} className="min-h-[44px] text-xs rounded-md border border-navy-200 bg-white text-navy-700">◀ 0.5s</button>
        <button onClick={togglePlay} className="min-h-[44px] text-sm font-semibold rounded-md bg-navy-700 text-white">{playing ? '⏸ 停止' : '▶ 再生'}</button>
        <button onClick={() => step(0.5)} className="min-h-[44px] text-xs rounded-md border border-navy-200 bg-white text-navy-700">0.5s ▶</button>
        <button onClick={mark} className="min-h-[44px] text-xs font-semibold rounded-md bg-brand-600 text-white">📍ここをマーク</button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-navy-400">
          止めて枠をドラッグ → 「ここをマーク」。<b>マークとマークの間は自動でなめらかに動きます</b>
        </p>
        {/* 前の指定が残っていると自分のマークと引っ張り合って左右に振られる。まっさらから打ち直せるように */}
        <button
          onClick={() => { if (window.confirm('マークを全部消して、今の位置で固定しますか？')) setKf(`0=${r2(pos)}`); }}
          className="shrink-0 min-h-[36px] px-3 text-[11px] rounded-md border border-red-300 text-red-600 bg-white">
          🗑 全消去
        </button>
      </div>

      {pts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[...pts].sort((a, b) => a.t - b.t).map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-sand-300 bg-white px-2 py-1 text-[11px] text-navy-700">
              <button onClick={() => { const v = vref.current; if (v) { v.pause(); v.currentTime = p.t; } setPos(p.v); }}
                className="font-semibold">{p.t}s → {p.v.toFixed(2)}</button>
              <button onClick={() => setKf(fmtKf(pts.filter((q) => q !== p)))} className="text-red-500">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StageKfControl({ kf, setKf, clipLen }: { kf: string; setKf: (v: string) => void; clipLen: number }) {
  const pts = parseKf(kf);
  const [mode, setMode] = useState<'fix' | 'pan' | 'multi'>(
    pts.length > 2 ? 'multi' : pts.length === 2 ? 'pan' : 'fix'
  );
  const a = pts[0].v;
  const b = pts[pts.length - 1].v;
  const endSec = Math.max(1, Math.round(clipLen));

  const setFix = (v: number) => setKf(`0=${r2(v)}`);
  const setPan = (from: number, to: number) => setKf(`0=${r2(from)},${endSec}=${r2(to)}`);
  const setPts = (next: KfPoint[]) => setKf(fmtKf(next));

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-navy-500">追従（主役の位置）</span>
        <div className="flex gap-1">
          {([['fix', '固定'], ['pan', 'パン'], ['multi', '詳細']] as const).map(([m, label]) => (
            <button key={m}
              onClick={() => {
                setMode(m);
                if (m === 'fix') setFix(a);
                else if (m === 'pan') setPan(a, b);
                else if (pts.length < 2) setPts([{ t: 0, v: a }, { t: endSec, v: a }]);
              }}
              className={`px-2.5 py-1 text-[11px] rounded-md border ${mode === m ? 'bg-navy-700 text-white border-navy-700' : 'border-navy-200 text-navy-600 bg-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode !== 'multi' && (
        <div className="grid grid-cols-5 gap-1 mt-1.5">
          {KF_PRESET_LIST.map((p) => {
            const v = Number(p.v.split('=')[1]);
            const active = mode === 'fix' && Math.abs(a - v) < 0.001;
            return (
              <button key={p.v} onClick={() => { setMode('fix'); setFix(v); }}
                className={`min-h-[44px] text-[11px] rounded-md border ${active ? 'bg-brand-600 text-white border-brand-600' : 'border-navy-200 text-navy-600 bg-white'}`}>
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'fix' && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[11px] text-navy-500">
            <span>左端</span><span className="font-semibold text-navy-700">{a.toFixed(2)}</span><span>右端</span>
          </div>
          <input type="range" min={0} max={1} step={0.01} value={a}
            onChange={(e) => setFix(Number(e.target.value))} className="w-full accent-brand-600" />
        </div>
      )}

      {mode === 'pan' && (
        <div className="mt-2 space-y-2">
          {([['開始の位置', a, (v: number) => setPan(v, b)], ['終わりの位置', b, (v: number) => setPan(a, v)]] as const).map(([label, val, on]) => (
            <div key={label}>
              <div className="flex items-center justify-between text-[11px] text-navy-500">
                <span>{label}</span><span className="font-semibold text-navy-700">{val.toFixed(2)}</span>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={val}
                onChange={(e) => on(Number(e.target.value))} className="w-full accent-brand-600" />
            </div>
          ))}
          <p className="text-[10px] text-navy-400">主役が横に動く演目向け。開始→終わりへゆっくりパンします</p>
        </div>
      )}

      {mode === 'multi' && (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] text-navy-400">
            「この秒はこの子がセンター」を何点でも指定できます。秒は<b>切り出しの先頭を0秒</b>とした経過秒（クリップの長さ {clipLen.toFixed(1)}秒）
          </p>
          {pts.map((p, i) => (
            <div key={i} className="rounded-md border border-sand-200 bg-white p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] text-navy-500 shrink-0">{i + 1}点目</span>
                <input type="number" step="0.5" min={0} max={Math.max(1, clipLen)} value={p.t}
                  onChange={(e) => { const n = [...pts]; n[i] = { ...p, t: Number(e.target.value) }; setPts(n); }}
                  className="w-20 border border-sand-300 rounded-md px-2 py-1 text-sm text-right text-navy-800" />
                <span className="text-[11px] text-navy-500">秒</span>
                <span className="ml-auto text-[11px] font-semibold text-navy-700">{p.v.toFixed(2)}</span>
                {pts.length > 1 && (
                  <button onClick={() => setPts(pts.filter((_, j) => j !== i))}
                    className="text-[11px] text-red-500 shrink-0">削除</button>
                )}
              </div>
              <input type="range" min={0} max={1} step={0.01} value={p.v}
                onChange={(e) => { const n = [...pts]; n[i] = { ...p, v: Number(e.target.value) }; setPts(n); }}
                className="w-full accent-brand-600" />
            </div>
          ))}
          <button
            onClick={() => {
              const last = pts[pts.length - 1];
              const t = Math.min(Math.max(1, clipLen), Math.round((last.t + Math.max(1, clipLen / 4)) * 10) / 10);
              setPts([...pts, { t, v: last.v }]);
            }}
            className="w-full min-h-[44px] text-sm rounded-md border border-brand-300 text-brand-700 bg-white">
            ＋ ポイントを追加
          </button>
        </div>
      )}

      <input value={kf} onChange={(e) => setKf(e.target.value)}
        className="w-full mt-1.5 border border-sand-300 rounded-md px-2 py-1 text-xs text-navy-800" />
      <p className="text-[10px] text-navy-400 mt-0.5">
        直接入力も可: 「クリップ内の秒=横位置」をカンマ区切り（例 0=0.5,4=0.3,9=0.6）。0=左端〜1=右端
      </p>
    </div>
  );
}

/**
 * 発表会リールの「切り出し＋追従」調整パネル(スマホ完結・TARO 2026-07-31)。
 * 元素材の何秒〜何秒を使っているかを見せ、±0.5/±1秒で微調整→ワンボタンで作り直す。
 * 作り直しは本編を焼き直す工程なのでSSDが要る。未接続なら「接続待ち」で保留され、挿すと自動で走る。
 */
function StageCutPanel({ draft, onDone, onMsg, defaultOpen = false }:
  { draft: Draft; onDone: () => void; onMsg: (s: string) => void; defaultOpen?: boolean }) {
  const [start, setStart] = useState<number>(Number(draft.dance_start ?? 0));
  const [end, setEnd] = useState<number>(Number(draft.dance_end ?? 0));
  const [kf, setKf] = useState<string>(draft.stage_kf ?? '0=0.5');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const [wideNg, setWideNg] = useState(false); // 切り取る前の映像が無い/読めない世代のフォールバック

  const len = end - start;
  const dirty = start !== Number(draft.dance_start ?? 0) || end !== Number(draft.dance_end ?? 0)
    || kf !== (draft.stage_kf ?? '0=0.5');
  const lenNg = len < 3 || len > 90;

  const nudge = (which: 's' | 'e', by: number) => {
    const round = (v: number) => Math.max(0, Math.round(v * 10) / 10);
    if (which === 's') setStart((v) => round(v + by));
    else setEnd((v) => round(v + by));
  };

  const recut = async () => {
    setBusy(true);
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'recut', id: draft.id, dance_start: start, dance_end: end, stage_kf: kf }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { onMsg(j.error ?? '作り直しに失敗しました'); return; }
    onMsg(`${stageNoOf(draft)} を ${start.toFixed(1)}s〜${end.toFixed(1)}s で作り直します（Macが1分以内に開始・SSD未接続なら挿した時点で自動実行）`);
    onDone();
  };

  return (
    <div className="rounded-lg border border-sand-200 bg-sand-50 p-3">
      <button onClick={() => setOpen(!open)} className="w-full flex items-start justify-between gap-2 text-left">
        <span className="text-xs font-semibold text-navy-700 min-w-0">
          ✂️ 切り出し {fmtSec(draft.dance_start)}〜{fmtSec(draft.dance_end)}
          <br />
          <span className="text-navy-400 font-normal">元素材 {stageNoOf(draft)} ・{(Number(draft.dance_end) - Number(draft.dance_start)).toFixed(1)}秒</span>
        </span>
        <span className="text-xs text-brand-600 shrink-0 whitespace-nowrap">{open ? '閉じる' : '調整する'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {(['s', 'e'] as const).map((which) => (
            <div key={which}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-navy-500">{which === 's' ? '開始' : '終了'}（元素材の経過秒）</span>
                <input
                  type="number" step="0.1" inputMode="decimal"
                  value={which === 's' ? start : end}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    if (which === 's') setStart(v); else setEnd(v);
                  }}
                  className="w-24 text-right border border-sand-300 rounded-md px-2 py-1 text-sm text-navy-800"
                />
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {/* 指で押す前提なので高さ44px以上を確保する */}
                {[-1, -0.5, 0.5, 1].map((by) => (
                  <button key={by} onClick={() => nudge(which, by)}
                    className="min-h-[44px] text-sm font-semibold rounded-md border border-navy-200 text-navy-700 bg-white active:bg-sand-100">
                    {by > 0 ? `＋${by}s` : `−${Math.abs(by)}s`}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <p className={`text-xs font-semibold ${lenNg ? 'text-red-600' : 'text-navy-600'}`}>
            長さ {len.toFixed(1)}秒{lenNg ? '（3〜90秒にしてください）' : ''}
          </p>

          {/* 切り取る前の映像がある時は「見ながらマーク」できるエディタを主役にする */}
          {draft.wide_path && !wideNg ? (
            <div className="space-y-2">
              <span className="text-[11px] text-navy-500">追従（見ながらマーク）</span>
              <StageTrackEditor src={draft.wide_path} kf={kf} setKf={setKf} clipLen={len}
                onUnavailable={() => setWideNg(true)} />
              <details>
                <summary className="text-[11px] text-navy-500 cursor-pointer select-none">数値で指定する</summary>
                <div className="mt-2"><StageKfControl kf={kf} setKf={setKf} clipLen={len} /></div>
              </details>
            </div>
          ) : (
            <>
              {draft.wide_path && wideNg && (
                <p className="text-[10px] text-amber-700 mb-1">
                  この下書きには切り取る前の映像がまだありません（一度作り直すと次から使えます）。数値で指定してください
                </p>
              )}
              <StageKfControl kf={kf} setKf={setKf} clipLen={len} />
            </>
          )}

          <button disabled={busy || lenNg || !dirty} onClick={recut}
            className="w-full min-h-[48px] text-sm font-semibold rounded-md bg-navy-700 text-white disabled:opacity-40">
            {busy ? '送信中…' : dirty ? '🔄 この設定で作り直す' : '変更なし'}
          </button>
          <p className="text-[10px] text-navy-400">
            作り直すと本編・カバー候補が新しくなります（カバーの選び直しが必要）。キャプションの手直しは残ります
          </p>
        </div>
      )}
    </div>
  );
}

// 発表会リールの新規作成(素材=SSDの本番映像 M01〜M38。Macで生成するのでSSD接続が必要)
// 固定フロー: stage_reel.py(9:16クロップ+主役追従) → outro_logo.sh(確定ロゴ演出) → カバー生成 → 投稿待ち
function StageCreateForm({ onCreated, onMsg, lessons }: { onCreated: () => void; onMsg: (s: string) => void; lessons: Lesson[] }) {
  const [stageNo, setStageNo] = useState('');
  const [title, setTitle] = useState('');
  const [classLabel, setClassLabel] = useState('');
  const [lessonId, setLessonId] = useState<number | null>(null);
  const [instructor, setInstructor] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [kf, setKf] = useState('0=0.5');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create_stage',
        stage_no: stageNo, title, instructor, class_label: classLabel, lesson_master_id: lessonId,
        dance_start: start === '' ? null : Number(start),
        dance_end: end === '' ? null : Number(end),
        stage_kf: kf,
      }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { onMsg(j.error ?? '作成失敗'); return; }
    onMsg(`${stageNo}「${title}」を受け付けました。SSD接続中のMacが本編を確定すると"入力待ち"に出るので、カバーはそこで(スマホでOK)選んでください`);
    setStageNo(''); setTitle(''); setClassLabel(''); setLessonId(null); setInstructor(''); setStart(''); setEnd(''); setKf('0=0.5');
    onCreated();
  };

  return (
    <div className="bg-white rounded-xl border-2 border-brand-200 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-navy-700 mb-1">🎭 発表会リールを作る</h3>
      <p className="text-[11px] text-navy-400 mb-3">
        SSDが要るのはこの切り出し指定だけ。秒数は元動画の経過秒。本編確定後のカバー選定・キャプションはスマホで完結できます
      </p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Field label="演目番号(M01〜M38)"><input value={stageNo} onChange={(e) => setStageNo(e.target.value)} placeholder="M30" className="input" /></Field>
        <Field label="演目名(キャプション用)"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="そのまま" className="input" /></Field>
        <Field label="クラス名(カバーに載る)"><input value={classLabel} onChange={(e) => setClassLabel(e.target.value)} placeholder="水曜TARO HIPHOP" className="input" /></Field>
        <Field label="講師名(タグ用・例 SAYUKI)"><input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="SAYUKI" className="input" /></Field>
        <Field label="見せ場 開始(秒)"><input type="number" step="0.1" value={start} onChange={(e) => setStart(e.target.value)} className="input" /></Field>
        <Field label="見せ場 終了(秒)"><input type="number" step="0.1" value={end} onChange={(e) => setEnd(e.target.value)} className="input" /></Field>
      </div>
      {lessons.length > 0 && (
        <div className="mb-3">
          <LessonPicker value={lessonId}
            onChange={(v) => {
              setLessonId(v);
              // クラス名(カバーに載る)が空なら選んだクラス名を入れておく
              const l = lessons.find((x) => x.id === v);
              if (l && !classLabel.trim()) setClassLabel(l.class_name);
            }}
            lessons={lessons} />
        </div>
      )}
      <div className="mb-3">
        <span className="text-[11px] text-navy-500">主役の位置(クロップ中心)</span>
        <div className="flex gap-1.5 mt-1">
          {KF_PRESET_LIST.map((p) => (
            <button key={p.v} onClick={() => setKf(p.v)}
              className={`px-3 py-1.5 text-xs rounded-md border ${kf === p.v ? 'bg-brand-600 text-white border-brand-600' : 'border-navy-200 text-navy-600 hover:bg-sand-100'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <input value={kf} onChange={(e) => setKf(e.target.value)} className="input mt-1.5" />
        <p className="text-[10px] text-navy-400 mt-0.5">上級: 「クリップ内秒=横位置」をカンマ区切りでパン指定可(例 0=0.5,10=0.3)。0=左端〜1=右端</p>
      </div>
      <div className="flex justify-end">
        <button disabled={busy} onClick={create}
          className="px-4 py-1.5 text-xs rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">✅ 生成を開始</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-navy-500">{label}</span>
      {children}
    </label>
  );
}

function CompactRow({ d, onReset, onMsg }: { d: Draft; onReset: () => void; onMsg: (s: string) => void }) {
  // 予約済み/完了でもキャプション本文を確認・修正できるようにする(TARO 2026-07-28)。
  // 予約済みの編集はAPI側で reel_queue(実際に投稿される文面)にも同期される。
  const [caption, setCaption] = useState(d.caption ?? '');
  const [savingCap, setSavingCap] = useState(false);
  const saveCaption = async () => {
    setSavingCap(true);
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: d.id, caption }),
    });
    setSavingCap(false);
    onMsg(r.ok ? 'キャプションを保存しました（投稿にもそのまま使われます）' : 'キャプション保存に失敗しました');
  };
  const reopen = async () => {
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: d.id, action: 'reset' }),
    });
    if (r.ok) { onMsg('入力待ちに戻しました'); onReset(); }
  };
  const unschedule = async () => {
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'unschedule', id: d.id }),
    });
    const j = await r.json();
    if (r.ok) { onMsg('予約を取り消して投稿待ちに戻しました'); onReset(); } else { onMsg(j.error ?? '取り消し失敗'); }
  };
  return (
    <div className="bg-white rounded-lg border border-sand-200 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-navy-700 truncate">{d.class_name || d.drive_name}{d.instructor ? `（${d.instructor}）` : ''}</p>
          {d.error && <p className="text-[11px] text-red-600 truncate">{d.error}</p>}
          {d.status === 'scheduled' && d.queue_scheduled_at && (
            <p className="text-[11px] text-green-700">📅 {fmtJst(d.queue_scheduled_at)} に投稿予約</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[d.status] ?? ''}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
          {d.reel_path && (
            <a href={d.reel_path} download={`${d.class_name || 'reel'}.mp4`} className="text-[11px] text-brand-600 hover:underline">⬇ 保存</a>
          )}
          {d.status === 'scheduled' && (
            <button onClick={unschedule} className="text-[11px] text-red-500 hover:underline">取り消し</button>
          )}
          {(d.status === 'error' || d.status === 'ready') && (
            <button onClick={reopen} className="text-[11px] text-brand-600 hover:underline">再編集</button>
          )}
        </div>
      </div>
      {d.caption != null && d.caption !== '' && (
        <details className="mt-1.5">
          <summary className="text-[11px] text-navy-500 cursor-pointer select-none">📝 キャプションを確認{d.status === 'scheduled' ? '・編集' : ''}</summary>
          {d.status === 'scheduled' ? (
            <div className="mt-1.5">
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={6}
                className="w-full border border-sand-200 rounded-lg p-2 text-xs text-navy-800" />
              <button onClick={saveCaption} disabled={savingCap}
                className="mt-1 px-3 py-1 text-[11px] rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">保存（投稿文に反映）</button>
            </div>
          ) : (
            <pre className="mt-1.5 text-xs text-navy-700 whitespace-pre-wrap font-sans bg-sand-50 rounded-lg p-2">{d.caption}</pre>
          )}
        </details>
      )}
    </div>
  );
}

/** 次の投稿枠(発表会=金/クラス=火 の19:00 JST)を datetime-local の値で返す */
function defaultSlotLocal(stage: boolean): string {
  const target = stage ? 5 : 2; // 金 or 火
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  for (let i = 0; i <= 14; i++) {
    const d = new Date(jst.getTime() + i * 86400000);
    if (d.getUTCDay() !== target) continue;
    const sameDay = i === 0;
    if (sameDay && jst.getUTCHours() >= 19) continue; // 今日の枠を過ぎていたら次週
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T19:00`;
  }
  return '';
}

// 投稿待ち: 完成リールを確認→キャプション微調整→投稿予約(手動GO)
function ReviewCard({ draft, onChanged, onMsg }: { draft: Draft; onChanged: () => void; onMsg: (s: string) => void }) {
  const stage = draft.kind === '発表会' || draft.kind === 'stage';
  const [caption, setCaption] = useState(draft.caption ?? '');
  const [collab, setCollab] = useState(draft.collaborators ?? '');
  const [dateStr, setDateStr] = useState(''); // datetime-local
  const [busy, setBusy] = useState(false);
  const [pickCover, setPickCover] = useState(false);
  let candidates: Candidate[] = [];
  try { candidates = draft.cover_candidates ? JSON.parse(draft.cover_candidates) : []; } catch { /* ignore */ }

  const resetCaption = async () => {
    if (!window.confirm('キャプションを自動文面に戻しますか？(手直しは消えます)')) return;
    setBusy(true);
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reset_caption', id: draft.id }),
    });
    setBusy(false);
    if (r.ok) { onMsg('自動文面に戻しました(次の生成で作り直されます)'); onChanged(); }
  };

  const saveCaption = async () => {
    setBusy(true);
    await fetch('/api/staff/reel-drafts', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: draft.id, caption }),
    });
    setBusy(false);
    onMsg('キャプションを保存しました');
  };

  const schedule = async (scheduledAt?: string) => {
    setBusy(true);
    // キャプション・共同投稿の編集を反映してから予約(予約時にreel_queueへコピーされるため先に保存)
    const patch: Record<string, unknown> = { id: draft.id };
    if (caption !== (draft.caption ?? '')) patch.caption = caption;
    if (collab !== (draft.collaborators ?? '')) patch.collaborators = collab.trim() || null;
    if (Object.keys(patch).length > 1) {
      await fetch('/api/staff/reel-drafts', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
      });
    }
    const body: Record<string, unknown> = { action: 'schedule', id: draft.id };
    if (scheduledAt) body.scheduled_at = scheduledAt;
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { onMsg(j.error ?? '予約失敗'); return; }
    onMsg(`${fmtJst(j.scheduled_at)} に投稿予約しました`);
    onChanged();
  };

  return (
    <div className="bg-white rounded-xl border-2 border-purple-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-navy-700 truncate">
          {draft.class_name || draft.drive_name}{draft.instructor ? `（${draft.instructor}）` : ''}
          {draft.daytime ? ` ・${draft.daytime}` : ''}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">投稿待ち</span>
      </div>

      {/* 完成リールのプレビュー(これが実際に投稿される動画) */}
      {draft.reel_path && (
        <>
          <video src={draft.reel_path} controls playsInline preload="metadata"
            poster={draft.cover_path ?? undefined} className="w-full max-h-[52vh] rounded-lg bg-black mb-2" />
          <div className="mb-3">
            <a href={draft.reel_path} download={`${draft.class_name || 'reel'}.mp4`}
              className="inline-flex items-center gap-1 text-xs text-brand-700 border border-brand-300 rounded-md px-3 py-1.5 hover:bg-brand-50">
              ⬇ 動画をダウンロード（ストーリー先出し等）
            </a>
          </div>
        </>
      )}

      {/* カバー写真: 一覧で最初に目に入る絵。ここで実物を確認して選び直せる */}
      {draft.cover_path && (
        <div className="mb-3 flex gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draft.cover_path} alt="カバー"
            className="w-24 aspect-[9/16] object-cover rounded-md border border-sand-200 bg-black" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-navy-500">カバー写真（一覧で最初に見える絵）</p>
            <p className="text-[11px] text-navy-400 mt-0.5">{draft.cover_at != null ? `${draft.cover_at}s の場面` : ''}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <a href={draft.cover_path} target="_blank" rel="noreferrer"
                className="text-[11px] text-brand-700 border border-brand-300 rounded-md px-2.5 py-1">拡大して確認</a>
              {stage && (
                <button onClick={() => setPickCover((v) => !v)}
                  className="text-[11px] text-navy-700 border border-navy-200 rounded-md px-2.5 py-1">
                  {pickCover ? '閉じる' : '🖼 カバーを選び直す'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 選び直し: 切り出しはやり直さずカバーだけ作り直す(SSD不要・数十秒) */}
      {pickCover && candidates.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] text-navy-500 mb-1">タップしたコマでカバーを作り直します</p>
          <div className="grid grid-cols-5 gap-1.5">
            {candidates.map((c) => (
              <button key={c.n} disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await fetch('/api/staff/reel-drafts', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ action: 'recover', id: draft.id, cover_at: c.t, cover_choice: c.n }),
                  });
                  const j = await r.json();
                  setBusy(false);
                  if (!r.ok) { onMsg(j.error ?? 'カバーの作り直しに失敗しました'); return; }
                  onMsg(`${c.t}s のコマでカバーを作り直します（1分以内に反映）`);
                  setPickCover(false);
                  onChanged();
                }}
                className="relative rounded-md overflow-hidden border-2 border-transparent disabled:opacity-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt={`候補${c.n}`} className="w-full aspect-[9/16] object-cover" />
                <span className="absolute bottom-0 left-0 text-[9px] bg-black/60 text-white px-1">{c.t}s</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 発表会: この段階でも切り出しをやり直せる(完成を見てから「もう1秒前から」が言える) */}
      {stage && (
        <div className="mb-3">
          <StageCutPanel draft={draft} onDone={onChanged} onMsg={onMsg} />
        </div>
      )}

      <label className="block mb-3">
        <span className="text-[11px] text-navy-500">キャプション（投稿文・編集可）</span>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5}
          className="w-full border border-sand-200 rounded-lg p-2 text-sm text-navy-800 mt-1" />
        <div className="flex gap-3 mt-1">
          <button onClick={saveCaption} disabled={busy}
            className="text-[11px] text-brand-600 hover:underline disabled:opacity-50">キャプションだけ保存</button>
          <button onClick={resetCaption} disabled={busy}
            className="text-[11px] text-navy-400 hover:underline disabled:opacity-50">自動文面に戻す</button>
        </div>
      </label>

      {/* 共同投稿: 承認されると相手のフィードにも並ぶ。自動では入れず、毎回ここで選ぶ(TARO 2026-08-10)。 */}
      <label className="block mb-3">
        <span className="text-[11px] text-navy-500">共同投稿する相手（Instagramのユーザー名・最大3人）</span>
        <input value={collab} onChange={(e) => setCollab(e.target.value)}
          placeholder="例: occhan.88（空欄なら共同投稿しない）"
          className="w-full border border-sand-200 rounded-lg p-2 text-sm text-navy-800 mt-1" />
        <p className="text-[11px] text-navy-400 mt-1">
          相手に招待が届き、承認されると相手の投稿一覧にも並びます。非公開アカウントは指定できません。
          指定が通らなかった場合も、共同投稿なしでリールは投稿されます。
        </p>
      </label>

      <div className="border-t border-sand-100 pt-3">
        <p className="text-[11px] text-navy-500 mb-2">確認できたら投稿予約（ここで初めてInstagramに出ます）</p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => schedule()} disabled={busy}
            className="px-4 py-2 text-sm rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            ▶ 次の{draft.kind === '発表会' || draft.kind === 'stage' ? '金曜' : '火曜'}19時で投稿
          </button>
          <span className="text-navy-300 text-xs">または</span>
          {/* 好きな日時で予約。空なら次の投稿枠を初期値にしておく(スマホで打ち直す手間を減らす) */}
          {/* ⚠️ 入力欄には既定値を表示しているので、TAROが手で触っていなくても
              「画面に見えている日時」で予約できるようにする(TARO 2026-08-04: 押しても
              何も起きなかった。dateStrが空のまま「日時を選んでください」で止まっていた)。 */}
          <input type="datetime-local" value={dateStr || defaultSlotLocal(stage)}
            onChange={(e) => setDateStr(e.target.value)}
            className="border border-sand-200 rounded-md px-2 py-1.5 text-sm text-navy-800" />
          <button onClick={() => {
              const v = dateStr || defaultSlotLocal(stage);
              if (!v) { onMsg('日時を選んでください'); return; }
              schedule(new Date(v).toISOString());
            }} disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md border border-brand-300 text-brand-700 hover:bg-brand-50 disabled:opacity-50">
            この日時で投稿
          </button>
        </div>
      </div>
    </div>
  );
}
