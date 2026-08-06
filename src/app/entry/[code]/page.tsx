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

// choices: パートごとに 出演する('yes') / 出演しない('no') / 未回答(キー無し)
// avail: 9/26(BOOMER'S FIGHT!!!)に出演できるか(未回答=undefined)
type PerformerRow = { name: string; choices: Record<string, 'yes' | 'no'>; avail?: 'yes' | 'no' };

// 送信用に「出演する」パートだけ配列化
function yesParts(choices: Record<string, 'yes' | 'no'>): PartKey[] {
  return Object.keys(choices).filter((k) => choices[k] === 'yes') as PartKey[];
}

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
  const [reviewing, setReviewing] = useState(false); // 既存申込を読み取り表示中（まだ編集していない）

  const [understood, setUnderstood] = useState(false);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<PerformerRow[]>([{ name: '', choices: {} }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneToken, setDoneToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
        setRows(
          r.signup.performers.map((p) => ({
            name: p.name,
            choices: Object.fromEntries(p.parts.map((k) => [k, 'yes' as const])),
            avail: p.availability ?? undefined,
          }))
        );
        setEditing(true);
        setReviewing(true);
        localStorage.setItem(tokenStorageKey(code), token);
      }
    })();
  }, [token, code]);

  const setChoice = useCallback((idx: number, key: PartKey, val: 'yes' | 'no') => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        // 同じボタンを再タップしたら選択解除（未回答に戻す）
        if (r.choices[key] === val) {
          const next = { ...r.choices };
          delete next[key];
          return { ...r, choices: next };
        }
        return { ...r, choices: { ...r.choices, [key]: val } };
      })
    );
  }, []);

  function addRow() {
    setRows((r) => [...r, { name: '', choices: {} }]);
  }
  function removeRow(idx: number) {
    setRows((r) => (r.length <= 1 ? r : r.filter((_, i) => i !== idx)));
  }

  async function onSubmit() {
    setError('');
    setSubmitting(true);
    try {
      const payload: SignupInput = {
        understood,
        note,
        performers: rows.map((r) => ({ name: r.name, parts: yesParts(r.choices), availability: r.avail })),
      };
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
              className="w-full text-xs text-slate-900 border border-slate-300 rounded-lg px-2 py-2 bg-white"
            />
            <button
              onClick={() => {
                setCopied(true);
                try { navigator.clipboard?.writeText(editUrl); } catch { /* フォールバック: 上の欄を長押し/選択でコピー */ }
              }}
              className={`mt-2 w-full rounded-lg text-white text-sm font-bold py-2 ${copied ? 'bg-emerald-600' : 'bg-teal-600'}`}
            >
              {copied ? '✓ コピーしました' : 'リンクをコピー'}
            </button>
          </div>
          <p className="text-center text-[11px] text-slate-400 px-2">
            同じ端末（このスマホ／パソコン）なら、次からこのページを開くだけで自分の申込が表示されます。上の編集用リンクは、別の端末で直すときのために保管してください。
          </p>
          <button
            onClick={() => { setDoneToken(null); setEditing(true); setReviewing(true); setToken(doneToken); }}
            className="w-full text-sm text-slate-500 underline"
          >
            申込内容を確認する
          </button>
        </div>
      </div>
    );
  }

  const s = view.settings;

  // 既存申込の確認モード（同じ端末での再訪 or 送信直後の「確認」）。
  // いきなり編集させず、内容を表示して「内容を修正する」を押してから編集に入る。
  if (reviewing) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="max-w-md mx-auto space-y-4">
          <h1 className="text-xl font-bold text-slate-800 text-center">{view.eventName}</h1>

          {rows.some((r) => r.name.trim() && !r.avail) && (
            <div className="rounded-xl bg-amber-50 border border-amber-300 px-3 py-2.5 text-xs text-amber-800 text-center font-bold">
              ⚠ 出演イベントが 9/26(土) BOOMER&apos;S FIGHT!!! に変わりました。
              <span className="block font-normal mt-0.5">下の「回答する」ボタンから、9/26に出演できるかどうかを選んで送信してください。</span>
            </div>
          )}

          <div className="rounded-2xl border border-teal-200 bg-white p-4">
            <div className="text-xs font-bold text-teal-700 mb-2">✅ この内容で申込済みです</div>
            <div className="space-y-2">
              {rows.filter((r) => r.name.trim()).map((r, i) => (
                <div key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-800">{r.name}</div>
                    <span
                      className={`text-[10px] font-bold rounded-full px-2 py-0.5 border shrink-0 ${
                        r.avail === 'yes'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                          : r.avail === 'no'
                            ? 'bg-rose-50 text-rose-700 border-rose-300'
                            : 'bg-amber-50 text-amber-700 border-amber-300'
                      }`}
                    >
                      {r.avail === 'yes' ? '9/26 出演できる' : r.avail === 'no' ? '9/26 出演できない' : '9/26 未回答'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {yesParts(r.choices).map((k) => parts.find((p) => p.key === k)?.label ?? k).join(' / ') || 'パート未選択'}
                  </div>
                </div>
              ))}
              {note.trim() && <div className="text-xs text-slate-500">メモ：{note}</div>}
            </div>
          </div>

          <p className="text-center text-[11px] text-slate-400 px-2">
            同じ端末なら、次からこのページを開くだけでこの内容が表示されます。修正したいときは下のボタンから。
          </p>

          <button
            onClick={() => setReviewing(false)}
            className="w-full rounded-2xl bg-teal-600 text-white text-base font-bold py-3"
          >
            {rows.some((r) => r.name.trim() && !r.avail) ? '9/26に出られるか回答する' : '内容を修正する'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-xl font-bold text-slate-800 text-center">{view.eventName}</h1>

        {editing && (
          <div className="rounded-xl bg-amber-50 border border-amber-300 px-3 py-2.5 text-xs text-amber-800 text-center font-bold">
            ⚠ 出演イベントが 9/26(土) BOOMER&apos;S FIGHT!!! に変わりました。
            <span className="block font-normal mt-0.5">出演者ごとに「出演できる／できない」を選び直して、最後に「内容を更新する」を押してください。</span>
          </div>
        )}

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
                      className={`w-full border rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 ${
                        row.name.trim() && !isKatakanaName(row.name) ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'
                      }`}
                    />
                    {row.name.trim() && !isKatakanaName(row.name) ? (
                      <p className="text-[11px] text-red-600 mt-1">お名前はカタカナでご入力ください（例：ヤマダ ハナコ）</p>
                    ) : (
                      <p className="text-[11px] text-slate-400 mt-1">※お名前はカタカナでご入力ください</p>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 mb-1.5">
                      各パートに<span className="font-bold">出演するか</span>を選んでください（複数OK）
                    </div>
                    <div className="space-y-2">
                      {parts.map((p) => {
                        const choice = row.choices[p.key];
                        return (
                          <div
                            key={p.key}
                            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                              choice === 'yes' ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-white'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-800">{p.label}</div>
                              {p.lesson && <div className="text-[11px] text-slate-400">{p.lesson}で振り入れ</div>}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => setChoice(idx, p.key, 'yes')}
                                className={`rounded-lg px-3 py-1.5 text-xs font-bold border ${
                                  choice === 'yes'
                                    ? 'bg-teal-600 text-white border-teal-600'
                                    : 'bg-white text-slate-600 border-slate-300'
                                }`}
                              >
                                出演する
                              </button>
                              <button
                                type="button"
                                onClick={() => setChoice(idx, p.key, 'no')}
                                className={`rounded-lg px-3 py-1.5 text-xs font-bold border ${
                                  choice === 'no'
                                    ? 'bg-slate-500 text-white border-slate-500'
                                    : 'bg-white text-slate-600 border-slate-300'
                                }`}
                              >
                                出演しない
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* 9/26 出欠 */}
                  <div className={`rounded-xl border px-3 py-2.5 ${
                    row.avail ? (row.avail === 'yes' ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50') : 'border-amber-300 bg-amber-50'
                  }`}>
                    <div className="text-xs font-bold text-slate-700 mb-1.5">9/26(土) に出演できますか？</div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, avail: 'yes' } : r)))}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold border ${
                          row.avail === 'yes' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        出演できる
                      </button>
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, avail: 'no' } : r)))}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold border ${
                          row.avail === 'no' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        出演できない
                      </button>
                    </div>
                    {!row.avail && row.name.trim() && (
                      <p className="text-[11px] text-amber-700 mt-1">どちらかを選んでください</p>
                    )}
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
              className="w-full border border-slate-300 rounded-2xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 bg-white"
            />

            {error && <div className="text-sm text-red-600 text-center">{error}</div>}

            <button
              onClick={onSubmit}
              disabled={submitting || rows.some((r) => r.name.trim() !== '' && (!isKatakanaName(r.name) || !r.avail))}
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
