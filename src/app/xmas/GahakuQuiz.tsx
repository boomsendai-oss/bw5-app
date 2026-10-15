'use client';

// 画伯コーナーの練習問題。去年の「画伯の絵を当てろ！ゲーム」の絵を、その場で答え合わせできる。
// 賞品とは関係ない(サイト上の遊び)。答えはTARO確認(2026-10-15): Q1=プーさん / Q2=ロバ。
import { useState } from 'react';
import Image from 'next/image';
import { normalizeKana } from '@/lib/party';

interface Question {
  q: string;
  src: string;
  rot: string;
  answer: string;
  accept: string[];
}

const QUESTIONS: Question[] = [
  { q: 'Q1', src: '/xmas/gahaku_cat.jpg', rot: '-rotate-2', answer: 'プーさん', accept: ['ぷーさん', 'くまのぷーさん', 'ぷー', 'pooh', 'winniethepooh'] },
  { q: 'Q2', src: '/xmas/gahaku_pig.jpg', rot: 'rotate-2', answer: 'ロバ', accept: ['ろば', 'ろばさん', 'donkey'] },
];

function normalizeAnswer(v: string): string {
  return normalizeKana(v).toLowerCase().replace(/[\s・!！?？。、.]/g, '');
}

type Result = '' | 'ok' | 'ng';

function QuizCard({ item }: { item: Question }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<Result>('');
  const [revealed, setRevealed] = useState(false);

  function check(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setResult(item.accept.includes(normalizeAnswer(value)) ? 'ok' : 'ng');
  }

  return (
    <div>
      <figure className={`relative ${item.rot} border-[3px] border-[#1a1410] bg-white p-1.5 pb-2 shadow-[4px_4px_0_#1a1410]`}>
        <span className="absolute -top-3 left-1/2 h-5 w-14 -translate-x-1/2 rotate-2 bg-[#f4cf3e]/80" aria-hidden />
        <Image src={item.src} alt={`画伯の絵 ${item.q}`} width={800} height={1100} className="h-auto w-full" />
        <figcaption className="mt-1 text-center text-lg font-black text-[#d4302a]">{item.q}</figcaption>
      </figure>
      <form onSubmit={check} className="mt-3 space-y-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setResult('');
          }}
          placeholder="これ何に見えますか？"
          className="w-full rounded-lg border-[3px] border-[#1a1410] bg-white px-2 py-2 text-sm font-bold text-[#1a1410] placeholder:font-normal placeholder:text-neutral-400 focus:outline-none focus:ring-4 focus:ring-[#f4cf3e]"
        />
        <button
          type="submit"
          className="w-full rounded-lg border-[3px] border-[#1a1410] bg-[#1a1410] py-1.5 text-sm font-black text-white active:translate-y-[1px]"
        >
          答え合わせ
        </button>
      </form>
      {result === 'ok' && (
        <p className="mt-2 -rotate-2 border-[3px] border-[#1a1410] bg-[#2f8a3e] py-1 text-center text-lg font-black text-white shadow-[3px_3px_0_#1a1410]">
          正解！
        </p>
      )}
      {result === 'ng' && (
        <div className="mt-2 text-center">
          <p className="rotate-1 border-[3px] border-[#1a1410] bg-[#d4302a] py-1 text-lg font-black text-white shadow-[3px_3px_0_#1a1410]">
            不正解…
          </p>
          {revealed ? (
            <p className="mt-1 text-sm font-black">
              答え: <span className="text-[#d4302a]">{item.answer}</span>
            </p>
          ) : (
            <button type="button" onClick={() => setRevealed(true)} className="mt-1 text-xs font-black underline">
              答えを見る
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function GahakuQuiz() {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4">
      {QUESTIONS.map((item) => (
        <QuizCard key={item.q} item={item} />
      ))}
    </div>
  );
}
