// キャンセル待ちのメール。
// 繰り上げ通知には承諾/辞退のリンクを入れる。期限内にどちらも押されなければ失効し、
// 次の人へ回る。**代金は預からない**(当日会場で現金払い)ので、返金処理は発生しない。
import { sendEmail } from './email';
import type { WaitlistRow } from './bf6WaitlistDb';

const BASE_URL = 'https://boomersfight.vercel.app';
const DIV_LABEL: Record<string, string> = {
  beginner: 'ビギナー部門', kids: '小中学生部門', general: '一般部門',
};

/** 登録できたことの控え。まだ出場は確定していないと伝える。 */
export function buildWaitlistJoinedEmail(row: WaitlistRow, waitingAhead: number): { subject: string; text: string } {
  const div = DIV_LABEL[row.division] ?? row.division;
  const lines = [
    `${row.buyerName} 様`, '',
    `BOOMER'S FIGHT!!! vol.6 ${div} のキャンセル待ちにご登録いただきました。`, '',
    `■ 出場予定者: ${row.dancerName}`,
    `■ 現在の順番: ${row.position}番目`,
    waitingAhead > 0 ? `  (前に ${waitingAhead} 名お待ちです)` : '  (次に空きが出た場合、最初にご案内します)',
    '',
    'この時点では出場は確定していません。',
    '定員に空きが出た場合、順番にご案内のメールをお送りします。',
    '',
    '■ 空きが出たときの流れ',
    '  1. ご案内のメールが届きます',
    '  2. メール内のボタンで「参加する」か「辞退する」を選びます',
    '  3. 期限内にご返答がない場合、次の方へお回しします',
    '',
    'エントリー費は、繰り上がりが決まってから当日会場でお支払いいただきます。',
    'いまの時点でのお支払いは不要です。',
    '',
    `日時: 2026年9月26日(土) OPEN 14:30`,
    `会場: SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール`,
    '',
    'ご不明な点はBOOM公式LINEまでご連絡ください。', '',
    'BOOM DANCE SCHOOL',
  ];
  return {
    subject: `【BOOMER'S FIGHT!!! vol.6】キャンセル待ちを承りました(${div} ${row.position}番目)`,
    text: lines.join('\n'),
  };
}

/** 繰り上げのご案内。承諾/辞退のリンク入り。 */
export function buildWaitlistOfferEmail(row: WaitlistRow, deadlineLabel: string): { subject: string; text: string } {
  const div = DIV_LABEL[row.division] ?? row.division;
  const lines = [
    `${row.buyerName} 様`, '',
    `BOOMER'S FIGHT!!! vol.6 ${div} に空きが出ました。`,
    `お待ちいただいていた ${row.dancerName} さんにご案内します。`, '',
    '■ ご返答の期限',
    `  ${deadlineLabel}`,
    '  期限を過ぎますと、次にお待ちの方へお回しします。',
    '',
    '▼ 参加する',
    `${BASE_URL}/bf6/waitlist/respond?t=${row.token}&a=yes`,
    '',
    '▼ 辞退する',
    `${BASE_URL}/bf6/waitlist/respond?t=${row.token}&a=no`,
    '',
    '■ エントリー費について',
    '  当日、会場受付で現金でお支払いください(1部門 ¥2,500)。',
    '  事前のお支払いは不要です。',
    '',
    '■ 当日',
    '  13:30 集合(9階ホール前で受付) / 14:00 締切',
    '  受付で組み合わせ抽選(くじ引き)を行います。',
    '',
    `日時: 2026年9月26日(土) OPEN 14:30`,
    `会場: SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール`,
    '',
    'BOOM DANCE SCHOOL',
  ];
  return {
    subject: `【BOOMER'S FIGHT!!! vol.6】空きが出ました(${div} / ご返答は${deadlineLabel}まで)`,
    text: lines.join('\n'),
  };
}

export async function sendWaitlistJoinedEmail(row: WaitlistRow, waitingAhead: number): Promise<void> {
  try {
    const m = buildWaitlistJoinedEmail(row, waitingAhead);
    await sendEmail({ to: row.email, subject: m.subject, text: m.text });
  } catch (e) {
    console.error('キャンセル待ち登録メールの送信に失敗', e);
  }
}

export async function sendWaitlistOfferEmail(row: WaitlistRow, deadlineLabel: string): Promise<void> {
  const m = buildWaitlistOfferEmail(row, deadlineLabel);
  await sendEmail({ to: row.email, subject: m.subject, text: m.text });
}
