'use client';

// 申込フォーム。送信後は同じ画面で申込番号と振込先を出す(同じ内容をメールでも送る)。
// 会員の先行期間(11/8〜11/14)は「会員以外」を選べないようにする。判定はサーバ側でも必ず行う。
import { useState } from 'react';
import Link from 'next/link';
import {
  MOCCHIN_BANK,
  MOCCHIN_OPEN_START,
  MOCCHIN_PROMISES,
  PAY_METHODS,
  PAY_METHOD_LABEL,
  MOCCHIN_FEE,
  MOCCHIN_LESSON_DUES,
  MOCCHIN_PLAN_CHOOSE_BY,
  formatJpDate,
  isMinor,
  yen,
  type FieldErrors,
} from '@/lib/mocchinEntry';
import { submitMocchinEntry, type MocchinSubmitResult } from './actions';
import CheckoutButton from './CheckoutButton';
import { Field, Notice, Panel, btnCls, errCls, inputCls } from './ui';

type Done = Extract<MocchinSubmitResult, { ok: true }>;

export default function EntryForm({ memberOnly, preview, inst }: { memberOnly: boolean; preview?: string; inst?: string }) {
  const [name, setName] = useState('');
  const [kana, setKana] = useState('');
  const [age, setAge] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isMember, setIsMember] = useState<boolean | null>(memberOnly || inst ? true : null);
  const memberNo = '';
  const [danceHistory, setDanceHistory] = useState('');
  const classNumber = '';
  const paymentPlan = 'pending';
  const [payMethod, setPayMethod] = useState('');
  const [note, setNote] = useState('');
  const [agreed, setAgreed] = useState<boolean[]>(MOCCHIN_PROMISES.map(() => false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fe, setFe] = useState<FieldErrors>({});
  const [done, setDone] = useState<Done | null>(null);

  const minor = isMinor(age);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await submitMocchinEntry(
      { name, kana, age, guardianName, phone, email, isMember, memberNo, danceHistory, classNumber, paymentPlan, payMethod, note, agreed },
      preview,
      inst
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setFe(r.fieldErrors ?? {});
      return;
    }
    setDone(r);
    // 完了の表示はページ下の方(料金・日程の下)に出るので、そこまで移す
    requestAnimationFrame(() => document.getElementById('mocchin-done')?.scrollIntoView({ block: 'start' }));
  }

  if (done) return <DoneView d={done} />;

  const clear = (k: keyof FieldErrors) => setFe((p) => (p[k] ? { ...p, [k]: undefined } : p));

  return (
    <form onSubmit={submit} noValidate>
      <Panel title="申込者">
        <Field label="お名前(漢字)" error={fe.name}>
          <input className={inputCls + errCls(fe.name)} value={name} autoComplete="name" onChange={(e) => (setName(e.target.value), clear('name'))} placeholder="例: 山田 花子" />
        </Field>
        <Field label="フリガナ" error={fe.kana}>
          <input className={inputCls + errCls(fe.kana)} value={kana} onChange={(e) => (setKana(e.target.value), clear('kana'))} placeholder="例: ヤマダ ハナコ" />
        </Field>
        <Field label="年齢 または 学年" hint="例: 25歳 / 中学2年" error={fe.age}>
          <input className={inputCls + errCls(fe.age)} value={age} onChange={(e) => (setAge(e.target.value), clear('age'))} placeholder="例: 中学2年" />
        </Field>
        {(minor || fe.guardianName) && (
          <Field label="保護者のお名前" hint="18歳未満の方は保護者の方のお名前を入れてください" error={fe.guardianName}>
            <input className={inputCls + errCls(fe.guardianName)} value={guardianName} onChange={(e) => (setGuardianName(e.target.value), clear('guardianName'))} placeholder="例: 山田 太郎" />
          </Field>
        )}
        <Field label="電話番号" error={fe.phone}>
          <input className={inputCls + errCls(fe.phone)} value={phone} type="tel" inputMode="tel" autoComplete="tel" onChange={(e) => (setPhone(e.target.value), clear('phone'))} placeholder="例: 09012345678" />
        </Field>
        <Field label="メールアドレス" hint="お申込み後、お支払いのご案内（振込先・金額・期限）をこのアドレスにお送りします。入力ミスがないかご確認ください。boom.sendai@gmail.com からのメールを受け取れるようにしておいてください" error={fe.email}>
          <input className={inputCls + errCls(fe.email)} value={email} type="email" inputMode="email" autoComplete="email" onChange={(e) => (setEmail(e.target.value), clear('email'))} placeholder="例: boom@example.com" />
        </Field>
      </Panel>

      <Panel title="BOOMとの関わり">
{inst ? (
          <p className="mt-4 rounded-lg border-2 border-[#19F2D6] p-3 text-sm font-bold text-white">講師用の申込フォームです。会員料金で受け付けます。</p>
        ) : (
          <>
                <Field label="BOOM会員ですか？" error={fe.isMember}>
          <div className="grid grid-cols-2 gap-2">
            <Choice on={isMember === true} onClick={() => (setIsMember(true), clear('isMember'))} label="BOOM会員です" />
            <Choice
              on={isMember === false}
              disabled={memberOnly}
              onClick={() => (setIsMember(false), clear('isMember'))}
              label="会員ではありません"
            />
          </div>
        </Field>
        {isMember === true && (
          <p className="mt-2 text-xs font-bold text-white/75">BOOMに会員登録しているお名前で入力してください。会員情報と照らし合わせて確認します。</p>
        )}
        {memberOnly && (
          <p className="mt-2 text-xs font-bold text-white/75">
            会員以外の方は{formatJpDate(MOCCHIN_OPEN_START)}から申し込めます。
            <a href="https://lin.ee/4EYB9zZ" target="_blank" rel="noopener noreferrer" className="underline text-[#19F2D6]">BOOMの公式LINE</a>
            に友だち登録しておくと、受付開始の日にお知らせが届きます。
          </p>
        )}
          </>
        )}
        {isMember === false && (
          <Field label="所属・ダンス歴(任意)" hint="例: ○○スタジオ所属 / HIPHOP 3年">
            <textarea className={inputCls} rows={3} value={danceHistory} onChange={(e) => setDanceHistory(e.target.value)} />
          </Field>
        )}
      </Panel>

      <Panel title="参加費のお支払い">
        <div className="rounded-lg border-2 border-[#19F2D6] p-3">
          <p className="text-sm font-black">お申込みのときにお支払いいただくのは、参加費だけです</p>
          <p className="mt-1 text-2xl font-black text-[#19F2D6]">{yen(MOCCHIN_FEE)}</p>
          <p className="text-xs font-bold text-white/80">申込から7日以内にお支払いください</p>
        </div>
        <Field label="参加費は、銀行振込とカードのどちらで払いますか？（タップで選択）" hint="カードの手数料はかかりません。レッスン代は、そのときにまた選べます" error={fe.payMethod}>
          <div className="grid grid-cols-2 gap-2">
            {PAY_METHODS.map((k) => (
              <Choice key={k} on={payMethod === k} onClick={() => (setPayMethod(k), clear('payMethod'))} label={PAY_METHOD_LABEL[k]} />
            ))}
          </div>
        </Field>
      </Panel>

      <Panel title="レッスン代について">
        <ol className="list-decimal space-y-1 pl-5 text-sm font-bold text-white/90">
          <li>参加費のお支払いを確認したら、メールでご案内をお送りします</li>
          <li>メールのリンクから、レッスン代の払い方(一括・2回・3回)を選んでいただきます({formatJpDate(MOCCHIN_PLAN_CHOOSE_BY)}まで)</li>
          <li>レッスン代の1回目のお支払い期限は{formatJpDate(MOCCHIN_LESSON_DUES[0])}です</li>
        </ol>
      </Panel>

      <Panel title="ご確認事項">
        <div className="space-y-3">
          {MOCCHIN_PROMISES.map((p, i) => (
            <label key={p} className="flex items-start gap-3 text-sm font-bold">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#19F2D6]"
                checked={agreed[i]}
                onChange={(e) => {
                  setAgreed((a) => a.map((v, j) => (j === i ? e.target.checked : v)));
                  clear('agreed');
                }}
              />
              <span>{p}</span>
            </label>
          ))}
        </div>
        {fe.agreed && <p className="mt-2 text-xs font-black text-[#FF4DB8]">⚠ {fe.agreed}</p>}
      </Panel>

      <Panel>
        <Field label="備考(任意)" hint="参加できない日がわかっている場合なども、こちらへ">
          <textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Panel>

      <Notice>
        <span className="block font-black">お支払いのご案内は、メールでお送りします。</span>
        申込のあとの画面にも表示します。届いたメールを必ずご確認のうえ、期限までにお支払いください。
        <Link href="/mocchin/legal" target="_blank" className="mt-1 block text-xs underline">
          特定商取引法に基づく表記
        </Link>
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" className={`${btnCls} mt-6`} disabled={busy}>
        {busy ? '送信中…' : '申し込む'}
      </button>
    </form>
  );
}

function Choice({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border-2 px-2 py-3 text-sm font-black ${
        on ? 'border-[#19F2D6] bg-[#19F2D6] text-black' : 'border-white/40 bg-black text-white'
      } disabled:opacity-35`}
    >
      {label}
    </button>
  );
}

function DoneView({ d }: { d: Done }) {
  return (
    <div id="mocchin-done" className="scroll-mt-4">
      <Panel title="申込を受け付けました">
        <p className="text-sm font-bold">申込番号</p>
        <p className="text-4xl font-black text-[#19F2D6]">{d.no}</p>
        {d.overCapacity && (
          <p className="mt-3 text-sm font-bold text-[#FF4DB8]">
            定員を超えるお申込みをいただいています。オーディション形式になる場合は、あらためてご連絡します。
          </p>
        )}
      </Panel>
      {d.payMethod === 'card' && (
        <Panel title="カードでのお支払い">
          <p className="text-sm font-bold">最初のお支払い：{d.steps[0].label} {yen(d.steps[0].amount)}</p>
          <CheckoutButton token={d.payToken} label={`カードで ${yen(d.steps[0].amount)} を支払う`} />
        </Panel>
      )}
      <Panel title="お支払い">
        <dl className="space-y-1 text-sm font-bold">
          {d.steps.map((s) => (
            <div key={s.step}>
              {s.label}：{yen(s.amount)}
              <span className="block text-xs text-white/80">{formatJpDate(s.due)} まで</span>
            </div>
          ))}
          <div className="pt-1 text-xs text-white/80">
            参加費のお支払いを確認したら、レッスン代の払い方を選んでいただくご案内をメールでお送りします。
          </div>
          <div className="pt-2 text-[#19F2D6]">銀行振込の振込先</div>
          <div>
            {MOCCHIN_BANK.bank} {MOCCHIN_BANK.branch}
            <br />
            {MOCCHIN_BANK.type} {MOCCHIN_BANK.number}
            <br />
            口座名義：{MOCCHIN_BANK.holder}
          </div>
        </dl>
        <p className="mt-3 rounded-lg bg-[#FF4DB8]/20 p-3 text-sm font-black">
          振込名義の前に、申込番号「{d.transferPrefix}」を付けてください
          <span className="block font-bold">例：{d.transferPrefix} ヤマダハナコ</span>
        </p>
        <p className="mt-2 text-xs font-bold text-white/75">振込手数料はご負担をお願いします。</p>
      </Panel>
      <Notice>
        {d.mailed
          ? '同じ内容をメールでお送りしました。届かない場合は、この画面をスクリーンショットで保存してください。'
          : 'メールの送信に失敗しました。この画面をスクリーンショットで保存してください。'}
      </Notice>
    </div>
  );
}
