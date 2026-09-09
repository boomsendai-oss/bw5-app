// BF6 エントリー者への一斉メール。
//
// 設計の要点:
//  - 文面は「テンプレート」としてコードに固定する。スタッフ画面から自由入力させない。
//    一斉送信は取り消せないため、TAROが承認した文面だけを送れるようにする。
//  - 同じ key は二度送れない(bf_broadcast.key の UNIQUE 制約)。
//  - 宛先は「バトルエントリーを含む有効注文」のメールアドレス(重複除去)。
//    観覧・配信チケットのみの購入者には送らない(集合13:30は関係がなく、混乱するため)。
import { getAll, execute } from './db';
import { sendEmail } from './email';
import { nowUtcIso } from './dateJst';

/**
 * 宛先の範囲。テンプレートごとに変える。
 *  entrants … バトルエントリーを含む有効注文。当日の段取り(集合時刻など)はこちら。
 *              観覧・配信のみの購入者に送ると混乱するため。
 *  all      … 有効注文すべて(エントリー+観覧チケット)。会場に来る人みんなに関係する
 *              案内はこちら。配信チケットを既に持っている人は自動で除く。
 */
export type Bf6BroadcastAudience = 'entrants' | 'all';

export type Bf6BroadcastTemplate = {
  key: string;
  label: string;
  subject: string;
  body: string;
  audience: Bf6BroadcastAudience;
  /** 画面に出す宛先の説明 */
  audienceNote: string;
};

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
];

/** テンプレートを取り出す。未知のキーは投げる(誤送信の防止)。 */
export function buildBf6Broadcast(key: string): {
  subject: string;
  body: string;
  audience: Bf6BroadcastAudience;
} {
  const t = BF6_BROADCAST_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`未知の一斉メールテンプレート: ${key}`);
  return { subject: t.subject, body: t.body, audience: t.audience };
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
  const { subject, body, audience } = buildBf6Broadcast(key);
  const now = nowUtcIso();

  // key の UNIQUE で二重送信を弾く。挿入できなければ既に送信済み。
  const ins = await execute(
    'INSERT INTO bf_broadcast (key, subject, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING',
    [key, subject, body, now]
  );
  if ((ins.rowsAffected ?? 0) === 0) return { sent: 0, failed: 0, alreadySent: true };
  const broadcastId = Number(ins.lastInsertRowid);

  const recipients = await getBf6BroadcastRecipients(audience);
  let sent = 0;
  let failed = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, text: body });
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
