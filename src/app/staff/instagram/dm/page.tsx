'use client';

// スタッフ: Instagram DM 台帳。受信したDM・自動返信の記録・TAROの手動返信。
// 入力欄は文字色と背景色を必ず明示する(白文字×白背景の事故防止)。

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

type Thread = {
  sender_id: string;
  username: string | null;
  display_name: string | null;
  first_in_at: string;
  last_in_at: string;
  last_out_at: string | null;
  last_text: string | null;
  status: 'new' | 'needs_reply' | 'auto_replied' | 'done' | string;
  note: string;
  auto_reply_kinds: string;
  canReply: boolean;
};

type Msg = {
  id: number;
  direction: 'in' | 'out';
  text: string | null;
  attachments: string;
  kind: string | null;
  sent_by: string | null;
  ig_timestamp: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  new: '新規',
  needs_reply: '返信待ち',
  auto_replied: '自動案内済み',
  done: '対応済み',
};

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function StaffInstagramDmPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [canReply, setCanReply] = useState(false);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [webhookConfigured, setWebhookConfigured] = useState<boolean | null>(null);

  const loadThreads = useCallback(async () => {
    const r = await fetch('/api/staff/instagram/dm', { cache: 'no-store' });
    if (!r.ok) {
      setInfo(`読み込み失敗 (${r.status})`);
      return;
    }
    const j = await r.json();
    setThreads(j.threads ?? []);
    setWebhookConfigured(!!j.webhookConfigured);
  }, []);

  const loadThread = useCallback(async (senderId: string) => {
    const r = await fetch(`/api/staff/instagram/dm?sender=${encodeURIComponent(senderId)}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    setMessages(j.messages ?? []);
    setCanReply(!!j.canReply);
    setNote(j.thread?.note ?? '');
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (selected) loadThread(selected);
  }, [selected, loadThread]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setInfo(null);
    try {
      const r = await fetch('/api/staff/instagram/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setInfo(j.error ?? `失敗 (${r.status})`);
        return false;
      }
      return j;
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    if (!window.confirm('この内容でDMを送信します。よろしいですか？')) return;
    const ok = await post({ action: 'reply', senderId: selected, text: reply });
    if (ok) {
      setReply('');
      setInfo('送信しました');
      await loadThread(selected);
      await loadThreads();
    }
  };

  const setStatus = async (status: string) => {
    if (!selected) return;
    const ok = await post({ action: 'status', senderId: selected, status, note });
    if (ok) {
      setInfo('更新しました');
      await loadThreads();
    }
  };

  const subscribe = async () => {
    const r = await post({ action: 'subscribe' });
    if (r) setInfo(`購読を有効化しました: ${JSON.stringify(r.result)}`);
  };

  const sel = threads.find((t) => t.sender_id === selected) ?? null;
  const inputCls = 'w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-navy-900 placeholder:text-neutral-400';

  return (
    <div>
      <StaffPageHeader title="インスタDM台帳" description="受信したDM・自動返信・手動返信" backHref="/staff/instagram" backLabel="Instagram" />
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        {webhookConfigured === false && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Webhookの検証トークン(INSTAGRAM_WEBHOOK_VERIFY_TOKEN)が未設定です。Vercelの環境変数を確認してください。
          </p>
        )}
        {info && <p className="rounded-lg bg-sand-50 px-3 py-2 text-xs text-navy-900">{info}</p>}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={loadThreads} className="rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-navy-900">
            再読み込み
          </button>
          <button type="button" onClick={subscribe} disabled={busy} className="rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-navy-900 disabled:opacity-50">
            Webhook購読を有効化(連携後に1回)
          </button>
          <span className="text-neutral-500">手動返信は相手の最終メッセージから24時間以内のみ(Meta仕様)。過ぎたらインスタアプリから。</span>
        </div>

        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <section className="rounded-2xl border border-sand-200 bg-white">
            <p className="border-b border-sand-200 px-3 py-2 text-xs font-bold text-navy-900">スレッド {threads.length}件</p>
            <ul className="max-h-[70vh] divide-y divide-sand-100 overflow-auto">
              {threads.length === 0 && <li className="px-3 py-4 text-xs text-neutral-500">まだDMはありません</li>}
              {threads.map((t) => (
                <li key={t.sender_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.sender_id)}
                    className={`w-full px-3 py-2 text-left ${selected === t.sender_id ? 'bg-sand-50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-navy-900">{t.username ? `@${t.username}` : t.display_name || t.sender_id}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          t.status === 'needs_reply' ? 'bg-red-100 text-red-700' : t.status === 'done' ? 'bg-neutral-100 text-neutral-500' : 'bg-teal-50 text-teal-700'
                        }`}
                      >
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-neutral-500">{t.last_text}</p>
                    <p className="text-[10px] text-neutral-400">{fmt(t.last_in_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-sand-200 bg-white p-3">
            {!sel && <p className="text-xs text-neutral-500">左のスレッドを選ぶと会話が出ます</p>}
            {sel && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 pb-2">
                  <div>
                    <p className="text-sm font-bold text-navy-900">{sel.username ? `@${sel.username}` : sel.display_name || sel.sender_id}</p>
                    <p className="text-[10px] text-neutral-400">
                      初回 {fmt(sel.first_in_at)} ／ 最終受信 {fmt(sel.last_in_at)} ／ 自動返信: {sel.auto_reply_kinds}
                    </p>
                  </div>
                  <div className="flex gap-1 text-xs">
                    {(['needs_reply', 'auto_replied', 'done'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={busy}
                        onClick={() => setStatus(s)}
                        className={`rounded-lg border px-2 py-1 ${sel.status === s ? 'border-navy-900 bg-navy-900 text-white' : 'border-sand-300 bg-white text-navy-900'}`}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>

                <ul className="my-3 max-h-[45vh] space-y-2 overflow-auto">
                  {messages.map((m) => (
                    <li key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                          m.direction === 'out' ? 'bg-navy-900 text-white' : 'bg-sand-50 text-navy-900'
                        }`}
                      >
                        {m.text || (m.attachments && m.attachments !== '[]' ? `[添付 ${m.attachments}]` : '(本文なし)')}
                        <p className={`mt-1 text-[10px] ${m.direction === 'out' ? 'text-sand-200' : 'text-neutral-400'}`}>
                          {fmt(m.ig_timestamp || m.created_at)}
                          {m.direction === 'out' && ` ・ ${m.sent_by === 'auto' ? `自動(${m.kind})` : m.sent_by === 'staff' ? 'スタッフ' : 'インスタアプリ'}`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="space-y-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={4}
                    placeholder={canReply ? '返信を書く(送信前に確認が出ます)' : '24時間を過ぎているためここからは送れません'}
                    disabled={!canReply || busy}
                    className={`${inputCls} disabled:bg-neutral-100`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={sendReply}
                      disabled={!canReply || busy || !reply.trim()}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      DMを送信
                    </button>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="メモ(人数・名前など。状態ボタンで保存)"
                      className={`${inputCls} flex-1`}
                    />
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
