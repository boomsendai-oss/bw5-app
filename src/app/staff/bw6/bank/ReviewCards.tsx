'use client';

// BW6 発表会の「見てほしい入金」のカード（Task 29。決まりの紙 2-19・2-24）。
// ② 人が決める入金（候補はラジオ。どれも初めは選ばない）③ 候補の無い入金（②と同じカード。探す欄で世帯を選んで当てられる・
// 「まとめて選ぶ」で、まとめて「発表会ではない」）④ 片づいた入金（たたむ）。
// どのボタンも2段階：押すと中身と名前の欄が開き、名前を選んで、もう1回押すと記録する（confirm() は使わない）。
// 種類・候補・印は listReviewRows（28）の返りをそのまま出す（ここで計算し直さない）。残高は出さない。
// 入力欄は文字色と下地色を両方決める（RECITAL_INPUT_CLS。CLAUDE.md 11）。
import { useMemo, useState, useTransition } from 'react';
import type { ReviewRowView } from '@/lib/recitalBankDb';
import type { ReviewKind } from '@/lib/recitalBankMatch';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { assignAction, mergeManualAction, restoreAction, searchHouseholdsForBankAction, setStateAction, splitAction } from './actions';

/** 種類の言葉（決まりの紙 6-6 の表のまま） */
const KIND_LABEL: Record<ReviewKind, string> = {
  unread: '読めない所がある',
  manual: '手で打った行',
  no_ref: '番号が無い',
  bad_ref: '番号が合わない',
  gone: '出演なし・まとめた世帯の番号',
  paid: 'もう払い済み',
  sum: '足すとぴったり',
  short: '金額が少ない',
  over: '金額が多い',
  name: 'お名前が合わない',
  first5: 'はじめの5件（「はい」待ち）',
};

/** 候補の「どこが合っているか」 */
const WHY_LABEL: Record<string, string> = {
  ref: '整理番号',
  told: '「振り込みました」の印',
  amount: '金額',
  surname: 'お名前',
  sum: '足すとぴったり',
  before_drop: '合計が変わる前の金額',
};

const CLOSED_LABEL: Record<string, string> = { not_recital: '発表会ではない', void: '読みまちがい' };

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const NOT_RECITAL_NOTE = '名義を消します。もどしても、名義は空のままです';

/** 'YYYY-MM-DD' → 'M月D日' */
function mdJa(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
}

/** UTC ISO → JST の 'M月D日 H時' */
function jstDayHour(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours()}時`;
}

/** 印の文（このまま） */
function flagText(row: ReviewRowView): string | null {
  if (row.checkFlag === 'twin') {
    const p = row.flagPair;
    return `台帳に、残高が同じ行があります（${p ? `${mdJa(p.rowDate)}・${yen(p.amount)}` : '—'}）。同じ入金なら、読みまちがいにする`;
  }
  if (row.checkFlag === 'last') return 'いちばん下の行です。金額を、明細で確かめてください';
  if (row.checkFlag === 'manual_twin') return '手で打った行と、同じ入金かもしれません';
  return null;
}

type Option = { householdId: number; refCode: string; contactName: string; remaining: number; status: string };

const BTN = 'rounded-md border border-sand-300 bg-white px-3 py-2 text-sm font-bold text-navy-700 disabled:opacity-40';
const BTN_GO = 'rounded-md bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40';

export default function ReviewCards({ rows, ev }: { rows: ReviewRowView[]; ev: string }) {
  const review = rows.filter((r) => r.group === 'review');
  const noCand = rows.filter((r) => r.group === 'no_candidate');
  const closed = rows.filter((r) => r.group === 'closed');
  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-navy-700">見てほしい入金 {review.length}件</h2>
        {review.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white p-4 text-sm text-sand-700">ありません</p>
        ) : (
          review.map((r) => <ReviewCard key={r.rowId} row={r} ev={ev} />)
        )}
      </section>
      <NoCandidateList rows={noCand} ev={ev} />
      <ClosedList rows={closed} />
    </>
  );
}

/** カードの上の、行の中身（日付・金額・名義・種類・印・メモ・多い時の日・お名前・知らせ） */
function RowFacts({ row }: { row: ReviewRowView }) {
  const flag = flagText(row);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-bold">{mdJa(row.rowDate)}</span>
        {row.isLeftover ? (
          <span className="font-bold">のこり {yen(row.leftover)}が、まだ当たっていません（入金 {yen(row.amount)}）</span>
        ) : (
          <span className="text-base font-bold">{yen(row.amount)}</span>
        )}
        <span className="min-w-0 break-words">名義 {row.nameRaw && row.nameRaw.trim() !== '' ? row.nameRaw : '（なし）'}</span>
        {row.state === 'hold' && <span className="rounded bg-sand-100 px-2 text-xs text-sand-800">保留</span>}
      </div>
      {row.reviewKind && <p><span className="rounded bg-navy-50 px-2 py-0.5 text-xs font-bold text-navy-700">{KIND_LABEL[row.reviewKind]}</span></p>}
      {flag && <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-900">{flag}</p>}
      {row.checkFlag === 'manual_twin' && row.flagPair && (
        <p className="rounded-md bg-sand-50 px-2 py-1 text-navy-700">
          相手の行：{mdJa(row.flagPair.rowDate)}・{yen(row.flagPair.amount)}（{row.flagPair.source === 'manual' ? '手で打った行' : '明細から入った行'}）
          ／この行：{mdJa(row.rowDate)}・{yen(row.amount)}
        </p>
      )}
      {row.memo && <p className="text-sand-800">保留のメモ：{row.memo}</p>}
      {row.overInfo && (
        <p className="text-navy-700">
          入金の日 {mdJa(row.overInfo.paidOn)}
          {row.overInfo.totalChangedAt && <>／合計が変わった日 {jstDayHour(row.overInfo.totalChangedAt)}</>}
          {row.overInfo.sameDay && <span className="ml-2 font-bold text-red-800">家庭に確かめる</span>}
        </p>
      )}
      {row.nameMismatch && <p className="font-bold text-red-800">お名前が合いません</p>}
      {row.notice && <p className="text-navy-700">{row.notice}</p>}
    </div>
  );
}

type Mode = null | 'assign' | 'split' | 'not_recital' | 'hold' | 'void' | 'restore' | 'merge';

/** ③のカードの「まとめて選ぶ」（まとめて「発表会ではない」にするため） */
type Bulk = { checked: boolean; disabled: boolean; onChange: (on: boolean) => void };

function ReviewCard({ row, ev, bulk }: { row: ReviewRowView; ev: string; bulk?: Bulk }) {
  const [selected, setSelected] = useState<number | null>(null); // 初めはどれも選ばない
  const [extra, setExtra] = useState<Option[]>([]);
  const [q, setQ] = useState('');
  const [searchMsg, setSearchMsg] = useState('');
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [flagOk, setFlagOk] = useState(false);
  const [needFlag, setNeedFlag] = useState(row.checkFlag !== null);
  const [sendRemaining, setSendRemaining] = useState<boolean | null>(null);
  const [memo, setMemo] = useState('');
  const [reason, setReason] = useState('');
  const [split, setSplit] = useState<{ a: number | null; b: number | null; amtA: string; amtB: string }>({ a: null, b: null, amtA: '', amtB: '' });
  const [pending, startTransition] = useTransition();

  const options: Option[] = useMemo(() => {
    const base: Option[] = row.candidates.map((c) => ({ householdId: c.householdId, refCode: c.refCode, contactName: c.contactName, remaining: c.remaining, status: 'active' }));
    const seen = new Set(base.map((o) => o.householdId));
    return [...base, ...extra.filter((o) => !seen.has(o.householdId))];
  }, [row.candidates, extra]);
  const optOf = (id: number | null) => (id === null ? undefined : options.find((o) => o.householdId === id));
  const chosen = optOf(selected);

  const open = (m: Mode) => { setMode(m); setError(''); };
  const close = () => { setMode(null); setError(''); };

  const search = () => {
    const t = q.trim();
    if (t === '') return;
    startTransition(async () => {
      const r = await searchHouseholdsForBankAction(ev, t);
      if (!r.ok) { setSearchMsg(r.error); return; }
      const hits = r.hits;
      setExtra((prev) => {
        const ids = new Set(prev.map((o) => o.householdId));
        return [...prev, ...hits.filter((h) => !ids.has(h.householdId))];
      });
      setSearchMsg(hits.length === 0 ? '見つかりませんでした' : `${hits.length}件 見つかりました（当てる世帯に足しました）`);
    });
  };

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string; code?: 'confirm_flag' }>) => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        if (r.code === 'confirm_flag') { setNeedFlag(true); setFlagOk(false); }
        return;
      }
      setError('');
      setMode(null);
    });
  };

  const isShort = row.reviewKind === 'short';
  const shortRest = chosen ? chosen.remaining - row.leftover : null;
  const flagBlocked = needFlag && !flagOk;
  const canAssign = chosen !== undefined && chosen.status === 'active' && !(isShort && sendRemaining === null) && !flagBlocked;

  const amtA = Number(split.amtA);
  const amtB = Number(split.amtB);
  const splitOk = split.a !== null && split.b !== null && split.a !== split.b
    && Number.isInteger(amtA) && Number.isInteger(amtB) && amtA > 0 && amtB > 0 && amtA + amtB === row.amount
    && optOf(split.a)?.status === 'active' && optOf(split.b)?.status === 'active' && !flagBlocked;

  const manualPair = row.checkFlag === 'manual_twin' && row.flagPair
    ? (row.flagPair.source === 'manual' ? { manualRowId: row.flagPair.rowId, newRowId: row.rowId } : { manualRowId: row.rowId, newRowId: row.flagPair.rowId })
    : null;

  const flagConfirm = needFlag && (
    <label className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-2 text-sm text-red-900">
      <input type="checkbox" checked={flagOk} onChange={(e) => setFlagOk(e.target.checked)} className="mt-1 size-4 accent-brand-600" />
      <span>{flagText(row) ?? '印のある行があります（足すとぴったりの行）。明細で確かめました'}　→ 確かめました</span>
    </label>
  );

  const pickSplit = (key: 'a' | 'b', v: string) => {
    const id = v === '' ? null : Number(v);
    const rem = optOf(id)?.remaining;
    setSplit((s) => ({ ...s, [key]: id, ...(key === 'a' ? { amtA: rem != null && rem > 0 ? String(rem) : '' } : { amtB: rem != null && rem > 0 ? String(rem) : '' }) }));
  };

  return (
    <article className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      {bulk && (
        <label className="mb-2 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={bulk.checked}
            disabled={bulk.disabled}
            onChange={(e) => bulk.onChange(e.target.checked)}
            className="mt-1 size-4 accent-brand-600"
          />
          <span className="text-sand-800">
            まとめて選ぶ（発表会ではない）
            {bulk.disabled && <span className="block text-xs">一部を当てた行なので、発表会ではないにはできません。下で世帯を選んで、のこりを当ててください</span>}
          </span>
        </label>
      )}
      <RowFacts row={row} />

      {/* 候補（ラジオ。初めは選ばない） */}
      <fieldset className="mt-3">
        <legend className="text-xs font-bold text-sand-800">当てる世帯（候補）</legend>
        {options.length === 0 && <p className="mt-1 text-sm text-sand-800">候補がありません。下の欄で家庭を探して選んでください</p>}
        <ul className="mt-1 space-y-1">
          {options.map((o) => {
            const c = row.candidates.find((x) => x.householdId === o.householdId);
            const merged = o.status !== 'active';
            return (
              <li key={o.householdId}>
                <label className={`flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 text-sm ${selected === o.householdId ? 'bg-brand-50' : ''}`}>
                  <input
                    type="radio"
                    name={`cand-${row.rowId}`}
                    checked={selected === o.householdId}
                    disabled={merged}
                    onChange={() => setSelected(o.householdId)}
                    className="size-4 accent-brand-600"
                  />
                  <span className="font-mono font-bold text-brand-700">{o.refCode}</span>
                  <span className="min-w-0 break-words">{o.contactName}</span>
                  <span>今の残り {yen(o.remaining)}</span>
                  {c && c.why.length > 0 && <span className="text-xs text-sand-800">合っている所：{c.why.map((w) => WHY_LABEL[w] ?? w).join('・')}</span>}
                  {!c && <span className="text-xs text-sand-800">（探して足した世帯）</span>}
                  {merged && <span className="rounded bg-sand-100 px-2 text-xs text-sand-800">まとめた（当てられません）</span>}
                </label>
              </li>
            );
          })}
        </ul>
        {/* 候補に無い家庭を探す */}
        <div className="mt-2 flex gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
            placeholder="候補に無い家庭を、名前・カナ・整理番号で探す"
            className={RECITAL_INPUT_CLS}
          />
          <button type="button" onClick={search} disabled={pending || q.trim() === ''} className={`${BTN} shrink-0`}>探す</button>
        </div>
        {searchMsg && <p className="mt-1 text-xs text-sand-800">{searchMsg}</p>}
      </fieldset>

      {/* ボタン（1段目） */}
      {mode === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => open('assign')} className={BTN_GO}>この世帯に当てる</button>
          {!row.isLeftover && (
            <>
              <button type="button" onClick={() => open('split')} className={BTN}>2つの世帯に分ける</button>
              <button type="button" onClick={() => open('not_recital')} className={BTN}>発表会ではない</button>
              <button type="button" onClick={() => { setMemo(row.memo ?? ''); open('hold'); }} className={BTN}>保留</button>
              <button type="button" onClick={() => open('void')} className={BTN}>読みまちがいにする</button>
              {row.state === 'hold' && <button type="button" onClick={() => open('restore')} className={BTN}>もとにもどす</button>}
              {manualPair && <button type="button" onClick={() => open('merge')} className={BTN}>同じ入金にする</button>}
            </>
          )}
        </div>
      )}

      {/* 2段目：中身・名前・記録する */}
      {mode !== null && (
        <div className="mt-3 space-y-2 rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm">
          {mode === 'assign' && (
            <>
              {chosen ? (
                <p>
                  <span className="font-mono font-bold">{chosen.refCode}</span> {chosen.contactName} に {yen(row.leftover)} を当てます
                </p>
              ) : (
                <p className="font-bold text-red-800">上の候補から、世帯を1つ選んでください</p>
              )}
              {isShort && (
                <fieldset className="space-y-1">
                  <legend className="text-xs font-bold text-sand-800">残りの知らせ</legend>
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`rem-${row.rowId}`} checked={sendRemaining === true} onChange={() => setSendRemaining(true)} className="size-4 accent-brand-600" />
                    {shortRest !== null && shortRest > 0 ? `あと ${yen(shortRest)}の知らせを送る` : 'あと いくらの知らせを送る'}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`rem-${row.rowId}`} checked={sendRemaining === false} onChange={() => setSendRemaining(false)} className="size-4 accent-brand-600" />
                    送らない
                  </label>
                </fieldset>
              )}
              {flagConfirm}
            </>
          )}

          {mode === 'split' && (
            <>
              {(['a', 'b'] as const).map((k) => (
                <div key={k} className="flex flex-wrap items-center gap-2">
                  <select
                    value={split[k] ?? ''}
                    onChange={(e) => pickSplit(k, e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-sand-300 bg-white px-2 py-2 text-base text-navy-900"
                    aria-label={k === 'a' ? '1つめの世帯' : '2つめの世帯'}
                  >
                    <option value="">世帯を選ぶ</option>
                    {options.filter((o) => o.status === 'active').map((o) => (
                      <option key={o.householdId} value={o.householdId}>{`${o.refCode} ${o.contactName}（残り ${yen(o.remaining)}）`}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={k === 'a' ? split.amtA : split.amtB}
                    onChange={(e) => {
                      const v = e.target.value.normalize('NFKC').replace(/[^\d]/g, '');
                      setSplit((s) => (k === 'a' ? { ...s, amtA: v } : { ...s, amtB: v }));
                    }}
                    className="w-32 rounded-lg border border-sand-300 bg-white px-2 py-2 text-base text-navy-900"
                    aria-label={k === 'a' ? '1つめの金額' : '2つめの金額'}
                  />
                  <span>円</span>
                </div>
              ))}
              <p className={amtA + amtB === row.amount ? 'text-navy-700' : 'font-bold text-red-800'}>
                合計 {yen((Number.isInteger(amtA) ? amtA : 0) + (Number.isInteger(amtB) ? amtB : 0))}／入金 {yen(row.amount)}
                {amtA + amtB !== row.amount && '（同じにしてください）'}
              </p>
              {flagConfirm}
            </>
          )}

          {mode === 'not_recital' && <p className="font-bold text-red-800">{NOT_RECITAL_NOTE}</p>}

          {mode === 'hold' && (
            <>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={2}
                maxLength={200}
                placeholder="保留のメモ"
                className={RECITAL_INPUT_CLS}
              />
              <p className="text-xs text-sand-800">家庭の名前・口座は、書かない</p>
            </>
          )}

          {mode === 'void' && <p>この行を、読みまちがいにします（台帳の行として数えなくなります）。</p>}

          {mode === 'restore' && (
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="もどす理由"
              className={RECITAL_INPUT_CLS}
            />
          )}

          {mode === 'merge' && manualPair && row.flagPair && (
            <p>手で打った行と、明細から入った行（{mdJa(row.flagPair.rowDate)}・{yen(row.flagPair.amount)}）を、同じ入金にします。メールは出しません。</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <StaffNamePicker value={name} onChange={setName} />
            <button
              type="button"
              disabled={
                pending
                || (mode === 'assign' && !canAssign)
                || (mode === 'split' && !splitOk)
                || (mode === 'restore' && reason.trim() === '')
              }
              onClick={() => {
                if (mode === 'assign' && chosen) {
                  run(() => assignAction({ rowId: row.rowId, householdId: chosen.householdId, amount: row.leftover, sendRemaining: isShort && sendRemaining === true, confirmFlag: needFlag && flagOk, staffName: name }));
                } else if (mode === 'split' && split.a !== null && split.b !== null) {
                  run(() => splitAction({ rowId: row.rowId, parts: [{ householdId: split.a!, amount: amtA }, { householdId: split.b!, amount: amtB }], confirmFlag: needFlag && flagOk, staffName: name }));
                } else if (mode === 'not_recital' || mode === 'void') {
                  run(() => setStateAction({ rowIds: [row.rowId], state: mode, memo: null, staffName: name }));
                } else if (mode === 'hold') {
                  run(() => setStateAction({ rowIds: [row.rowId], state: 'hold', memo, staffName: name }));
                } else if (mode === 'restore') {
                  run(() => restoreAction({ rowId: row.rowId, reason, staffName: name }));
                } else if (mode === 'merge' && manualPair) {
                  run(() => mergeManualAction({ ...manualPair, staffName: name }));
                }
              }}
              className={BTN_GO}
            >
              {pending ? '記録しています…' : '記録する'}
            </button>
            <button type="button" onClick={close} className="px-2 py-2 text-sm text-sand-700">やめる</button>
          </div>
          {error && <p className="font-bold text-red-800">{error}</p>}
        </div>
      )}
    </article>
  );
}

/**
 * ③ 候補の無い入金：②と同じカード（探す欄で世帯を選んで「この世帯に当てる」・保留の行は「もとにもどす」）。
 * 「まとめて選ぶ」で選んだ行を、まとめて「発表会ではない」にする。一部を当てた行（のこりの行）は入金があるので、まとめては選べない（当てるのはカードで）。
 */
function NoCandidateList({ rows, ev }: { rows: ReviewRowView[]; ev: string }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  if (rows.length === 0) return null;

  // 画面を開き直して消えた行は数えない
  const ids = rows.filter((r) => picked.has(r.rowId) && !r.isLeftover).map((r) => r.rowId);
  const toggle = (id: number, on: boolean) => setPicked((s) => {
    const n = new Set(s);
    if (on) n.add(id); else n.delete(id);
    return n;
  });
  const go = () => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await setStateAction({ rowIds: ids, state: 'not_recital', memo: null, staffName: name });
      if (!r.ok) { setError(r.error); return; }
      setError(''); setConfirming(false); setPicked(new Set());
    });
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-navy-700">候補の無い入金 {rows.length}件</h2>
      {rows.map((r) => (
        <ReviewCard
          key={r.rowId}
          row={r}
          ev={ev}
          bulk={{ checked: picked.has(r.rowId), disabled: r.isLeftover, onChange: (on) => toggle(r.rowId, on) }}
        />
      ))}
      <div className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
        {!confirming ? (
          <button type="button" disabled={ids.length === 0} onClick={() => { setConfirming(true); setError(''); }} className={BTN}>
            選んだ {ids.length}件を「発表会ではない」にする
          </button>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-bold text-red-800">{NOT_RECITAL_NOTE}（{ids.length}件）</p>
            <div className="flex flex-wrap items-center gap-2">
              <StaffNamePicker value={name} onChange={setName} />
              <button type="button" disabled={pending || ids.length === 0} onClick={go} className={BTN_GO}>
                {pending ? '記録しています…' : '発表会ではないにする'}
              </button>
              <button type="button" onClick={() => { setConfirming(false); setError(''); }} className="px-2 py-2 text-sm text-sand-700">やめる</button>
            </div>
            {error && <p className="font-bold text-red-800">{error}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

/** ④ 片づいた入金（たたむ。日付と金額だけ・「もとにもどす」） */
function ClosedList({ rows }: { rows: ReviewRowView[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <summary className="cursor-pointer text-lg font-bold">片づいた入金 {rows.length}件</summary>
      <ul className="mt-2 divide-y divide-sand-100">
        {rows.map((r) => <ClosedRow key={r.rowId} row={r} />)}
      </ul>
    </details>
  );
}

function ClosedRow({ row }: { row: ReviewRowView }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const go = () => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await restoreAction({ rowId: row.rowId, reason, staffName: name });
      if (!r.ok) { setError(r.error); return; }
      setError(''); setOpen(false); setReason('');
    });
  };
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{mdJa(row.rowDate)}</span>
        <span className="font-bold">{yen(row.amount)}</span>
        <span className="text-xs text-sand-800">{CLOSED_LABEL[row.state] ?? row.state}</span>
        {!open && <button type="button" onClick={() => { setOpen(true); setError(''); }} className={BTN}>もとにもどす</button>}
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-sand-200 bg-sand-50 p-3">
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="もどす理由" className={RECITAL_INPUT_CLS} />
          {row.state === 'not_recital' && <p className="text-xs text-sand-800">もどしても、名義は空のままです</p>}
          <div className="flex flex-wrap items-center gap-2">
            <StaffNamePicker value={name} onChange={setName} />
            <button type="button" disabled={pending || reason.trim() === ''} onClick={go} className={BTN_GO}>
              {pending ? '記録しています…' : 'もとにもどす'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setError(''); }} className="px-2 py-2 text-sm text-sand-700">やめる</button>
          </div>
          {error && <p className="font-bold text-red-800">{error}</p>}
        </div>
      )}
    </li>
  );
}
