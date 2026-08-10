'use client';

// ⚠️ 公開ページ(認証なし)。理由: SSM学生無料枠の専用エントリーフォーム。
// ただし招待コードをサーバー側で照合するまでフォームは表示されず、
// 期間(8/11〜8/31)・枠数(6名)・部門(一般固定)もすべてサーバー側で強制される。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBf6SsmStatus, submitBf6SsmEntry } from '../actions';
import { isValidBf6Email, isValidBf6Phone, isKatakanaText } from '@/lib/bf6';
import { Bf6Card, Bf6Field, Bf6Hero, Bf6SectionTitle, Bf6Shell, btnPrimaryCls, inputCls, inputClsWith } from '../ui';

export default function Bf6SsmPage() {
  const router = useRouter();
  const [step, setStep] = useState<'code' | 'input' | 'confirm'>('code');
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);

  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dancerName, setDancerName] = useState('');
  const [dancerKana, setDancerKana] = useState('');
  const [performerName, setPerformerName] = useState('');
  const [genre, setGenre] = useState('');
  const [rep, setRep] = useState('');
  const [instagram, setInstagram] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [blurred, setBlurred] = useState<Record<string, boolean>>({});
  const markBlurred = (k: string) => setBlurred((p) => ({ ...p, [k]: true }));
  const emailError = blurred.email && email.trim() && !isValidBf6Email(email) ? 'メールアドレスの形式が正しくありません' : '';
  const phoneError = blurred.phone && phone.trim() && !isValidBf6Phone(phone) ? '電話番号は数字10〜11桁で入力してください' : '';
  const kanaError = blurred.kana && dancerKana.trim() && !isKatakanaText(dancerKana) ? 'カタカナで入力してください' : '';
  const nameError = blurred.pname && performerName.trim() && !isKatakanaText(performerName) ? 'カタカナで入力してください' : '';

  async function handleCode() {
    setBusy(true);
    setError('');
    const res = await getBf6SsmStatus(code);
    setBusy(false);
    if (!res.ok) {
      setError(
        res.reason === 'code'
          ? '招待コードが正しくありません'
          : res.reason === 'full'
            ? 'SSM学生無料枠(6名)は埋まりました。通常のエントリーをご利用ください'
            : '現在SSM学生枠の受付期間外です(受付: 8/11〜8/31)'
      );
      return;
    }
    setRemaining(res.remaining);
    setStep('input');
    window.scrollTo({ top: 0 });
  }

  async function handleSubmit() {
    setBusy(true);
    setError('');
    const res = await submitBf6SsmEntry(code, {
      buyerName, email, phone, dancerName, dancerKana, performerName, genre, rep, instagram, isFirstBattle: false,
    });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      setStep('input');
      return;
    }
    router.push(`/bf6/complete?t=${res.token}`);
  }

  if (step === 'code') {
    return (
      <Bf6Shell>
        <div>
          <Bf6Hero title="SSM ENTRY" subtitle="SSM学生 無料エントリー(6名限定)" />
          <div className="space-y-4 px-4 py-6">
            <Bf6Card label="SSM(仙台スクールオブミュージック&ダンス専門学校)の学生専用">
              <ul className="space-y-1.5 text-sm text-neutral-300">
                <li>・SSMの学生は<span className="font-bold text-white">6名まで無料</span>で一般部門にエントリーできます</li>
                <li>・受付期間: <span className="font-bold text-white">8/11(月)〜8/31(月)</span>・先着順</li>
                <li>・学校から共有された<span className="font-bold text-white">招待コード</span>を入力してください</li>
              </ul>
            </Bf6Card>
            <Bf6Card>
              <div className="space-y-4">
                <Bf6Field label="招待コード" required>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="学校から共有されたコード"
                    className={`${inputCls} font-mono uppercase`}
                  />
                </Bf6Field>
                {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
                <button
                  onClick={handleCode}
                  disabled={busy || !code.trim()}
                  className={`w-full rounded-2xl py-4 text-lg font-black active:scale-[0.99] disabled:opacity-50 ${btnPrimaryCls}`}
                >
                  {busy ? '確認中…' : 'コードを確認する'}
                </button>
              </div>
            </Bf6Card>
            <p className="text-center text-xs text-neutral-400">
              SSMの学生でない方は <Link href="/bf6/entry" className="font-bold text-red-400 underline">通常のエントリー</Link> をご利用ください
            </p>
          </div>
        </div>
      </Bf6Shell>
    );
  }

  if (step === 'confirm') {
    return (
      <Bf6Shell>
        <div>
          <Bf6Hero title="CONFIRM" subtitle="入力内容の確認" />
          <div className="space-y-4 px-4 py-6">
            <Bf6Card label="学生情報">
              <p className="font-bold text-white">{buyerName}</p>
              <p className="text-sm text-neutral-400">{email} / {phone}</p>
            </Bf6Card>
            <Bf6Card label="エントリー内容">
              <p className="font-bold text-white">{dancerName}({dancerKana})</p>
              <p className="text-sm text-neutral-400">{performerName} / {genre} / REP: {rep}</p>
              <p className="mt-1 text-sm font-bold text-red-400">一般部門(SSM学生無料枠)</p>
            </Bf6Card>
            <div className="rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
              <p className="text-xs font-bold tracking-widest text-neutral-400">エントリー料</p>
              <p className="mt-1 text-4xl font-black text-white">無料</p>
              <p className="mt-1 text-xs text-neutral-400">SSM学生枠のためお支払いはありません</p>
            </div>
            {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
            <div className="space-y-3 pt-2">
              <button
                onClick={handleSubmit}
                disabled={busy}
                className={`w-full rounded-2xl py-4 text-lg font-black disabled:opacity-50 ${btnPrimaryCls}`}
              >
                {busy ? '送信中…' : 'この内容でエントリーする'}
              </button>
              <button onClick={() => setStep('input')} disabled={busy} className="w-full rounded-2xl border-2 border-neutral-700 bg-neutral-900 py-3.5 font-bold text-neutral-400">
                入力に戻る
              </button>
            </div>
          </div>
        </div>
      </Bf6Shell>
    );
  }

  return (
    <Bf6Shell>
      <div>
        <Bf6Hero title="SSM ENTRY" subtitle="SSM学生 無料エントリー / 一般部門" />
        <div className="px-4 py-6">
          {remaining !== null && (
            <p className="mb-4 rounded-xl border-2 border-red-600 bg-red-950/40 p-3 text-center text-sm font-bold text-red-300">
              無料枠 残り{remaining}名(先着順)
            </p>
          )}
          <section>
            <Bf6SectionTitle no="1" title="学生情報" />
            <Bf6Card>
              <div className="space-y-4">
                <Bf6Field label="お名前" required>
                  <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} />
                </Bf6Field>
                <Bf6Field label="メールアドレス" required hint="エントリー確定のご連絡が届きます" error={emailError}>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => markBlurred('email')} className={inputClsWith(emailError)} />
                </Bf6Field>
                <Bf6Field label="電話番号" required hint="必ず当日連絡が取れる番号" error={phoneError}>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => markBlurred('phone')} className={inputClsWith(phoneError)} />
                </Bf6Field>
              </div>
            </Bf6Card>
          </section>

          <section className="mt-6">
            <Bf6SectionTitle no="2" title="エントリー情報" note="部門は一般部門(固定)です" />
            <Bf6Card>
              <div className="space-y-4">
                <Bf6Field label="ダンサーネーム(エントリーネーム)" required hint="エントリーリスト・トーナメント表に載る名前">
                  <input value={dancerName} onChange={(e) => setDancerName(e.target.value)} placeholder="例: TARO" className={inputCls} />
                </Bf6Field>
                <Bf6Field label="ダンサーネームのフリガナ" required hint="当日MCがお呼びする読み方" error={kanaError}>
                  <input value={dancerKana} onChange={(e) => setDancerKana(e.target.value)} onBlur={() => markBlurred('kana')} placeholder="例: タロー" className={inputClsWith(kanaError)} />
                </Bf6Field>
                <Bf6Field label="本名(カタカナ)" required hint="受付での本人確認用。公開されません" error={nameError}>
                  <input value={performerName} onChange={(e) => setPerformerName(e.target.value)} onBlur={() => markBlurred('pname')} placeholder="例: ヤマダタロウ" className={inputClsWith(nameError)} />
                </Bf6Field>
                <Bf6Field label="エントリージャンル" required hint="DJがこのジャンルに合わせて選曲します">
                  <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="例: HIPHOP" className={inputCls} />
                </Bf6Field>
                <Bf6Field label="レペゼン" required hint="エントリーリストに載ります">
                  <input value={rep} onChange={(e) => setRep(e.target.value)} placeholder="例: 仙台(地域名・チーム名など)" className={inputCls} />
                </Bf6Field>
                <Bf6Field label="Instagram" hint="任意。タグ付けに使用します">
                  <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@your_account" className={inputCls} />
                </Bf6Field>
              </div>
            </Bf6Card>
          </section>

          {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}

          <button
            onClick={() => {
              if (!buyerName.trim() || !email.trim() || !phone.trim() || !dancerName.trim() || !dancerKana.trim() || !performerName.trim() || !genre.trim() || !rep.trim()) {
                setError('未入力の必須項目があります');
                return;
              }
              setError('');
              setStep('confirm');
              window.scrollTo({ top: 0 });
            }}
            className={`mt-6 w-full rounded-2xl py-4 text-lg font-black active:scale-[0.99] ${btnPrimaryCls}`}
          >
            入力内容を確認する
          </button>
        </div>
      </div>
    </Bf6Shell>
  );
}
