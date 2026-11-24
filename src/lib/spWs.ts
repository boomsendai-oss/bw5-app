// 特設ワークショップ(/ws/[slug])の共通ロジック(純関数・vitest対象)。
//
// - 回ごとの設定(講師・日時・会場・料金・定員・締切・写真・紹介文)は sp_ws_events に持つ。ここに直書きしない
// - 会員・一般とも料金は同じ。会員かどうかは自己申告で聞くだけ(確認はしない)
// - 支払いは BOOM DOJO(battle.ts)と同じ2択:
//   カード=30分の仮押さえ→StripeのWebhookで確定 / 当日払い(現金)=申込の時点で枠を確保して確定(onsite=未収)
// - 金額は必ずサーバ側でこのファイルの関数から計算する(クライアント申告額は使わない)
import { isValidBf6Email, isValidBf6Phone } from './bf6';
import { formatJpDateLong, formatJpDateTime, yen } from './battle';

export { formatJpDateLong, formatJpDateTime, nowJstMinute, yen } from './battle';

export interface SpWsEvent {
  slug: string;
  title: string;
  subtitle: string;
  instructorName: string;
  instructorKana: string;
  instructorFrom: string;
  /** 講師紹介(改行あり)。空なら出さない */
  instructorBio: string;
  instructorGenre: string;
  instructorInstagram: string;
  /** 講師の写真URL。空なら写真なしのデザインで出す */
  photoUrl: string;
  description: string;
  /** YYYY-MM-DD(JST) */
  eventDate: string;
  startTime: string;
  endTime: string;
  /** 空なら「調整中」と出す */
  venue: string;
  venueAddress: string;
  fee: number;
  capacity: number;
  /** 申込の締切(JST 'YYYY-MM-DDTHH:MM')。この時刻を過ぎたら受け付けない */
  entryDeadline: string;
  entryOpen: boolean;
  /** 持ち物(1行に1つ) */
  belongings: string;
  /** 対象(空なら出さない) */
  target: string;
  cancelPolicy: string;
  contact: string;
}

export type SpWsPaymentStatus = 'pending' | 'paid' | 'onsite' | 'expired' | 'canceled' | 'refunded' | 'test';
export type SpWsPayMethod = 'card' | 'onsite';

/** 枠を消費する状態(確定+当日払いの確定+30分の仮押さえ)。 */
export const SP_WS_HOLDING_STATUSES: SpWsPaymentStatus[] = ['paid', 'onsite', 'pending'];
export const SP_WS_HOLD_MINUTES = 30;

export const SP_WS_MIN_AGE = 3;
export const SP_WS_MAX_AGE = 100;

/** 会場が決まっているか。 */
export function venueLabel(ev: Pick<SpWsEvent, 'venue'>): string {
  return ev.venue.trim() || '調整中(決まり次第お知らせします)';
}

/** 残り枠。 */
export function calcSpWsRemaining(capacity: number, used: number): number {
  return Math.max(0, Math.floor(capacity) - Math.max(0, Math.floor(used)));
}

/** 請求額。会員・一般とも同じ料金で1人分(サーバ側で必ずこれを使う)。 */
export function calcSpWsAmount(ev: Pick<SpWsEvent, 'fee'>): number {
  return Math.max(0, Math.floor(ev.fee) || 0);
}

/** 受付できない理由(受付中なら null)。締切→受付フラグ→満員の順に見る。 */
export function spWsGateError(ev: Pick<SpWsEvent, 'entryOpen' | 'entryDeadline'>, now: string, remaining: number | null = null): string | null {
  if (ev.entryDeadline && now > ev.entryDeadline) return `お申し込みは${formatJpDateTime(ev.entryDeadline)}で締め切りました`;
  if (!ev.entryOpen) return '現在お申し込みは受け付けていません';
  if (remaining != null && remaining <= 0) return '定員に達したため、お申し込みを締め切りました';
  return null;
}

/** 受付中か(フラグ・締切・残り枠)。締切は「23:59」までその分を含めて受け付ける。 */
export function isSpWsAccepting(ev: Pick<SpWsEvent, 'entryOpen' | 'entryDeadline'>, now: string, remaining: number | null = null): boolean {
  return spWsGateError(ev, now, remaining) == null;
}

/** 入力された年齢を整数に。全角数字・「歳」つきも受ける。範囲外・数字でなければ null。 */
export function parseSpWsAge(raw: unknown): number | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/歳$/, '')
    .trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= SP_WS_MIN_AGE && n <= SP_WS_MAX_AGE ? n : null;
}

/** 18歳未満は保護者の同意が要る。 */
export function spWsNeedsGuardian(age: number | null): boolean {
  return age != null && age < 18;
}

export interface SpWsEntryInput {
  name: string;
  kana: string;
  email: string;
  phone: string;
  age: number | null;
  /** 自己申告: BOOMの会員か */
  isMember: boolean;
  guardianName: string;
  guardianConsent: boolean;
  payMethod: SpWsPayMethod;
  agreePolicy: boolean;
}

export type ValidatedSpWsEntry = SpWsEntryInput;

function clean(v: unknown, max = 100): string {
  return String(v ?? '').trim().slice(0, max);
}

/** 入力チェック(サーバ側で必ず通す)。OKなら整えた値、NGならエラー文。 */
export function validateSpWsEntry(raw: Partial<Omit<SpWsEntryInput, 'age' | 'isMember'>> & { age?: unknown; isMember?: unknown }): ValidatedSpWsEntry | string {
  const v: SpWsEntryInput = {
    name: clean(raw.name, 60),
    kana: clean(raw.kana, 60),
    email: clean(raw.email),
    phone: clean(raw.phone, 20),
    age: parseSpWsAge(raw.age),
    isMember: raw.isMember === true || raw.isMember === 'member',
    guardianName: clean(raw.guardianName, 60),
    guardianConsent: raw.guardianConsent === true,
    payMethod: raw.payMethod === 'onsite' ? 'onsite' : 'card',
    agreePolicy: raw.agreePolicy === true,
  };
  if (raw.isMember !== true && raw.isMember !== false && raw.isMember !== 'member' && raw.isMember !== 'guest') {
    return 'BOOMの会員かどうかを選んでください';
  }
  if (!v.name) return 'お名前を入力してください';
  if (!v.kana) return 'ふりがなを入力してください';
  if (!v.email || !isValidBf6Email(v.email)) return 'メールアドレスを正しく入力してください';
  if (!v.phone || !isValidBf6Phone(v.phone)) return '電話番号は数字10〜11桁で入力してください';
  if (v.age == null) return '年齢を数字で入力してください(例: 15)';
  if (spWsNeedsGuardian(v.age)) {
    if (!v.guardianName) return '18歳未満の方は、保護者の方のお名前を入力してください';
    if (!v.guardianConsent) return '18歳未満の方は、保護者の方の同意にチェックしてください';
  } else {
    v.guardianName = '';
    v.guardianConsent = false;
  }
  if (!v.agreePolicy) return 'キャンセルについてと個人情報の取り扱いへの同意にチェックしてください';
  return v;
}

/** 受付番号(例 MY-001)。slugの大文字＋確定した順。確定前は「—」、スタッフのテストは「テスト」。 */
export function formatSpWsReceiptNo(e: { receiptSeq: number | null; paymentStatus?: string }, slug: string): string {
  if (e.receiptSeq != null && e.receiptSeq > 0) return `${slug.toUpperCase()}-${String(e.receiptSeq).padStart(3, '0')}`;
  if (e.paymentStatus === 'test') return 'テスト';
  return '—';
}

export const SP_WS_STATUS_LABEL: Record<string, string> = {
  paid: '支払済',
  onsite: '当日払い(未収)',
  pending: '決済待ち',
  expired: '期限切れ',
  canceled: 'キャンセル',
  refunded: '返金済',
  test: 'テスト',
};

/** 支払いのひとこと(完了画面・メール)。 */
export function spWsPayLabel(e: { paymentStatus?: string; amountTotal: number; note?: string }): string {
  const st = e.paymentStatus ?? 'paid';
  if (st === 'onsite') return '当日、会場で現金でお支払い(まだお支払いしていません)';
  if (st === 'pending') return 'カード決済待ち';
  if (st === 'test') return 'テスト申込(決済なし)';
  if (st === 'paid') {
    if (e.amountTotal === 0) return 'お支払いなし';
    if (e.note?.includes('当日現金で受領')) return '当日、現金でお支払い済み';
    return 'カードでお支払い済み';
  }
  return SP_WS_STATUS_LABEL[st] ?? st;
}

/** 持ち物を1行ずつの配列に。 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** 2026-12-22 → { md: '12.22', dow: 'TUE', jp: '12月22日(火)' } */
export function spWsDateParts(ymd: string): { year: string; md: string; dow: string; jp: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return { year: '', md: ymd, dow: '', jp: ymd };
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const JP = ['日', '月', '火', '水', '木', '金', '土'];
  return { year: m[1], md: `${Number(m[2])}.${Number(m[3])}`, dow: EN[d.getUTCDay()], jp: `${Number(m[2])}月${Number(m[3])}日(${JP[d.getUTCDay()]})` };
}

export interface SpWsMailEntry {
  receiptSeq: number | null;
  name: string;
  amountTotal: number;
  paymentStatus?: string;
  note?: string;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 確定メール(カードはWebhookで決済確定した瞬間・当日払いは申込直後)。 */
export function buildSpWsConfirmEmail(e: SpWsMailEntry, ev: SpWsEvent, links: { completeUrl: string }): { subject: string; text: string; html: string } {
  const receiptNo = formatSpWsReceiptNo(e, ev.slug);
  const onsite = e.paymentStatus === 'onsite';
  const when = `${formatJpDateLong(ev.eventDate)} ${ev.startTime}〜${ev.endTime}`;
  const belongings = splitLines(ev.belongings);
  const L: string[] = [];
  L.push(`${e.name} 様`);
  L.push('');
  L.push(`${ev.title} へのお申し込みありがとうございます。`);
  L.push(onsite ? 'お申し込みが確定しました。参加費は当日、会場でお支払いください。' : 'お支払いが完了し、お申し込みが確定しました。');
  L.push('');
  L.push(`受付番号: ${receiptNo}`);
  L.push('');
  L.push(`日時: ${when}`);
  L.push(`会場: ${venueLabel(ev)}`);
  if (ev.venueAddress) L.push(`  ${ev.venueAddress}`);
  L.push(`参加費: ${yen(e.amountTotal)}(${spWsPayLabel(e)})`);
  if (onsite) L.push('  当日、受付で現金でお支払いください。おつりが出ないようご用意いただけると助かります。');
  if (belongings.length) L.push(`持ち物: ${belongings.join('・')}`);
  L.push('');
  L.push('▼ お申し込み内容の確認');
  L.push(links.completeUrl);
  L.push('');
  L.push('当日は受付で、受付番号かお名前をお伝えください。');
  if (!ev.venue.trim()) L.push('会場は決まり次第、お知らせします。');
  L.push(`内容の変更・キャンセル・お問い合わせは${ev.contact || 'BOOM公式LINE'}までご連絡ください。`);
  L.push('');
  L.push('BOOM DANCE SCHOOL');

  const NAVY = '#14122b';
  const INK = '#1a1a1a';
  const SUB = '#6b6b6b';
  const LINE = '#e6e1d8';
  const ACC = '#00a090';
  const F = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','Meiryo',sans-serif";
  const T = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';
  const row = (k: string, v: string) =>
    `<tr><td width="72" valign="top" style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${F};font-size:13px;font-weight:bold;color:${SUB};">${k}</td>` +
    `<td style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${F};font-size:15px;line-height:1.6;color:${INK};">${v}</td></tr>`;
  const html =
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ev.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f5f2ec;">` +
    `<table ${T} style="background:#f5f2ec;"><tr><td align="center" style="padding:16px 8px;">` +
    `<table ${T} style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">` +
    `<tr><td align="center" style="background:${NAVY};padding:28px 16px;">` +
    `<div style="font-family:${F};font-size:11px;letter-spacing:0.3em;color:#b9b6d6;">BOOM DANCE SCHOOL PRESENTS</div>` +
    `<div style="font-family:${F};font-size:26px;font-weight:bold;color:#ffffff;margin-top:8px;">${esc(ev.title)}</div>` +
    `<div style="font-family:${F};font-size:14px;color:#ffffff;margin-top:14px;">お申し込みが確定しました</div>` +
    `</td></tr>` +
    `<tr><td style="padding:24px 20px 8px 20px;font-family:${F};font-size:15px;line-height:1.7;color:${INK};">${esc(e.name)} 様<br>` +
    `${esc(ev.title)} へのお申し込みありがとうございます。<br>` +
    `${onsite ? '参加費は当日、会場でお支払いください。' : 'お支払いも完了しています。'}</td></tr>` +
    `<tr><td align="center" style="padding:12px 20px;"><table ${T} style="border:2px solid ${NAVY};border-radius:10px;"><tr><td align="center" style="padding:16px;">` +
    `<div style="font-family:${F};font-size:12px;font-weight:bold;letter-spacing:0.2em;color:${SUB};">受付番号</div>` +
    `<div style="font-family:${F};font-size:36px;font-weight:bold;color:${NAVY};margin-top:4px;">${esc(receiptNo)}</div>` +
    `<div style="font-family:${F};font-size:12px;color:${SUB};margin-top:4px;">当日は受付で、受付番号かお名前をお伝えください</div>` +
    `</td></tr></table></td></tr>` +
    `<tr><td style="padding:8px 20px;"><table ${T}>` +
    row('日時', esc(when)) +
    row('会場', `${esc(venueLabel(ev))}${ev.venueAddress ? `<br><span style="font-size:12px;color:${SUB};">${esc(ev.venueAddress)}</span>` : ''}`) +
    row('参加費', `<b>${esc(yen(e.amountTotal))}</b><br><span style="font-size:13px;color:${onsite ? '#b3261e' : ACC};font-weight:bold;">${esc(spWsPayLabel(e))}</span>`) +
    (belongings.length ? row('持ち物', esc(belongings.join('・'))) : '') +
    `</table></td></tr>` +
    `<tr><td style="padding:16px 20px;"><table ${T}><tr><td align="center" style="border-radius:999px;background:${NAVY};">` +
    `<a href="${esc(links.completeUrl)}" style="display:block;padding:14px 10px;font-family:${F};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">お申し込み内容を見る</a>` +
    `</td></tr></table></td></tr>` +
    `<tr><td style="padding:4px 20px 28px 20px;font-family:${F};font-size:12px;line-height:1.8;color:${SUB};">` +
    (onsite ? '当日、受付で現金でお支払いください。おつりが出ないようご用意いただけると助かります。<br>' : '') +
    (!ev.venue.trim() ? '会場は決まり次第、お知らせします。<br>' : '') +
    `内容の変更・キャンセル・お問い合わせは${esc(ev.contact || 'BOOM公式LINE')}までご連絡ください。` +
    `<div style="margin-top:14px;text-align:center;letter-spacing:0.2em;">BOOM DANCE SCHOOL</div></td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { subject: `【${ev.title}】お申し込み確定(受付番号 ${receiptNo})`, text: L.join('\n'), html };
}
