// ⚠️ 公開ページ(認証なし)。理由: 家庭が控えのメールのリンク（鍵つきURL /bw6/my?t=…）から開くマイページ。
// 鍵（edit_token・16進48けた）の完全一致の1世帯だけを出す。形の合わない鍵は DB を引かない（recitalGuard.ts）。
// 出すのはその世帯の申込の中身・金額・支払いの状態だけ。ほかの世帯の情報・作品ごとの名簿は出さない。
// 電話・メール・生年月日・スタッフのメモ・メールの記録・変えた記録は、画面にもクライアントの部品にも渡さない（R-66）。
// 文の正本は設計書 04 4-2「マイページ」。「払う」（PaySection・Task 21）は payState が show の時だけ MoneyBox の children に入れる。
// 「お振込みのご案内」（Task 23）の金額・期限・振込先・名義の1行・年末年始の1行・振込の進みは、ここで今の値から作って渡す。
// 開いている支払い（カードの決済の画面）がある世帯は、描く前に Stripe に聞いて合わせる。聞けなければ「ご入金を確認しています」で「払う」を出さない（R-98）。
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getOne } from '@/lib/db';
import { todayJst } from '@/lib/dateJst';
import { canFamilyEdit, deadlineMs, type CastStatus, entryPhase, householdViewLabel, payButtonState, payGate, payableAmount } from '@/lib/recital';
import { getRecitalSettings, listWorks, type HouseholdDetail, type PersonRow, type WorkRow } from '@/lib/recitalDb';
import { markMyPageOpened } from '@/lib/recitalFamilyDb';
import { requireHouseholdByToken } from '@/lib/recitalGuard';
import { CARD_CHECKING_TEXT, CARD_PAID_RETURN_TEXT, syncCardCheckout } from '@/lib/recitalPayDb';
import { bankProgressLines, bankRestLine, closedNotice, lastLiveBankPayment, longJpDate, myTopLines, nextTodos, payAreaText } from '@/lib/recitalMyPage';
import { FAMILY_ADD_LINE, fiveLines } from '@/lib/recitalPublic';
import { workEditOptions, type EditWorkLite } from '@/lib/recitalWorkEdit';
import { FiveLines } from '@/components/recital/FiveLines';
import { MoneyBox } from '@/components/recital/MoneyBox';
import { InstaEditor } from './InstaEditor';
import type { BankGuideData } from './BankGuide';
import { PaySection } from './PaySection';
import { WorkEditor, type WorkEditorPerson } from './WorkEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'BW6 マイページ',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const boxCls = 'rounded-xl border border-sand-200 bg-white p-4 text-navy-700';
const noticeCls = 'rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-sm font-bold leading-relaxed text-navy-700';
const linkBtnCls = 'block w-full rounded-xl border-2 border-navy-700 bg-white px-4 py-3 text-center font-bold text-navy-700';

/** 同じ名前の引数が2つ来ると配列になるので、文字1つだけを受ける */
function one(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function personName(p: PersonRow): string {
  return `${p.last_name} ${p.first_name ?? ''}`.trim();
}

function Notice({ title, lines }: { title?: string; lines: ReactNode[] }) {
  return (
    <main className="space-y-4 text-navy-700">
      {title && <h1 className="text-xl font-bold">{title}</h1>}
      {lines.map((l, i) => (
        <p key={i} className="text-base leading-relaxed">
          {l}
        </p>
      ))}
      <Link href="/bw6/resend" className={linkBtnCls}>
        マイページのURLを受け取る
      </Link>
    </main>
  );
}

/** 設定・作品・今の時刻から、ページに出す状態と文を決める（時刻を読むのはここだけ）。
 *  checking＝カードの入金を確かめられなかった（「払う」は出さない） */
async function loadMyPageState(d: HouseholdDetail, x: { checking: boolean }) {
  const h = d.household;
  const [settings, works] = await Promise.all([getRecitalSettings(h.event_key), listWorks(h.event_key)]);
  const nowMs = Date.now();
  const workById = new Map(works.map((w) => [Number(w.id), w]));
  const people = d.people.filter((p) => p.status === 'active');
  const activeIds = new Set(people.map((p) => Number(p.id)));
  const liveCasts = d.casts.filter((c) => activeIds.has(Number(c.person_id)) && workById.get(Number(c.work_id))?.status !== 'dropped');
  const hasIn = liveCasts.some((c) => c.status === 'in');
  const hasMaybe = liveCasts.some((c) => c.status === 'maybe');

  const phase = entryPhase(settings, nowMs, h.extend_until);
  const gate = payGate(settings, nowMs);
  const payState = payButtonState({ gate, view: d.view, m: d.money, refundTodo: d.refundTodo });
  // 「払う」のボタンが今この画面に出るか。出ない時は、つぎにやること・期限切れの文でも「払う」を指さない（K221）
  const payShown = payState === 'show' && !x.checking;
  const payDue = h.pay_due_override ?? settings.pay_due;
  // 延長の世帯は延長の日まで false（判定は canFamilyEdit だけ）
  const afterChangeClose = nowMs > deadlineMs(settings.change_close_at) && !canFamilyEdit(settings, nowMs, h.extend_until);
  // 作品を足す・やめる（Task 15）を出すか。8 の applyHouseholdEdits が家庭の変更を通す条件と同じ（止めている間・締切のあとは出さない。延長の世帯は延長の日まで）
  const canEditWorks = canFamilyEdit(settings, nowMs, h.extend_until);

  const lines = myTopLines({
    view: d.view, m: d.money, hasIn, hasMaybe, payDue, todayYmd: todayJst(), changeClose: settings.change_close_at, afterChangeClose,
    payMethod: h.pay_method, payShown,
  });
  const todos = nextTodos({ payState: payShown ? 'show' : 'hidden', remaining: d.money.remaining, payDue, hasMaybe, canEditWorks, changeClose: settings.change_close_at });
  const closed = closedNotice({ afterChangeClose, remaining: d.money.remaining, payDue, changeClose: settings.change_close_at });

  return { settings, works, workById, people, hasMaybe, phase, payState, payDue, lines, todos, closed, canEditWorks };
}

/** 「お振込みのご案内」の中身と振込の進み（Task 23・D5 2-20・2-24）。bank_text が空なら案内は null（銀行振込は選べない） */
function bankViewOf(d: HouseholdDetail, bankText: string, payDue: string, restFrom: string, restTo: string) {
  const h = d.household;
  const told = h.bank_told_at == null ? null : { amount: Number(h.bank_told_amount ?? 0) };
  const today = todayJst();
  const kana = [h.contact_last_kana, h.contact_first_kana].filter((x) => x && x.trim() !== '').join(' ');
  const guide: BankGuideData | null = bankText.trim() === ''
    ? null
    : {
        amount: payableAmount(d.money, told),
        payDueLong: longJpDate(payDue),
        bankText,
        refCode: h.ref_code,
        nameLine: `${h.ref_code} ${kana}`.trim(),
        restLine: bankRestLine(restFrom, restTo, today),
      };
  // いちばん新しい、取り消していない振込の入金（明細の日付と額）。印が閉じたあとの「◯月◯日に ◯円を確認しました」に使う（Task 28：取り消した振込は出さない）
  const progress = bankProgressLines({
    toldAt: h.bank_told_at,
    toldAmount: told ? told.amount : null,
    remaining: d.money.remaining,
    lastBank: lastLiveBankPayment(d.payments),
  });
  return { guide, progress, today };
}

/** 作品を足す・やめる（Task 15）に渡す人ごとの行と足せる作品。準備中（form かつ draft）の作品は、まだ足せる人にだけ見せる（選べない） */
function workEditorPeople(d: HouseholdDetail, people: PersonRow[], works: WorkRow[], maxWorks: number): WorkEditorPerson[] {
  // works は listWorks の並び（sort_order, id）。行も足せる作品もこの並びで出す
  const editWorks: EditWorkLite[] = works.map((w) => ({
    id: Number(w.id), title: w.title, status: w.status, selectable: w.entry_mode === 'form' && w.status === 'open',
  }));
  const order = new Map(editWorks.map((w, i) => [w.id, i]));
  const titleOf = new Map(editWorks.map((w) => [w.id, w.title]));
  return people.map((p) => {
    const casts = d.casts
      .filter((c) => Number(c.person_id) === Number(p.id) && order.has(Number(c.work_id)))
      .sort((a, b) => order.get(Number(a.work_id))! - order.get(Number(b.work_id))!)
      .map((c) => ({ workId: Number(c.work_id), status: c.status as CastStatus }));
    const o = workEditOptions({ paid: d.money.paid, casts, works: editWorks, maxWorks });
    const live = new Set(o.rows.filter((r) => !r.dropped && (r.status === 'in' || r.status === 'maybe')).map((r) => r.workId));
    const drafts = live.size < maxWorks
      ? works.filter((w) => w.entry_mode === 'form' && w.status === 'draft' && !live.has(Number(w.id))).map((w) => ({ id: Number(w.id), title: w.title, draft: true }))
      : [];
    return {
      personId: Number(p.id),
      name: personName(p),
      rows: o.rows,
      addable: [...o.addable.map((id) => ({ id, title: titleOf.get(id) ?? '' })), ...drafts],
    };
  });
}

const CAST_LABEL: Record<string, string> = { in: '出る', maybe: '迷っている', out: 'やめた作品', passed: '見送り' };

export default async function Bw6MyPage({ searchParams }: { searchParams: Promise<{ t?: string; from?: string; paid?: string }> }) {
  const sp = await searchParams;
  const first = await requireHouseholdByToken(one(sp.t));
  if (!first) {
    return (
      <Notice
        title="お申し込みが見つかりません"
        lines={['URLが正しいかご確認ください。マイページのURLは、こちらからもう一度メールで受け取れます。']}
      />
    );
  }
  if (first.household.status === 'merged') {
    // まとめ先の整理番号だけを読む（まとめ先の鍵・URL・中身は出さない）
    const into = first.household.merged_into;
    const to = into == null ? null : await getOne('SELECT ref_code FROM recital_households WHERE id = ?', [into]);
    return (
      <Notice
        lines={[
          `ご家族のお申し込みは、整理番号 ${to ? String(to.ref_code) : ''} のマイページに1つにまとめました。新しいマイページのURLは、メールでお送りしています。`,
          '届いていないときは、こちらからもう一度受け取れます。',
        ]}
      />
    );
  }

  const householdId = first.household.id;
  try {
    await markMyPageOpened(householdId, one(sp.from) === 'mail');
  } catch (e) {
    // 開いた印が書けなくてもページは出す（ログに個人の情報は出さない）
    console.error(`[recital] マイページを開いた印を書けませんでした household=${householdId}`, e instanceof Error ? e.message : String(e));
  }

  // 開いている支払いがあれば、描く前に Stripe に聞いて合わせ（払い終わっていれば入金を記録）、世帯を読み直す
  let checking = false;
  let reread: HouseholdDetail | null = null;
  const openCheckout = await getOne("SELECT id FROM recital_checkouts WHERE household_id = ? AND status = 'open' LIMIT 1", [householdId]);
  if (openCheckout) {
    try {
      await syncCardCheckout(householdId);
    } catch (e) {
      checking = true;
      console.error(`[recital] マイページでカードの入金を確かめられませんでした household=${householdId}`, e instanceof Error ? e.message : String(e));
    }
    reread = await requireHouseholdByToken(first.household.edit_token);
  }
  const d = reread ?? first;
  const h = d.household;
  const { settings, works, workById, people, hasMaybe, phase, payState, payDue, lines, todos, closed, canEditWorks } = await loadMyPageState(d, { checking });
  const bankView = bankViewOf(d, settings.bank_text, payDue, settings.bank_rest_from, settings.bank_rest_to);
  const showPaySection = payState === 'show' && !checking;
  const showChecking = checking && payState !== 'hidden';
  // 決済の画面から戻った（?paid=1）時の受付の文は、今の状態と合う時だけ（残りが無い・確認中）。
  // URL に paid=1 が残っていても、残りがあれば「払う」をふつうに出す
  const showPaidReturn = one(sp.paid) === '1' && (checking || d.money.remaining === 0);

  // 人ごとの内わけ（生きている請求の行）。人の付かない行は「ご家族」にまとめる
  const nameById = new Map(d.people.map((p) => [Number(p.id), personName(p)]));
  const groups = new Map<number | null, { label: string; amount: number }[]>();
  for (const c of d.charges) {
    if (c.status !== 'active') continue;
    const key = c.person_id == null ? null : Number(c.person_id);
    const list = groups.get(key) ?? [];
    list.push({ label: c.label, amount: Number(c.amount) });
    groups.set(key, list);
  }
  const breakdown = [
    ...d.people.filter((p) => groups.has(Number(p.id))).map((p) => ({ who: `${personName(p)}さん`, items: groups.get(Number(p.id))! })),
    ...[...groups.entries()]
      .filter(([k]) => k === null || !nameById.has(k))
      .map(([, items]) => ({ who: 'ご家族', items })),
  ];
  const lastPayment = [...d.payments].reverse().find((p) => Number(p.amount) > 0) ?? null;

  const lineUrl = settings.line_url;
  const lineButton = lineUrl ? (
    <a href={lineUrl} target="_blank" rel="noreferrer noopener" className={linkBtnCls}>
      公式LINE
    </a>
  ) : null;

  return (
    <main className="space-y-6 text-navy-700">
      <MoneyBox
        refCode={h.ref_code}
        viewLabel={householdViewLabel(d.view, d.money.remaining)}
        lines={lines}
        money={d.money}
        breakdown={breakdown}
        lastPaid={lastPayment ? { method: lastPayment.method, paidOn: lastPayment.paid_on } : null}
        manyPeople={people.length > 1}
        hasMaybe={hasMaybe}
        payText={showChecking ? CARD_CHECKING_TEXT : payAreaText(payState, settings.pay_open_at)}
      >
        {showPaidReturn && (
          <p className="rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-base font-bold leading-relaxed text-navy-700">{CARD_PAID_RETURN_TEXT}</p>
        )}
        {showPaySection && (
          <PaySection
            token={h.edit_token}
            remaining={d.money.remaining}
            toldAmount={h.bank_told_at == null ? null : Number(h.bank_told_amount ?? 0)}
            bank={bankView.guide}
            payMethod={h.pay_method}
            progress={bankView.progress}
            today={bankView.today}
          />
        )}
      </MoneyBox>

      {todos.length > 0 && (
        <section className={boxCls}>
          <h2 className="text-base font-bold">つぎにやること</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {todos.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </section>
      )}

      <section className={`${boxCls} space-y-4`}>
        <h2 className="text-base font-bold">お申し込みの中身</h2>
        {closed.length > 0 && (
          <div className={noticeCls}>
            {closed.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}
        {phase === 'suspended' && <p className={noticeCls}>ただいま受付を止めています。再開までお待ちください</p>}
        {canEditWorks && (
          <WorkEditor
            token={h.edit_token}
            people={workEditorPeople(d, people, works, settings.max_works_per_person)}
            paid={d.money.paid}
            total={d.money.total}
            remaining={d.money.remaining}
          />
        )}
        {!canEditWorks && people.map((p) => {
          const casts = d.casts
            .filter((c) => Number(c.person_id) === Number(p.id) && workById.has(Number(c.work_id)))
            .sort((a, b) => {
              const wa = workById.get(Number(a.work_id))!;
              const wb = workById.get(Number(b.work_id))!;
              return wa.sort_order - wb.sort_order || wa.id - wb.id;
            });
          return (
            <div key={p.id}>
              <p className="font-bold">{personName(p)}さん</p>
              <ul className="mt-1 space-y-1 text-sm">
                {casts.map((c) => {
                  const w = workById.get(Number(c.work_id))!;
                  const dropped = w.status === 'dropped';
                  const faded = !dropped && (c.status === 'out' || c.status === 'passed');
                  return (
                    <li key={c.id} className={`flex justify-between gap-3 ${faded ? 'opacity-50' : ''}`}>
                      <span>{w.title}</span>
                      <span className="shrink-0 font-bold">{dropped ? 'スクールの都合で、なくなりました' : CAST_LABEL[c.status] ?? ''}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      <p className="text-sm leading-relaxed">{FAMILY_ADD_LINE}</p>

      <InstaEditor
        token={h.edit_token}
        people={people.map((p) => ({ id: Number(p.id), name: personName(p), insta: p.insta_handle }))}
        readOnly={phase === 'suspended'}
      />

      <FiveLines lines={fiveLines(settings)} />

      <section className={`${boxCls} space-y-3`}>
        <h2 className="text-base font-bold">こまったら</h2>
        <p className="text-sm leading-relaxed">カードも銀行振込もむずかしいときは、公式LINEでご相談ください。</p>
        {lineButton}
      </section>
    </main>
  );
}
