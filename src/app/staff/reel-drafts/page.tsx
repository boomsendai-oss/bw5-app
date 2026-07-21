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
  cover_candidates: string | null;
  dance_start: number | null;
  dance_end: number | null;
  cover_at: number | null;
  cover_choice: number | null;
  status: string;
  reel_queue_id: number | null;
  error: string | null;
  updated_at: string;
};
type Signal = { sync_requested_at: string | null; generate_requested_at: string | null; updated_at: string | null };

const STATUS_LABEL: Record<string, string> = {
  new: '取込中', need_input: '入力待ち', ready: '生成待ち', generating: '生成中', done: '完了', error: 'エラー',
};
const STATUS_STYLE: Record<string, string> = {
  need_input: 'bg-amber-100 text-amber-800', ready: 'bg-brand-100 text-brand-700',
  generating: 'bg-blue-100 text-blue-700', done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700', new: 'bg-sand-200 text-navy-700',
};

export default function ReelDraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>('');

  const load = useCallback(async () => {
    const r = await fetch('/api/staff/reel-drafts', { cache: 'no-store' });
    if (!r.ok) { setMsg('読み込み失敗'); setLoading(false); return; }
    const j = await r.json();
    setDrafts(j.drafts ?? []);
    setSignal(j.signal ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sendSignal = async (kind: 'sync' | 'generate') => {
    setMsg(kind === 'sync' ? '同期を要求しました…(Macが1分以内に反応)' : '生成を要求しました…(Macが1分以内に反応)');
    await fetch('/api/staff/reel-drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signal: kind }),
    });
    setTimeout(load, 800);
  };

  const pending = drafts.filter((d) => d.status === 'need_input');
  const inFlight = drafts.filter((d) => d.status === 'ready' || d.status === 'generating');
  const settled = drafts.filter((d) => d.status === 'done' || d.status === 'error' || d.status === 'new');

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

        {loading ? (
          <p className="text-navy-500">読み込み中…</p>
        ) : (
          <>
            <Section title={`入力待ち (${pending.length})`} empty="Driveに新しいクリップが上がると、ここに並びます">
              {pending.map((d) => <DraftEditor key={d.id} draft={d} onSaved={load} onMsg={setMsg} />)}
            </Section>

            {inFlight.length > 0 && (
              <Section title={`生成待ち・生成中 (${inFlight.length})`}>
                {inFlight.map((d) => <CompactRow key={d.id} d={d} onReset={load} onMsg={setMsg} />)}
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

function DraftEditor({ draft, onSaved, onMsg }: { draft: Draft; onSaved: () => void; onMsg: (s: string) => void }) {
  const [className, setClassName] = useState(draft.class_name ?? '');
  const [instructor, setInstructor] = useState(draft.instructor ?? '');
  const [daytime, setDaytime] = useState(draft.daytime ?? '');
  const [danceStart, setDanceStart] = useState(fmt(draft.dance_start));
  const [danceEnd, setDanceEnd] = useState(fmt(draft.dance_end));
  const [coverAt, setCoverAt] = useState<number | null>(draft.cover_at);
  const [coverChoice, setCoverChoice] = useState<number | null>(draft.cover_choice);
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
      cover_at: coverAt, cover_choice: coverChoice, ...extra,
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
    if (await patch({}, 'submit')) { onMsg(`「${className || draft.drive_name}」を生成待ちにしました`); onSaved(); }
  };

  const seekTo = (t: number) => { if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.pause(); } };

  return (
    <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-navy-400 truncate">{draft.drive_name}{draft.shot_at ? ` ・${draft.shot_at.slice(0, 16).replace('T', ' ')}` : ''}</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[draft.status] ?? ''}`}>{STATUS_LABEL[draft.status] ?? draft.status}</span>
      </div>

      {/* プレビュー(スクラブバー)。位置を踊り出し/終わり/カバーに反映できる */}
      {draft.preview_path && (
        <div className="mb-3">
          <video ref={videoRef} src={draft.preview_path} controls playsInline preload="metadata"
            className="w-full max-h-[46vh] rounded-lg bg-black" />
          <div className="flex flex-wrap gap-2 mt-2">
            <button onClick={() => { const t = grab(); if (t != null) setDanceStart(String(t)); }}
              className="px-2.5 py-1 text-xs rounded-md border border-navy-200 text-navy-700 hover:bg-sand-100">⏱ 再生位置を踊り出しに</button>
            <button onClick={() => { const t = grab(); if (t != null) setDanceEnd(String(t)); }}
              className="px-2.5 py-1 text-xs rounded-md border border-navy-200 text-navy-700 hover:bg-sand-100">⏱ 再生位置を踊り終わりに</button>
            <button onClick={() => { const t = grab(); if (t != null) { setCoverAt(t); setCoverChoice(null); } }}
              className="px-2.5 py-1 text-xs rounded-md border border-brand-300 text-brand-700 hover:bg-brand-50">🖼 この瞬間をカバーに</button>
          </div>
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

      {/* 数値・テキスト入力 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Field label="踊り出し(秒)"><input type="number" step="0.1" value={danceStart} onChange={(e) => setDanceStart(e.target.value)} className="input" /></Field>
        <Field label="踊り終わり(秒)"><input type="number" step="0.1" value={danceEnd} onChange={(e) => setDanceEnd(e.target.value)} className="input" /></Field>
        <Field label="カバー秒(候補タップで自動)"><input type="number" step="0.1" value={coverAt ?? ''} onChange={(e) => { setCoverAt(e.target.value === '' ? null : Number(e.target.value)); setCoverChoice(null); }} className="input" /></Field>
        <Field label="曜日・時間"><input value={daytime} onChange={(e) => setDaytime(e.target.value)} placeholder="日曜11:00" className="input" /></Field>
        <Field label="クラス名"><input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="はじめてのヒップホップ" className="input" /></Field>
        <Field label="講師"><input value={instructor} onChange={(e) => setInstructor(e.target.value)} placeholder="KEIKO" className="input" /></Field>
      </div>

      <div className="flex justify-end gap-2">
        <button disabled={saving} onClick={() => patch({}).then((ok) => ok && onMsg('下書きを保存しました'))}
          className="px-3 py-1.5 text-xs rounded-md border border-navy-200 text-navy-600 hover:bg-sand-100 disabled:opacity-50">下書き保存</button>
        <button disabled={saving} onClick={submit}
          className="px-4 py-1.5 text-xs rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">✅ 生成待ちにする</button>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-navy-500">{label}</span>
      {children}
    </label>
  );
}

function CompactRow({ d, onReset, onMsg }: { d: Draft; onReset: () => void; onMsg: (s: string) => void }) {
  const reopen = async () => {
    const r = await fetch('/api/staff/reel-drafts', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: d.id, action: 'reset' }),
    });
    if (r.ok) { onMsg('入力待ちに戻しました'); onReset(); }
  };
  return (
    <div className="bg-white rounded-lg border border-sand-200 px-3 py-2 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm text-navy-700 truncate">{d.class_name || d.drive_name}{d.instructor ? `（${d.instructor}）` : ''}</p>
        {d.error && <p className="text-[11px] text-red-600 truncate">{d.error}</p>}
        {d.reel_queue_id && <p className="text-[11px] text-green-700">投稿キュー #{d.reel_queue_id} に投入済み</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[d.status] ?? ''}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
        {(d.status === 'error' || d.status === 'ready') && (
          <button onClick={reopen} className="text-[11px] text-brand-600 hover:underline">再編集</button>
        )}
      </div>
    </div>
  );
}
