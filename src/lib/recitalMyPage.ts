// BW6 発表会（段階1）のマイページの文（純関数。DB にさわらない）。
// 文の正本は設計書 04 4-2「マイページ」（いちばん上に出すもの・その時だけ重ねて出すもの・つぎにやること）と H19。
// 見る順は「出演なし」→ 世帯の言葉ごと（R-46）。期限は呼ぶ側が pay_due_override ?? pay_due を渡す。
// 日付は日付と曜日だけで書く（決まり 5）。金額は yenJa、日付は jpDate／slashDate（recitalPublic.ts）。
import type { HouseholdView, MoneySummary } from './recital';
import { jpDate, slashDate, yenJa } from './recitalPublic';

export type MyTopInput = {
  view: HouseholdView; m: MoneySummary; hasIn: boolean; hasMaybe: boolean; payDue: string; todayYmd: string;
  changeClose: string; afterChangeClose: boolean; payMethod: string | null;
  /** 「払う」が今この画面に出ているか（Task 21）。false の時は期限切れの文から『払う』を指す文を外す。省くと true */
  payShown?: boolean;
};

type PayState = 'hidden' | 'before' | 'preparing' | 'refund_hold' | 'show';

const TENTATIVE_LINE = 'いまは『仮受付』です。お支払いが済むと、『申込完了』になります。';
const MAYBE_LINE = '迷っている作品がある方は、決まってからお支払いください。お支払いのあとは、お返しできません。';
const OVERDUE_HEAD = 'お支払いの期限が過ぎました。お申し込みは、まだ完了していません。';
const OVERDUE_PAY = '下の『払う』から、今もお支払いいただけます。';
const BANK_DAYS_LINE =
  'お振込みずみのときは、ご入金の確認に、ふだん1〜2日、土日や祝日をはさむと数日かかることがあります。確認できましたら、メールでお知らせします。';

/** 「お支払いずみの分」の文（払ったあとにへらした）。2/1 からは「スタッフが作品を足したときは」の文（5-5） */
function overpaidLine(x: MyTopInput): string {
  const use = x.afterChangeClose
    ? 'スタッフが作品を足したときは、その分に当てます'
    : `${slashDate(x.changeClose)}までに作品を足すと、その分に当てられます`;
  return `お支払いずみ ${yenJa(x.m.paid)}／今のお申し込み ${yenJa(x.m.total)}。差の ${yenJa(x.m.overpaid)}は、${use}。お返しはできません。`;
}

/** いちばん上の文（世帯の言葉の下に出す） */
export function myTopLines(x: MyTopInput): string[] {
  if (x.view === 'none') {
    return x.m.overpaid > 0 ? [overpaidLine(x)] : ['お支払いはありません。出たいお気持ちがあるときは、公式LINEでお知らせください。'];
  }
  const overdue = x.todayYmd > x.payDue.slice(0, 10) && x.m.remaining > 0;
  const dueOrOverdue = overdue
    ? [x.payShown === false ? OVERDUE_HEAD : OVERDUE_HEAD + OVERDUE_PAY, ...(x.payMethod === 'bank' ? [BANK_DAYS_LINE] : [])]
    : [`お支払いは、${jpDate(x.payDue)}までです。今すぐでも、あとからでも大丈夫です。`];

  switch (x.view) {
    case 'tentative':
      if (!x.hasIn && x.hasMaybe) {
        return ['いまは『仮受付』です。', `迷っている作品を、${jpDate(x.changeClose)}までに決めてください。`, '出る作品が決まったら、ここからお支払いいただけます。'];
      }
      return [...dueOrOverdue, TENTATIVE_LINE, ...(x.hasMaybe ? [MAYBE_LINE] : [])];
    case 'complete_extra':
      return [`追加分のお支払いは ${yenJa(x.m.remaining)}です。${jpDate(x.payDue)}までにお支払いください。今のお申し込みは、そのままです。`];
    case 'complete': {
      const lines = ['お申し込みが完了しました'];
      if (x.m.overpaid > 0) lines.push(overpaidLine(x));
      else if (x.m.total === 0 && x.hasIn) lines.push('お支払いはありません');
      return lines;
    }
  }
}

/** 締切のあとの文（H19）。残りがある世帯には期限を続ける */
export function closedNotice(x: { afterChangeClose: boolean; remaining: number; payDue: string; changeClose: string }): string[] {
  if (!x.afterChangeClose) return [];
  return [
    `お申し込みと変更の受付は、${jpDate(x.changeClose)}で終わりました。中身を変えたいときは、公式LINEでお知らせください。`,
    ...(x.remaining > 0 ? [`お支払いは、${jpDate(x.payDue)}までです。`] : []),
  ];
}

/** つぎにやること（K221：その時マイページでできる物だけ。多くても3つ） */
export function nextTodos(x: { payState: PayState; remaining: number; payDue: string; hasMaybe: boolean; canEditWorks: boolean; changeClose: string }): string[] {
  const out: string[] = [];
  if (x.payState === 'show' && x.remaining > 0) out.push(`お支払い（${jpDate(x.payDue)}まで）`);
  if (x.hasMaybe && x.canEditWorks) out.push(`迷っている作品を決める（${jpDate(x.changeClose)}まで）`);
  return out.slice(0, 3);
}

/** 「払う」の置き場に、ボタンの代わりに出す文（K224・K207）。出す文が無ければ null */
export function payAreaText(state: PayState, payOpenAt: string): string | null {
  switch (state) {
    case 'before': return `お支払いは ${jpDate(payOpenAt)}から`;
    case 'preparing': return 'お支払いは、準備中です';
    case 'refund_hold': return 'お預かりしている分があります。スクールからご連絡します';
    default: return null;
  }
}
