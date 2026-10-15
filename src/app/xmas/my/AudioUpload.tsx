'use client';

// 音源のアップロード。Vercel Blob へブラウザから直接送る(関数の本文上限4.5MBを超えるため)。
// 保存先トークンは /api/xmas/audio-upload が申込トークンを確かめてから発行する。
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import { PARTY_EVENT_KEY } from '@/lib/party';
import { saveXmasAudio } from '../actions';
import { Notice, greenBtnCls } from '../ui';

const MAX_MB = 50;

export default function AudioUpload({ credential, orderId }: { credential: string; orderId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  async function send() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMsg({ tone: 'error', text: 'ファイルを選んでください' });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setMsg({ tone: 'error', text: `ファイルが大きすぎます(${MAX_MB}MBまで)` });
      return;
    }
    setBusy(true);
    setMsg(null);
    setPct(0);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'audio';
      const blob = await upload(`${PARTY_EVENT_KEY}/audio/${orderId}-${safe}`, file, {
        access: 'public',
        handleUploadUrl: '/api/xmas/audio-upload',
        clientPayload: credential,
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: (p) => setPct(Math.round(p.percentage)),
      });
      const r = await saveXmasAudio(credential, blob.url, file.name);
      if (!r.ok) throw new Error(r.error);
      setMsg({ tone: 'info', text: `提出しました: ${file.name}` });
      router.refresh();
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'アップロードに失敗しました' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac"
        className="block w-full rounded-lg border-[3px] border-[#1a1410] bg-white p-2 text-sm font-bold text-[#1a1410] file:mr-3 file:rounded file:border-0 file:bg-[#1a1410] file:px-3 file:py-2 file:font-black file:text-white"
      />
      <button type="button" onClick={send} disabled={busy} className={`mt-3 ${greenBtnCls}`}>
        {busy ? `アップロード中… ${pct}%` : '音源をアップロードする'}
      </button>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
