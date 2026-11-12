'use client';

// BW6 発表会のマイページの「お振込みのご案内」と「振り込みました」（Task 23）。「払う」（PaySection）の中に出す。別の URL は作らない。
// 文の正本は決まりの紙 D5 2-24「画面の文（このまま使う）」と「『振り込みました』を押したあとの画面」、2-20 の3つの欄、設計書 04 4-2。
// 振込先は設定 bank_text をそのまま（改行も）出す。※の1行は画面の固定の文（bank_text には入れない。計画で決めた）。
// 金額・振込先は字のまま出す（絵にしない）。［コピーする］は名義の1行だけ。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
// 金額・期限・年末年始の1行はサーバ（page.tsx）で今の値から作って渡す。家庭から送るのは「振り込みました」の3つの欄だけ。
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { yenJa } from '@/lib/recitalPublic';
import { markBankToldAction } from './actions';

export type BankGuideData = {
  /** ご案内に出す金額（今の残り。印が開いていて残りが印の金額より多い間は 残り−印の金額） */
  amount: number;
  /** 期限（'2027年2月10日（水）' の形） */
  payDueLong: string;
  /** 設定 bank_text（銀行・支店・口座・受取人名の行） */
  bankText: string;
  refCode: string;
  /** 名義の1行（整理番号＋申し込んだ人のフリガナ） */
  nameLine: string;
  /** 年末年始の1行（休みの終わりの日まで。過ぎたら null） */
  restLine: string | null;
};

const bigBtnCls = 'block w-full rounded-xl bg-navy-700 px-4 py-3 text-center text-lg font-bold text-white disabled:opacity-40';
const subBtnCls = 'block w-full rounded-xl border-2 border-navy-700 bg-white px-4 py-3 text-center text-base font-bold text-navy-700 disabled:opacity-40';
const msgCls = 'rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-base font-bold leading-relaxed text-navy-700';
const copyBtnCls = 'shrink-0 rounded-lg border-2 border-navy-700 bg-white px-3 py-1 text-sm font-bold text-navy-700';

/** 銀行ごとの「お名前を変える場所」の早見（04 4-2。公式のページで確かめられた銀行だけ） */
const BANK_HINTS: [string, string][] = [
  ['三菱UFJ銀行', 'アプリは、確認の画面で「振込依頼人名」の右の「変更」'],
  ['三井住友銀行', '振込の入力の中の「依頼人名」'],
  ['みずほ銀行', 'アプリは、振込先を選んだあとの「振込人名の変更」。ATM は「依頼人名入力」'],
  ['りそな銀行', 'マイゲートは、金額を入れる画面。ATM は「カードのみ」を選ぶ'],
  ['楽天銀行', '先に入っているお名前を書きかえる'],
  ['仙台銀行', '金額を入れる画面の「付加情報選択」で「振込依頼人名」を選ぶ'],
  ['JAネットバンク', '金額を入れる画面の「振込・振替依頼人名」'],
];

/** 「振り込みました」を押したあとの画面の文（D5 2-24。このまま使う） */
export const TOLD_DONE_LINES = [
  'ご連絡ありがとうございます。お振込みを確認中です。',
  '確認できましたら、メールでお知らせします。',
  '確認中のあいだ、カードでお支払いになると、二重のお支払いになります。',
];

/** 「振り込みました」の3つの欄（2-20・04 4-2）。初めの値：日＝今日・お名前＝空・金額＝今の残り（印があればその値） */
export function BankToldForm(props: { token: string; today: string; initialAmount: number; onDone: () => void; onCancel?: () => void }) {
  const { token, today, initialAmount, onDone, onCancel } = props;
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(String(initialAmount));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    if (date === '' || name.trim() === '' || amount.trim() === '') { setError('3つとも入れてください。'); return; }
    if (date > today) { setError('お振込みの日に、今日より先の日は入れられません。'); return; }
    setError(null);
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof markBankToldAction>>;
      try {
        r = await markBankToldAction(token, { date, name, amount });
      } catch {
        setError('もう一度押してください');
        return;
      }
      if ('error' in r) { setError(r.error); return; }
      onDone();
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-sand-300 bg-white p-4 text-navy-700">
      <p className="text-base font-bold">振り込みました</p>
      <label className="block text-sm font-bold">
        お振込みの日
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={`${RECITAL_INPUT_CLS} mt-1`} required />
      </label>
      <label className="block text-sm font-bold">
        お名前
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="4827 ヤマダ ハナコ"
          autoComplete="off"
          className={`${RECITAL_INPUT_CLS} mt-1`}
          required
        />
        <span className="mt-1 block text-xs font-normal">通帳やアプリに出る、振り込んだ方のお名前</span>
      </label>
      <label className="block text-sm font-bold">
        金額（円）
        <input
          type="text"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${RECITAL_INPUT_CLS} mt-1`}
          required
        />
      </label>
      {error && <p className={msgCls}>{error}</p>}
      <button type="button" className={bigBtnCls} disabled={pending} onClick={send}>
        振り込みました
      </button>
      {onCancel && (
        <button type="button" className={subBtnCls} disabled={pending} onClick={onCancel}>
          もどる
        </button>
      )}
    </div>
  );
}

/**
 * 「お振込みのご案内」の画面（D5 2-24 の文のまま）。いちばん下に［振り込みました］（残りがある間だけ）と［カードで払う］。
 * ［カードで払う］は 21 の流れ（振込を選んだ世帯なので、1回聞かれる）を呼ぶ側が持つ。
 */
export function BankGuide(props: {
  token: string; guide: BankGuideData; today: string; remaining: number; toldAmount: number | null;
  openForm: boolean; onOpenForm: (open: boolean) => void; onCard: () => void; pending: boolean;
}) {
  const { token, guide, today, remaining, toldAmount, openForm, onOpenForm, onCard, pending } = props;
  const nameRef = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);
  const [told, setTold] = useState(false);

  const copy = async () => {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(guide.nameLine);
      setCopied(true);
    } catch {
      // 写せない時は、字を選んだ状態にする（長押しで写せる）
      const el = nameRef.current;
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (el && sel) {
        sel.removeAllRanges();
        sel.selectAllChildren(el);
      }
    }
  };

  return (
    <div className="space-y-4 text-navy-700">
      <div className="space-y-4 rounded-xl border border-sand-200 bg-white p-4 text-base leading-relaxed">
        <h3 className="text-lg font-bold">お振込みのご案内</h3>

        <div>
          <p>
            お振込み金額　<span className="font-bold">{yenJa(guide.amount)}</span>（ちょうどの金額でお願いします）
          </p>
          <p>お振込み期限　{guide.payDueLong}</p>
        </div>

        <div>
          <p>お振込み先</p>
          <div className="pl-4">
            <p className="whitespace-pre-wrap break-words select-text">{guide.bankText}</p>
            <p>※ BOOM は個人の事業のため、受取人名に代表の氏名が出ます。</p>
          </div>
        </div>

        <p>
          あなたの整理番号　<span className="font-bold">{guide.refCode}</span>
        </p>

        <div>
          <p>「振込依頼人名」（お振込みをする方のお名前のらん）の頭に、</p>
          <p>整理番号を足してください。</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pl-4">
          <span ref={nameRef} className="select-all font-bold">{guide.nameLine}</span>
          <button type="button" className={copyBtnCls} onClick={copy}>
            コピーする
          </button>
          {copied && <span className="text-sm">写しました</span>}
        </div>

        <ul className="space-y-1">
          <li>・お名前は、口座のお名前のままでかまいません。数字4つを、前に足すだけです。</li>
          <li>・空白は、あっても無くてもかまいません。</li>
          <li>
            ・らんの名前は、銀行によって「振込人名」「ご依頼人名」のこともあります。
            <br />
            　「メッセージ」や「メモ」のらんではありません。
          </li>
        </ul>

        <details className="rounded-lg border border-sand-200 bg-sand-50 px-3 py-2">
          <summary className="cursor-pointer font-bold">銀行ごとの、お名前を変える場所</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {BANK_HINTS.map(([bank, where]) => (
              <li key={bank}>
                <span className="font-bold">{bank}</span>　{where}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">限度額の引き上げに日がかかるときは、カードでもお支払いいただけます</p>
        </details>

        <div>
          <p>銀行の画面でお名前を変えられないときは、そのままお振込みください。</p>
          <p>振り込み直しは、要りません。</p>
          <p>お振込みのあと、このページの「振り込みました」を押して、</p>
          <p>お振込みの日・お名前・金額を教えてください。</p>
        </div>

        <ul className="space-y-1">
          <li>・ご家族のほかの方が振り込むときは、整理番号と金額をお伝えください。</li>
          <li>・ごきょうだいの分は、同じ整理番号で、まとめて1回でかまいません。</li>
          <li>・振込手数料は、ご負担をお願いします。</li>
          <li>・夜や休日のお振込みは、次の営業日のあつかいになることがあります。</li>
          <li>・現金でのお振込みは、銀行の店の ATM か窓口からになります。</li>
          <li>・このページから、カードでもお支払いいただけます。</li>
        </ul>

        <div>
          <p>ご入金の確認には、ふだん1〜2日、土日や祝日をはさむと数日かかることがあります。</p>
          <p>確認できましたら、メールでお知らせします。</p>
          {guide.restLine && <p>{guide.restLine}</p>}
        </div>
      </div>

      {told && (
        <div className={msgCls}>
          {TOLD_DONE_LINES.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}

      {remaining > 0 && !told && (openForm ? (
        <BankToldForm
          token={token}
          today={today}
          initialAmount={toldAmount ?? remaining}
          onDone={() => { setTold(true); onOpenForm(false); }}
          onCancel={() => onOpenForm(false)}
        />
      ) : (
        <button type="button" className={bigBtnCls} disabled={pending} onClick={() => onOpenForm(true)}>
          振り込みました
        </button>
      ))}
      <button type="button" className={subBtnCls} disabled={pending} onClick={onCard}>
        カードで払う
      </button>
    </div>
  );
}
