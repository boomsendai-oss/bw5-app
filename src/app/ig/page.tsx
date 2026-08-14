'use client';

// 会員向けInstagramアカウント収集フォーム(公開・任意)。
// 太白まつり出演者募集 src/app/entry/[code]/page.tsx と同じ構造:
//   送信 → 本人専用の編集URLを表示 → 同じ端末なら次回以降は自動で自分の回答を表示。

import { useEffect, useState } from 'react';
import { getPublicView, submit, loadOwn, updateOwn, deleteOwn, type PublicView } from './actions';
import { OWNER_KINDS, ownerKindLabel, MAX_ENTRIES, type OwnerKind } from '@/lib/instagramCollect';

type Row = { memberName: string; memberNameKana: string; handle: string; ownerKind: '' | OwnerKind };

const emptyRow = (): Row => ({ memberName: '', memberNameKana: '', handle: '', ownerKind: '' });
const TOKEN_KEY = 'boom_ig_collect_token';

export default function IgCollectPage() {
  const [view, setView] = useState<PublicView | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneToken, setDoneToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    (async () => {
      setView(await getPublicView());
      setLoading(false);
      const url = new URL(window.location.href);
      const t = url.searchParams.get('t') || localStorage.getItem(TOKEN_KEY);
      if (t) setToken(t);
    })();
  }, []);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const r = await loadOwn(token);
      if (r.ok) {
        setRows(
          r.submission.entries.map((e) => ({
            memberName: e.memberName,
            memberNameKana: e.memberNameKana,
            handle: e.handle,
            ownerKind: e.ownerKind,
          }))
        );
        setEditing(true);
        setReviewing(true);
        localStorage.setItem(TOKEN_KEY, token);
      }
    })();
  }, [token]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function onSubmit() {
    setError('');
    setBusy(true);
    const payload = { entries: rows };
    if (editing && token) {
      const r = await updateOwn(token, payload);
      setBusy(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setReviewing(true);
      return;
    }
    const r = await submit(payload);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    localStorage.setItem(TOKEN_KEY, r.token);
    setDoneToken(r.token);
    setToken(r.token);
  }

  async function onDelete() {
    if (!token) return;
    setBusy(true);
    const r = await deleteOwn(token);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setEditing(false);
    setReviewing(false);
    setRows([emptyRow()]);
    setDeleted(true);
  }

  if (loading) {
    return <div className="min-h-screen bg-slate-50 grid place-items-center text-sm text-slate-400">読み込み中…</div>;
  }

  if (deleted) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="max-w-md mx-auto space-y-4 text-center">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-base font-bold text-slate-800">取り消しました</div>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              お預かりしていたアカウントは削除しました。ご協力ありがとうございました。
            </p>
          </div>
          <button onClick={() => setDeleted(false)} className="w-full text-sm text-slate-500 underline">
            もう一度入力する
          </button>
        </div>
      </div>
    );
  }

  // 送信直後: 編集用URLを渡す
  if (doneToken) {
    const editUrl = `${window.location.origin}/ig?t=${doneToken}`;
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="max-w-md mx-auto space-y-4">
          <div className="rounded-2xl border border-teal-200 bg-white p-6 text-center">
            <div className="text-base font-bold text-teal-700">送信しました</div>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">ありがとうございます。</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-bold text-slate-700 mb-2">修正・取り消し用のリンク</div>
            <input
              readOnly
              value={editUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full text-xs text-slate-900 border border-slate-300 rounded-lg px-2 py-2 bg-white"
            />
            <button
              onClick={() => {
                setCopied(true);
                try {
                  navigator.clipboard?.writeText(editUrl);
                } catch {
                  /* フォールバック: 上の欄を長押し/選択でコピー */
                }
              }}
              className={`mt-2 w-full rounded-lg text-white text-sm font-bold py-2 ${copied ? 'bg-emerald-600' : 'bg-teal-600'}`}
            >
              {copied ? '✓ コピーしました' : 'リンクをコピー'}
            </button>
          </div>
          <p className="text-center text-[11px] text-slate-400 px-2">
            同じ端末（このスマホ／パソコン）なら、次からこのページを開くだけで自分の回答が表示されます。
            気が変わったときはいつでも取り消せます。
          </p>
          <button
            onClick={() => {
              setDoneToken(null);
              setEditing(true);
              setReviewing(true);
            }}
            className="w-full text-sm text-slate-500 underline"
          >
            回答内容を確認する
          </button>
        </div>
      </div>
    );
  }

  const s = view!.settings;

  // 既存回答の確認モード
  if (reviewing) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="max-w-md mx-auto space-y-4">
          <h1 className="text-xl font-bold text-slate-800 text-center">Instagramアカウントの登録</h1>
          <div className="rounded-2xl border border-teal-200 bg-white p-4">
            <div className="text-xs font-bold text-teal-700 mb-2">✅ この内容でお預かりしています</div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-sm font-bold text-slate-800">{r.memberName}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    @{r.handle}（{r.ownerKind ? ownerKindLabel(r.ownerKind) : '未選択'}のアカウント）
                  </div>
                </div>
              ))}
            </div>
          </div>
          {error && <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <button
            onClick={() => setReviewing(false)}
            className="w-full rounded-2xl bg-teal-600 text-white text-base font-bold py-3"
          >
            内容を修正する
          </button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="w-full text-sm text-slate-500 underline">
              登録を取り消す
            </button>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 text-center">
              <p className="text-sm text-slate-700">取り消すと、お預かりしたアカウントは削除されます。よろしいですか？</p>
              <button
                onClick={onDelete}
                disabled={busy}
                className="w-full rounded-xl bg-slate-700 text-white text-sm font-bold py-2.5 disabled:opacity-50"
              >
                取り消す
              </button>
              <button onClick={() => setConfirmDelete(false)} className="w-full text-sm text-slate-500 underline">
                やめる
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-xl font-bold text-slate-800 text-center">Instagramアカウントの登録</h1>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
          {s.introMd}
        </div>

        {!s.isOpen && !editing ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
            現在は受付を停止しています。
          </div>
        ) : (
          <>
            {rows.map((r, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-500">{rows.length > 1 ? `${i + 1}人目` : '会員さんのお名前'}</div>
                  {rows.length > 1 && (
                    <button
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      className="text-xs text-slate-400 underline"
                    >
                      この人を消す
                    </button>
                  )}
                </div>

                <label className="block">
                  <span className="text-xs text-slate-500">お名前（漢字）</span>
                  <input
                    value={r.memberName}
                    onChange={(e) => setRow(i, { memberName: e.target.value })}
                    placeholder="例）木村 花子"
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base text-slate-900 bg-white"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-slate-500">フリガナ（カタカナ）</span>
                  <input
                    value={r.memberNameKana}
                    onChange={(e) => setRow(i, { memberNameKana: e.target.value })}
                    placeholder="例）キムラ ハナコ"
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base text-slate-900 bg-white"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-slate-500">Instagramのアカウント名</span>
                  <input
                    value={r.handle}
                    onChange={(e) => setRow(i, { handle: e.target.value })}
                    placeholder="例）boom_sendai"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base text-slate-900 bg-white"
                  />
                  <span className="block text-[11px] text-slate-400 mt-1">
                    プロフィール画面の「@」から始まる名前です。@は付けても付けなくても大丈夫です。
                    プロフィールのURLを貼っていただいても構いません。
                  </span>
                </label>

                <div>
                  <span className="text-xs text-slate-500">どなたのアカウントですか？</span>
                  <div className="mt-1 grid grid-cols-4 gap-1.5">
                    {OWNER_KINDS.map((k) => (
                      <button
                        key={k}
                        onClick={() => setRow(i, { ownerKind: k })}
                        className={`rounded-lg py-2 text-sm font-bold border ${
                          r.ownerKind === k
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        {ownerKindLabel(k)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {rows.length < MAX_ENTRIES && (
              <button
                onClick={() => setRows((prev) => [...prev, emptyRow()])}
                className="w-full rounded-2xl border border-dashed border-slate-300 bg-white text-sm text-slate-500 py-3"
              >
                ＋ ごきょうだいなど、もう1人追加する
              </button>
            )}

            {error && <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}

            <button
              onClick={onSubmit}
              disabled={busy}
              className="w-full rounded-2xl bg-teal-600 text-white text-base font-bold py-3 disabled:opacity-50"
            >
              {busy ? '送信中…' : editing ? '内容を更新する' : '送信する'}
            </button>

            <p className="text-center text-[11px] text-slate-400 px-2 leading-relaxed">
              入力は任意です。送ったあとで気が変わったときは、いつでも取り消せます。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
