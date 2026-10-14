'use client';

// 出演エントリーフォーム。合計 = メンバー数 × (出演料 + 参加費)。請求額はサーバが再計算する。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_MEMBERS, MIN_MEMBERS, yen } from '@/lib/party';
import { startXmasCheckout, submitXmasEntry } from '../actions';
import { Field, Notice, Panel, greenBtnCls, inputCls } from '../ui';

const GENRES = ['HIPHOP', 'JAZZ', 'HOUSE', 'GIRLS', 'BREAKIN', 'LOCK', 'POP', 'WAACK', 'K-POP', 'MIX'];

export default function EntryForm(p: {
  entryUnit: number;
  performerFee: number;
  presalePrice: number;
  teamsLeft: number;
  entryDeadline: string;
  audioDeadline: string;
}) {
  const router = useRouter();
  const [teamName, setTeamName] = useState('');
  const [genre, setGenre] = useState('');
  const [members, setMembers] = useState<string[]>(['', '']);
  const [buyerName, setBuyerName] = useState('');
  const [buyerKana, setBuyerKana] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [payMethod, setPayMethod] = useState<'card' | 'cash' | ''>('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filled = members.filter((m) => m.trim()).length;
  const total = filled * p.entryUnit;

  function setMember(i: number, v: string) {
    setMembers((prev) => prev.map((m, j) => (j === i ? v : m)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agree) {
      setError('「原則返金不可」をご確認のうえチェックしてください');
      return;
    }
    setBusy(true);
    setError('');
    const r = await submitXmasEntry({ teamName, genre, members, buyerName, buyerKana, email, phone, payMethod });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    if (r.payMethod === 'card') {
      const c = await startXmasCheckout(r.token);
      if (c.ok) {
        window.location.href = c.url;
        return;
      }
    }
    router.push(`/xmas/my?t=${r.token}`);
  }

  return (
    <form onSubmit={submit}>
      <Notice>残り {p.teamsLeft} チーム ・ エントリー締切 {p.entryDeadline}</Notice>

      <Panel title="チーム" tone="green">
        <Field label="チーム名">
          <input className={inputCls} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="例: BOOM KIDS" />
        </Field>
        <Field label="ジャンル">
          <input className={inputCls} value={genre} onChange={(e) => setGenre(e.target.value)} list="xmas-genres" placeholder="例: HIPHOP" />
          <datalist id="xmas-genres">
            {GENRES.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <Field label={`メンバー全員の名前(${MIN_MEMBERS}人以上)`} hint="BOOMの生徒ではない友達も入れてOK">
          <div className="space-y-2">
            {members.map((m, i) => (
              <input
                key={i}
                className={inputCls}
                value={m}
                onChange={(e) => setMember(i, e.target.value)}
                placeholder={`メンバー${i + 1}`}
              />
            ))}
          </div>
        </Field>
        {members.length < MAX_MEMBERS && (
          <button
            type="button"
            onClick={() => setMembers((prev) => [...prev, ''])}
            className="mt-2 w-full rounded-lg border-[3px] border-dashed border-[#1a1410] bg-white py-2 text-sm font-black text-[#1a1410]"
          >
            ＋ メンバーを追加
          </button>
        )}
      </Panel>

      <Panel title="代表者(連絡先)">
        <Field label="お名前" hint="保護者の方でもOKです">
          <input className={inputCls} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="例: 木村 太郎" autoComplete="name" />
        </Field>
        <Field label="ふりがな">
          <input className={inputCls} value={buyerKana} onChange={(e) => setBuyerKana(e.target.value)} placeholder="例: きむら たろう" />
        </Field>
        <Field label="メールアドレス" hint="控えと音源の提出ページのURLが届きます">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="例: boom@example.com" autoComplete="email" />
        </Field>
        <Field label="電話番号">
          <input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="例: 09012345678" autoComplete="tel" />
        </Field>
      </Panel>

      <Panel title="お支払い" tone="green">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['card', 'カードで今払う'],
            ['cash', '当日、会場で現金'],
          ].map(([v, label]) => (
            <button
              type="button"
              key={v}
              onClick={() => setPayMethod(v as 'card' | 'cash')}
              className={`rounded-lg border-[3px] border-[#1a1410] px-2 py-3 text-sm font-black ${payMethod === v ? 'bg-[#2f8a3e] text-white' : 'bg-white text-[#1a1410]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-lg border-[3px] border-[#1a1410] bg-[#f4cf3e] p-3 text-center">
          <p className="text-sm font-black">
            1人 {yen(p.entryUnit)}(出演料 {yen(p.performerFee)} + 参加費 {yen(p.presalePrice)}) × {filled}人
          </p>
          <p className="text-3xl font-black">{yen(total)}</p>
          <p className="text-xs font-bold">出演メンバーはパーティーの参加申込は不要です</p>
        </div>
        <p className="mt-3 text-xs font-bold text-neutral-700">
          音源はエントリー後の控えページから {p.audioDeadline} までにアップロードしてください。
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm font-bold">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 accent-[#2f8a3e]" />
          お申し込み後は、原則として返金できないことを確認しました
        </label>
      </Panel>

      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" disabled={busy} className={`mt-6 ${greenBtnCls}`}>
        {busy ? '送信中…' : payMethod === 'card' ? 'カード決済に進む' : 'エントリーする'}
      </button>
    </form>
  );
}
