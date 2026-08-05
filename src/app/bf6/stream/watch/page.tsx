'use client';

// ⚠️ 公開ページ(認証なし)。理由: BF6オンライン配信の視聴ページ。
// 実際の視聴にはメール+視聴キーの一致が必要(同時1端末・ハートビート制御)。
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { heartbeatBf6Stream, loginBf6Stream } from '../actions';
import { Bf6Card, Bf6Field, Bf6Hero, Bf6Shell, btnPrimaryCls, inputCls } from '../../ui';

const HEARTBEAT_MS = 20_000;

function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem('bf6_stream_session');
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem('bf6_stream_session', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export default function Bf6StreamWatchPage() {
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('');
  const [kicked, setKicked] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 前回入力の復元(リロード対応)。ハイドレーション後に非同期で反映
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const savedEmail = localStorage.getItem('bf6_stream_email');
        const savedKey = localStorage.getItem('bf6_stream_key');
        if (savedEmail) setEmail(savedEmail);
        if (savedKey) setKey(savedKey);
      } catch { /* private mode */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function handleLogin() {
    setBusy(true);
    setError('');
    const sessionId = getSessionId();
    const res = await loginBf6Stream(email, key, sessionId);
    setBusy(false);
    if (!res.ok) {
      setError(
        res.reason === 'busy'
          ? 'このキーは他の端末で視聴中です。もう一方の端末で視聴をやめてから約1分後にお試しください'
          : res.reason === 'not_ready'
            ? '配信の準備中です。開始までお待ちください'
            : res.reason === 'closed'
              ? 'アーカイブの公開期間が終了しました。ご視聴ありがとうございました!'
              : 'メールアドレスまたは視聴キーが正しくありません'
      );
      return;
    }
    try {
      localStorage.setItem('bf6_stream_email', email);
      localStorage.setItem('bf6_stream_key', key);
    } catch { /* private mode */ }
    setIframeSrc(res.iframeSrc);
    setKicked(false);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const hb = await heartbeatBf6Stream(key, sessionId);
      if (!hb.ok && hb.reason === 'taken') {
        setKicked(true);
        setIframeSrc('');
        if (timer.current) clearInterval(timer.current);
      }
    }, HEARTBEAT_MS);
  }

  if (iframeSrc) {
    return (
      <Bf6Shell wide>
        <div>
          <Bf6Hero title="LIVE" subtitle="BOOMER'S FIGHT!!! vol.6 オンライン配信" />
          <div className="px-4 py-4">
            <div className="overflow-hidden rounded-2xl bg-black ring-1 ring-neutral-700" style={{ aspectRatio: '16 / 9' }}>
              <iframe
                src={iframeSrc}
                className="h-full w-full"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
            <p className="mt-3 text-center text-xs text-neutral-400">
              映像が始まらない場合は再生ボタンを押してください。配信開始前は待機画面が表示されます
            </p>
            <button
              onClick={() => {
                setIframeSrc('');
                if (timer.current) clearInterval(timer.current);
              }}
              className="mx-auto mt-4 block rounded-xl border border-neutral-700 px-4 py-2 text-sm font-bold text-neutral-400"
            >
              視聴をやめる
            </button>
          </div>
        </div>
      </Bf6Shell>
    );
  }

  return (
    <Bf6Shell>
      <div>
        <Bf6Hero title="WATCH" subtitle="オンライン配信 視聴ページ" />
        <div className="space-y-4 px-4 py-6">
          {kicked && (
            <p className="rounded-xl border-2 border-red-600 bg-red-950/40 p-4 text-sm font-bold text-red-300">
              別の端末で視聴が開始されたため、この端末の再生を停止しました。
            </p>
          )}
          <Bf6Card>
            <div className="space-y-4">
              <Bf6Field label="メールアドレス" required hint="購入時にご入力いただいたアドレス">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </Bf6Field>
              <Bf6Field label="視聴キー" required hint="メールで届いた BF6-XXXX-XXXX-XXXX 形式のキー">
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="BF6-XXXX-XXXX-XXXX"
                  className={`${inputCls} font-mono uppercase`}
                />
              </Bf6Field>
              {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
              <button
                onClick={handleLogin}
                disabled={busy || !email.trim() || !key.trim()}
                className={`w-full rounded-2xl py-4 text-lg font-black active:scale-[0.99] disabled:opacity-50 ${btnPrimaryCls}`}
              >
                {busy ? '確認中…' : '視聴する'}
              </button>
            </div>
          </Bf6Card>
          <p className="text-center text-xs text-neutral-400">
            1つのキーで同時に視聴できるのは1台までです。<br />
            チケットをお持ちでない方は <Link href="/bf6/stream" className="font-bold text-red-400 underline">こちらから購入</Link>
          </p>
        </div>
      </div>
    </Bf6Shell>
  );
}
