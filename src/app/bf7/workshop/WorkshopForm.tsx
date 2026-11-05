'use client';

// HIRO ワークショップの申込フォーム。会員料金は「会員」を選んだ人にだけ見せる(外部向けの告知は一般料金のみのため)。
// 先行期間は「会員ではありません」を選べないようにする。判定はサーバ側でも必ず行う。
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BF7_WORKSHOP } from '@/lib/bf7';
import {
  BF7_WS_CARD_TEST_AMOUNT,
  bf7WsCourseUses,
  bf7WsPrice,
  yenBf7Ws,
  type Bf7WsCourse,
  type Bf7WsFieldErrors,
  type Bf7WsRemaining,
} from '@/lib/bf7Workshop';
import { isMinor } from '@/lib/mocchinEntry';
import { Bf7Field, btnPrimaryCls, inputCls, inputClsWith } from '../ui';
import { startBf7WsCheckout, submitBf7Ws } from './actions';

/** 残りが少なくなったら数を出す */
const LOW_LEFT = 5;

export default function WorkshopForm({ memberOnly, remaining, preview = false }: { memberOnly: boolean; remaining: Bf7WsRemaining; preview?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [kana, setKana] = useState('');
  const [age, setAge] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isMember, setIsMember] = useState<boolean | null>(memberOnly ? true : null);
  const [course, setCourse] = useState<Bf7WsCourse | ''>('');
  const [payMethod, setPayMethod] = useState<'prepaid' | 'transfer' | ''>('');
  const [note, setNote] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fe, setFe] = useState<Bf7WsFieldErrors>({});

  const clear = (k: keyof Bf7WsFieldErrors) => setFe((p) => (p[k] ? { ...p, [k]: undefined } : p));
  const minor = isMinor(age);
  const [c1, c2] = BF7_WORKSHOP.classes;

  function courseFull(k: Bf7WsCourse): boolean {
    const use = bf7WsCourseUses(k);
    return (use.first && remaining.first <= 0) || (use.second && remaining.second <= 0);
  }

  const courses: Array<{ key: Bf7WsCourse; label: string; time: string; title: string; left: number }> = [
    { key: 'first', label: '1本目', time: `${c1.start}〜${c1.end}`, title: c1.title, left: remaining.first },
    { key: 'second', label: '2本目', time: `${c2.start}〜${c2.end}`, title: c2.title, left: remaining.second },
    { key: 'both', label: '2本とも', time: `${c1.start}〜${c2.end}`, title: `${c1.title} ＋ ${c2.title}`, left: Math.min(remaining.first, remaining.second) },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await submitBf7Ws({ name, kana, age, guardianName, phone, email, isMember, course, payMethod, note, agreed });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      setFe(r.fieldErrors ?? {});
      return;
    }
    if (r.payMethod === 'prepaid') {
      const c = await startBf7WsCheckout(r.token);
      if (c.ok) {
        window.location.href = c.url;
        return;
      }
    }
    // 銀行振込(振込先を出す)、またはカードの画面を開けなかったときは完了画面へ(そこから決済に進める)
    router.push(`/bf7/workshop/complete?t=${r.token}`);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 px-4 pt-5">
      <Group title="BOOM会員ですか？" error={fe.isMember}>
        <div className="grid grid-cols-2 gap-2">
          <Choice on={isMember === true} onClick={() => (setIsMember(true), clear('isMember'))}>
            BOOM会員です
          </Choice>
          <Choice on={isMember === false} disabled={memberOnly} onClick={() => (setIsMember(false), clear('isMember'))}>
            会員ではありません
          </Choice>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-neutral-400">
          会員料金は<span className="font-bold text-neutral-200">会員ご本人のみ</span>です。きょうだい・保護者の方は一般料金になります。
        </p>
      </Group>

      <Group title="受講するクラス" error={fe.course}>
        <div className="space-y-2">
          {courses.map((c) => {
            const full = courseFull(c.key);
            return (
              <button
                key={c.key}
                type="button"
                disabled={full}
                onClick={() => (setCourse(c.key), clear('course'))}
                className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-xl border-2 px-3.5 py-3 text-left disabled:opacity-40 ${
                  course === c.key ? 'border-sky-400 bg-sky-500/15' : 'border-neutral-800 bg-neutral-900'
                }`}
              >
                <span>
                  {/* 分かりやすさ優先で「何本目・何時から」を先に大きく出し、クラス名はその下に(TARO 2026-11-05) */}
                  <span className="block text-lg font-black leading-tight text-white">
                    {c.label}
                    <span className="ml-2 tabular-nums">{c.time}</span>
                  </span>
                  <span className="mt-1 block text-xs font-bold text-sky-300">{c.title}</span>
                  {full ? (
                    <span className="mt-1 block text-xs font-black text-red-400">満員</span>
                  ) : (
                    c.left <= LOW_LEFT && <span className="mt-1 block text-xs font-black text-sky-300">残り{c.left}名</span>
                  )}
                </span>
                {isMember !== null && (
                  <span className="text-xl font-black text-white tabular-nums">{yenBf7Ws(bf7WsPrice(c.key, isMember))}</span>
                )}
              </button>
            );
          })}
        </div>
        {isMember === null && <p className="mt-2 text-xs text-neutral-400">会員かどうかを選ぶと、料金が表示されます。</p>}
      </Group>

      <Group title="受講される方">
        <div className="space-y-4">
          <Bf7Field label="お名前(漢字)" required error={fe.name}>
            <input className={inputClsWith(fe.name)} value={name} autoComplete="name" onChange={(e) => (setName(e.target.value), clear('name'))} placeholder="例: 山田 花子" />
          </Bf7Field>
          <Bf7Field label="フリガナ" required error={fe.kana}>
            <input className={inputClsWith(fe.kana)} value={kana} onChange={(e) => (setKana(e.target.value), clear('kana'))} placeholder="例: ヤマダ ハナコ" />
          </Bf7Field>
          <Bf7Field label="年齢 または 学年" required error={fe.age}>
            <input className={inputClsWith(fe.age)} value={age} onChange={(e) => (setAge(e.target.value), clear('age'))} placeholder="例: 25歳 / 中学2年" />
          </Bf7Field>
          {(minor || fe.guardianName) && (
            <Bf7Field label="保護者のお名前" required hint="18歳未満の方は保護者の方のお名前を入れてください" error={fe.guardianName}>
              <input className={inputClsWith(fe.guardianName)} value={guardianName} onChange={(e) => (setGuardianName(e.target.value), clear('guardianName'))} placeholder="例: 山田 太郎" />
            </Bf7Field>
          )}
          <Bf7Field label="電話番号" required error={fe.phone}>
            <input className={inputClsWith(fe.phone)} value={phone} type="tel" inputMode="tel" autoComplete="tel" onChange={(e) => (setPhone(e.target.value), clear('phone'))} placeholder="例: 09012345678" />
          </Bf7Field>
          <Bf7Field label="メールアドレス" required hint="受付番号をお送りします" error={fe.email}>
            <input className={inputClsWith(fe.email)} value={email} type="email" inputMode="email" autoComplete="email" onChange={(e) => (setEmail(e.target.value), clear('email'))} placeholder="例: boom@example.com" />
          </Bf7Field>
          <Bf7Field label="備考(任意)">
            <textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Bf7Field>
        </div>
      </Group>

      <Group title="お支払い方法" error={fe.payMethod}>
        <div className="grid grid-cols-2 gap-2">
          <Choice on={payMethod === 'prepaid'} onClick={() => (setPayMethod('prepaid'), clear('payMethod'))}>
            カード決済
          </Choice>
          <Choice on={payMethod === 'transfer'} onClick={() => (setPayMethod('transfer'), clear('payMethod'))}>
            銀行振込
          </Choice>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-neutral-400">
          当日のお支払いはできません。銀行振込は、申込のあとに振込先をご案内します(申込日から7日以内)。
        </p>
      </Group>

      <div>
        <label className="flex items-start gap-3 text-sm font-bold text-neutral-200">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-sky-500" checked={agreed} onChange={(e) => (setAgreed(e.target.checked), clear('agreed'))} />
          <span>
            お客様のご都合によるキャンセル・返金はできないことを確認しました(
            <Link href="/bf7/legal" target="_blank" className="text-sky-400 underline">
              特商法表記・キャンセルポリシー
            </Link>
            )
          </span>
        </label>
        {fe.agreed && <p className="mt-1 text-xs font-bold text-red-400">⚠ {fe.agreed}</p>}
      </div>

      {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}

      <button type="submit" disabled={busy} className={`w-full rounded-2xl py-4 text-lg font-black active:scale-[0.99] disabled:opacity-50 ${btnPrimaryCls}`}>
        {busy
          ? '送信中…'
          : preview && payMethod === 'prepaid'
            ? `テスト決済に進む(${yenBf7Ws(BF7_WS_CARD_TEST_AMOUNT)})`
            : course && isMember !== null
              ? `申し込む(${yenBf7Ws(bf7WsPrice(course, isMember))})`
              : '申し込む'}
      </button>
    </form>
  );
}

function Group({ title, error, children }: { title: string; error?: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-black text-white">{title}</legend>
      {children}
      {error && <p className="mt-1 text-xs font-bold text-red-400">⚠ {error}</p>}
    </fieldset>
  );
}

function Choice({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl border-2 px-2 py-3 text-sm font-black disabled:opacity-35 ${on ? 'border-sky-400 bg-sky-500/15 text-white' : 'border-neutral-800 bg-neutral-900 text-neutral-200'}`}
    >
      {children}
    </button>
  );
}
