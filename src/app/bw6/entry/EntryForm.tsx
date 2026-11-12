'use client';

// BW6 発表会（段階1）の申込フォーム（画面0〜7）。文の正本は設計書 04 4-2「申込フォームの流れ」。
// 1画面に1つ。下書きはこのスマホの中（localStorage）だけに残し、送れたら消す。合い鍵（submitKey）は下書きに入れない。
// 金額は毎回サーバ（quoteEntryAction）に聞く。画面では計算しない。「送る」の本当の確かめもサーバ（submitEntryAction）。
// サーバのファイルの型は import type で読む（ふつうの import だとサーバのコードがブラウザ用に入る）。
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PayGate, HouseholdView } from '@/lib/recital';
import type { ChargeLine } from '@/lib/recitalFee';
import type { PublicWork, QuotePerson } from '@/lib/recitalFamilyDb';
import { FAMILY_ADD_LINE, RECITAL_MSG, jpDate, slashDate, slashDateTime, yenJa } from '@/lib/recitalPublic';
import {
  doneScreen,
  draftToSubmission,
  entryStepErrors,
  toKatakana,
  workCountNotice,
  type DraftPerson,
  type EntryDraft,
} from '@/lib/recitalEntryForm';
import { FiveLines } from '@/components/recital/FiveLines';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { WorkCard } from '@/components/recital/WorkCard';
import { precheckEntryAction, quoteEntryAction, submitEntryAction } from './actions';

type Settings = {
  tshirtSizes: string[]; maxWorks: number; minSelfApplyAge: number; entryCloseAt: string; changeCloseAt: string; payDue: string;
  payOpenAt: string; privacyText: string; consentItems: string; extraCostsText: string; lineUrl: string;
};
type Props = {
  eventKey: string; pv: string | null; qs: string; preview: boolean; submitKey: string; todayYmd: string;
  works: PublicWork[]; fiveLines: string[]; settings: Settings;
};
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Quote = { lines: ChargeLine[]; total: number; totalIfAllIn: number };
type Done = { token: string; refCode: string; view: HouseholdView; total: number; hasMaybe: boolean; gate: PayGate };

const btnPrimary = 'block w-full rounded-xl bg-navy-700 px-4 py-3 text-center text-base font-bold text-white disabled:opacity-40';
const btnSecondary = 'block w-full rounded-xl border-2 border-navy-700 bg-white px-4 py-3 text-center text-base font-bold text-navy-700 disabled:opacity-40';
const btnSmall = 'rounded-lg border border-navy-700 bg-white px-3 py-1 text-sm font-bold text-navy-700';
const boxCls = 'rounded-xl border border-sand-200 bg-white p-4';
const stopCls = 'rounded-xl border-2 border-brand-600 bg-brand-50 p-4 text-sm font-bold leading-relaxed text-navy-700';
const errCls = 'mt-1 text-sm font-bold text-red-700';
const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
const MAYBE_LINE = '迷っている作品がある方は、決まってからお支払いください。お支払いのあとは、お返しできません。';
const STOP_SAME_EMAIL = 'もうお申し込みがあります。マイページのURLをメールで送りました。';
const SAME_PHONE_LINE = 'ご家族のお申し込みが、すでにあります。マイページをご確認ください。';
const SAME_PERSON_LINE = '同じお名前・同じ生年月日のお申し込みが、もうあります。ご家族が申し込んでいないか、確かめてください。';
const COOP_LINE = '協力チケットは、1家族に3枚です。ご家族やお友だちに渡せる入場券です。';
const FAMILY_BEST_LINE = 'ご家族の中で、いちばんお得になる組み合わせで計算しています。';
const QUOTE_FAILED = '金額を出せませんでした。もう一度お試しください';

let tempSeq = 0;
function newPerson(): DraftPerson {
  tempSeq += 1;
  return {
    tempId: `p${Date.now().toString(36)}${tempSeq}`, sameAsContact: false, lastName: '', firstName: '', lastKana: '', firstKana: '',
    birthday: '', instaHandle: '', tshirtSize: null, works: {},
  };
}

const emptyDraft = (): EntryDraft => ({
  contact: { lastName: '', firstName: '', lastKana: '', firstKana: '', email: '', phone: '' },
  people: [],
});

const chosen = (p: DraftPerson) => Object.values(p.works).filter((v) => v === 'in' || v === 'maybe').length;

function personName(d: EntryDraft, p: DraftPerson): string {
  const last = p.sameAsContact ? d.contact.lastName : p.lastName;
  const first = p.sameAsContact ? d.contact.firstName : p.firstName;
  return `${last} ${first}`.trim() || '（お名前）';
}

/** サーバの欄の名前 → 家庭に見せる言葉（invalid の fieldErrors を画面6 に並べる時） */
function fieldLabel(key: string, d: EntryDraft): string {
  const map: Record<string, string> = {
    lastName: '姓', firstName: '名', lastKana: 'セイ', firstKana: 'メイ', email: 'メールアドレス', phone: '電話番号',
    birthday: '生年月日', isContact: '「連絡する人と同じ」', tshirtSize: 'Tシャツのサイズ', works: '作品', category: '区分',
  };
  if (key === 'consentAccepted') return '同意';
  if (key === 'people') return '出る人';
  const c = /^contact\.(\w+)$/.exec(key);
  if (c) return `連絡する人の${map[c[1]] ?? c[1]}`;
  const p = /^people\.(\d+)\.(\w+)$/.exec(key);
  if (p) {
    const person = d.people[Number(p[1])];
    return `${person ? personName(d, person) : `${Number(p[1]) + 1}人目`}さんの${map[p[2]] ?? p[2]}`;
  }
  return key;
}

function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-bold text-navy-700">{label}</span>
      {hint && <span className="mt-0.5 block text-xs leading-relaxed text-navy-700">{hint}</span>}
      <span className="mt-1 block">{children}</span>
      {error && <span className={errCls}>{error}</span>}
    </label>
  );
}

export function EntryForm({ eventKey, pv, qs, preview, submitKey, todayYmd, works, fiveLines, settings: st }: Props) {
  const storageKey = `bw6-entry-draft:${eventKey}`;
  const hasTshirt = st.tshirtSizes.length > 0;
  const stepCount = hasTshirt ? 7 : 6;
  const ctx = { todayYmd, minSelfApplyAge: st.minSelfApplyAge, maxWorks: st.maxWorks };
  const worksById = useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);

  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [personIdx, setPersonIdx] = useState(0);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showFive, setShowFive] = useState(false);
  const [sameEmailStop, setSameEmailStop] = useState(false);
  const [samePhoneNotice, setSamePhoneNotice] = useState(false);
  const [samePersonNotice, setSamePersonNotice] = useState(false);
  const [confirmNotFamily, setConfirmNotFamily] = useState(false);
  const [confirmSamePerson, setConfirmSamePerson] = useState(false);
  const [chkRefund, setChkRefund] = useState(false);
  const [chkOthers, setChkOthers] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [fDay, setFDay] = useState('');
  const [fPlace, setFPlace] = useState('');
  const [fInst, setFInst] = useState('');

  // ---------- 下書き（読めなくても動く） ----------
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return; // 戻すのは開いた時の1回だけ
    restored.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const v = JSON.parse(raw) as { draft?: EntryDraft; step?: number; personIdx?: number };
        const d = v.draft;
        if (d && d.contact && typeof d.contact === 'object' && Array.isArray(d.people)) {
          const openIds = new Set(works.filter((w) => w.status === 'open').map((w) => w.id));
          const people = d.people.map((p) => ({
            ...newPerson(), ...p,
            works: Object.fromEntries(Object.entries(p.works ?? {}).filter(([k, s]) => openIds.has(Number(k)) && (s === 'in' || s === 'maybe'))),
          })) as DraftPerson[];
          const contact = { ...emptyDraft().contact, ...d.contact };
          let s = typeof v.step === 'number' && v.step >= 0 && v.step <= 6 ? (v.step as Step) : 0;
          if (s >= 2 && people.length === 0) s = 1;
          const pi = typeof v.personIdx === 'number' ? Math.min(Math.max(0, v.personIdx), Math.max(0, people.length - 1)) : 0;
          setDraft({ contact, people });
          setStep(s);
          setPersonIdx(pi);
        }
      }
    } catch {
      /* 下書きが読めなくても、空から始める */
    }
    setLoaded(true);
  }, [storageKey, works]);

  useEffect(() => {
    if (!loaded || step === 7) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ draft, step, personIdx }));
    } catch {
      /* 書けなくても続ける */
    }
  }, [loaded, storageKey, draft, step, personIdx]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step, personIdx]);

  // ---------- 金額（選ぶたびに 400ms 待って聞き、最後の答えだけを出す） ----------
  const quoteKey = useMemo(() => {
    const people: QuotePerson[] = draft.people.map((p) => ({
      lastName: p.sameAsContact ? draft.contact.lastName : p.lastName,
      firstName: p.sameAsContact ? draft.contact.firstName : p.firstName,
      lastKana: toKatakana(p.sameAsContact ? draft.contact.lastKana : p.lastKana).trim(),
      firstKana: toKatakana(p.sameAsContact ? draft.contact.firstKana : p.firstKana).trim(),
      birthday: p.birthday || null,
      works: Object.entries(p.works)
        .filter(([, v]) => v === 'in' || v === 'maybe')
        .map(([k, v]) => ({ workId: Number(k), status: v }))
        .sort((a, b) => a.workId - b.workId),
    }));
    return JSON.stringify(people);
  }, [draft]);
  const quoteSeq = useRef(0);
  const sendingRef = useRef(false);
  useEffect(() => {
    if (step !== 3 && step !== 5 && step !== 6) return;
    const my = ++quoteSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await quoteEntryAction(eventKey, pv, JSON.parse(quoteKey) as QuotePerson[]);
        if (my !== quoteSeq.current) return;
        if (r.ok) {
          setQuote({ lines: r.lines, total: r.total, totalIfAllIn: r.totalIfAllIn });
          setQuoteFailed(false);
        } else {
          setQuoteFailed(true);
        }
      } catch {
        if (my === quoteSeq.current) setQuoteFailed(true); // 「…」のままにせず、出せなかったと知らせる
      }
    }, step === 3 ? 400 : 0);
    return () => clearTimeout(t);
  }, [step, quoteKey, eventKey, pv]);

  // ---------- 書きかえ ----------
  const setContact = (k: keyof EntryDraft['contact'], v: string) => setDraft((d) => ({ ...d, contact: { ...d.contact, [k]: v } }));
  const updatePerson = (idx: number, fn: (p: DraftPerson) => DraftPerson) =>
    setDraft((d) => ({ ...d, people: d.people.map((p, i) => (i === idx ? fn(p) : p)) }));
  const go = (s: Step, pi?: number) => {
    setErrors({});
    setMsg(null);
    if (s < 6) {
      // 中身を直しに戻ったら、「もうあります」の知らせと選んだ答えは消す（「送る」の前にもう一度確かめる）
      setSameEmailStop(false);
      setSamePhoneNotice(false);
      setSamePersonNotice(false);
      setConfirmNotFamily(false);
      setConfirmSamePerson(false);
    }
    if (pi !== undefined) setPersonIdx(pi);
    setStep(s);
  };
  const err = (k: string, prefix: string) => errors[k] ?? serverErrors[`${prefix}${k}`];

  const hasIn = draft.people.some((p) => Object.values(p.works).includes('in'));
  const hasMaybe = draft.people.some((p) => Object.values(p.works).includes('maybe'));
  const pos = step <= 4 ? step : hasTshirt ? step : step - 1;

  // ---------- 画面1 → 2 ----------
  async function nextFrom1() {
    const e = entryStepErrors(1, draft, 0, ctx);
    setErrors(e);
    setMsg(null);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    try {
      const r = await precheckEntryAction(eventKey, pv, { email: draft.contact.email, phone: '', people: [] });
      if (!r.ok) {
        setMsg(r.message);
        return;
      }
      if (r.sameEmail) {
        setSameEmailStop(true);
        return;
      }
      if (draft.people.length === 0) setDraft((d) => ({ ...d, people: [newPerson()] }));
      go(2, 0);
    } catch {
      setMsg(RECITAL_MSG.rate);
    } finally {
      setBusy(false);
    }
  }

  function otherEmail() {
    setContact('email', '');
    setSameEmailStop(false);
    go(1);
  }

  // ---------- 画面2・3 ----------
  function nextFrom2() {
    const e = entryStepErrors(2, draft, personIdx, ctx);
    setErrors(e);
    if (Object.keys(e).length === 0) go(3);
  }
  function backFrom2() {
    if (personIdx === 0) go(1);
    else go(3, personIdx - 1);
  }
  function removePerson() {
    const idx = personIdx;
    setDraft((d) => ({ ...d, people: d.people.filter((_, i) => i !== idx) }));
    go(3, Math.max(0, idx - 1));
  }
  function addPerson() {
    const e = entryStepErrors(3, draft, personIdx, ctx);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const nextIdx = draft.people.length;
    setDraft((d) => ({ ...d, people: [...d.people, newPerson()] }));
    go(2, nextIdx);
  }
  function nextFrom3() {
    const e = entryStepErrors(3, draft, personIdx, ctx);
    setErrors(e);
    if (Object.keys(e).length === 0) go(hasTshirt ? 4 : 5);
  }
  function setWork(workId: number, v: 'in' | 'maybe' | 'out') {
    updatePerson(personIdx, (p) => {
      const w = { ...p.works };
      if (v === 'out') delete w[workId];
      else {
        if (!(workId in w) && chosen(p) >= st.maxWorks) return p;
        w[workId] = v;
      }
      return { ...p, works: w };
    });
  }

  // ---------- 送る ----------
  /** 全部の画面の確かめをやり直す（下書きから戻った時など）。止まった画面へ行く */
  function allChecksOk(): boolean {
    const e1 = entryStepErrors(1, draft, 0, ctx);
    if (Object.keys(e1).length > 0) { go(1); setErrors(e1); return false; }
    if (draft.people.length === 0) { go(1); return false; }
    for (let i = 0; i < draft.people.length; i++) {
      const e2 = entryStepErrors(2, draft, i, ctx);
      if (Object.keys(e2).length > 0) { go(2, i); setErrors(e2); return false; }
      const e3 = entryStepErrors(3, draft, i, ctx);
      if (Object.keys(e3).length > 0) { go(3, i); setErrors(e3); return false; }
    }
    return true;
  }

  async function send() {
    if (sendingRef.current) return; // 素早い2回押しでも state はまだ古いので、ref で止める
    sendingRef.current = true;
    setBusy(true);
    setMsg(null);
    setServerErrors({});
    let finished = false;
    try {
      if (!allChecksOk()) return;
      const pre = await precheckEntryAction(eventKey, pv, {
        email: draft.contact.email,
        phone: draft.contact.phone,
        people: draft.people.map((p) => ({
          lastKana: toKatakana(p.sameAsContact ? draft.contact.lastKana : p.lastKana).trim(),
          firstKana: toKatakana(p.sameAsContact ? draft.contact.firstKana : p.firstKana).trim(),
          birthday: p.birthday,
        })),
        // 知らせを出した1回目で URL のメールはもう送った。答えたあとの2回目では送り直さない
        noResend: samePhoneNotice || samePersonNotice,
      });
      if (!pre.ok) { setMsg(pre.message); return; }
      let stop = false;
      if (pre.sameEmail) { setSameEmailStop(true); stop = true; }
      if (pre.samePhone && !confirmNotFamily) { setSamePhoneNotice(true); stop = true; }
      if (pre.samePersonIdx.length > 0 && !confirmSamePerson) { setSamePersonNotice(true); stop = true; }
      if (stop) return;

      const sub = draftToSubmission(draft, { eventKey, submitKey, confirmNotFamily, confirmSamePerson, consentAccepted: chkRefund && chkOthers, tshirtOn: hasTshirt });
      const r = await submitEntryAction(sub, pv);
      if (r.ok) {
        finished = true;
        try { localStorage.removeItem(storageKey); } catch { /* 消せなくても進む */ }
        setDone({ token: r.token, refCode: r.refCode, view: r.view, total: r.total, hasMaybe, gate: r.gate });
        go(7);
        return;
      }
      switch (r.code) {
        case 'same_phone': setSamePhoneNotice(true); break;
        case 'same_person': setSamePersonNotice(true); break;
        case 'same_email': setSameEmailStop(true); break;
        case 'invalid': setServerErrors(r.fieldErrors ?? {}); setMsg(r.message); break;
        default: setMsg(r.message); // busy・rate（同じ合い鍵のまま押し直せる）・before・closed・suspended
      }
    } catch {
      setMsg(RECITAL_MSG.busy);
    } finally {
      if (!finished) {
        sendingRef.current = false;
        setBusy(false);
      }
    }
  }

  // ---------- 表示の部品 ----------
  const totalText = quoteFailed ? <span className="text-base text-red-700">{QUOTE_FAILED}</span> : quote ? yenJa(quote.total) : '…';
  const person = draft.people[personIdx];
  const personLines = (i: number) => (quote?.lines ?? []).filter((l) => l.personId === i + 1);
  const householdLines = (quote?.lines ?? []).filter((l) => l.personId == null);
  const coopLine = householdLines.find((l) => l.itemCode === 'coop_ticket');
  const instructorNames = useMemo(() => [...new Set(works.flatMap((w) => w.instructors))], [works]);
  const shownWorks = works.filter((w) => {
    if (fDay && !w.slotLabel.includes(`${fDay}曜`)) return false;
    if (fPlace.trim() && !w.slotLabel.includes(fPlace.trim())) return false;
    if (fInst && !w.instructors.includes(fInst)) return false;
    return true;
  });

  const kanaInput = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <input
      type="text"
      className={RECITAL_INPUT_CLS}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onChange(toKatakana(e.target.value))}
    />
  );

  const lineList = (lines: ChargeLine[]) => (
    <ul className="space-y-1 text-sm">
      {lines.map((l, i) => (
        <li key={i} className="flex justify-between gap-3">
          <span>{l.label}</span>
          <span className="shrink-0 font-bold">{yenJa(l.amount)}</span>
        </li>
      ))}
    </ul>
  );

  const backBtn = (onClick: () => void) => (
    <button type="button" onClick={onClick} className={btnSecondary}>
      もどる
    </button>
  );

  let body: ReactNode = null;

  if (step === 0) {
    body = (
      <section className="space-y-4">
        <div className={`${boxCls} space-y-3 text-sm leading-relaxed`}>
          <p>お申し込みのときは、お支払いはありません。お支払いは、お申し込みのすぐあとから {jpDate(st.payDue)}まで、いつでもできます。お支払いいただいた時点で、お申し込み完了です。</p>
          <p>
            ごきょうだい・ご家族は、<strong>1回のお申し込みで、まとめて</strong>入れてください。別々に申し込むと、料金が高くなります。お子さま1人につき、お申し込みは1回です。ご家族で、どなたが申し込むかを決めてから、お進みください。
          </p>
          <p>振りを見てから決めたい方は、『まだ迷っている』を選んでお申し込みください。{slashDate(st.changeCloseAt)}までに、マイページで『出る』に変えられます。お支払いは、決まってからで大丈夫です。期限は {jpDate(st.payDue)}です。</p>
        </div>
        <button type="button" onClick={() => setShowFive((v) => !v)} className="text-sm font-bold text-navy-700 underline">
          くわしくは、こちら
        </button>
        {showFive && <FiveLines lines={fiveLines} />}
        <div className="space-y-1 text-xs text-navy-700">
          <p>途中でやめても、続きから入れられます</p>
          <p>金額は、送る前に画面に出ます</p>
        </div>
        <button type="button" className={btnPrimary} onClick={() => go(1)}>
          はじめる
        </button>
        <Link href={`/bw6/resend${qs}`} className="block text-center text-sm font-bold text-navy-700 underline">
          もう申し込んだ方はこちら（お支払い・作品を足す・やめる）
        </Link>
        <div className="flex justify-center gap-6 text-sm font-bold">
          <Link href={`/bw6/guide${qs}`} className="text-navy-700 underline">出演のご案内</Link>
          <Link href={`/bw6/fee${qs}`} className="text-navy-700 underline">料金の早見</Link>
        </div>
      </section>
    );
  } else if (step === 1) {
    const c = draft.contact;
    body = (
      <section className="space-y-4">
        <h2 className="text-xl font-bold">連絡する人</h2>
        <div className="space-y-1 text-sm leading-relaxed">
          <p>お子さんが出るときは、保護者の方のことを書いてください。出演するご本人が大人の方は、ご本人のことを書いてください</p>
          <p>高校生の方は、保護者の方と一緒に入れてください。</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="姓" error={err('lastName', 'contact.')}>
            <input type="text" autoComplete="family-name" className={RECITAL_INPUT_CLS} value={c.lastName} onChange={(e) => setContact('lastName', e.target.value)} />
          </Field>
          <Field label="名" error={err('firstName', 'contact.')}>
            <input type="text" autoComplete="given-name" className={RECITAL_INPUT_CLS} value={c.firstName} onChange={(e) => setContact('firstName', e.target.value)} />
          </Field>
          <Field label="セイ" error={err('lastKana', 'contact.')}>
            {kanaInput(c.lastKana, (v) => setContact('lastKana', v), 'ヤマダ')}
          </Field>
          <Field label="メイ" error={err('firstKana', 'contact.')}>
            {kanaInput(c.firstKana, (v) => setContact('firstKana', v), 'ハナコ')}
          </Field>
        </div>
        <Field label="メールアドレス" error={err('email', 'contact.')}>
          <input type="email" inputMode="email" autoComplete="email" className={RECITAL_INPUT_CLS} value={c.email} onChange={(e) => { setContact('email', e.target.value); setSameEmailStop(false); }} />
        </Field>
        <Field label="電話番号" hint="本番の日につながる番号" error={err('phone', 'contact.')}>
          <input type="tel" inputMode="tel" autoComplete="tel" className={RECITAL_INPUT_CLS} value={c.phone} onChange={(e) => setContact('phone', e.target.value)} />
        </Field>
        {sameEmailStop ? (
          <div className="space-y-3">
            <div className={stopCls}>
              <p>{STOP_SAME_EMAIL}</p>
              <p className="mt-2 font-normal">{FAMILY_ADD_LINE}</p>
            </div>
            <button type="button" className={btnSecondary} onClick={otherEmail}>
              別のメールアドレスで申し込む
            </button>
          </div>
        ) : (
          <button type="button" className={btnPrimary} disabled={busy} onClick={nextFrom1}>
            つぎへ
          </button>
        )}
        {backBtn(() => go(0))}
      </section>
    );
  } else if (step === 2 && person) {
    const p = person;
    const [by = '', bm = '', bd = ''] = p.birthday ? p.birthday.split('-') : [];
    const setBirth = (part: 0 | 1 | 2, v: string) => {
      const parts = [by, bm, bd];
      parts[part] = v;
      updatePerson(personIdx, (x) => ({ ...x, birthday: parts.every((s) => s === '') ? '' : parts.join('-') }));
    };
    const thisYear = Number(todayYmd.slice(0, 4));
    const years = Array.from({ length: 91 }, (_, i) => String(thisYear - i));
    const someoneElseIsContact = draft.people.some((x, i) => i !== personIdx && x.sameAsContact);
    body = (
      <section className="space-y-4">
        <h2 className="text-xl font-bold">出る人{draft.people.length > 1 ? `（${personIdx + 1}人目）` : ''}</h2>
        {!someoneElseIsContact && (
          <button
            type="button"
            className={`w-full rounded-xl border-2 px-4 py-3 text-base font-bold ${p.sameAsContact ? 'border-navy-700 bg-navy-700 text-white' : 'border-navy-700 bg-white text-navy-700'}`}
            aria-pressed={p.sameAsContact}
            onClick={() => updatePerson(personIdx, (x) => ({ ...x, sameAsContact: !x.sameAsContact }))}
          >
            連絡する人と同じ{p.sameAsContact ? '（えらんでいます）' : ''}
          </button>
        )}
        {err('sameAsContact', '') && <p className={errCls}>{errors.sameAsContact}</p>}
        {serverErrors[`people.${personIdx}.isContact`] && <p className={errCls}>{serverErrors[`people.${personIdx}.isContact`]}</p>}
        {p.sameAsContact ? (
          <div className={`${boxCls} text-sm`}>
            <p className="font-bold">{draft.contact.lastName} {draft.contact.firstName}（{toKatakana(draft.contact.lastKana)} {toKatakana(draft.contact.firstKana)}）</p>
            <p className="mt-1 text-xs">パンフレットとエンドロールに載ります</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs">パンフレットとエンドロールに載ります</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="姓" error={err('lastName', `people.${personIdx}.`)}>
                <input type="text" className={RECITAL_INPUT_CLS} value={p.lastName} onChange={(e) => updatePerson(personIdx, (x) => ({ ...x, lastName: e.target.value }))} />
              </Field>
              <Field label="名" error={err('firstName', `people.${personIdx}.`)}>
                <input type="text" className={RECITAL_INPUT_CLS} value={p.firstName} onChange={(e) => updatePerson(personIdx, (x) => ({ ...x, firstName: e.target.value }))} />
              </Field>
              <Field label="セイ" error={err('lastKana', `people.${personIdx}.`)}>
                {kanaInput(p.lastKana, (v) => updatePerson(personIdx, (x) => ({ ...x, lastKana: v })), 'ヤマダ')}
              </Field>
              <Field label="メイ" error={err('firstKana', `people.${personIdx}.`)}>
                {kanaInput(p.firstKana, (v) => updatePerson(personIdx, (x) => ({ ...x, firstKana: v })), 'ハナコ')}
              </Field>
            </div>
          </div>
        )}
        <div>
          <span className="block text-sm font-bold">生年月日</span>
          <div className="mt-1 grid grid-cols-[2fr_1fr_1fr] gap-2">
            <select aria-label="年" className={RECITAL_INPUT_CLS} value={by} onChange={(e) => setBirth(0, e.target.value)}>
              <option value="">年</option>
              {years.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
            <select aria-label="月" className={RECITAL_INPUT_CLS} value={bm} onChange={(e) => setBirth(1, e.target.value)}>
              <option value="">月</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => <option key={m} value={m}>{Number(m)}月</option>)}
            </select>
            <select aria-label="日" className={RECITAL_INPUT_CLS} value={bd} onChange={(e) => setBirth(2, e.target.value)}>
              <option value="">日</option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => <option key={d} value={d}>{Number(d)}日</option>)}
            </select>
          </div>
          <p className="mt-1 text-xs">生年月日は、学年べつの名簿、控室の部屋分け、会員の確認に使います</p>
          {err('birthday', `people.${personIdx}.`) && <p className={errCls}>{err('birthday', `people.${personIdx}.`)}</p>}
        </div>
        <Field
          label="Instagram（任意）"
          hint={
            <>
              発表会の投稿でタグ付けしてお知らせしたいので、Instagram をお持ちの方は、アカウントを入れてください（任意）
              <br />
              お子さまのアカウントが無いときは、保護者の方のものでもかまいません（どなたのものか、書いてください）。
            </>
          }
        >
          <input type="text" autoCapitalize="none" autoCorrect="off" className={RECITAL_INPUT_CLS} value={p.instaHandle} placeholder="@boom_sendai（母）" onChange={(e) => updatePerson(personIdx, (x) => ({ ...x, instaHandle: e.target.value }))} />
        </Field>
        <button type="button" className={btnPrimary} onClick={nextFrom2}>
          つぎへ
        </button>
        {backBtn(backFrom2)}
        {personIdx > 0 && (
          <button type="button" className="block w-full text-center text-sm font-bold text-navy-700 underline" onClick={removePerson}>
            この人を消す
          </button>
        )}
      </section>
    );
  } else if (step === 3 && person) {
    const p = person;
    const limit = chosen(p) >= st.maxWorks;
    const notice = workCountNotice(p);
    body = (
      <section className="space-y-4">
        <h2 className="text-xl font-bold">作品をえらぶ（{personName(draft, p)}さん）</h2>
        <div className="space-y-1 text-sm leading-relaxed">
          <p>ふだん通っているクラスの作品をえらんでください。分からないときは、担当イントラに聞いてください</p>
          <p>分からないときは、『まだ迷っている』で送って大丈夫です。あとから変えられます。</p>
          <p>人数が少ないクラスは、他のクラスと合同での作品制作になる場合があります</p>
        </div>
        <div className={`${boxCls} space-y-3`}>
          <p className="text-sm font-bold">しぼる</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="曜日">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={fDay === d}
                onClick={() => setFDay((x) => (x === d ? '' : d))}
                className={`h-9 w-9 rounded-full border text-sm font-bold ${fDay === d ? 'border-navy-700 bg-navy-700 text-white' : 'border-sand-300 bg-white text-navy-700'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <input type="text" aria-label="会場" placeholder="会場（例：長町）" className={RECITAL_INPUT_CLS} value={fPlace} onChange={(e) => setFPlace(e.target.value)} />
          {instructorNames.length > 0 && (
            <select aria-label="担当イントラ" className={RECITAL_INPUT_CLS} value={fInst} onChange={(e) => setFInst(e.target.value)}>
              <option value="">担当イントラ（すべて）</option>
              {instructorNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-3">
          {shownWorks.length === 0 && <p className="text-center text-sm">あてはまる作品がありません</p>}
          {shownWorks.map((w) => {
            const v = (p.works[w.id] as 'in' | 'maybe' | undefined) ?? 'out';
            return <WorkCard key={w.id} work={w} value={v} onChange={(x) => setWork(w.id, x)} disabled={limit && v === 'out'} />;
          })}
        </div>
        <p className="text-sm">
          MOCCHINナンバーのお申し込みは、別のページです
          <Link href="/mocchin" className="ml-2 font-bold text-navy-700 underline">こちら</Link>
        </p>
        {notice && <p className={stopCls}>{notice}</p>}
        {errors.works && <p className={errCls}>{errors.works}</p>}
        {serverErrors[`people.${personIdx}.works`] && <p className={errCls}>{serverErrors[`people.${personIdx}.works`]}</p>}
        <div className={`${boxCls} space-y-2`}>
          <p className="text-sm font-bold">ご家族の合計（いま）</p>
          <p className="text-3xl font-bold">{totalText}</p>
          {draft.people.length > 1 && <p className="text-xs">{FAMILY_BEST_LINE}</p>}
          <p className="pt-2 text-sm font-bold">{personName(draft, p)}さんの内わけ</p>
          {lineList(personLines(personIdx))}
        </div>
        <button type="button" className={btnPrimary} onClick={nextFrom3}>
          つぎへ
        </button>
        <button type="button" className={btnSecondary} onClick={addPerson}>
          もう1人、家族を足す
        </button>
        {backBtn(() => go(2))}
      </section>
    );
  } else if (step === 4) {
    body = (
      <section className="space-y-4">
        <h2 className="text-xl font-bold">Tシャツ</h2>
        <p className="text-sm">色は、デザインが決まったらお知らせします</p>
        {draft.people.map((p, i) => (
          <Field key={p.tempId} label={`${personName(draft, p)}さんのサイズ`} error={serverErrors[`people.${i}.tshirtSize`]}>
            <select className={RECITAL_INPUT_CLS} value={p.tshirtSize ?? ''} onChange={(e) => updatePerson(i, (x) => ({ ...x, tshirtSize: e.target.value === '' ? null : e.target.value }))}>
              <option value="">あとで決める</option>
              {st.tshirtSizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        ))}
        <button type="button" className={btnPrimary} onClick={() => go(5)}>
          つぎへ
        </button>
        {backBtn(() => go(3, draft.people.length - 1))}
      </section>
    );
  } else if (step === 5) {
    body = (
      <section className="space-y-4">
        <h2 className="text-xl font-bold">金額</h2>
        <div className={`${boxCls} space-y-3`}>
          <p className="text-sm font-bold">ご家族の合計</p>
          <p className="text-4xl font-bold">{totalText}</p>
          {draft.people.map((p, i) => (
            <div key={p.tempId} className="border-t border-sand-200 pt-2">
              <p className="text-sm font-bold">{personName(draft, p)}さん</p>
              {lineList(personLines(i))}
            </div>
          ))}
          {householdLines.length > 0 && (
            <div className="border-t border-sand-200 pt-2">
              <p className="text-sm font-bold">ご家族で</p>
              {lineList(householdLines)}
            </div>
          )}
        </div>
        <div className="space-y-2 text-sm leading-relaxed">
          <p>お申し込みのときは、お支払いはありません。お支払いは、お申し込みのすぐあとから {jpDate(st.payDue)}まで、いつでもできます。お支払いいただいた時点で、お申し込み完了です。</p>
          <p>{FAMILY_BEST_LINE}</p>
          {coopLine && <p>{coopLine.label}。{COOP_LINE}</p>}
          {hasMaybe && quote && !quoteFailed && (
            <>
              <p className="font-bold">迷っている作品は、金額に入っていません。出ると決めると {yenJa(quote.totalIfAllIn)} になります</p>
              <p>{MAYBE_LINE}</p>
            </>
          )}
        </div>
        {st.extraCostsText.trim() !== '' && (
          <div className={boxCls}>
            <p className="text-sm font-bold">このほかにかかるもの</p>
            <p className="mt-1 whitespace-pre-line text-sm">{st.extraCostsText}</p>
          </div>
        )}
        <button type="button" className={btnPrimary} onClick={() => go(6)}>
          つぎへ
        </button>
        {backBtn(() => (hasTshirt ? go(4) : go(3, draft.people.length - 1)))}
      </section>
    );
  } else if (step === 6) {
    const c = draft.contact;
    const consentItems = st.consentItems.split('\n').map((s) => s.trim()).filter((s) => s !== '');
    const zeroWithIn = quote !== null && quote.total === 0 && hasIn;
    const blocked = !chkRefund || !chkOthers || (samePhoneNotice && !confirmNotFamily) || (samePersonNotice && !confirmSamePerson) || sameEmailStop;
    const serverErrList = Object.entries(serverErrors);
    body = (
      <section className="space-y-4">
        <h2 className="text-xl font-bold">確認と同意</h2>
        <div className={`${boxCls} space-y-2`}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">連絡する人</p>
            <button type="button" className={btnSmall} onClick={() => go(1)}>直す</button>
          </div>
          <p className="text-sm">{c.lastName} {c.firstName}（{toKatakana(c.lastKana)} {toKatakana(c.firstKana)}）</p>
          <p className="break-all text-xl font-bold">{c.email}</p>
          <p className="text-sm">{c.phone}</p>
        </div>
        {draft.people.map((p, i) => (
          <div key={p.tempId} className={`${boxCls} space-y-1 text-sm`}>
            <div className="flex items-center justify-between">
              <p className="font-bold">{personName(draft, p)}さん</p>
              <button type="button" className={btnSmall} onClick={() => go(2, i)}>直す</button>
            </div>
            <p>生年月日：{p.birthday}</p>
            {p.instaHandle.trim() && <p>Instagram：{p.instaHandle.trim()}</p>}
            {hasTshirt && <p>Tシャツ：{p.tshirtSize ?? 'あとで決める'}</p>}
            <ul className="list-disc pl-5">
              {Object.entries(p.works)
                .filter(([, v]) => v === 'in' || v === 'maybe')
                .map(([k, v]) => (
                  <li key={k}>{worksById.get(Number(k))?.title ?? '作品'}（{v === 'in' ? '出る' : 'まだ迷っている'}）</li>
                ))}
            </ul>
          </div>
        ))}
        <div className={boxCls}>
          <p className="text-sm font-bold">合計</p>
          <p className="text-2xl font-bold">{totalText}</p>
        </div>

        {st.privacyText.trim() !== '' && (
          <div className={boxCls}>
            <p className="text-sm font-bold">お名前・連絡先などの使い道</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{st.privacyText}</p>
          </div>
        )}
        {consentItems.length > 0 && (
          <div className={boxCls}>
            <p className="text-sm font-bold">同意のお願い</p>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {consentItems.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        )}
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm font-bold">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-navy-700" checked={chkRefund} onChange={(e) => setChkRefund(e.target.checked)} />
            お支払いのあとはお返しできないことを、確かめました
          </label>
          <label className="flex items-start gap-3 text-sm font-bold">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-navy-700" checked={chkOthers} onChange={(e) => setChkOthers(e.target.checked)} />
            ほかの5つを読みました
          </label>
          {serverErrors.consentAccepted && <p className={errCls}>{serverErrors.consentAccepted}</p>}
        </div>

        {sameEmailStop && (
          <div className="space-y-3">
            <div className={stopCls}>
              <p>{STOP_SAME_EMAIL}</p>
              <p className="mt-2 font-normal">{FAMILY_ADD_LINE}</p>
            </div>
            <button type="button" className={btnSecondary} onClick={otherEmail}>
              別のメールアドレスで申し込む
            </button>
          </div>
        )}
        {samePhoneNotice && (
          <div className={stopCls}>
            <p>{SAME_PHONE_LINE}</p>
            <label className="mt-3 flex items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-navy-700" checked={confirmNotFamily} onChange={(e) => setConfirmNotFamily(e.target.checked)} />
              家族ではない
            </label>
          </div>
        )}
        {samePersonNotice && (
          <div className={stopCls}>
            <p>{SAME_PERSON_LINE}</p>
            <label className="mt-3 flex items-center gap-3">
              <input type="checkbox" className="h-5 w-5 accent-navy-700" checked={confirmSamePerson} onChange={(e) => setConfirmSamePerson(e.target.checked)} />
              それでも進む
            </label>
          </div>
        )}
        {serverErrList.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-red-300 bg-white p-3 text-sm text-red-700">
            {serverErrList.map(([k, v]) => <li key={k}>{fieldLabel(k, draft)}：{v}</li>)}
          </ul>
        )}

        <p className="text-sm font-bold leading-relaxed">
          {zeroWithIn ? '送ると、お申し込みが完了します。お支払いはありません。' : '送ると『仮受付』になります。このあと、マイページからお支払いいただけます。'}
        </p>
        <button type="button" className={btnPrimary} disabled={blocked || busy} onClick={send}>
          {busy ? '送っています…' : '送る'}
        </button>
        {backBtn(() => go(5))}
      </section>
    );
  } else if (step === 7 && done) {
    const ds = doneScreen({ view: done.view, total: done.total, gate: done.gate, payOpenAt: st.payOpenAt, payDue: st.payDue, hasMaybe: done.hasMaybe });
    body = (
      <section className="space-y-4">
        <h2 className="text-xl font-bold">送りました</h2>
        <div className={`${boxCls} space-y-2 text-center`}>
          <p className="text-sm font-bold">整理番号</p>
          <p className="text-4xl font-bold tracking-widest">{done.refCode}</p>
          <p className="pt-2 text-sm font-bold">いまの金額</p>
          <p className="text-2xl font-bold">{yenJa(done.total)}</p>
        </div>
        <div className="space-y-2 text-sm leading-relaxed">
          {ds.lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
        <Link href={`/bw6/my?t=${encodeURIComponent(done.token)}`} className={btnPrimary}>
          {ds.button}
        </Link>
        <div className={boxCls}>
          <p className="text-sm font-bold">次にやること</p>
          <ol className="mt-2 list-decimal pl-5 text-sm">
            <li>控えのメールが届いたか、確かめてください。</li>
          </ol>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-bold">控えが届いていないとき</p>
          {st.lineUrl ? (
            <a href={st.lineUrl} target="_blank" rel="noreferrer noopener" className={btnSecondary}>
              公式LINEへ
            </a>
          ) : (
            <p className="text-sm">公式LINEへお知らせください</p>
          )}
        </div>
        <p className="text-sm leading-relaxed">{FAMILY_ADD_LINE}</p>
      </section>
    );
  }

  if (body === null) {
    // 下書きの形がこわれていた時など。連絡する人の画面から入り直す
    body = (
      <button type="button" className={btnPrimary} onClick={() => go(1)}>
        はじめから入れる
      </button>
    );
  }

  return (
    <main className="space-y-5 text-navy-700">
      {preview && <p className="rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-bold text-white">試し用の表示です</p>}
      <header className="space-y-2">
        <p className="text-sm font-bold text-brand-700">BOOMダンススクール 発表会</p>
        <h1 className="text-2xl font-bold">出演のお申し込み</h1>
        {step !== 7 && (
          <p className="rounded-lg bg-sand-100 px-3 py-2 text-sm font-bold">{slashDateTime(st.entryCloseAt)} までに、『送る』を押してください。</p>
        )}
        {step >= 1 && <p className="text-right text-sm font-bold">いま {pos}／{stepCount}</p>}
      </header>
      {body}
      {msg && <p className="rounded-xl border border-red-300 bg-white p-3 text-sm font-bold text-red-700">{msg}</p>}
    </main>
  );
}
