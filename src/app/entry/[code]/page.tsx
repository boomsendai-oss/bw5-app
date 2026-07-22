'use client';

import { useCallback, useEffect, useMemo, useState, use as usePromise } from 'react';
import {
  getPublicView,
  submitSignup,
  loadOwnSignup,
  updateOwnSignup,
  type PublicView,
} from './actions';
import { isKatakanaName, type PartDef, type PartKey, type SignupInput } from '@/lib/eventSignup';
import FlowDiagram from './FlowDiagram';

type PerformerRow = { name: string; parts: PartKey[] };

function tokenStorageKey(code: string) {
  return `taihaku_signup_token_${code}`;
}

export default function EntryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = usePromise(params);
  const [view, setView] = useState<PublicView | null>(null);
  const [loading, setLoading] = useState(true);

  // token（自己編集用）: URLの ?t= か localStorage から
  const [token, setToken] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [understood, setUnderstood] = useState(false);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<PerformerRow[]>([{ name: '', parts: [] }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneToken, setDoneToken] = useState<string | null>(null);

  const parts: PartDef[] = useMemo(
    () => (view && view.ok ? view.settings.parts : []),
    [view]
  );

  useEffect(() => {
    (async () => {
      const v = await getPublicView(code);
      setView(v);
      setLoading(false);
      // token 解決: URL優先→localStorage
      const url = new URL(window.location.href);
      const t = url.searchParams.get('t') || localStorage.getItem(tokenStorageKey(code));
      if (t) setToken(t);
    })();
  }, [code]);

  // token があれば自分の申込をロードして編集モードに
  useEffect(() => {
    if (!token) return;
    (async () => {
      const r = await loadOwnSignup(code, token);
      if (r.ok) {
        setUnderstood(true);
        setNote(r.signup.note);
        setRows(r.signup.performers.map((p) => ({ name: p.name, parts: p.parts })));
        setEditing(true);
        localStorage.setItem(tokenStorageKey(code), token);
      }
    })();
  }, [token, code]);

  const togglePart = useCallback((idx: number, key: PartKey) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx
          ? { ...r, parts: r.parts.includes(key) ? r.parts.filter((k) => k !== key) : [...r.parts, key] }
          : r
      )
    );
  }, []);

  function addRow() {
    setRows((r) => [...r, { name: '', parts: [] }]);
  }
  function removeRow(idx: number) {
    setRows((r) => (r.length <= 1 ? r : r.filter((_, i) => i !== idx)));
  }

  async function onSubmit() {
    setError('');
    setSubmitting(true);
    try {
      const payload: SignupInput = { understood, note, performers: rows };
      if (editing && token) {
        const r = await updateOwnSignup(code, token, payload);
        if (!r.ok) { setError(r.error); return; }
        setDoneToken(token);
      } else {
        const r = await submitSignup(code, payload);
        if (!r.ok) { setError(r.error); return; }
        localStorage.setItem(tokenStorageKey(code), r.token);
        setDoneToken(r.token);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">読み込み中…</div>;
  }
  if (!view || !view.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center text-slate-500">
        {view && !view.ok ? view.error : 'エラーが発生しました'}
      </div>
    );
  }

  // サンクス画面
  if (doneToken) {
    const editUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/entry/${code}?t=${doneToken}`;
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="max-w-md mx-auto space-y-4">
          <div className="rounded-2xl border border-teal-200 bg-white p-5 text-center">
            <div className="text-2xl mb-1">✅</div>
            <h1 className="text-lg font-bold text-slate-800">申込を受け付けました</h1>
            <p className="text-sm text-slate-500 mt-1">ありがとうございます。</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-bold text-slate-500 mb-1">編集用リンク（保管してください）</div>
            <p className="text-[11px] text-slate-400 mb-2">
              このリンクから、あとで内容を修正できます。別の端末で直すときに使うので、LINEのトークに残すかブックマークしてください。
            </p>
            <input
              readOnly
              value={editUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50"
            />
            <button
              onClick={() => navigator.clipboard?.writeText(editUrl)}
              className="mt-2 w-full rounded-lg bg-teal-600 text-white text-sm font-bold py-2"
            >
              リンクをコピー
            </button>
          </div>
          <button
            onClick={() => { setDoneToken(null); setEditing(true); setToken(doneToken); }}
            className="w-full text-sm text-slate-500 underline"
          >
            続けて内容を確認・修正する
          </button>
        </div>
      </div>
    );
  }

  const s = view.settings;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-xl font-bold text-slate-800 text-center">{view.eventName}</h1>

        {/* 説明 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
          {s.introMd}
        </div>

        {/* 参加費 */}
        {s.feeText && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-sm font-bold text-amber-800">
            {s.feeText}
          </div>
        )}

        {/* 流れ図 */}
        <FlowDiagram parts={parts} />

        {/* カレンダーリンク */}
        {s.calendarUrl && (
          <a
            href={s.calendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm font-bold text-teal-700"
          >
            📅 全体リハ・HIPHOPの日程（Googleカレンダー）を見る
          </a>
        )}

        {/* 受付停止 */}
        {!s.isOpen && !editing && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
            現在は受付を停止しています。
          </div>
        )}

        {(s.isOpen || editing) && (
          <>
            {/* 理解チェック */}
            <label className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>上記の内容（日時・会場・参加費・演目の流れ）を読み、理解しました。</span>
            </label>

            {/* 出演者ブロック */}
            <div className="space-y-3">
              {rows.map((row, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-slate-500">出演者 {idx + 1}</div>
                    {rows.length > 1 && (
                      <button onClick={() => removeRow(idx)} className="text-xs text-red-500">削除</button>
                    )}
                  </div>
                  <div>
                    <input
                      value={row.name}
                      onChange={(e) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
                      placeholder="おなまえ（カタカナ）"
                      className={`w-full border rounded-lg px-3 py-2 text-sm ${
                        row.name.trim() && !isKatakanaName(row.name) ? 'border-red-400 bg-red-50' : 'border-slate-200'
                      }`}
                    />
                    {row.name.trim() && !isKatakanaName(row.name) ? (
                      <p className="text-[11px] text-red-600 mt-1">お名前はカタカナでご入力ください（例：ヤマダ ハナコ）</p>
                    ) : (
                      <p className="text-[11px] text-slate-400 mt-1">※お名前はカタカナでご入力ください</p>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1.5">希望パート（複数選べます）</div>
                    <div className="flex flex-wrap gap-2">
                      {parts.map((p) => {
                        const on = row.parts.includes(p.key);
                        return (
                          <button
                            key={p.key}
                            type="button"
                            onClick={() => togglePart(idx, p.key)}
                            className={`rounded-full px-3 py-1.5 text-xs font-bold border ${
                              on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-300'
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={addRow}
                className="w-full rounded-2xl border border-dashed border-slate-300 bg-white py-3 text-sm font-bold text-slate-500"
              >
                ＋ 出演者を追加（兄弟など）
              </button>
            </div>

            {/* メモ */}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="連絡事項があればご記入ください（任意）"
              rows={2}
              className="w-full border border-slate-200 rounded-2xl px-3 py-2 text-sm bg-white"
            />

            {error && <div className="text-sm text-red-600 text-center">{error}</div>}

            <button
              onClick={onSubmit}
              disabled={submitting || rows.some((r) => r.name.trim() !== '' && !isKatakanaName(r.name))}
              className="w-full rounded-2xl bg-teal-600 text-white text-base font-bold py-3 disabled:opacity-50"
            >
              {submitting ? '送信中…' : editing ? '内容を更新する' : '申し込む'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
