'use client';

// 会員Instagram 承認キュー(スタッフ専用)。
// 候補は出すだけで自動確定しない。「承認して紐付ける」を押したときだけ boom_members に書く。

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';
import { loadBoard, approve, reject, unlink, updateSettings } from './actions';
import { ownerKindLabel } from '@/lib/instagramCollect';
import type { StaffEntry, CollectSettings } from '@/lib/instagramCollectDb';

type Summary = { total: number; pending: number; approved: number; linkedMembers: number };

const CONFIDENCE_STYLE: Record<string, string> = {
  高: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  要確認: 'bg-amber-50 text-amber-700 border-amber-300',
  なし: 'bg-slate-100 text-slate-500 border-slate-300',
};

export default function MemberInstagramPage() {
  const [entries, setEntries] = useState<StaffEntry[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [settings, setSettings] = useState<CollectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tab, setTab] = useState<'pending' | 'done' | 'settings'>('pending');
  const [introDraft, setIntroDraft] = useState('');
  const [savedNote, setSavedNote] = useState('');

  const refresh = useCallback(async () => {
    const r = await loadBoard();
    setLoading(false);
    if (!r.ok) {
      setError(r.error === 'Unauthorized' ? 'ログインが必要です' : r.error);
      return;
    }
    setError('');
    setEntries(r.entries);
    setSum(r.summary);
    setSettings(r.settings);
    setIntroDraft(r.settings.introMd);
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
    })();
  }, [refresh]);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, id: number) {
    setBusyId(id);
    const r = await fn();
    setBusyId(null);
    if (!r.ok) {
      setError(r.error ?? '失敗しました');
      return;
    }
    await refresh();
  }

  const pending = entries.filter((e) => e.match_state === 'pending');
  const done = entries.filter((e) => e.match_state !== 'pending');
  const shown = tab === 'pending' ? pending : done;

  return (
    <div className="min-h-screen bg-sand-50">
      <StaffPageHeader
        title="📷 会員Instagram"
        description="会員から届いたInstagramアカウントを、確認して会員データベースに紐付けます"
      />

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="rounded-xl border border-sand-200 bg-white p-3 text-xs text-navy-700 leading-relaxed">
          会員のInstagramの<b>正本は会員データベース（boom_members）</b>です。この画面で「承認して紐付ける」を押すと、
          そこに書き込まれます。ここに並んでいるのは<b>届いた回答そのもの</b>で、承認するまで会員データベースには何も入りません。
          <br />
          収集フォームのURL: <code className="bg-sand-100 px-1 rounded">/ig</code>
        </div>

        {sum && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: '届いた回答', value: sum.total },
              { label: '未処理', value: sum.pending },
              { label: '承認済み', value: sum.approved },
              { label: '紐付いた会員', value: sum.linkedMembers },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-sand-200 bg-white p-3 text-center">
                <div className="text-[11px] text-navy-500">{c.label}</div>
                <div className="text-xl font-bold text-navy-900">{c.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {(
            [
              ['pending', `未処理 (${pending.length})`],
              ['done', `処理済み (${done.length})`],
              ['settings', '設定'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold border ${
                tab === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-navy-600 border-sand-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {loading && <div className="text-sm text-navy-400">読み込み中…</div>}

        {tab === 'settings' && settings && (
          <div className="rounded-xl border border-sand-200 bg-white p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                checked={settings.isOpen}
                onChange={(e) => setSettings({ ...settings, isOpen: e.target.checked })}
              />
              受付中にする（外すとフォームは「受付を停止しています」になります。取り消しは停止中でもできます）
            </label>
            <label className="block">
              <span className="text-xs text-navy-500">フォームに出す説明文</span>
              <textarea
                value={introDraft}
                onChange={(e) => setIntroDraft(e.target.value)}
                rows={16}
                className="mt-1 w-full border border-sand-300 rounded-lg px-3 py-2 text-sm text-navy-900 bg-white font-mono"
              />
            </label>
            <button
              onClick={async () => {
                const r = await updateSettings({ isOpen: settings.isOpen, introMd: introDraft });
                setSavedNote(r.ok ? '保存しました' : (r.error ?? '失敗しました'));
                await refresh();
              }}
              className="rounded-lg bg-brand-600 text-white text-sm font-bold px-4 py-2"
            >
              保存する
            </button>
            {savedNote && <span className="ml-2 text-sm text-navy-500">{savedNote}</span>}
          </div>
        )}

        {tab !== 'settings' && !loading && shown.length === 0 && (
          <div className="rounded-xl border border-sand-200 bg-white p-6 text-center text-sm text-navy-400">
            {tab === 'pending' ? 'まだ未処理の回答はありません。' : 'まだ処理済みの回答はありません。'}
          </div>
        )}

        {tab !== 'settings' &&
          shown.map((e) => (
            <div key={e.id} className="rounded-xl border border-sand-200 bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-base font-bold text-navy-900">
                    {e.member_name}
                    <span className="ml-2 text-xs font-normal text-navy-500">{e.member_name_kana}</span>
                  </div>
                  <div className="text-sm text-navy-700 mt-0.5">
                    <a
                      href={`https://www.instagram.com/${e.handle}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-700 underline"
                    >
                      @{e.handle}
                    </a>
                    <span className="ml-2 text-xs text-navy-500">{ownerKindLabel(e.owner_kind)}のアカウント</span>
                  </div>
                </div>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 border ${CONFIDENCE_STYLE[e.suggestion.confidence]}`}>
                  {e.match_state === 'approved'
                    ? `紐付け済み: ${e.matched_member_name ?? `会員#${e.matched_member_id}`}`
                    : e.match_state === 'rejected'
                      ? '保留にした'
                      : `候補 ${e.suggestion.confidence}`}
                </span>
              </div>

              {e.note && <div className="text-xs text-navy-500">メモ: {e.note}</div>}

              {e.match_state === 'pending' && (
                <>
                  {e.suggestion.candidates.length === 0 ? (
                    <div className="rounded-lg bg-sand-50 px-3 py-2 text-sm text-navy-600">
                      会員データベースに一致する人が見つかりませんでした。氏名の表記ゆれ・退会済みなどの可能性があります。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {e.suggestion.candidates.map((c) => (
                        <div
                          key={c.member_id}
                          className="rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 flex items-center justify-between gap-3 flex-wrap"
                        >
                          <div className="text-sm text-navy-800">
                            <b>{c.full_name}</b>
                            <span className="ml-2 text-xs text-navy-500">
                              {c.hacomono_member_id} / {c.status}
                              {c.reason === 'name' && '（漢字一致・カナは不一致）'}
                            </span>
                            {c.overwrites && (
                              <div className="text-xs text-amber-700 mt-0.5">
                                ⚠ この会員には既に @{c.existing_handle} が入っています。承認すると上書きされます
                              </div>
                            )}
                          </div>
                          <button
                            disabled={busyId === e.id}
                            onClick={() => act(() => approve(e.id, c.member_id), e.id)}
                            className="rounded-lg bg-brand-600 text-white text-sm font-bold px-3 py-1.5 disabled:opacity-50"
                          >
                            承認して紐付ける
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    disabled={busyId === e.id}
                    onClick={() => act(() => reject(e.id), e.id)}
                    className="text-xs text-navy-500 underline disabled:opacity-50"
                  >
                    保留にする（紐付けない）
                  </button>
                </>
              )}

              {e.match_state !== 'pending' && (
                <button
                  disabled={busyId === e.id}
                  onClick={() => act(() => unlink(e.id), e.id)}
                  className="text-xs text-navy-500 underline disabled:opacity-50"
                >
                  {e.match_state === 'approved' ? '紐付けを解除して未処理に戻す' : '未処理に戻す'}
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
