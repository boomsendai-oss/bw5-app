// BF6の完了メール。文面は純関数(vitest対象)、送信は既存のGmail SMTP基盤を使う。
// 送信タイミング: 当日現金=申込直後 / カード=Webhookで決済確定した瞬間。
import { sendEmail } from '@/lib/email';
import { bf6DivisionLabel, bf6GradeLabel, formatReceiptNo } from '@/lib/bf6';
import type { OwnBf6Order } from '@/lib/bf6Db';

// 告知はすべて boomersfight.vercel.app で統一している(bw5-app も同じサイトに解決するが
// 受け手に「別サイト?」と見せないため、メール内のリンクも告知側のドメインに揃える)。
const BASE_URL = 'https://boomersfight.vercel.app';
// 添付画像を取りに行く先(本番の公開URL)。メールはサーバ側から送るので絶対URLが要る
const PUBLIC_BASE_URL = 'https://bw5-app.vercel.app';
const yen = (n: number) => `¥${n.toLocaleString()}`;

export function buildBf6OrderEmail(order: OwnBf6Order, editToken: string): { subject: string; text: string } {
  const receiptNo = formatReceiptNo(order.orderId);
  const entries = order.items.filter((i) => i.itemType === 'entry');
  const adult = order.items.find((i) => i.itemType === 'ticket_adult');
  const child = order.items.find((i) => i.itemType === 'ticket_child');
  const stream = order.items.find((i) => i.itemType === 'stream');
  const isEntry = entries.length > 0;
  const isStreamOnly = !isEntry && !adult && !child && Boolean(stream);
  const paid = order.paymentStatus === 'paid';

  const subject = isEntry
    ? `【BOOMER'S FIGHT!!! vol.6】${paid ? 'エントリー確定' : 'エントリー受付'}(受付番号 ${receiptNo})`
    : isStreamOnly
      ? `【BOOMER'S FIGHT!!! vol.6】オンライン配信チケット${paid ? '購入完了' : 'ご購入受付'}(受付番号 ${receiptNo})`
      : `【BOOMER'S FIGHT!!! vol.6】観覧チケット${paid ? '購入完了' : 'ご予約受付'}(受付番号 ${receiptNo})`;

  const lines: string[] = [];
  lines.push(`${order.buyerName} 様`);
  lines.push('');
  lines.push(`BOOMER'S FIGHT!!! vol.6 への${isEntry ? 'エントリー' : '観覧チケットのお申し込み'}ありがとうございます。`);
  if (paid) {
    lines.push(isEntry ? 'お支払いが完了し、エントリーが確定しました!' : 'お支払いが完了しました。');
  } else {
    lines.push(isEntry ? 'エントリーを受け付けました。' : 'ご予約を受け付けました。');
  }
  lines.push('');
  lines.push(`■ 受付番号: ${receiptNo}`);
  lines.push('');
  for (const e of entries) {
    lines.push(`■ 出場者: ${e.dancerName}(${e.dancerKana})`);
    lines.push(`  本名: ${e.performerName} / ${bf6GradeLabel(e.grade)}`);
    lines.push(`  部門: ${e.divisions.map(bf6DivisionLabel).join('・')}`);
    lines.push(`  エントリー料: ${yen(e.unitAmount)}`);
  }
  if (adult) lines.push(`■ 観覧チケット(大人) × ${adult.qty} — ${yen(adult.qty * adult.unitAmount)}`);
  if (child) lines.push(`■ 観覧チケット(小学生) × ${child.qty} — ${yen(child.qty * child.unitAmount)}`);
  if (stream) {
    lines.push(`■ オンライン配信視聴チケット × ${stream.qty} — ${yen(stream.qty * stream.unitAmount)}`);
    if (paid) lines.push('  ※ 視聴キーは別のメールでお送りします(まもなく届きます)');
  }
  lines.push('');
  lines.push(`■ 合計: ${yen(order.amountTotal)}`);
  if (paid && order.amountTotal === 0) {
    lines.push('  (無料枠でのご参加のため、お支払いは不要です)');
  } else if (paid) {
    lines.push('  (カード決済でお支払い済み)');
  } else if (order.payMethod === 'onsite') {
    lines.push('  当日会場受付にて現金でお支払いください。');
  }
  lines.push('');
  lines.push('▼ お申し込み内容の確認はこちら');
  lines.push(`${BASE_URL}/bf6/complete?t=${editToken}`);
  if (isEntry) {
    lines.push('');
    lines.push('▼ エントリーリスト(リアルタイム更新)');
    lines.push(`${BASE_URL}/bf6/entries`);
  }
  lines.push('');
  lines.push('日時: 2026年9月26日(土) OPEN 14:30');
  lines.push('会場: SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール');
  if (isEntry) {
    // 出場者は開場より1時間早い集合。受付でくじ引き(組み合わせ抽選)を行うため、
    // 遅れると抽選に入れず不利になる。観覧のみの方には出さない。
    lines.push('');
    lines.push('▼ バトルエントリー者の集合時刻');
    lines.push('  13:30 集合(9階ホール前で受付)');
    lines.push('  14:00 締切');
    lines.push('  受付で組み合わせ抽選(くじ引き)を行いますので、');
    lines.push('  時間内にお越しください。');
    lines.push('  遅れると抽選に参加できず、運営サイドで決定を行う場合があります。');
    lines.push('  ※ 観覧の方の開場は 14:30 です');
    // 9/23に出場者へ一斉送信した「当日のご案内」と同じ内容。締切(9/24)までに申し込んだ人にも
    // 同じ情報が届くように、自動返信にもそのまま入れる(TARO 2026-09-23)。
    lines.push('');
    lines.push('▼ 会場への行き方');
    lines.push('  SSMの1階の入口を入るとエレベーターが2つあります。');
    lines.push('  そこから9階へ直接上がってきてください。');
    lines.push('  エレベーターを降りた目の前がホールです。');
    lines.push('  受付に置いてあるタブレットで、エントリー受付');
    lines.push('  (部門を選ぶ → 名前を選ぶ → くじを引く)をお済ませください。');
    lines.push('');
    lines.push('▼ 保護者の方へ(受付と一緒にお願いします)');
    lines.push('  ・観覧チケットを購入済みの方は、このタイミングで入場受付');
    lines.push('   (リストバンドのお渡し)も済ませてください。');
    lines.push('   ホールへの入場自体は、開場の14:30からです。');
    lines.push('  ・お支払いが当日現金の方は、このタイミングで、');
    lines.push('   エントリー費と観覧チケットのお支払いをまとめてお願いします。');
    lines.push('');
    lines.push('▼ 控室(柔道場)');
    lines.push('  柔道場を控室としてご利用いただけます。荷物なども置いていただけます。');
    lines.push('  柔道場は飲食禁止です。');
    lines.push('  会場をお借りしているので、食べ物・飲み物をこぼすなどがあると、');
    lines.push('  今後この会場を使えなくなります。必ずお守りください。');
    lines.push('  柔道場の場所は、添付の地図をご覧ください。');
    lines.push('');
    lines.push('▼ ご注意');
    lines.push('  ・SSMの校舎では、ほかのフロアやお部屋で授業やほかの催しが');
    lines.push('   行われていることがあります。ご迷惑にならないよう、');
    lines.push('   用のないフロア・お部屋には立ち入らないでください。');
    lines.push('  ・バトルの時間は、進行状況によって変わることがあります。');
    lines.push('   なるべく会場の近くにいてください。');
    lines.push('  ・コール(呼び出し)のときにいない場合は、不戦敗になることがあります。');
    lines.push('  ・会場内での紛失・盗難などについて、主催者は一切責任を負いません。');
    lines.push('   貴重品は各自で管理してください。');
    lines.push('');
    lines.push('▼ タイムテーブル');
    lines.push('  添付のタイムテーブルをご覧ください。');
  }
  lines.push('');
  lines.push('内容の変更・キャンセルはBOOM公式LINEまでご連絡ください。');
  lines.push('');
  lines.push('BOOM DANCE SCHOOL');

  return { subject, text: lines.join('\n') };
}

/**
 * 出場者の自動返信に付ける添付(控室の地図・タイムテーブル)。
 * 一斉メール(bf6Broadcast)と同じ画像をpublicから取る。取れないときは添付なしで送る
 * (メールそのものが届かない方が困るため)。
 */
const GUIDE_ATTACHMENTS = [
  { filename: '控室（柔道場）への行き方.png', path: 'bf6/mail/judo-map.png' },
  { filename: 'タイムテーブル.png', path: 'bf6/mail/timetable.png' },
];

async function loadGuideAttachments(): Promise<{ filename: string; content: Buffer }[]> {
  try {
    return await Promise.all(
      GUIDE_ATTACHMENTS.map(async (a) => {
        const res = await fetch(`${PUBLIC_BASE_URL}/${a.path}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${a.path} (${res.status})`);
        return { filename: a.filename, content: Buffer.from(await res.arrayBuffer()) };
      })
    );
  } catch (e) {
    console.error('[bf6] guide attachments failed', e instanceof Error ? e.message : e);
    return [];
  }
}

/** 完了メールを送る。失敗しても呼び出し元の処理(申込・Webhook)は止めない。 */
export async function sendBf6OrderEmail(order: OwnBf6Order, editToken: string): Promise<void> {
  try {
    const mail = buildBf6OrderEmail(order, editToken);
    const isEntry = order.items.some((i) => i.itemType === 'entry');
    const attachments = isEntry ? await loadGuideAttachments() : [];
    await sendEmail({
      to: order.email,
      subject: mail.subject,
      text: mail.text,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  } catch (e) {
    console.error('[bf6] order email failed', order.orderId, e instanceof Error ? e.message : e);
  }
}
