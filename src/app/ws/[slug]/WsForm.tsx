'use client';

// 特設ワークショップの申込フォーム。入力→確認→送信。
// 金額の表示は calcSpWsAmount(サーバと同じ)。請求額はサーバ側で再計算する。
import { useState } from 'react';
import { calcSpWsAmount, parseSpWsAge, spWsNeedsGuardian, yen } from '@/lib/spWs';
import { startSpWsCheckout, submitSpWsEntry } from '../actions';
import { MultiLine, WsCard, WsError, WsField, btnPrimaryCls, btnSubCls, inputCls } from '../ui';

const TOKEN_KEY = 'sp_ws_entry_token';

export default function WsForm({
  ev,
  remaining,
  preview,
}: {
  ev: { slug: string; title: string; fee: number; cancelPolicy: string };
  remaining: number;
  preview: boolean;
}) {
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [f, setF] = useState({ name: '', kana: '', email: '', phone: '', age: '', guardianName: '' });
  const [member, setMember] = useState<'member' | 'guest' | ''>('');
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [payMethod, setPayMethod] = useState<'card' | 'onsite'>('card');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const age = parseSpWsAge(f.age);
  const guardian = spWsNeedsGuardian(age);
  const amount = calcSpWsAmount(ev);

  function localCheck(): string {
    if (!member) return 'BOOMの会員かどうかを選んでください';
    if (!f.name.trim()) return 'お名前を入力してください';
    if (!f.kana.trim()) return 'ふりがなを入力してください';
    if (age == null) return '年齢を数字で入力してください(例: 15)';
    if (!f.email.trim()) return 'メールアドレスを入力してください';
    if (!f.phone.trim()) return '電話番号を入力してください';
    if (guardian && !f.guardianName.trim()) return '保護者の方のお名前を入力してください';
    if (guardian && !guardianConsent) return '保護者の方の同意にチェックしてください';
    if (!agree) return 'キャンセルについてと個人情報の取り扱いへの同意にチェックしてください';
    return '';
  }

  async function submit() {
    setBusy(true);
    setError('');
    const res = await submitSpWsEntry(ev.slug, {
      ...f, age, isMember: member === 'member', guardianConsent, payMethod, agreePolicy: agree,
    });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    try { localStorage.setItem(TOKEN_KEY, res.token); } catch { /* プライベートモード */ }
    if (res.status === 'pending') {
      const co = await startSpWsCheckout(res.token);
      if (co.ok) { window.location.href = co.url; return; }
      // 決済ページを作れなかったときは完了画面(決済ボタンつき)へ。30分以内ならそこから払える
    }
    window.location.href = `/ws/complete?t=${res.token}`;
  }

  const scrollToForm = () => setTimeout(() => document.getElementById('entry-form')?.scrollIntoView({ behavior: 'smooth' }), 0);
  const check = 'mt-0.5 h-5 w-5 shrink-0 accent-[#00a090]';
  const choice = (on: boolean) => `flex cursor-pointer items-start gap-2.5 rounded-xl border-2 p-3 ${on ? 'border-[#00a090] bg-[#ecf8f6]' : 'border-[#e6e1d8] bg-white'}`;

  if (step === 'confirm') {
    return (
      <section id="entry-form" className="scroll-mt-4 space-y-4">
        <h2 className="pt-2 text-center text-xl font-bold">入力内容の確認</h2>
        <WsCard>
          <p className="text-xl font-bold">{f.name} <span className="text-sm font-normal text-[#6b6880]">{f.kana}</span></p>
          <p className="mt-1 text-sm">{age}歳 / {member === 'member' ? 'BOOMの会員' : 'BOOMの会員ではない'}</p>
          <p className="text-sm text-[#6b6880]">{f.email} / {f.phone}</p>
          {guardian && <p className="text-sm text-[#6b6880]">保護者: {f.guardianName}(同意済み)</p>}
        </WsCard>
        <WsCard>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold">参加費</p>
            <p className="f-num text-4xl font-bold">{yen(amount)}</p>
          </div>
          <p className="mt-1 text-right text-sm font-bold text-[#00a090]">
            {payMethod === 'onsite' ? '当日、会場で現金でお支払い' : 'カードでお支払い(このあと決済画面へ)'}
          </p>
        </WsCard>
        {error && <WsError>{error}</WsError>}
        <button onClick={submit} disabled={busy} className={`w-full rounded-full py-4 text-lg font-bold ${btnPrimaryCls}`}>
          {busy ? '送信しています…' : preview ? 'テストとして送信する(決済なし)' : payMethod === 'onsite' ? 'この内容で申し込む' : 'カードの支払いに進む'}
        </button>
        {!preview && (
          <p className="text-center text-xs text-[#6b6880]">
            {payMethod === 'onsite'
              ? '送信した時点でお申し込みが確定します。当日、受付で現金でお支払いください'
              : 'このあとカードの決済画面に移ります。30分以内にお支払いが済むとお申し込みが確定します'}
          </p>
        )}
        <button onClick={() => { setStep('input'); scrollToForm(); }} disabled={busy} className={`w-full rounded-full py-3.5 font-bold ${btnSubCls}`}>
          入力に戻る
        </button>
      </section>
    );
  }

  return (
    <section id="entry-form" className="scroll-mt-4 space-y-4">
      <div className="pt-2 text-center">
        <p className="f-num text-xs tracking-[0.3em] text-[#00a090]">ENTRY</p>
        <h2 className="text-xl font-bold">お申し込み</h2>
        <p className="mt-1 text-xs text-[#6b6880]">{remaining > 0 ? `残り${remaining}枠です。` : ''}1人ずつお申し込みください(1〜2分で終わります)</p>
      </div>

      <WsCard title="BOOMの会員ですか？">
        <div className="grid grid-cols-2 gap-2.5">
          {([['member', '会員です'], ['guest', '会員ではありません']] as const).map(([k, label]) => (
            <label key={k} className={`${choice(member === k)} items-center justify-center text-center`}>
              <input type="radio" name="member" checked={member === k} onChange={() => setMember(k)} className="sr-only" />
              <span className="text-sm font-bold">{label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-[#6b6880]">参加費はどちらも同じです</p>
      </WsCard>

      <WsCard title="参加する方">
        <div className="space-y-4">
          <WsField label="お名前" required>
            <input value={f.name} onChange={set('name')} placeholder="例: 山田 花子" className={inputCls} autoComplete="name" />
          </WsField>
          <WsField label="ふりがな" required>
            <input value={f.kana} onChange={set('kana')} placeholder="例: やまだ はなこ" className={inputCls} />
          </WsField>
          <WsField label="年齢" required>
            <div className="flex items-center gap-2">
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={f.age} onChange={set('age')} placeholder="例: 15" className={`${inputCls.replace('w-full', '')} w-28`} />
              <span className="font-bold">歳</span>
            </div>
          </WsField>
          {f.age.trim() !== '' && age == null && <p className="-mt-2 text-xs font-bold text-red-700">年齢は数字で入れてください(例: 15)</p>}
          <WsField label="メールアドレス" required hint="お申し込み確定のメールが届きます">
            <input type="email" value={f.email} onChange={set('email')} placeholder="例: boom@example.com" className={inputCls} autoComplete="email" />
          </WsField>
          <WsField label="電話番号" required hint="当日、連絡が取れる番号">
            <input type="tel" value={f.phone} onChange={set('phone')} placeholder="例: 090-1234-5678" className={inputCls} autoComplete="tel" />
          </WsField>
        </div>
      </WsCard>

      {guardian && (
        <WsCard title="保護者の方へ(18歳未満の方)">
          <div className="space-y-3">
            <WsField label="保護者の方のお名前" required>
              <input value={f.guardianName} onChange={set('guardianName')} className={inputCls} />
            </WsField>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={guardianConsent} onChange={(e) => setGuardianConsent(e.target.checked)} className={check} />
              <span>保護者として、このワークショップへの参加に同意します</span>
            </label>
          </div>
        </WsCard>
      )}

      <WsCard title="お支払い方法">
        <div className="space-y-2.5">
          {([
            ['card', 'カードで今払う', 'このあとカードの決済画面へ。お支払いが済むと確定します'],
            ['onsite', '当日、会場で払う(現金)', '送信した時点で確定します。当日の受付で現金でお支払いください'],
          ] as const).map(([k, label, hint]) => (
            <label key={k} className={choice(payMethod === k)}>
              <input type="radio" name="payMethod" checked={payMethod === k} onChange={() => setPayMethod(k)} className={check} />
              <span>
                <span className="block font-bold">{label}</span>
                <span className="block text-xs text-[#6b6880]">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-[#6b6880]">参加費はどちらも{yen(amount)}です</p>
      </WsCard>

      <WsCard title="キャンセルと個人情報について">
        {ev.cancelPolicy && <MultiLine text={ev.cancelPolicy} className="space-y-1 text-xs leading-relaxed" />}
        <p className="mt-2 text-xs leading-relaxed">
          ご入力いただいた内容は、このワークショップの受付とご連絡にだけ使います。外に公開することはありません。
          当日の写真・動画をBOOMのSNSなどに載せることがあります。
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className={check} />
          <span className="font-bold">キャンセルについてと個人情報の取り扱いに同意します</span>
        </label>
      </WsCard>

      {error && <WsError>{error}</WsError>}
      <button
        onClick={() => {
          const e = localCheck();
          if (e) { setError(e); return; }
          setError('');
          setStep('confirm');
          scrollToForm();
        }}
        className={`w-full rounded-full py-4 text-lg font-bold ${btnPrimaryCls}`}
      >
        確認画面へ
      </button>
      <p className="text-center text-xs text-[#6b6880]">次の画面で入力内容を確認できます</p>
    </section>
  );
}
