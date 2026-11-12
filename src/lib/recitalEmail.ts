// BW6 発表会（段階1）のメールの文面（純。DB にも送る口にもさわらない）。Task 10。
// 件名と本文の正本：受付の控え・変更の控え・URL の送り直し＝設計書 04 4-2「自動メール」、
// お振込みのご案内・申込完了・追加分・あと◯円＝設計書 07 7-8 と決まりの紙 2-24、頭と終わりの形＝07 7-6。
// 金額と日付は data（請求の行と設定から作った物）を差し込むだけ。文の中に直書きしない。
// 振込先（bank_text）を書くのは bank_guide だけ。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
import type { MoneySummary } from '@/lib/recital';

export type MailKind = 'receipt' | 'change' | 'complete' | 'extra_complete' | 'remaining' | 'resend_url' | 'bank_guide';
export type MailVia = 'card' | 'bank' | 'cash' | 'adjust';

/**
 * その日の発表会のメール（sent＋failed）がこの数以上なら、スタッフの画面に「上限に近いです」を出す（07 7-7）。
 * U5：今の送り口は個人の Gmail（boom.sendai@gmail.com・アプリパスワードの SMTP）。Google のヘルプ
 * （support.google.com/mail/answer/22839「1日に500通より多く送ると止まることがある」）の 500 の8割。
 */
export const RECITAL_MAIL_DAILY_WARN = 400;

export type RecitalMailData = {
  contactName: string; refCode: string; myUrl: string; eventLine: string;
  people: { name: string; inWorks: string[]; maybeWorks: string[] }[]; // 作品は「作品の名前（W03）」の形
  chargeLines: { label: string; amount: number }[]; // 生きている請求の行
  m: MoneySummary; hasMaybe: boolean; zeroComplete: boolean;
  payDue: string; payDueLong: string; // '2月10日（水）'／'2027年2月10日（水）'。pay_due_override があればその日
  payNotice: 'open' | 'before' | 'preparing'; payOpenLabel: string; // payGate の結果と '12月15日（火）'
  changeCloseLabel: string; mypageItems: string; // '1月31日（日）23:59'／マイページに今出ている物だけ（K221）
  nextContact: string; // '2月ごろ'
  via?: MailVia;
  paid?: { amount: number; dateLabel: string }; // その入金（振込は bank_date）
  paidTotal?: number; // 完了の「■ お支払い」の額（調整の入金を除いた和）
  addedWorks?: { name: string; works: string[] }[];
  change?: {
    lines: string[]; totalBefore: number; totalAfter: number;
    kind: 'unpaid' | 'paid_add' | 'paid_drop' | 'fee_refund' | 'no_money'; afterFeb1: boolean; refundAmount: number;
    merged?: { intoRefCode: string };
  };
  guide?: { amount: number; bankText: string; nameLine: string; restLine: string | null };
};

const SUBJECT_HEAD = '【BOOM】BW6';
const LAST_LINE = 'このメールに心当たりがないときは、そのままにしてください。';
const NO_RETURN = 'お支払いのあとは、お返しできません。スクールの都合で作品がなくなったときは、その分をお返しします。';
/** マイページに「作品を足す・やめる」が出ているときだけ「マイページで変えられます」と書く（04 4-2 の逃げ道・K221） */
const EDIT_ITEM = '作品を足す・やめる';

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

function viaLabel(via: MailVia | undefined): string | null {
  if (via === 'card') return 'カード';
  if (via === 'bank') return '銀行振込';
  if (via === 'cash') return '現金';
  return null; // adjust（と、払い方が分からないとき）は払い方を書かない
}

function head(d: RecitalMailData): string[] {
  return [`${d.contactName}様`, '', 'こんにちは、BOOMダンススクールです。'];
}

function foot(): string[] {
  return ['', 'こまったときは、公式LINEでお知らせください。', 'BOOMダンススクール', '', LAST_LINE];
}

/** 「（出る人の名前）：出る＝（作品）、（作品）／迷っている＝（作品）」 */
function applyLines(d: RecitalMailData): string[] {
  const out: string[] = [];
  for (const p of d.people) {
    const parts: string[] = [];
    if (p.inWorks.length > 0) parts.push(`出る＝${p.inWorks.join('、')}`);
    if (p.maybeWorks.length > 0) parts.push(`迷っている＝${p.maybeWorks.join('、')}`);
    if (parts.length > 0) out.push(`　${p.name}：${parts.join('／')}`);
  }
  return out;
}

/** 「（出る人の名前）：（作品）、（作品）」（出るだけ） */
function inLines(d: RecitalMailData): string[] {
  return d.people.filter((p) => p.inWorks.length > 0).map((p) => `　${p.name}：${p.inWorks.join('、')}`);
}

function mypageBlock(d: RecitalMailData, withItems: boolean, items: string = d.mypageItems): string[] {
  return [withItems && items !== '' ? `■ マイページ（${items}はこちら）` : '■ マイページ', `　${d.myUrl}`];
}

/** 申込完了のメールは、もう払う物が無いので「お支払い」を出さない（まだ出ている物だけ。07 7-8 の見本・K221） */
function itemsAfterComplete(d: RecitalMailData): string {
  return d.mypageItems.split('、').map((x) => x.trim()).filter((x) => x !== '' && x !== 'お支払い').join('、');
}

function changeCloseLine(d: RecitalMailData): string {
  return d.mypageItems.includes(EDIT_ITEM)
    ? `■ ${d.changeCloseLabel} まで、マイページで変えられます。`
    : `■ ${d.changeCloseLabel} まで、変えられます。変えたいときは、公式LINEでお知らせください。`;
}

/** 振込の入金の1行目「12月21日のお振込み 32,500円を確認しました。」 */
function bankFirstLine(d: RecitalMailData): string | null {
  if (d.via !== 'bank' || !d.paid) return null;
  return `${d.paid.dateLabel}のお振込み ${yen(d.paid.amount)}を確認しました。`;
}

function payLine(amount: number, d: RecitalMailData): string {
  const via = viaLabel(d.via);
  const date = d.paid?.dateLabel ?? '';
  return `${yen(amount)}${via ? `（${via}）` : ''}${date ? `　${date}` : ''}`;
}

// ---------- 種類ごとの本文 ----------

function receiptText(d: RecitalMailData): string[] {
  const maybeOnly = d.m.total === 0 && d.hasMaybe && !d.people.some((p) => p.inWorks.length > 0);
  const lines = [
    ...head(d),
    `${d.eventLine}への出演のお申し込みを受け付けました。`,
    'いまは「仮受付」です。お支払いが済むと、「申込完了」になります。',
    '',
    `■ 整理番号　${d.refCode}`,
    '■ お申し込みの中身',
    ...applyLines(d),
  ];
  if (maybeOnly) {
    lines.push(
      `■ 金額　${yen(0)}（迷っている作品は、金額に入っていません）`,
      '　ご家族が別々にお申し込みのときは、こちらで1つにまとめて、金額を直します。',
      '■ お支払い',
      `　出る作品が決まったら、マイページの「払う」からお支払いいただけます。お支払いは、${d.payDue}までです。`,
    );
  } else {
    const first =
      d.payNotice === 'before'
        ? `お支払いは、${d.payOpenLabel}から、マイページでできます。`
        : d.payNotice === 'preparing'
          ? 'お支払いは、準備ができしだい、マイページでできます。'
          : 'マイページの「払う」から、カードか銀行振込でお支払いいただけます。';
    lines.push(
      `■ 金額　${yen(d.m.total)}`,
      ...d.chargeLines.map((c) => `　${c.label}　${yen(c.amount)}`),
      '　迷っている作品は、金額に入っていません。',
      '　ご家族が別々にお申し込みのときは、こちらで1つにまとめて、金額を直します。',
      '■ お支払い',
      `　${first}`,
      `　お支払いは、${d.payDue}までです。今すぐでも、あとからでも大丈夫です。`,
      '　迷っている作品がある方は、決まってからお支払いください。',
      `　${NO_RETURN}`,
    );
  }
  lines.push(
    ...mypageBlock(d, true),
    '　このURLは、ご家族だけのものです。ほかの方に送らないでください。',
    changeCloseLine(d),
    ...foot(),
  );
  return lines;
}

/** 合計0円で「出る」がある世帯の「控え＋申込完了」の1通（04 4-2・裁定 R-77）。「■ お支払い」は出さない */
function zeroCompleteText(d: RecitalMailData): string[] {
  return [
    ...head(d),
    `${d.eventLine}へのお申し込みが完了しました。お支払いはありません。`,
    '',
    `■ 整理番号　${d.refCode}`,
    '■ お申し込みの中身',
    ...applyLines(d),
    `■ 金額　${yen(0)}`,
    ...mypageBlock(d, true, itemsAfterComplete(d)),
    '　このURLは、ご家族だけのものです。ほかの方に送らないでください。',
    changeCloseLine(d),
    ...foot(),
  ];
}

function changeMoneyLines(d: RecitalMailData, c: NonNullable<RecitalMailData['change']>): string[] {
  if (c.kind === 'no_money') return [];
  const out = [`■ 金額　${yen(c.totalBefore)} → ${yen(c.totalAfter)}`];
  if (c.kind === 'unpaid') {
    out.push(`　お支払いは、${d.payDue}までです。今すぐでも、あとからでも大丈夫です。`);
  } else if (c.kind === 'paid_add') {
    out.push(
      `　お支払いずみ ${yen(d.m.paid)}／残り ${yen(d.m.remaining)}`,
      `　追加分 ${yen(d.m.remaining)}は、マイページの「払う」からお支払いください。${d.payDue}までです。`,
    );
  } else if (c.kind === 'paid_drop') {
    const base = `　お支払いずみ ${yen(d.m.paid)}／今のお申し込み ${yen(c.totalAfter)}。`;
    const closeDate = d.changeCloseLabel.replace(/\s*\d{1,2}:\d{2}$/, '');
    if (d.m.overpaid > 0 && !c.afterFeb1) {
      out.push(`${base}差の ${yen(d.m.overpaid)}は、${closeDate}までに作品を足すと、その分に当てられます。お返しはできません。`);
    } else if (d.m.overpaid > 0) {
      out.push(`${base}お返しはできません。`);
    } else {
      out.push(base);
    }
  } else {
    out.push(`　今のお申し込み ${yen(c.totalAfter)}。多くいただいた ${yen(c.refundAmount)}は、お返しします。お返しの方法は、公式LINEでご連絡します。`);
  }
  return out;
}

function changeText(d: RecitalMailData): string[] {
  const c = d.change ?? { lines: [], totalBefore: d.m.total, totalAfter: d.m.total, kind: 'no_money' as const, afterFeb1: false, refundAmount: 0 };
  const changed: string[] = [];
  if (c.merged) {
    changed.push(
      '　ご家族のお申し込みが2つに分かれていました。1つにまとめて、金額を直しました。',
      `　これからは、整理番号 ${c.merged.intoRefCode} のマイページをお使いください。`,
    );
  }
  changed.push(...c.lines.map((l) => `　${l}`));
  return [
    ...head(d),
    'お申し込みの中身を変えました。',
    '',
    '■ 変わった所',
    ...changed,
    ...changeMoneyLines(d, c),
    '■ 今のお申し込みの中身',
    ...applyLines(d),
    ...mypageBlock(d, false),
    ...foot(),
  ];
}

/** 振込先の下の固定の1行（画面 BankGuide.tsx とメールで同じ文。bank_text には入れない。D5 2-24） */
export const BANK_GUIDE_FIXED_NOTE = '※ BOOM は個人の事業のため、受取人名に代表の氏名が出ます。';

function bankGuideText(d: RecitalMailData): string[] {
  const g = d.guide ?? { amount: d.m.remaining, bankText: '', nameLine: d.refCode, restLine: null };
  const bankLines = g.bankText.split('\n').map((l) => l.trim()).filter((l) => l !== '').map((l) => `　${l}`);
  return [
    ...head(d),
    'BW6 の出演料の、お振込みのご案内です。',
    '',
    `お振込み金額　${yen(g.amount)}（ちょうどの金額でお願いします）`,
    `お振込み期限　${d.payDueLong}`,
    '',
    'お振込み先',
    ...bankLines,
    `　${BANK_GUIDE_FIXED_NOTE}`,
    '',
    `あなたの整理番号　${d.refCode}`,
    '',
    '「振込依頼人名」（お振込みをする方のお名前のらん）の頭に、',
    '整理番号を足してください。',
    '',
    `　${g.nameLine}`,
    '',
    '・お名前は、口座のお名前のままでかまいません。数字4つを、前に足すだけです。',
    '・空白は、あっても無くてもかまいません。',
    '・らんの名前は、銀行によって「振込人名」「ご依頼人名」のこともあります。',
    '　「メッセージ」や「メモ」のらんではありません。',
    '',
    '銀行の画面でお名前を変えられないときは、そのままお振込みください。',
    '振り込み直しは、要りません。',
    'お振込みのあと、マイページの「振り込みました」を押して、',
    'お振込みの日・お名前・金額を教えてください。',
    `　${d.myUrl}`,
    '',
    '・ご家族のほかの方が振り込むときは、整理番号と金額をお伝えください。',
    '・ごきょうだいの分は、同じ整理番号で、まとめて1回でかまいません。',
    '・振込手数料は、ご負担をお願いします。',
    '・夜や休日のお振込みは、次の営業日のあつかいになることがあります。',
    '・現金でのお振込みは、銀行の店の ATM か窓口からになります。',
    '・マイページから、カードでもお支払いいただけます。',
    '',
    'ご入金の確認には、ふだん1〜2日、土日や祝日をはさむと数日かかることがあります。',
    '確認できましたら、メールでお知らせします。',
    ...(g.restLine ? [g.restLine] : []),
    '',
    '作品を足したときは、新しい金額のメールをお送りします。前のメールの金額は、古くなります。',
    ...foot(),
  ];
}

function completeText(d: RecitalMailData): string[] {
  return [
    ...head(d),
    bankFirstLine(d) ?? 'お支払いを確認しました。',
    `${d.eventLine}へのお申し込みが完了しました。`,
    'このメールが、お支払いの控えです。',
    '',
    `■ 整理番号　${d.refCode}`,
    '■ 出る人と作品',
    ...inLines(d),
    `■ お支払い　${payLine(d.paidTotal ?? d.m.paid, d)}`,
    `　${NO_RETURN}`,
    ...mypageBlock(d, true, itemsAfterComplete(d)),
    `■ 次のご連絡は、${d.nextContact}です。`,
    ...foot(),
  ];
}

function extraCompleteText(d: RecitalMailData): string[] {
  const added = (d.addedWorks ?? []).filter((a) => a.works.length > 0);
  return [
    ...head(d),
    bankFirstLine(d) ?? '追加分のお支払いを確認しました。',
    '',
    `■ 整理番号　${d.refCode}`,
    ...(added.length > 0 ? ['■ 追加した作品', ...added.map((a) => `　${a.name}：${a.works.join('、')}`)] : []),
    `■ 追加分のお支払い　${payLine(d.paid?.amount ?? 0, d)}`,
    '■ いまのお申し込み',
    ...inLines(d),
    ...mypageBlock(d, false),
    ...foot(),
  ];
}

function remainingText(d: RecitalMailData): string[] {
  const first = d.paid
    ? `${d.paid.dateLabel}のお振込み ${yen(d.paid.amount)}を確認しました。あと ${yen(d.m.remaining)}です。`
    : `お支払いを確認しました。あと ${yen(d.m.remaining)}です。`;
  return [
    ...head(d),
    first,
    '',
    `■ 整理番号　${d.refCode}`,
    `■ あと ${yen(d.m.remaining)}のお支払い`,
    '　マイページの「払う」から、お願いします。銀行振込でも、カードでも、お支払いいただけます。',
    `　期限は ${d.payDue}です。`,
    ...mypageBlock(d, false),
    ...foot(),
  ];
}

/** URL の送り直し：見本どおり頭を付けず、URL の1行と最後の1行だけ（04 4-2） */
function resendUrlText(d: RecitalMailData): string[] {
  return [`マイページはこちらです。${d.myUrl}`, LAST_LINE];
}

// ---------- 件名と本文 ----------

export function buildRecitalMail(kind: MailKind, d: RecitalMailData): { subject: string; text: string } {
  const no = `整理番号 ${d.refCode}`;
  const bank = d.via === 'bank';
  let subject: string;
  let lines: string[];
  switch (kind) {
    case 'receipt':
      subject = `${SUBJECT_HEAD} お申し込みを受け付けました（仮受付）（${no}）`;
      lines = receiptText(d);
      break;
    case 'resend_url':
      subject = `${SUBJECT_HEAD} マイページのご案内`;
      lines = resendUrlText(d);
      break;
    case 'change':
      subject = `${SUBJECT_HEAD} お申し込みの中身が変わりました（${no}）`;
      lines = changeText(d);
      break;
    case 'bank_guide':
      subject = `${SUBJECT_HEAD} お振込みのご案内（${no}）`;
      lines = bankGuideText(d);
      break;
    case 'complete':
      subject = bank ? `${SUBJECT_HEAD} ご入金を確認しました（お申し込み完了・${no}）` : `${SUBJECT_HEAD} お申し込みが完了しました（${no}）`;
      lines = d.zeroComplete ? zeroCompleteText(d) : completeText(d);
      break;
    case 'extra_complete':
      subject = bank ? `${SUBJECT_HEAD} ご入金を確認しました（追加分・${no}）` : `${SUBJECT_HEAD} 追加分のお支払いを受け付けました（${no}）`;
      lines = extraCompleteText(d);
      break;
    case 'remaining':
      subject = `${SUBJECT_HEAD} ご入金を確認しました（あと ${yen(d.m.remaining)}です）`;
      lines = remainingText(d);
      break;
  }
  return { subject, text: lines.join('\n') + '\n' };
}
