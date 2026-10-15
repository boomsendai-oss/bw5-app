'use client';

// 音源提出: メールアドレスかチーム名でチームを探す → そのチーム専用のアップロード欄を出す。
// 画面に出すのはチーム名と提出状況だけ(個人情報は出さない)。
import { useState } from 'react';
import { findXmasEntryForAudio, type XmasAudioLookup } from '../actions';
import AudioUpload from '../my/AudioUpload';
import { Field, Notice, inputCls, greenBtnCls } from '../ui';

type Team = Extract<XmasAudioLookup, { ok: true }>['teams'][number];

export default function AudioLookup() {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [picked, setPicked] = useState<Team | null>(null);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await findXmasEntryForAudio(query);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setTeams(r.teams);
    setPicked(r.teams.length === 1 ? r.teams[0] : null);
  }

  function reset() {
    setTeams(null);
    setPicked(null);
    setQuery('');
  }

  if (picked) {
    return (
      <div>
        <div className="-rotate-1 border-[3px] border-[#1a1410] bg-[#f4cf3e] px-3 py-2 text-center shadow-[3px_3px_0_#1a1410]">
          <p className="text-xs font-black">チーム専用アップロード</p>
          <p className="text-xl font-black">{picked.teamName}</p>
        </div>
        {picked.audioFilename ? (
          <p className="mt-3 rounded-lg border-[3px] border-[#1a1410] bg-white p-2 text-sm font-black">
            提出済み: {picked.audioFilename}(差し替える場合は新しいファイルを選んでください)
          </p>
        ) : (
          <p className="mt-3 text-sm font-black text-[#d4302a]">まだ提出されていません</p>
        )}
        <AudioUpload credential={picked.ticket} orderId={picked.orderId} />
        <p className="mt-3 text-xs font-bold text-neutral-700">
          提出・差し替えをすると、エントリー時のメールアドレスにお知らせが届きます。
        </p>
        <button type="button" onClick={reset} className="mt-4 text-xs font-black underline">
          ← 別のチームを探す
        </button>
      </div>
    );
  }

  if (teams && teams.length > 1) {
    return (
      <div>
        <p className="text-sm font-black">チームを選んでください</p>
        <div className="mt-3 space-y-2">
          {teams.map((t) => (
            <button
              type="button"
              key={t.orderId}
              onClick={() => setPicked(t)}
              className="block w-full rounded-lg border-[3px] border-[#1a1410] bg-white px-3 py-3 text-left text-base font-black text-[#1a1410]"
            >
              {t.teamName}
              <span className="block text-xs font-bold text-neutral-600">{t.audioFilename ? `提出済み: ${t.audioFilename}` : '未提出'}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={reset} className="mt-4 text-xs font-black underline">
          ← 探し直す
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <Field label="メールアドレス または チーム名" hint="どちらか一つでOK。エントリー時のメールアドレスか、チーム名(ひらがな・カタカナどちらでも)">
        <input
          className={inputCls}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例: boom@example.com / BOOM KIDS"
          autoComplete="email"
        />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" disabled={busy} className={`mt-5 ${greenBtnCls}`}>
        {busy ? '探しています…' : 'チームを探す'}
      </button>
    </form>
  );
}
