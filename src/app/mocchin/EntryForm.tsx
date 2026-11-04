'use client';

// 申込フォーム。送信後は同じ画面で申込番号と振込先を出す(同じ内容をメールでも送る)。
// 会員の先行期間(11/8〜11/14)は「会員以外」を選べないようにする。判定はサーバ側でも必ず行う。
import { useState } from 'react';
import {
  CLASS_NUMBER_LABEL,
  CLASS_NUMBER_OPTIONS,
  MOCCHIN_BANK,
  MOCCHIN_FEE,
  MOCCHIN_LESSON_FEE_GUEST,
  MOCCHIN_LESSON_FEE_MEMBER,
  MOCCHIN_OPEN_START,
  MOCCHIN_PROMISES,
  formatJpDate,
  isMinor,
  yen,
  type FieldErrors,
} from '@/lib/mocchinEntry';
import { submitMocchinEntry, type MocchinSubmitResult } from './actions';
import { Field, Notice, Panel, btnCls, errCls, inputCls } from './ui';

type Done = Extract<MocchinSubmitResult, { ok: true }>;

export default function EntryForm({ memberOnly, preview }: { memberOnly: boolean; preview?: string }) {
  const [name, setName] = useState('');
  const [kana, setKana] = useState('');
  const [age, setAge] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isMember, setIsMember] = useState<boolean | null>(memberOnly ? true : null);
  const [memberNo, setMemberNo] = useState('');
  const [danceHistory, setDanceHistory] = useState('');
  const [classNumber, setClassNumber] = useState('');
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
      { name, kana, age, guardianName, phone, email, isMember, memberNo, danceHistory, classNumber, note, agreed },
      preview
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setFe(r.fieldErrors ?? {});
      return;
    }
    setDone(r);
    window.scrollTo({ top: 0 });
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
        <Field label="メールアドレス" hint="申込番号と振込先をお送りします" error={fe.email}>
          <input className={inputCls + errCls(fe.email)} value={email} type="email" inputMode="email" autoComplete="email" onChange={(e) => (setEmail(e.target.value), clear('email'))} placeholder="例: boom@example.com" />
        </Field>
      </Panel>

      <Panel title="BOOMとの関わり">
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
        {memberOnly && (
          <p className="mt-2 text-xs font-bold text-white/75">会員以外の方は{formatJpDate(MOCCHIN_OPEN_START)}から申し込めます</p>
        )}
        {isMember === true && (
          <Field label="会員番号(わかれば)" hint="わからなければ空欄でOK">
            <input className={inputCls} value={memberNo} onChange={(e) => setMemberNo(e.target.value)} placeholder="例: 1234" />
          </Field>
        )}
        {isMember === false && (
          <Field label="所属・ダンス歴(任意)" hint="例: ○○スタジオ所属 / HIPHOP 3年">
            <textarea className={inputCls} rows={3} value={danceHistory} onChange={(e) => setDanceHistory(e.target.value)} />
          </Field>
        )}
        <Field label="BW6で、クラスのナンバーにも出る予定ですか？" error={fe.classNumber}>
          <div className="grid grid-cols-3 gap-2">
            {CLASS_NUMBER_OPTIONS.map((k) => (
              <Choice key={k} on={classNumber === k} onClick={() => (setClassNumber(k), clear('classNumber'))} label={CLASS_NUMBER_LABEL[k]} />
            ))}
          </div>
        </Field>
        <p className="mt-2 text-xs font-bold text-white/75">クラスのナンバーに出る場合は、その参加費が別にかかります</p>
      </Panel>

      <Panel title="参加の約束">
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
        参加費 {yen(MOCCHIN_FEE)} は、申込のあとに表示される振込先へお振込みください。
        <span className="block">
          レッスン代は1日{yen(MOCCHIN_LESSON_FEE_MEMBER)}(会員以外の方は{yen(MOCCHIN_LESSON_FEE_GUEST)})で、各日当日のお支払いです。
        </span>
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
    <div>
      <Panel title="申込を受け付けました">
        <p className="text-sm font-bold">申込番号</p>
        <p className="text-4xl font-black text-[#19F2D6]">{d.no}</p>
        {d.overCapacity && (
          <p className="mt-3 text-sm font-bold text-[#FF4DB8]">
            定員を超えるお申込みをいただいています。オーディション形式になる場合は、あらためてご連絡します。
          </p>
        )}
      </Panel>
      <Panel title="参加費のお振込み">
        <dl className="space-y-1 text-sm font-bold">
          <div>金額：{yen(MOCCHIN_FEE)}</div>
          <div>期限：{formatJpDate(d.payDeadline)} まで</div>
          <div className="pt-2">
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
        <span className="block">
          レッスン代は1日{yen(d.isMember ? MOCCHIN_LESSON_FEE_MEMBER : MOCCHIN_LESSON_FEE_GUEST)}で、各日当日のお支払いです。
        </span>
      </Notice>
    </div>
  );
}
