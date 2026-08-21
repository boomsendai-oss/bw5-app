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

export type Bf6BroadcastTemplate = {
  key: string;
  label: string;
  subject: string;
  body: string;
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

export const BF6_BROADCAST_TEMPLATES: Bf6BroadcastTemplate[] = [
  {
    key: 'call-time-1',
    label: '集合時刻の案内(1通目)',
    subject: "【BOOMER'S FIGHT!!! vol.6】当日は13:30集合です(バトルエントリー者の方へ)",
    body: CALL_TIME_BODY,
  },
];

/** テンプレートを取り出す。未知のキーは投げる(誤送信の防止)。 */
export function buildBf6Broadcast(key: string): { subject: string; body: string } {
  const t = BF6_BROADCAST_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`未知の一斉メールテンプレート: ${key}`);
  return { subject: t.subject, body: t.body };
}

/** 宛先 = バトルエントリーを含む有効注文のメールアドレス(重複除去)。 */
export async function getBf6BroadcastRecipients(): Promise<string[]> {
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
  const { subject, body } = buildBf6Broadcast(key);
  const now = nowUtcIso();

  // key の UNIQUE で二重送信を弾く。挿入できなければ既に送信済み。
  const ins = await execute(
    'INSERT INTO bf_broadcast (key, subject, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING',
    [key, subject, body, now]
  );
  if ((ins.rowsAffected ?? 0) === 0) return { sent: 0, failed: 0, alreadySent: true };
  const broadcastId = Number(ins.lastInsertRowid);

  const recipients = await getBf6BroadcastRecipients();
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
