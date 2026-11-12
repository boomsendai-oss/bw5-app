'use client';

// BW6 発表会のマイページの「載せる名前・インスタ」（04 4-2・5-13）。出る人ごとにインスタの欄（任意）を変える。
// SNS に使ってよいかを選ぶ所は作らない（5-13）。受付を止めている間（readOnly）は値を見せるだけ。
// 受け取るのは鍵・人の id と名前とインスタだけ（R-66）。
import { useState, useTransition } from 'react';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { updateInstaAction } from './actions';

type Person = { id: number; name: string; insta: string | null };

const btnCls = 'shrink-0 rounded-lg bg-navy-700 px-4 py-2 text-base font-bold text-white disabled:opacity-40';

function PersonRow({ token, p, readOnly }: { token: string; p: Person; readOnly: boolean }) {
  const [value, setValue] = useState(p.insta ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMsg(null);
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await updateInstaAction(token, p.id, value)).ok;
      } catch {
        ok = false;
      }
      setMsg(ok ? { ok: true, text: '保存しました' } : { ok: false, text: '保存できませんでした。もう一度お試しください。' });
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-base font-bold">{p.name}さん</p>
      {readOnly ? (
        <p className="text-sm">インスタ：{p.insta ?? '（なし）'}</p>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              className={RECITAL_INPUT_CLS}
              value={value}
              maxLength={100}
              autoCapitalize="none"
              autoCorrect="off"
              aria-label={`${p.name}さんのインスタのアカウント`}
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="button" className={btnCls} onClick={save} disabled={pending}>
              保存
            </button>
          </div>
          {msg && <p className={`text-sm font-bold ${msg.ok ? 'text-brand-700' : 'text-red-700'}`}>{msg.text}</p>}
        </>
      )}
    </div>
  );
}

export function InstaEditor({ token, people, readOnly }: { token: string; people: Person[]; readOnly: boolean }) {
  return (
    <section className="space-y-4 rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-base font-bold">載せる名前・インスタ</h2>
      <div className="space-y-1 text-sm leading-relaxed">
        <p>発表会の投稿でタグ付けしてお知らせしたいので、Instagram をお持ちの方は、アカウントを入れてください（任意）</p>
        <p>お子さまのアカウントが無いときは、保護者の方のものでもかまいません（どなたのものか、書いてください）。</p>
      </div>
      {people.map((p) => (
        <PersonRow key={p.id} token={token} p={p} readOnly={readOnly} />
      ))}
      <div className="space-y-1 border-t border-sand-200 pt-3 text-xs leading-relaxed">
        <p>お名前は、パンフレットとエンドロールに載ります。写真と映像は、パンフレットと、当日会場で流す映像・記録の映像に使います。</p>
        <p>発表会の写真や映像は、スクールのSNS（Instagram など）でも使わせていただきます。事情のある方は、公式LINEでお知らせください。</p>
      </div>
    </section>
  );
}
