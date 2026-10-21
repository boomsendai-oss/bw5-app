// src/lib/notify.ts — 運用障害の能動通知(TARO本人宛)の単一入口。
//
// 呼び出し側(watchdog / pre-flight 等)はチャネルを意識しない。送る順番:
//   1. Pushover(iPhoneに直接届く): PUSHOVER_USER_KEY + アプリの鍵
//      (PUSHOVER_TOKEN_BOOM → 無ければ PUSHOVER_TOKEN_TARO → PUSHOVER_TOKEN_NITROASH)。
//      成功したら、Gmailに記録を残すためにメールも「ついでに」送る(メールの失敗は無視)。
//   2. Pushoverが未設定 or 失敗した時だけ: LINE push(LINE_CHANNEL_ACCESS_TOKEN + TARO_LINE_USER_ID)
//   3. それも無理なら: 既存 nodemailer(Gmail SMTP) で boom.sendai@gmail.com へメール。
//   どれか1つでも届けば正常終了。全部だめな時だけ、各チャネルの失敗理由をまとめて throw する。
//
// なぜPushoverが先頭か(2026-10-16の事故):
//   TAROがGoogleのパスワードを変えた → Gmailのアプリパスワード(GMAIL_APP_PASSWORD)が自動で無効化
//   → アプリのメールが全部失敗。障害通知もメールしか経路が無かった(本番はLINE未設定)ため、
//   「壊れた」という知らせ自体が届かず、誰も気づけなかった。
//   Gmailに依存しない経路を先頭に置き、メールが死んでも通知だけは届くようにした。
//   メールの生死は /api/cron/mail-health が毎朝確かめる。
//
// 方針(MEMORY準拠): これは「自発的なLINE進捗報告」ではなく運用障害アラート専用。
// 顧客宛ではなくTARO本人宛なので誤爆リスクなし。全て正常なら呼ばれない(沈黙=正常)。

import { isMailConfigured, sendEmail } from './email';
import { sendPushover } from './inboxAlert/pushover';
import { truncateChars } from './inboxAlert/format';

const TARO_EMAIL = 'boom.sendai@gmail.com';

const DEFAULT_SUBJECT_PREFIX = '[BOOM Story]';

/** Pushoverの上限(文字数): タイトル250・本文1024 */
const PUSHOVER_TITLE_MAX = 250;
const PUSHOVER_MESSAGE_MAX = 1024;

type Env = Record<string, string | undefined>;

/** 件名の組み立て(純関数・テスト用に切り出し)。prefix未指定/空なら既定値を使う。 */
export function formatSubject(subject: string, prefix?: string): string {
  return `${prefix || DEFAULT_SUBJECT_PREFIX} ${subject}`;
}

/** Pushoverの送り先。ユーザーキーと鍵が1本も無ければ null(=Pushoverは使わない) */
export function pushoverTarget(env: Env): { userKey: string; appToken: string } | null {
  const userKey = env.PUSHOVER_USER_KEY;
  const appToken = env.PUSHOVER_TOKEN_BOOM || env.PUSHOVER_TOKEN_TARO || env.PUSHOVER_TOKEN_NITROASH;
  return userKey && appToken ? { userKey, appToken } : null;
}

export type NotifyDeps = {
  env?: Env;
  fetchImpl?: typeof fetch;
  /** メール送信。未設定などで送れない時は throw すること */
  sendMail?: (subject: string, body: string) => Promise<void>;
};

async function defaultSendMail(subject: string, body: string): Promise<void> {
  // sendEmail は鍵が無いと黙って何もしないので、ここで「送れていない」と明示する
  if (!isMailConfigured()) throw new Error('GMAIL_APP_PASSWORD 未設定');
  await sendEmail({ to: TARO_EMAIL, subject, text: body });
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function notifyTaro(
  opts: {
    subject: string;
    body: string;
    subjectPrefix?: string;
  },
  deps: NotifyDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sendMail = deps.sendMail ?? defaultSendMail;
  const subject = formatSubject(opts.subject, opts.subjectPrefix);
  const failures: string[] = [];

  // 1. Pushover
  const po = pushoverTarget(env);
  if (po) {
    try {
      await sendPushover(
        po.appToken,
        po.userKey,
        {
          title: truncateChars(subject, PUSHOVER_TITLE_MAX),
          message: truncateChars(opts.body || '(本文なし)', PUSHOVER_MESSAGE_MAX),
        },
        fetchImpl,
      );
      // 届いた。Gmailにも記録を残す(メールが死んでいても通知は届いているので失敗は握りつぶす)
      try {
        await sendMail(subject, opts.body);
      } catch (e) {
        console.warn(`通知メール(控え)の送信失敗・Pushoverには送信済み: ${errMsg(e)}`);
      }
      return;
    } catch (e) {
      failures.push(`Pushover: ${errMsg(e)}`);
      console.warn(`Pushover通知失敗→次の経路へ: ${errMsg(e)}`);
    }
  } else {
    failures.push('Pushover: 未設定(PUSHOVER_USER_KEY / PUSHOVER_TOKEN_*)');
  }

  // 2. LINE
  const lineToken = env.LINE_CHANNEL_ACCESS_TOKEN;
  const lineUser = env.TARO_LINE_USER_ID;
  if (lineToken && lineUser) {
    try {
      await pushLine(lineToken, lineUser, `${subject}\n\n${opts.body}`, fetchImpl);
      return;
    } catch (e) {
      failures.push(`LINE: ${errMsg(e)}`);
      console.warn(`LINE通知失敗→メールへフォールバック: ${errMsg(e)}`);
    }
  }

  // 3. メール
  try {
    await sendMail(subject, opts.body);
    return;
  } catch (e) {
    failures.push(`メール: ${errMsg(e)}`);
  }

  throw new Error(`TAROへの通知がすべての経路で失敗: ${failures.join(' / ')}`);
}

async function pushLine(token: string, to: string, text: string, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE push ${res.status}: ${await res.text().catch(() => '')}`);
  }
}
