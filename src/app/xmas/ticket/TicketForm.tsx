'use client';

// 参加申込フォーム。合計は表示用に同じ計算関数で出す(請求額はサーバが再計算する)。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_INFANTS, MAX_PEOPLE, XMAS_EVENT_INFO, ticketTotal, yen, DEFAULT_PARTY_SETTINGS } from '@/lib/party';
import { startXmasCheckout, submitXmasTicket } from '../actions';
import { Field, Notice, Panel, inputCls, primaryBtnCls } from '../ui';

export default function TicketForm(p: {
  presalePrice: number;
  cardOpen: boolean;
  cashOpen: boolean;
  cardDeadline: string;
  cashDeadline: string;
}) {
  const router = useRouter();
  const [buyerName, setBuyerName] = useState('');
  const [buyerKana, setBuyerKana] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isMember, setIsMember] = useState('');
  const [peopleCount, setPeopleCount] = useState(1);
  const [infantCount, setInfantCount] = useState(0);
  const [payMethod, setPayMethod] = useState<'card' | 'cash' | ''>(p.cardOpen ? '' : 'cash');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const total = ticketTotal(peopleCount, { ...DEFAULT_PARTY_SETTINGS, presalePrice: p.presalePrice });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agree) {
      setError('「原則返金不可」をご確認のうえチェックしてください');
      return;
    }
    setBusy(true);
    setError('');
    const r = await submitXmasTicket({ buyerName, buyerKana, email, phone, isMember, peopleCount, infantCount, payMethod });
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
      <Panel title="代表者">
        <Field label="お名前">
          <input className={inputCls} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="例: 木村 太郎" autoComplete="name" />
        </Field>
        <Field label="ふりがな" hint="当日、会場の名簿はふりがな順に並びます">
          <input className={inputCls} value={buyerKana} onChange={(e) => setBuyerKana(e.target.value)} placeholder="例: きむら たろう" />
        </Field>
        <Field label="メールアドレス" hint="申込の控えが届きます">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="例: boom@example.com" autoComplete="email" />
        </Field>
        <Field label="電話番号">
          <input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="例: 09012345678" autoComplete="tel" />
        </Field>
        <Field label="BOOMの会員ですか？">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['member', '会員'],
              ['non_member', '会員ではない(お友達など)'],
            ].map(([v, label]) => (
              <button
                type="button"
                key={v}
                onClick={() => setIsMember(v)}
                className={`rounded-lg border-[3px] border-[#1a1410] px-2 py-3 text-sm font-black ${isMember === v ? 'bg-[#2f8a3e] text-white' : 'bg-white text-[#1a1410]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
      </Panel>

      <Panel title="人数" tone="green">
        <Field label={`小学生以上(1人 ${yen(p.presalePrice)})`} hint="保護者の方も人数に含めてください">
          <select className={inputCls} value={peopleCount} onChange={(e) => setPeopleCount(Number(e.target.value))}>
            {Array.from({ length: MAX_PEOPLE }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}人</option>
            ))}
          </select>
        </Field>
        <Field label="未就学児(無料)">
          <select className={inputCls} value={infantCount} onChange={(e) => setInfantCount(Number(e.target.value))}>
            {Array.from({ length: MAX_INFANTS + 1 }, (_, i) => i).map((n) => (
              <option key={n} value={n}>{n}人</option>
            ))}
          </select>
        </Field>
      </Panel>

      <Panel title="お支払い">
        <div className="space-y-2">
          <PayOption
            active={payMethod === 'card'}
            disabled={!p.cardOpen}
            onClick={() => setPayMethod('card')}
            title="カードで今払う"
            note={p.cardOpen ? `${p.cardDeadline} まで` : '受付終了'}
          />
          <PayOption
            active={payMethod === 'cash'}
            disabled={!p.cashOpen}
            onClick={() => setPayMethod('cash')}
            title="当日、会場で現金で払う"
            note={p.cashOpen ? `${p.cashDeadline} まで予約できます` : '受付終了'}
          />
        </div>
        <div className="mt-4 rounded-lg border-[3px] border-[#1a1410] bg-[#f4cf3e] p-3 text-center">
          <p className="text-sm font-black">合計(前売 {yen(p.presalePrice)} × {peopleCount}人)</p>
          <p className="text-3xl font-black">{yen(total)}</p>
          <p className="text-xs font-bold">{XMAS_EVENT_INFO.drinkLabel}</p>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm font-bold">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 accent-[#d4302a]" />
          お申し込み後は、原則として返金できないことを確認しました
        </label>
      </Panel>

      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" disabled={busy} className={`mt-6 ${primaryBtnCls}`}>
        {busy ? '送信中…' : payMethod === 'card' ? 'カード決済に進む' : '申し込む'}
      </button>
    </form>
  );
}

function PayOption(p: { active: boolean; disabled: boolean; onClick: () => void; title: string; note: string }) {
  return (
    <button
      type="button"
      disabled={p.disabled}
      onClick={p.onClick}
      className={`block w-full rounded-lg border-[3px] border-[#1a1410] p-3 text-left disabled:opacity-40 ${p.active ? 'bg-[#d4302a] text-white' : 'bg-white text-[#1a1410]'}`}
    >
      <span className="block text-base font-black">{p.title}</span>
      <span className="block text-xs font-bold">{p.note}</span>
    </button>
  );
}
