'use client';

// BW6 発表会のマイページの「作品を足す・やめる」（Task 15。04 4-2「マイページでの変え方」・05 5-5・K222）。12/8 に出すか決める（出さない時は git revert で抜く）。
// 順は「えらぶ → 金額を見る → 決定」。ボタンは「作品を足す」「出るに変える」「この作品をやめる」の3つ（足すのは「出る」だけ）。
// 選んだ変更はためておき、「金額を見る」でサーバ（8 の applyHouseholdEdits の dryRun）に当てて、editConfirmText の文とボタンを出す。
// 通すかどうかの確かめは全部サーバ（ここで出すボタンは見せ方だけ）。受け取るのは鍵・人の id と名前・行・足せる作品・金額だけ（R-66）。
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import type { FamilyEdit } from '@/lib/recitalFamilyDb';
import { editConfirmText, type EditItem, type EditRow } from '@/lib/recitalWorkEdit';
import { previewWorkEditsAction, saveWorkEditsAction } from './actions';

export type WorkEditorPerson = {
  personId: number;
  name: string;
  rows: EditRow[];
  /** 足せる作品。draft は準備中の作品（見せるだけで選べない） */
  addable: { id: number; title: string; draft?: boolean }[];
};

const CAST_LABEL: Record<string, string> = { in: '出る', maybe: '迷っている', out: 'やめた作品', passed: '見送り' };
const DRAFT_LABEL = '準備中（決まったら、マイページから足せます）';
const LINE_ONLY_TEXT = '出演を全部やめるときは、公式LINEでお知らせください。';

const smallBtnCls = 'shrink-0 rounded-lg border-2 border-navy-700 bg-white px-3 py-1 text-sm font-bold text-navy-700 disabled:opacity-40';
const bigBtnCls = 'block w-full rounded-xl bg-navy-700 px-4 py-3 text-center text-lg font-bold text-white disabled:opacity-40';
const subBtnCls = 'block w-full rounded-xl border-2 border-navy-700 bg-white px-4 py-3 text-center text-base font-bold text-navy-700 disabled:opacity-40';
const msgCls = 'rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-base font-bold leading-relaxed text-navy-700';

type Pending = FamilyEdit & { key: string };
type Confirm = { lines: string[]; confirmLabel: string };

const keyOf = (personId: number, workId: number) => `${personId}:${workId}`;

/** ためた変更を、押す前の文の品目にする。払う前に、その人の出る・迷っているが全部なくなる時は「出演を取りやめます」を1行だけ */
function itemsOf(people: WorkEditorPerson[], pending: Pending[], paid: number): EditItem[] {
  const items: EditItem[] = [];
  for (const p of people) {
    const mine = pending.filter((e) => e.personId === p.personId);
    if (mine.length === 0) continue;
    const rowOf = (workId: number) => p.rows.find((r) => r.workId === workId) ?? null;
    const after = new Map(p.rows.filter((r) => !r.dropped).map((r) => [r.workId, r.status as string]));
    for (const e of mine) after.set(e.workId, e.status);
    const liveAfter = [...after.values()].filter((s) => s === 'in' || s === 'maybe').length;
    const withdraw = paid === 0 && liveAfter === 0;
    let withdrawn = false;
    for (const e of mine) {
      const row = rowOf(e.workId);
      const title = row?.title ?? p.addable.find((a) => a.id === e.workId)?.title ?? '';
      if (e.status === 'in') {
        items.push({ kind: row?.status === 'maybe' ? 'to_in' : 'add', title, personName: p.name, wasIn: false });
      } else if (withdraw) {
        if (!withdrawn) items.push({ kind: 'last_out', title, personName: p.name, wasIn: row?.status === 'in' });
        withdrawn = true;
      } else {
        items.push({ kind: 'out', title, personName: p.name, wasIn: row?.status === 'in' });
      }
    }
  }
  return items;
}

export function WorkEditor(props: { token: string; people: WorkEditorPerson[]; paid: number; total: number; remaining: number }) {
  const { token, people, paid } = props;
  const router = useRouter();
  const [pending, setPending] = useState<Pending[]>([]);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, startTransition] = useTransition();
  const saving = useRef(false);

  const change = (next: Pending[]) => {
    setPending(next);
    setConfirm(null);
    setError(null);
    setDone(false);
  };
  const setEdit = (personId: number, workId: number, status: 'in' | 'out') => {
    const key = keyOf(personId, workId);
    change([...pending.filter((e) => e.key !== key), { key, personId, workId, status }]);
  };
  const undo = (key: string) => change(pending.filter((e) => e.key !== key));
  const pendingOf = (personId: number, workId: number) => pending.find((e) => e.key === keyOf(personId, workId)) ?? null;
  const edits = (): FamilyEdit[] => pending.map(({ personId, workId, status }) => ({ personId, workId, status }));

  const preview = () => {
    setError(null);
    setConfirm(null);
    startTransition(async () => {
      try {
        const r = await previewWorkEditsAction(token, edits());
        if (!r.ok) { setError(r.message); return; }
        setConfirm(editConfirmText({
          paid, items: itemsOf(people, pending, paid),
          totalBefore: r.totalBefore, totalAfter: r.totalAfter, remainingBefore: r.remainingBefore, remainingAfter: r.remainingAfter,
        }));
      } catch {
        setError('もう一度押してください');
      }
    });
  };

  const save = () => {
    if (saving.current) return;
    saving.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const r = await saveWorkEditsAction(token, edits());
        if (!r.ok) { setError(r.message); setConfirm(null); return; }
        setPending([]);
        setConfirm(null);
        setChoice({});
        setDone(true);
        router.refresh();
      } catch {
        setError('もう一度押してください');
      } finally {
        saving.current = false;
      }
    });
  };

  return (
    <div className="space-y-4">
      {people.map((p) => {
        const addable = p.addable.filter((a) => !a.draft && !pendingOf(p.personId, a.id));
        const drafts = p.addable.filter((a) => a.draft);
        const picked = choice[p.personId] ?? '';
        const added = pending.filter((e) => e.personId === p.personId && e.status === 'in' && !p.rows.some((r) => r.workId === e.workId && r.status === 'maybe'));
        return (
          <div key={p.personId} className="space-y-2">
            <p className="font-bold">{p.name}さん</p>
            <ul className="space-y-2 text-sm">
              {p.rows.map((r) => {
                const pe = pendingOf(p.personId, r.workId);
                const reAdding = pe?.status === 'in' && !r.canToIn;
                if (reAdding) return null; // やめた作品をもう1回足す時は、下の「足す」の欄に出す
                const faded = !r.dropped && (r.status === 'out' || r.status === 'passed');
                return (
                  <li key={r.workId} className={`space-y-1 ${faded ? 'opacity-50' : ''}`}>
                    <div className="flex justify-between gap-3">
                      <span>{r.title}</span>
                      <span className="shrink-0 font-bold">
                        {r.dropped ? 'スクールの都合で、なくなりました' : pe ? (pe.status === 'in' ? '→ 出る' : '→ やめる') : CAST_LABEL[r.status] ?? ''}
                      </span>
                    </div>
                    {pe ? (
                      <div className="flex justify-end">
                        <button type="button" className={smallBtnCls} disabled={busy} onClick={() => undo(pe.key)}>
                          取り消す
                        </button>
                      </div>
                    ) : (
                      (r.canToIn || r.canOut) && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {r.canToIn && (
                            <button type="button" className={smallBtnCls} disabled={busy} onClick={() => setEdit(p.personId, r.workId, 'in')}>
                              出るに変える
                            </button>
                          )}
                          {r.canOut && (
                            <button type="button" className={smallBtnCls} disabled={busy} onClick={() => setEdit(p.personId, r.workId, 'out')}>
                              この作品をやめる
                            </button>
                          )}
                        </div>
                      )
                    )}
                    {r.lineOnly && <p className="text-xs leading-relaxed">{LINE_ONLY_TEXT}</p>}
                  </li>
                );
              })}
              {added.map((e) => (
                <li key={e.key} className="flex items-center justify-between gap-3">
                  <span>{p.addable.find((a) => a.id === e.workId)?.title ?? p.rows.find((r) => r.workId === e.workId)?.title ?? ''}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-bold">→ 足す</span>
                    <button type="button" className={smallBtnCls} disabled={busy} onClick={() => undo(e.key)}>
                      取り消す
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {(addable.length > 0 || drafts.length > 0) && (
              <div className="flex gap-2">
                <select
                  className={RECITAL_INPUT_CLS}
                  value={picked}
                  aria-label={`${p.name}さんに足す作品`}
                  disabled={busy}
                  onChange={(e) => setChoice({ ...choice, [p.personId]: e.target.value })}
                >
                  <option value="">足す作品をえらぶ</option>
                  {addable.map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.title}
                    </option>
                  ))}
                  {drafts.map((a) => (
                    <option key={a.id} value="" disabled>
                      {a.title}：{DRAFT_LABEL}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={smallBtnCls}
                  disabled={busy || picked === ''}
                  onClick={() => {
                    setEdit(p.personId, Number(picked), 'in');
                    setChoice({ ...choice, [p.personId]: '' });
                  }}
                >
                  作品を足す
                </button>
              </div>
            )}
          </div>
        );
      })}

      {done && <p className={msgCls}>変更しました。</p>}
      {error && <p className={msgCls}>{error}</p>}

      {pending.length > 0 && !confirm && (
        <button type="button" className={subBtnCls} disabled={busy} onClick={preview}>
          金額を見る
        </button>
      )}
      {confirm && (
        <div className="space-y-3 rounded-xl border border-sand-300 bg-sand-100 p-4">
          {confirm.lines.map((l, i) => (
            <p key={i} className="text-base font-bold leading-relaxed text-navy-700">
              {l}
            </p>
          ))}
          <button type="button" className={bigBtnCls} disabled={busy} onClick={save}>
            {confirm.confirmLabel}
          </button>
        </div>
      )}
    </div>
  );
}
