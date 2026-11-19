'use client';

// 月1回の校内プチバトル(BOOM DOJO)の申込フォーム。見た目は和紙カード・墨の見出し・朱のボタン。
// 部門・料金・定員は親(サーバ)から受け取った設定だけを使う。
// 金額の表示はサーバと同じ calcBattleAmount で計算する(請求額はサーバ側で再計算)。
import { useMemo, useState } from 'react';
import {
  ageOn,
  calcBattleAmount,
  isAgeEligible,
  needsGuardian,
  yen,
  type BattleEvent,
} from '@/lib/battle';
import { submitBattleEntry, startBattleCheckout } from './actions';
import { BattleCard, BattleField, DojoError, DojoHeading, MultiLine, WhiteBelt, btnOnDarkCls, btnPrimaryCls, inputCls } from './ui';

const TOKEN_KEY = 'battle_entry_token';

export default function BattleForm({
  ev,
  remaining,
  now,
  preview,
}: {
  ev: BattleEvent;
  remaining: Record<string, number>;
  /** サーバ基準の今(JST 'YYYY-MM-DDTHH:MM')。端末の時計を信用しない */
  now: string;
  preview: boolean;
}) {
  const today = now.slice(0, 10);
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [f, setF] = useState({
    email: '', dancerName: '', dancerKana: '', realName: '', birthdate: '', rep: '', genre: '', phone: '', instagram: '',
    guardianName: '',
  });
  const [divisions, setDivisions] = useState<string[]>([]);
  const [noWin, setNoWin] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [agree, setAgree] = useState(false);
  const [spectators, setSpectators] = useState(0);
  const [preschool, setPreschool] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const age = ageOn(f.birthdate, today);
  const guardian = needsGuardian(f.birthdate, today);
  const amount = useMemo(() => calcBattleAmount(ev, divisions.length, spectators, now), [ev, divisions.length, spectators, now]);

  function disabledReason(key: string): string {
    const d = ev.divisions.find((x) => x.key === key)!;
    if (!divisions.includes(key) && (remaining[key] ?? 0) <= 0) return '満員';
    if (f.birthdate && !isAgeEligible(d, f.birthdate, ev.eventDate)) return `開催日に${d.maxAge}歳以下の方のみ`;
    return '';
  }

  function toggle(key: string) {
    setDivisions((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  function localCheck(): string {
    if (!f.email.trim()) return 'メールアドレスを入力してください';
    if (!f.dancerName.trim()) return 'ダンサー名を入力してください';
    if (!f.dancerKana.trim()) return 'ダンサー名のよみがなを入力してください';
    if (!f.realName.trim()) return '本名を入力してください';
    if (age == null) return '生年月日を入力してください';
    if (!f.rep.trim()) return '所属(レペゼン)を入力してください';
    if (!f.genre.trim()) return 'メインジャンルを入力してください';
    if (!f.phone.trim()) return '電話番号を入力してください';
    if (divisions.length === 0) return '出る部門を1つ以上選んでください';
    for (const k of divisions) if (disabledReason(k) && disabledReason(k) !== '満員') return `選んだ部門に出られません(${disabledReason(k)})`;
    if (!noWin) return '「優勝未経験」の確認にチェックしてください';
    if (guardian && !f.guardianName.trim()) return '保護者の方のお名前を入力してください';
    if (guardian && !guardianConsent) return '保護者の方の同意にチェックしてください';
    if (!agree) return 'キャンセル規定と個人情報の取り扱いへの同意にチェックしてください';
    return '';
  }

  async function submit() {
    setBusy(true);
    setError('');
    const res = await submitBattleEntry(ev.eventKey, {
      ...f, divisions, noWinConfirmed: noWin, spectators, spectatorsPreschool: preschool,
      guardianConsent, agreePolicy: agree,
    });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    try { localStorage.setItem(TOKEN_KEY, res.token); } catch { /* private mode */ }
    if (res.status === 'pending') {
      const co = await startBattleCheckout(res.token);
      if (co.ok) { window.location.href = co.url; return; }
      // 決済ページを作れなかったときは完了画面(決済ボタンつき)へ。30分以内ならそこから払える
    }
    window.location.href = `/battle/complete?t=${res.token}`;
  }

  const scrollToForm = () => setTimeout(() => document.getElementById('entry-form')?.scrollIntoView(), 0);
  const check = 'mt-0.5 h-5 w-5 shrink-0 accent-[#b8261c]';

  if (step === 'confirm') {
    return (
      <section id="entry-form" className="scroll-mt-4 space-y-4">
        <DojoHeading>入力内容の確認</DojoHeading>
        <BattleCard label="出場者">
          <p className="text-xl font-black">{f.dancerName} <span className="text-sm font-bold text-[#6b5a44]">{f.dancerKana}</span></p>
          <p className="mt-1 text-sm">{f.realName} / {f.birthdate}(開催日に{ageOn(f.birthdate, ev.eventDate)}歳)</p>
          <p className="text-sm">{f.genre} / {f.rep}</p>
          <p className="text-sm text-[#6b5a44]">{f.email} / {f.phone}{f.instagram && ` / ${f.instagram}`}</p>
          {guardian && <p className="text-sm text-[#6b5a44]">保護者: {f.guardianName}(同意済み)</p>}
        </BattleCard>
        <BattleCard label="お支払い">
          <ul className="space-y-1 text-sm">
            {divisions.map((k) => (
              <li key={k} className="flex justify-between gap-2">
                <span>{ev.divisions.find((d) => d.key === k)?.name}</span><span className="font-bold">{yen(amount.entryUnit)}</span>
              </li>
            ))}
            {spectators > 0 && (
              <li className="flex justify-between gap-2"><span>観覧 {yen(amount.spectatorUnit)} × {spectators}名</span><span className="font-bold">{yen(amount.spectatorTotal)}</span></li>
            )}
            {preschool > 0 && <li className="flex justify-between gap-2"><span>観覧(未就学児) × {preschool}名</span><span className="font-bold">無料</span></li>}
          </ul>
          <p className="f-num mt-3 border-t-2 border-[#1d140c] pt-3 text-center text-4xl font-bold">{yen(amount.total)}</p>
          <p className="text-center text-xs text-[#6b5a44]">カード決済(Stripe)</p>
        </BattleCard>
        {error && <DojoError>{error}</DojoError>}
        <button onClick={submit} disabled={busy} className={`w-full rounded py-4 text-lg font-black ${btnPrimaryCls}`}>
          {busy ? '接続中…' : preview ? 'テストとして送信する(決済なし)' : `挑戦する(${yen(amount.total)}・決済へ)`}
        </button>
        {!preview && (
          <p className="text-center text-xs text-[#f3eadb]/70">※ このあとカード決済画面に移動します。30分以内に決済が完了するとエントリー確定です</p>
        )}
        <button onClick={() => { setStep('input'); scrollToForm(); }} disabled={busy} className={`w-full rounded py-3.5 font-bold ${btnOnDarkCls}`}>
          入力に戻る
        </button>
      </section>
    );
  }

  return (
    <section id="entry-form" className="scroll-mt-4 space-y-4">
      <DojoHeading>エントリー</DojoHeading>
      <BattleCard title="出場者">
        <div className="space-y-4">
          <BattleField label="メールアドレス" required hint="エントリー確定のメールが届きます">
            <input type="email" value={f.email} onChange={set('email')} className={inputCls} autoComplete="email" />
          </BattleField>
          <BattleField label="ダンサー名" required hint="エントリー一覧・トーナメント表に載る名前です">
            <input value={f.dancerName} onChange={set('dancerName')} placeholder="例: TARO" className={inputCls} />
          </BattleField>
          <BattleField label="ダンサー名のよみがな" required hint="当日MCがお呼びする読み方です">
            <input value={f.dancerKana} onChange={set('dancerKana')} placeholder="例: たろー" className={inputCls} />
          </BattleField>
          <BattleField label="本名" required hint="受付での本人確認用。公開されません">
            <input value={f.realName} onChange={set('realName')} placeholder="例: 山田 太郎" className={inputCls} autoComplete="name" />
          </BattleField>
          <BattleField label="生年月日" required hint="年齢で出られる部門が決まります(開催日の年齢で判定)">
            <input type="date" value={f.birthdate} onChange={set('birthdate')} className={inputCls} max={today} />
          </BattleField>
          {f.birthdate && age != null && (
            <p className="-mt-2 text-xs text-[#6b5a44]">開催日({ev.eventDate})に {ageOn(f.birthdate, ev.eventDate)}歳</p>
          )}
          <BattleField label="所属(レペゼン)" required hint="チーム名・スクール名・地域など自由に。エントリー一覧に載ります">
            <input value={f.rep} onChange={set('rep')} placeholder="例: 仙台" className={inputCls} />
          </BattleField>
          <BattleField label="メインジャンル" required hint="エントリー一覧に載ります">
            <input value={f.genre} onChange={set('genre')} placeholder="例: HIPHOP" className={inputCls} />
          </BattleField>
          <BattleField label="電話番号" required hint="当日連絡が取れる番号">
            <input type="tel" value={f.phone} onChange={set('phone')} placeholder="090-1234-5678" className={inputCls} autoComplete="tel" />
          </BattleField>
          <BattleField label="Instagram" optional hint="結果発表などでタグ付けします">
            <input value={f.instagram} onChange={set('instagram')} placeholder="@boom_dance_school" className={inputCls} />
          </BattleField>
        </div>
      </BattleCard>

      <BattleCard title="出る部門" hanko={<>白帯<br />限定</>}>
        <p className="-mt-1 mb-2 text-xs text-[#6b5a44]">複数選べます(エントリー料は部門ごと)</p>
        <div className="space-y-2.5">
          {ev.divisions.map((d) => {
            const reason = disabledReason(d.key);
            const checked = divisions.includes(d.key);
            const left = remaining[d.key] ?? 0;
            return (
              <label
                key={d.key}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md border-2 p-2.5 ${checked ? 'border-[#b8261c] bg-[#fff1ec]' : 'border-[#d8c8aa] bg-[#fff8ec]'} ${reason && !checked ? 'opacity-50' : ''}`}
              >
                <input type="checkbox" checked={checked} disabled={Boolean(reason) && !checked} onChange={() => toggle(d.key)} className="h-5 w-5 shrink-0 accent-[#b8261c]" />
                <WhiteBelt />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-black leading-snug">{d.name}</span>
                  <span className="block text-xs text-[#6b5a44]">
                    {[d.note, `${d.capacity}名限定`].filter(Boolean).join('・')}・
                    <b className={left > 0 ? 'text-[#1d140c]' : 'text-[#b8261c]'}>{left > 0 ? `残り${left}枠` : '満員'}</b>
                  </span>
                  <span className="block text-sm font-bold">エントリー料 <span className="f-num">{yen(amount.entryUnit)}</span>
                  </span>
                  {reason && reason !== '満員' && <span className="block text-xs font-bold text-[#b8261c]">{reason}</span>}
                </span>
              </label>
            );
          })}
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" checked={noWin} onChange={(e) => setNoWin(e.target.checked)} className={check} />
          <span>
            <span className="font-bold">優勝未経験です</span>
            <span className="block text-xs text-[#6b5a44]">エントリーするジャンルで、過去にソロバトルで優勝したことはありません(ほかのジャンルでの優勝はOK)</span>
          </span>
        </label>
      </BattleCard>

      <BattleCard title="一緒に来る観覧の方">
        <div className="grid grid-cols-2 gap-3">
          <BattleField label={`小学生以上 ${yen(ev.spectatorFee)}/人`}>
            <CountSelect value={spectators} onChange={setSpectators} />
          </BattleField>
          <BattleField label="未就学児 無料">
            <CountSelect value={preschool} onChange={setPreschool} />
          </BattleField>
        </div>
        <p className="mt-2 text-xs text-[#6b5a44]">出場するご本人の観覧料はかかりません</p>
      </BattleCard>

      {guardian && (
        <BattleCard title="保護者の方へ" label="18歳未満の方">
          <div className="space-y-3">
            <BattleField label="保護者の方のお名前" required>
              <input value={f.guardianName} onChange={set('guardianName')} className={inputCls} />
            </BattleField>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={guardianConsent} onChange={(e) => setGuardianConsent(e.target.checked)} className={check} />
              <span>保護者として、このバトルへの参加に同意します</span>
            </label>
          </div>
        </BattleCard>
      )}

      <BattleCard title="キャンセル規定・個人情報">
        {ev.cancelPolicy && <MultiLine text={ev.cancelPolicy} className="text-xs leading-relaxed" />}
        <p className="mt-2 text-xs leading-relaxed">
          ご入力いただいた個人情報は、このイベントの運営(受付・連絡・結果の発表)にのみ使います。
          エントリー一覧に載るのはダンサー名・所属・ジャンルだけで、本名・連絡先・生年月日は公開しません。
          当日の写真・動画をBOOMのSNS等に載せることがあります。
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className={check} />
          <span className="font-bold">キャンセル規定と個人情報の取り扱いに同意します</span>
        </label>
      </BattleCard>

      <div className="rounded-md border border-[#f3eadb]/20 bg-black/60 p-4 text-center">
        <p className="text-xs font-bold tracking-widest text-[#f3eadb]/70">合計金額</p>
        <p className="f-num mt-1 text-5xl font-bold text-[#f3eadb]">{yen(amount.total)}</p>
      </div>

      {error && <DojoError>{error}</DojoError>}
      <button
        onClick={() => {
          const e = localCheck();
          if (e) { setError(e); return; }
          setError('');
          setStep('confirm');
          scrollToForm();
        }}
        className={`w-full rounded py-4 text-lg font-black ${btnPrimaryCls}`}
      >
        挑戦する　ENTRY
      </button>
      <p className="text-center text-xs text-[#f3eadb]/60">次の画面で入力内容を確認します</p>
    </section>
  );
}

function CountSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls}>
      {Array.from({ length: 11 }, (_, n) => (
        <option key={n} value={n}>{n}名</option>
      ))}
    </select>
  );
}
