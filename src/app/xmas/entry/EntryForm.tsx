'use client';

// 出演エントリーフォーム。合計 = メンバー数 × 出演料 + 入場チケット(前売)×まとめ買いの枚数。請求額はサーバが再計算する。
// 入場チケットは最初メンバー数と同じ枚数にしておき、先に予約済みのメンバーがいれば減らしてもらう(TARO 2026-10-20)。
// 出演はカード払いのみ(後からのキャンセルで枠が空くと困るため・TARO 2026-10-15)。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GRADES, GRADE_SHORT, MAX_MEMBERS, MIN_MEMBERS, yen } from '@/lib/party';
import { startXmasCheckout, submitXmasEntry } from '../actions';
import { Field, Notice, Panel, errCls, greenBtnCls, inputCls } from '../ui';
import { useFieldErrors } from '../useFieldErrors';
import { SHOWCASE_ORDER_NOTE } from '../content';

const GENRES = ['HIPHOP', 'JAZZ', 'HOUSE', 'GIRLS', 'BREAKIN', 'LOCK', 'POP', 'WAACK', 'K-POP', 'MIX'];

interface MemberRow {
  name: string;
  grade: string;
}

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
  const [teamKana, setTeamKana] = useState('');
  const [genre, setGenre] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([
    { name: '', grade: '' },
    { name: '', grade: '' },
  ]);
  const [buyerName, setBuyerName] = useState('');
  const [buyerKana, setBuyerKana] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fe = useFieldErrors();
  // 入場チケットの枚数。触るまではメンバー数に合わせて自動で増減する
  const [ticketPick, setTicketPick] = useState<number | null>(null);

  const filled = members.filter((m) => m.name.trim()).length;
  const tickets = ticketPick == null ? filled : Math.min(ticketPick, filled);
  const total = filled * p.entryUnit + tickets * p.presalePrice;

  function setMember(i: number, patch: Partial<MemberRow>) {
    setMembers((prev) => prev.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agree) {
      setError('「原則返金不可」をご確認のうえチェックしてください');
      return;
    }
    setBusy(true);
    setError('');
    const r = await submitXmasEntry({
      teamName,
      teamKana,
      genre,
      members,
      ticketCount: tickets,
      buyerName,
      buyerKana,
      email,
      phone,
      payMethod: 'card',
    });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    const c = await startXmasCheckout(r.token);
    if (c.ok) {
      window.location.href = c.url;
      return;
    }
    router.push(`/xmas/my?t=${r.token}`);
  }

  return (
    <form onSubmit={submit}>
      <Notice>
        残り {p.teamsLeft} チーム ・ エントリー締切 {p.entryDeadline}
      </Notice>

      <Panel title="出演の前に" tone="red">
        <ul className="space-y-1 text-sm font-bold">
          <li>・リハーサルの時間はありません</li>
          <li>
            ・{SHOWCASE_ORDER_NOTE}
          </li>
          <li>・音源は後日でOK。エントリー後に届くメールの「提出ページ」から {p.audioDeadline} までに出してください</li>
        </ul>
      </Panel>

      <Panel title="チーム" tone="green">
        <Field label="チーム名">
          <input className={inputCls} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="例: BOOM KIDS" />
        </Field>
        <Field label="チーム名のふりがな" hint="当日のMCが読み上げます" error={fe.errs.teamKana}>
          <input
            className={inputCls + errCls(fe.errs.teamKana)}
            value={teamKana}
            onChange={(e) => {
              setTeamKana(e.target.value);
              fe.clear('teamKana');
            }}
            onBlur={(e) => fe.check('teamKana', 'kana', e.target.value)}
            placeholder="例: ぶーむ きっず"
          />
        </Field>
        <Field label="ジャンル">
          <input className={inputCls} value={genre} onChange={(e) => setGenre(e.target.value)} list="xmas-genres" placeholder="例: HIPHOP" />
          <datalist id="xmas-genres">
            {GENRES.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <Field label={`メンバー全員の名前と学年(${MIN_MEMBERS}人以上)`} hint="BOOMの生徒ではない友達も参加OK">
          <div className="space-y-2">
            {members.map((m, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_6.75rem] gap-2">
                <input
                  className={inputCls}
                  value={m.name}
                  onChange={(e) => setMember(i, { name: e.target.value })}
                  placeholder={`メンバー${i + 1}の名前`}
                />
                <select
                  className={`${inputCls} px-2 text-sm`}
                  value={m.grade}
                  onChange={(e) => setMember(i, { grade: e.target.value })}
                  aria-label={`メンバー${i + 1}の学年`}
                >
                  <option value="">学年</option>
                  {GRADES.map(([k]) => (
                    <option key={k} value={k}>
                      {GRADE_SHORT[k]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Field>
        {members.length < MAX_MEMBERS && (
          <button
            type="button"
            onClick={() => setMembers((prev) => [...prev, { name: '', grade: '' }])}
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
        <Field label="ふりがな" error={fe.errs.kana}>
          <input
            className={inputCls + errCls(fe.errs.kana)}
            value={buyerKana}
            onChange={(e) => {
              setBuyerKana(e.target.value);
              fe.clear('kana');
            }}
            onBlur={(e) => fe.check('kana', 'kana', e.target.value)}
            placeholder="例: きむら たろう"
          />
        </Field>
        <Field label="メールアドレス" hint="控えと、音源の提出ページのURLが届きます" error={fe.errs.email}>
          <input
            className={inputCls + errCls(fe.errs.email)}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              fe.clear('email');
            }}
            onBlur={(e) => fe.check('email', 'email', e.target.value)}
            placeholder="例: boom@example.com"
            autoComplete="email"
          />
        </Field>
        <Field label="電話番号" error={fe.errs.phone}>
          <input
            className={inputCls + errCls(fe.errs.phone)}
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              fe.clear('phone');
            }}
            onBlur={(e) => fe.check('phone', 'phone', e.target.value)}
            placeholder="例: 09012345678"
            autoComplete="tel"
          />
        </Field>
      </Panel>

      <Panel title="出演メンバーの入場チケット" tone="red">
        <p className="text-sm font-bold">
          入場には、出演メンバーも1人ずつ入場チケット(前売{yen(p.presalePrice)})が必要です。ここで一緒に買えます。
        </p>
        <p className="mt-1 text-xs font-bold text-neutral-700">
          すでにチケットを予約したメンバーがいる場合は、その人数分だけ減らしてください。付き添いの保護者の方のチケットは、チケット予約のページからお申し込みください。
        </p>
        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setTicketPick(Math.max(0, tickets - 1))}
            disabled={tickets <= 0}
            className="h-12 w-12 rounded-full border-[3px] border-[#1a1410] bg-white text-2xl font-black text-[#1a1410] disabled:opacity-30"
            aria-label="入場チケットを1枚減らす"
          >
            −
          </button>
          <p className="min-w-[7rem] text-center text-2xl font-black text-[#1a1410]">
            {tickets} <span className="text-base">枚</span>
          </p>
          <button
            type="button"
            onClick={() => setTicketPick(Math.min(filled, tickets + 1))}
            disabled={tickets >= filled}
            className="h-12 w-12 rounded-full border-[3px] border-[#1a1410] bg-white text-2xl font-black text-[#1a1410] disabled:opacity-30"
            aria-label="入場チケットを1枚増やす"
          >
            ＋
          </button>
        </div>
        <p className="mt-2 text-center text-xs font-bold text-neutral-700">メンバー {filled}人中 {tickets}人分</p>
      </Panel>

      <Panel title="お支払い(カードのみ)" tone="green">
        <div className="rounded-lg border-[3px] border-[#1a1410] bg-[#f4cf3e] p-3 text-center">
          <p className="text-sm font-black">
            出演料 {yen(p.entryUnit)} × {filled}人
          </p>
          <p className="text-sm font-black">
            入場チケット {yen(p.presalePrice)} × {tickets}枚
          </p>
          <p className="text-3xl font-black">{yen(total)}</p>
          {tickets < filled && (
            <p className="text-xs font-bold">
              残りの {filled - tickets}人分の入場チケットは、チケット予約のページで予約してください(予約済みならそのままでOK)
            </p>
          )}
        </div>
        <p className="mt-3 text-xs font-bold text-neutral-700">
          出演エントリーはカード払いのみです。30分以内に決済が完了すると、エントリーが確定します。
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm font-bold">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 accent-[#2f8a3e]" />
          お申し込み後は、原則として返金できないことを確認しました
        </label>
      </Panel>

      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" disabled={busy} className={`mt-6 ${greenBtnCls}`}>
        {busy ? '送信中…' : 'カード決済に進む'}
      </button>
    </form>
  );
}
