// BF6 エントリー者への一斉メール。
//
// 設計の要点:
//  - 文面は「テンプレート」としてコードに固定する。スタッフ画面から自由入力させない。
//    一斉送信は取り消せないため、TAROが承認した文面だけを送れるようにする。
//  - 同じ key は二度送れない(bf_broadcast.key の UNIQUE 制約)。
//  - 宛先は「バトルエントリーを含む有効注文」のメールアドレス(重複除去)。
//    観覧・配信チケットのみの購入者には送らない(集合13:30は関係がなく、混乱するため)。
import { getAll, execute } from './db';
import { buildBreakdownByOrder, type CashLine } from './bf6Cash';
import { getBf6Settings } from './bf6Db';
import { toOrderLine } from './bf6CashDb';
import { sendEmail } from './email';
import { nowUtcIso } from './dateJst';

/**
 * 宛先の範囲。テンプレートごとに変える。
 *  entrants … バトルエントリーを含む有効注文。当日の段取り(集合時刻など)はこちら。
 *              観覧・配信のみの購入者に送ると混乱するため。
 *  all      … 有効注文すべて(エントリー+観覧チケット)。会場に来る人みんなに関係する
 *              案内はこちら。配信チケットを既に持っている人は自動で除く。
 *  cash_due … 支払い方法が「当日現金」でまだ払っていない注文。人ごとに金額が違うので
 *              本文に金額と内訳を差し込む。すでに受け取った人には送らない。
 */
export type Bf6BroadcastAudience = 'entrants' | 'all' | 'cash_due';

export type Bf6BroadcastTemplate = {
  key: string;
  label: string;
  subject: string;
  body: string;
  audience: Bf6BroadcastAudience;
  /** 画面に出す宛先の説明 */
  audienceNote: string;
  /**
   * 添付する画像。path は public/ からの相対パス。送信時に本番のURLから取ってきて付ける
   * (⚠️ Vercelの関数からは public/ のファイルを直接読めないため)。
   */
  attachments?: Bf6BroadcastAttachment[];
};

export type Bf6BroadcastAttachment = { filename: string; path: string };

/** 添付画像を取りに行く先。publicは本番と同じものが配信されている。 */
const PUBLIC_BASE_URL = 'https://bw5-app.vercel.app';

const CALL_TIME_BODY = `BOOMER'S FIGHT!!! vol.6 にエントリーいただき、ありがとうございます。

当日の集合時刻が決まりましたので、お知らせします。


▼ バトルエントリー者の集合時刻

  9月26日(土) 13:30 集合
  SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール前

  14:00 締切です。

  受付で組み合わせ抽選(くじ引き)を行いますので、
  時間内にお越しください。
  遅れると抽選に参加できず、運営サイドで決定を行う場合があります。


▼ 受付でお渡しするもの

  ・リストバンド(会場内でご着用ください)
  ・当日の注意事項のご案内

  ※ お支払いが「当日現金」の方は、受付でお支払いをお願いします。


▼ 観覧の方へ

  一般の開場は 14:30 です。
  バトルエントリー者ご本人の観覧料はかかりません。
  ご家族・お友達の観覧チケットはこちらから。

  https://boomersfight.vercel.app


▼ 当日の流れ(予定)

  13:30  バトルエントリー者 集合・受付開始
  14:00  受付締切
  14:30  開場
  18:30頃 終演

  ※ タイムテーブルの詳細は後日あらためてお知らせします。


ご不明な点は、BOOM公式LINEまでお気軽にご連絡ください。
当日お会いできるのを楽しみにしています。

BOOM DANCE SCHOOL
BOOMER'S FIGHT!!! vol.6`;

// 配信チケットの案内。狙いは「遠方のご家族に勧めてもらう」こと。
// 出場者・観覧客の親戚が主な買い手になるため、宛先は entrants ではなく all。
const STREAM_INVITE_BODY = `BOOMER'S FIGHT!!! vol.6 にお申し込みいただき、ありがとうございます。

当日の様子を、会場に来られない方向けにオンラインで生配信します。
遠方のご家族・ご親戚にご覧いただけますので、よろしければお知らせください。


▼ オンライン配信 視聴チケット

  1キー ¥1,500(税込)
  当日のライブ配信 + 終了後1週間のアーカイブ
  スマホ・PC・タブレットからご覧いただけます

  https://bw5-app.vercel.app/bf6/stream


▼ 離れて住むご家族へのプレゼントにも

  ご購入いただくと、視聴用のキーがメールで届きます。
  そのキーをお送りいただくだけでご覧いただけます。

  ※ 1キーにつき同時に視聴できるのは1端末までです。
    2か所で同時にご覧になる場合は2キーご購入ください。
  ※ お支払いは事前のカード決済のみです。


当日のタイムテーブルなど詳しいご案内は、あらためてお送りします。

BOOM DANCE SCHOOL
BOOMER'S FIGHT!!! vol.6`;

const CASH_DUE_BODY = `BOOMER'S FIGHT!!! vol.6 にお申し込みいただき、ありがとうございます。

お支払い方法を「当日現金」でお申し込みいただいた方へ、
当日のお支払いについてのご案内です。


▼ お支払いは 13:30 の受付で、まとめてお願いします

  観覧チケットの分も、バトルエントリーの受付でいっしょにお支払いください。
  開場(14:30)の入口では、リストバンドをお渡しするだけになります。

  ご家族が別々にお越しになる場合も、あらかじめご調整のうえ、
  お支払いを1回にまとめていただけると助かります。


▼ 当日お支払いいただく金額

{{breakdown}}

  合計 {{amount}}

  おつりのないよう、ご準備いただけると助かります。


▼ 受付

  9月26日(土) 13:30 〜 14:00
  SSM(仙台スクールオブミュージック&ダンス専門学校) 9階ホール前

  受付では組み合わせ抽選(くじ引き)も行います。
  14:00 を過ぎると抽選に参加できず、運営側で決定する場合があります。


金額に心当たりがない場合や、ご都合が変わった場合は、
このメールにご返信ください。


BOOM DANCE SCHOOL
BOOMER'S FIGHT!!! vol.6`;

// 当日のご案内(TARO 2026-09-22 承認)。控室・飲食禁止・立ち入り・保護者の入場受付と当日現金の
// まとめ払いを、受付(13:30)の前に伝える。地図とタイムテーブルの画像を添付する。
const ENTRANT_GUIDE_BODY = `BOOMER'S FIGHT!!! vol.6 にエントリーいただき、ありがとうございます。
当日のご案内です。


▼ 集合・受付

  9月26日(土) 13:30〜14:00　9階ホール前

  SSM(仙台スクールオブミュージック&ダンス専門学校)の1階の入口を入ると、
  エレベーターが2つあります。そこから9階へ直接上がってきてください。
  エレベーターを降りた目の前がホールです。

  受付に置いてあるタブレットで、エントリー受付
  (部門を選ぶ → 名前を選ぶ → くじを引く)をお済ませください。
  14:00を過ぎると抽選に参加できず、運営側で決定する場合があります。


▼ 保護者の方へ(受付と一緒にお願いします)

  ・観覧チケットを購入済みの方は、このタイミングで入場受付
   (リストバンドのお渡し)も済ませてください。
   ホールへの入場自体は、開場の14:30からです。
  ・お支払いが当日現金の方は、このタイミングで、
   エントリー費と観覧チケットのお支払いをまとめてお願いします。

  開場の時間は受付が混み合うため、一緒に済ませていただけると大変助かります。


▼ 控室(柔道場)

  柔道場を控室としてご利用いただけます。荷物なども置いていただけます。

  柔道場は飲食禁止です。
  会場をお借りしているので、食べ物・飲み物をこぼすなどがあると、
  今後この会場を使えなくなります。必ずお守りください。

  柔道場の場所は、添付の地図をご覧ください。


▼ ご注意

  ・SSMの校舎では、ほかのフロアやお部屋で授業やほかの催しが
   行われていることがあります。ご迷惑にならないよう、
   用のないフロア・お部屋には立ち入らないでください。
  ・バトルの時間は、進行状況によって変わることがあります。
   なるべく会場の近くにいてください。
  ・コール(呼び出し)のときにいない場合は、不戦敗になることがあります。
  ・会場内での紛失・盗難などについて、主催者は一切責任を負いません。
   貴重品は各自で管理してください。


▼ タイムテーブル

  添付のタイムテーブルをご覧ください。


▼ 観覧の方へ

  一般の開場は14:30です。
  ご家族・お友達の観覧チケットはこちらから。

  https://boomersfight.vercel.app


当日お会いできるのを楽しみにしています。

BOOM DANCE SCHOOL
BOOMER'S FIGHT!!! vol.6`;

export const BF6_BROADCAST_TEMPLATES: Bf6BroadcastTemplate[] = [
  {
    key: 'call-time-1',
    label: '集合時刻の案内(1通目)',
    subject: "【BOOMER'S FIGHT!!! vol.6】当日は13:30集合です(バトルエントリー者の方へ)",
    body: CALL_TIME_BODY,
    audience: 'entrants',
    audienceNote:
      'バトルエントリーを含む有効な注文(決済済み・当日現金)。観覧チケットのみ・配信チケットのみの購入者には送りません。',
  },
  {
    key: 'stream-invite-1',
    label: 'オンライン配信のご案内',
    subject: "【BOOMER'S FIGHT!!! vol.6】遠方のご家族はオンライン配信でご覧いただけます",
    body: STREAM_INVITE_BODY,
    audience: 'all',
    audienceNote:
      'エントリー・観覧チケットを問わず有効な注文すべて。配信チケットを既にお持ちの方は自動で除きます。',
  },
  {
    key: 'cash-due-1',
    label: '当日現金の方へ(受付でまとめてお支払い)',
    subject: "【BOOMER'S FIGHT!!! vol.6】当日のお支払いは13:30の受付でお願いします",
    body: CASH_DUE_BODY,
    audience: 'cash_due',
    audienceNote:
      '支払い方法が「当日現金」で、まだ受け取っていない注文のみ。人ごとに金額と内訳を差し込みます。すでに受け取った方・事前決済の方には送りません。',
  },
  {
    key: 'entrant-guide-1',
    label: '当日のご案内(控室・飲食禁止・保護者の受付)',
    subject: "【BOOMER'S FIGHT!!! vol.6】当日のご案内(バトル出場者の方へ)",
    body: ENTRANT_GUIDE_BODY,
    audience: 'entrants',
    audienceNote:
      'バトルエントリーを含む有効な注文(決済済み・当日現金)。地図とタイムテーブルの画像を添付します。',
    attachments: [
      { filename: '控室（柔道場）への行き方.png', path: 'bf6/mail/judo-map.png' },
      { filename: 'タイムテーブル.png', path: 'bf6/mail/timetable.png' },
    ],
  },
];

const YEN = (n: number) => `¥${n.toLocaleString()}`;

/**
 * お支払いの内訳をメール本文に入れる形にする。
 * 金額だけでは何の分か分からないので、集金画面と同じ内訳をそのまま載せる。
 */
export function breakdownText(lines: CashLine[]): string {
  return lines
    .map((l) => `  ${l.label}${l.qty > 1 ? ` × ${l.qty}` : ''}　${YEN(l.amount)}`)
    .join('\n');
}

/**
 * 本文の {{名前}} を差し替える。
 * ⚠️ 値の無い差し込みは空にする。{{ }} のままお客に届く事故を防ぐ。
 */
export function fillBroadcastVars(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? '');
}

export type BroadcastRecipient = { email: string; vars: Record<string, string> };

/**
 * 当日現金の人への宛先。人ごとに金額が違うので差し込みを作る。
 * 同じアドレスで複数申し込んでいたら 1通にまとめて合算する
 * (別々に届くと「どちらを払うのか」と問い合わせになる)。
 */
export function buildCashDueRecipients(
  orders: { id: number; email: string; amountTotal: number }[],
  breakdown: Map<number, CashLine[]>
): BroadcastRecipient[] {
  const byEmail = new Map<string, { total: number; lines: CashLine[] }>();
  for (const o of orders) {
    const email = (o.email ?? '').trim();
    if (!email) continue;
    const cur = byEmail.get(email) ?? { total: 0, lines: [] };
    cur.total += o.amountTotal;
    cur.lines.push(...(breakdown.get(o.id) ?? []));
    byEmail.set(email, cur);
  }
  return [...byEmail.entries()].map(([email, v]) => ({
    email,
    vars: { amount: YEN(v.total), breakdown: breakdownText(v.lines) },
  }));
}

/** テンプレートを取り出す。未知のキーは投げる(誤送信の防止)。 */
export function buildBf6Broadcast(key: string): {
  subject: string;
  body: string;
  audience: Bf6BroadcastAudience;
  attachments: Bf6BroadcastAttachment[];
} {
  const t = BF6_BROADCAST_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`未知の一斉メールテンプレート: ${key}`);
  return { subject: t.subject, body: t.body, audience: t.audience, attachments: t.attachments ?? [] };
}

/**
 * 添付画像を取ってくる。1回の送信で1度だけ取り、全員に同じものを付ける。
 * ⚠️ 取れなかったら送信自体を止める(添付なしで一部の人にだけ届く、を防ぐ)。
 */
async function loadBroadcastAttachments(list: Bf6BroadcastAttachment[]): Promise<{ filename: string; content: Buffer }[]> {
  return Promise.all(
    list.map(async (a) => {
      const res = await fetch(`${PUBLIC_BASE_URL}/${a.path}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`添付画像を取得できません: ${a.path} (${res.status})`);
      return { filename: a.filename, content: Buffer.from(await res.arrayBuffer()) };
    })
  );
}

/**
 * 当日現金でまだ受け取っていない注文の宛先。金額と内訳を人ごとに差し込む。
 *
 * ⚠️ payment_status = 'cash_due' だけを見る。受け取り済み(paid)の人に
 *    「当日お支払いください」と送ると事故になる。
 */
export async function getCashDueRecipients(): Promise<BroadcastRecipient[]> {
  const [orders, lines, settings] = await Promise.all([
    getAll(
      `SELECT id, email, amount_total FROM bf_orders
        WHERE pay_method = 'onsite' AND payment_status = 'cash_due' AND amount_total > 0
          AND email IS NOT NULL AND email != ''
        ORDER BY id`
    ).catch(() => []),
    getAll(
      `SELECT i.order_id, i.item_type, i.qty, i.unit_amount, i.divisions, i.dancer_name
         FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
        WHERE o.pay_method = 'onsite' AND o.payment_status = 'cash_due'
        ORDER BY i.order_id, i.sort_order`
    ).catch(() => []),
    getBf6Settings().catch(() => null),
  ]);
  const breakdown = buildBreakdownByOrder(
    lines.map(toOrderLine),
    settings?.pricing.entryPerExtraDivision ?? 1500
  );
  return buildCashDueRecipients(
    orders.map((o) => ({ id: Number(o.id), email: String(o.email), amountTotal: Number(o.amount_total ?? 0) })),
    breakdown
  );
}

/**
 * 宛先のメールアドレス(重複除去)。
 *
 * all のときは、配信チケットを既に買っている人を除く。
 * 買った本人に「買いませんか」と送るのは失礼だし、問い合わせの原因になる。
 */
export async function getBf6BroadcastRecipients(
  audience: Bf6BroadcastAudience = 'entrants'
): Promise<string[]> {
  if (audience === 'all') {
    const rows = await getAll(
      `SELECT DISTINCT o.email AS email
         FROM bf_orders o
        WHERE o.payment_status IN ('paid','cash_due')
          AND o.email IS NOT NULL AND o.email != ''
          AND o.email NOT IN (
            SELECT o2.email FROM bf_orders o2
              JOIN bf_order_items i2 ON i2.order_id = o2.id
             WHERE i2.item_type = 'stream'
               AND o2.payment_status IN ('paid','cash_due')
          )
        ORDER BY o.email`
    );
    return rows.map((r) => String(r.email));
  }

  const rows = await getAll(
    `SELECT DISTINCT o.email AS email
       FROM bf_orders o
       JOIN bf_order_items i ON i.order_id = o.id
      WHERE i.item_type = 'entry'
        AND o.payment_status IN ('paid','cash_due')
        AND o.email IS NOT NULL AND o.email != ''
      ORDER BY o.email`
  );
  return rows.map((r) => String(r.email));
}

/**
 * 送信の間隔(ミリ秒)。
 * ⚠️ 0にすると Gmail SMTP が `421 4.3.0 Temporary System Problem` で弾き始める。
 * 2026-09-09 の配信案内(46通)で実際に8通落ちた。アドレスの問題ではなく速度の問題。
 */
const SEND_INTERVAL_MS = 900;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type Bf6BroadcastResult = {
  sent: number;
  failed: number;
  alreadySent?: boolean;
};

/**
 * 一斉送信。同じ key は二度送れない(UNIQUE制約で弾く)。
 * 1件ずつ送り、個別の失敗で全体を止めない。
 */
export async function sendBf6Broadcast(key: string): Promise<Bf6BroadcastResult> {
  const { subject, body, audience, attachments: attachmentList } = buildBf6Broadcast(key);
  const now = nowUtcIso();
  // 添付は送信済みの記録を作る前に取る(取れないまま「送信済み」にならないように)
  const attachments = await loadBroadcastAttachments(attachmentList);

  // key の UNIQUE で二重送信を弾く。挿入できなければ既に送信済み。
  const ins = await execute(
    'INSERT INTO bf_broadcast (key, subject, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING',
    [key, subject, body, now]
  );
  if ((ins.rowsAffected ?? 0) === 0) return { sent: 0, failed: 0, alreadySent: true };
  const broadcastId = Number(ins.lastInsertRowid);

  // 当日現金だけは人ごとに金額が違うので、差し込み付きの宛先を使う
  const recipients: BroadcastRecipient[] =
    audience === 'cash_due'
      ? await getCashDueRecipients()
      : (await getBf6BroadcastRecipients(audience)).map((email) => ({ email, vars: {} }));
  let sent = 0;
  let failed = 0;
  for (const [idx, r] of recipients.entries()) {
    const to = r.email;
    if (idx > 0) await wait(SEND_INTERVAL_MS);
    try {
      await sendEmail({ to, subject, text: fillBroadcastVars(body, r.vars), attachments });
      sent += 1;
      await execute(
        'INSERT INTO bf_broadcast_recipient (broadcast_id, email, status, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(broadcast_id, email) DO NOTHING',
        [broadcastId, to, 'sent', nowUtcIso()]
      );
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      await execute(
        'INSERT INTO bf_broadcast_recipient (broadcast_id, email, status, error, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(broadcast_id, email) DO NOTHING',
        [broadcastId, to, 'failed', msg.slice(0, 300), nowUtcIso()]
      );
    }
  }
  await execute('UPDATE bf_broadcast SET sent_count = ?, failed_count = ? WHERE id = ?', [sent, failed, broadcastId]);
  return { sent, failed };
}

/** 送信済みの一斉メール一覧(スタッフ画面の表示用)。 */
export async function listBf6Broadcasts(): Promise<
  { key: string; subject: string; sentCount: number; failedCount: number; createdAt: string }[]
> {
  const rows = await getAll(
    'SELECT key, subject, sent_count, failed_count, created_at FROM bf_broadcast ORDER BY id DESC'
  ).catch(() => []);
  return rows.map((r) => ({
    key: String(r.key),
    subject: String(r.subject),
    sentCount: Number(r.sent_count ?? 0),
    failedCount: Number(r.failed_count ?? 0),
    createdAt: String(r.created_at ?? ''),
  }));
}

/**
 * 失敗した宛先にだけ送り直す。
 *
 * Gmail のスロットリング(421)で落ちた分を拾うためのもの。本文は送信時に
 * bf_broadcast へ保存したものをそのまま使う(テンプレートを後から直しても、
 * 一度送ったものと違う文面が同じ人に届かないようにするため)。
 */
export async function retryBf6BroadcastFailures(key: string): Promise<Bf6BroadcastResult> {
  const b = await getAll('SELECT id, subject, body FROM bf_broadcast WHERE key = ?', [key]);
  if (b.length === 0) return { sent: 0, failed: 0 };
  const broadcastId = Number(b[0].id);
  const subject = String(b[0].subject);
  const body = String(b[0].body);
  // 送り直しでも最初と同じ添付を付ける(テンプレートが無くなっていれば添付なし)
  const tpl = BF6_BROADCAST_TEMPLATES.find((x) => x.key === key);
  const attachments = await loadBroadcastAttachments(tpl?.attachments ?? []);

  const rows = await getAll(
    "SELECT email FROM bf_broadcast_recipient WHERE broadcast_id = ? AND status = 'failed' ORDER BY email",
    [broadcastId]
  );

  let sent = 0;
  let failed = 0;
  for (const [idx, r] of rows.entries()) {
    if (idx > 0) await wait(SEND_INTERVAL_MS);
    const to = String(r.email);
    try {
      await sendEmail({ to, subject, text: body, attachments });
      sent += 1;
      await execute(
        "UPDATE bf_broadcast_recipient SET status = 'sent', error = NULL WHERE broadcast_id = ? AND email = ?",
        [broadcastId, to]
      );
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      await execute(
        'UPDATE bf_broadcast_recipient SET error = ? WHERE broadcast_id = ? AND email = ?',
        [msg.slice(0, 300), broadcastId, to]
      );
    }
  }

  // 集計を貼り直す(履歴の成功/失敗件数を実態に合わせる)
  const agg = await getAll(
    "SELECT status, COUNT(*) AS n FROM bf_broadcast_recipient WHERE broadcast_id = ? GROUP BY status",
    [broadcastId]
  );
  const okAll = Number(agg.find((x) => x.status === 'sent')?.n ?? 0);
  const ngAll = Number(agg.find((x) => x.status === 'failed')?.n ?? 0);
  await execute('UPDATE bf_broadcast SET sent_count = ?, failed_count = ? WHERE id = ?', [okAll, ngAll, broadcastId]);

  return { sent, failed };
}

/** 失敗が残っている一斉メールの key と件数(スタッフ画面の再送ボタン用)。 */
export async function listBf6BroadcastFailures(): Promise<{ key: string; failed: number }[]> {
  const rows = await getAll(
    `SELECT b.key AS key, COUNT(*) AS n
       FROM bf_broadcast_recipient r JOIN bf_broadcast b ON b.id = r.broadcast_id
      WHERE r.status = 'failed'
      GROUP BY b.key`
  ).catch(() => []);
  return rows.map((r) => ({ key: String(r.key), failed: Number(r.n) }));
}
