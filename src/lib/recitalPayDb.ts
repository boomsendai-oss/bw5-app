// BW6 発表会（段階1）の開いている支払い（recital_checkouts。カードの決済の画面だけ）の作る・聞いて合わせる・切る（Task 21）。
// 決まりの正本は設計書 05 5-6（開いている支払いは世帯に1つまで・30分で切れる・開いた時と「払う」の時に Stripe に聞く）、
// 04 4-2 の「払う」の表、決まり K55・K172・K194・K204・K207・K224、裁定 R-43・R-98。
// 金額はいつもサーバで、その時の今の残り（印があれば 残り−印の金額）から出す。家庭から金額を受けない。
// 22（Stripe の知らせ）・23（銀行振込を選ぶ・「振り込みました」）がこのファイルに足した。ログに名前・メールは出さない。金額は 22 の「額がちがう」の1行だけ（計画どおり）。
import { execute, getOne, withWriteTx } from '@/lib/db';
import { isIsoDate, nowUtcIso, todayJst } from '@/lib/dateJst';
import { payableAmount, payButtonState, payGate, recitalMyUrl } from '@/lib/recital';
import { getRecitalSettings, logChangeTx } from '@/lib/recitalDb';
import { requireHouseholdByToken } from '@/lib/recitalGuard';
import { maybeResendBankGuide, sendPaidMail } from '@/lib/recitalMail';
import { notifyTaro } from '@/lib/notify';
import { afterMoneyChanged, insertPaymentTx, readHouseholdMoney, readHouseholdMoneyTx } from '@/lib/recitalMoneyDb';
import {
  buildRecitalCheckoutParams,
  createRecitalCheckout,
  expireRecitalCheckout,
  parseRecitalWebhookEvent,
  retrieveRecitalCheckout,
  stripeModeForSession,
  type RecitalCheckoutState,
  type RecitalStripeMode,
  type RecitalWebhookEvent,
} from '@/lib/recitalStripe';

/** 決済の画面が切れるまで（分）。設計書 5-6・K55 */
export const RECITAL_CHECKOUT_MINUTES = 30;
/** カードの入金を Stripe に確かめられなかった時の文（「払う」は出さない。04 4-2・R-98） */
export const CARD_CHECKING_TEXT = 'ご入金を確認しています';
/** 決済の画面から戻った時（?paid=1）の文。残りが無い・確認中の時だけ出す（04 4-2） */
export const CARD_PAID_RETURN_TEXT = 'お支払いを受け付けました。完了のメールが届きます。この画面は、閉じて大丈夫です。もう一度払う必要は、ありません。';
/** 番号（stripe_session_id）がまだ空の行を「作っている途中」と見る時間。これより前の物だけ閉じる */
const CREATING_GRACE_MS = 60_000;

export type CardPayBlocked = 'ask_bank' | 'told_open' | 'not_open' | 'nothing_due' | 'refund_hold';
export type CardPayResult = { url: string } | { blocked: CardPayBlocked };

/** 家庭の画面に出してよい文を持つ失敗（Server Action はこの文だけを返す） */
export class RecitalPayError extends Error {
  constructor(public readonly code: 'not_found' | 'busy', message: string) {
    super(message);
    this.name = 'RecitalPayError';
  }
}
const notFound = () => new RecitalPayError('not_found', 'お申し込みが見つかりません');
const busy = () => new RecitalPayError('busy', 'もう一度押してください');

type OpenRow = { id: number; eventKey: string; amount: number; sessionId: string | null; createdAt: string };

async function readOpenRow(householdId: number): Promise<OpenRow | null> {
  const r = await getOne(
    "SELECT id, event_key, amount, stripe_session_id, created_at FROM recital_checkouts WHERE household_id = ? AND status = 'open' ORDER BY id LIMIT 1",
    [householdId],
  );
  if (!r) return null;
  const sid = r.stripe_session_id == null ? '' : String(r.stripe_session_id);
  return { id: Number(r.id), eventKey: String(r.event_key), amount: Number(r.amount), sessionId: sid === '' ? null : sid, createdAt: String(r.created_at) };
}

function isPastGrace(createdAt: string): boolean {
  const t = Date.parse(createdAt);
  return Number.isNaN(t) || Date.now() - t > CREATING_GRACE_MS;
}

/** 番号が空の行を閉じる（作っている途中のタブの行は閉じないため、60秒より前の物だけ） */
async function closeStaleEmptyRow(row: OpenRow): Promise<void> {
  if (row.sessionId != null || !isPastGrace(row.createdAt)) return;
  await execute("UPDATE recital_checkouts SET status = 'closed' WHERE id = ? AND status = 'open' AND stripe_session_id IS NULL", [row.id]);
}

/** 開いている画面を聞く・切る時の鍵：番号の頭（cs_test_／cs_live_）で選ぶ。分からない時だけ今の stripe_mode。
 *  作ったあとに stripe_mode を変えても、前の画面を聞けずに置き去りにしないため */
async function modeForRow(row: OpenRow, sessionId: string): Promise<RecitalStripeMode> {
  return stripeModeForSession(sessionId) ?? (await getRecitalSettings(row.eventKey)).stripe_mode;
}

function isUniqueViolation(e: unknown): boolean {
  const t = e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}` : String(e);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/.test(t);
}

// ---------- カードの入金を書く核（22 も使う） ----------

/**
 * カードの入金を1回だけ書く。同じ stripe_event_id・stripe_session_id・stripe_pi_id（空は除く）の入金があれば duplicate。
 * 書き込みの外で afterMoneyChanged → sendPaidMail（メールの失敗はログだけ）。
 */
async function recordCardPayment(x: {
  householdId: number; checkoutId: number | null; amount: number; source: 'stripe_webhook' | 'stripe_recheck';
  stripeEventId: string | null; stripeSessionId: string | null; stripePiId: string | null;
}): Promise<{ status: 'recorded'; paymentId: number } | { status: 'duplicate' }> {
  const keys: [string, string][] = [];
  for (const [col, v] of [['stripe_event_id', x.stripeEventId], ['stripe_session_id', x.stripeSessionId], ['stripe_pi_id', x.stripePiId]] as const) {
    if (typeof v === 'string' && v !== '') keys.push([col, v]);
  }
  let paymentId: number | null;
  try {
    paymentId = await withWriteTx(async (tx) => {
      if (keys.length > 0) {
        const dup = await tx.execute({
          sql: `SELECT id FROM recital_payments WHERE ${keys.map((k) => `${k[0]} = ?`).join(' OR ')} LIMIT 1`,
          args: keys.map((k) => k[1]),
        });
        if (dup.rows.length > 0) {
          // もう記録ずみ。開いている行が残って毎回聞きに行かないよう、行だけ paid にする
          if (x.checkoutId != null) {
            await tx.execute({ sql: "UPDATE recital_checkouts SET status = 'paid' WHERE id = ? AND status <> 'paid'", args: [x.checkoutId] });
          }
          return null;
        }
      }
      const r = await insertPaymentTx(
        tx,
        {
          householdId: x.householdId, method: 'card', amount: x.amount, paidOn: todayJst(), source: x.source,
          stripeEventId: x.stripeEventId, stripeSessionId: x.stripeSessionId, stripePiId: x.stripePiId,
        },
        'system',
      );
      if (x.checkoutId != null) {
        await tx.execute({ sql: "UPDATE recital_checkouts SET status = 'paid', stripe_pi_id = ? WHERE id = ?", args: [x.stripePiId, x.checkoutId] });
      }
      return r.paymentId;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { status: 'duplicate' };
    throw e;
  }
  if (paymentId == null) return { status: 'duplicate' };
  await afterMoneyChanged(x.householdId, 'payment');
  try {
    await sendPaidMail(x.householdId, paymentId, 'card');
  } catch (e) {
    console.error(`[recital] カードの入金のメールを送れませんでした household=${x.householdId}`, e instanceof Error ? e.message : String(e));
  }
  return { status: 'recorded', paymentId };
}

// ---------- 聞いて合わせる ----------

/** 開いている行を Stripe に聞いて合わせる。まだ Stripe で開いている時だけ、その行と状態を返す。聞けなかった時は throw */
async function syncOpenCheckout(householdId: number): Promise<{ row: OpenRow; state: RecitalCheckoutState } | null> {
  const row = await readOpenRow(householdId);
  if (!row) return null;
  if (row.sessionId == null) {
    await closeStaleEmptyRow(row);
    return null;
  }
  const state = await retrieveRecitalCheckout(await modeForRow(row, row.sessionId), row.sessionId);
  if (state.status === 'complete' && state.payment_status === 'paid') {
    if (state.amount_total == null || state.amount_total <= 0) throw new Error('recital_pay:no_amount');
    await recordCardPayment({
      householdId, checkoutId: row.id, amount: state.amount_total, source: 'stripe_recheck',
      stripeEventId: null, stripeSessionId: row.sessionId, stripePiId: state.payment_intent,
    });
    return null;
  }
  if (state.status === 'expired') {
    await execute("UPDATE recital_checkouts SET status = 'expired' WHERE id = ? AND status = 'open'", [row.id]);
    return null;
  }
  if (state.status === 'open') return { row, state };
  return null;
}

/** マイページを開いた時・「払う」の時に、開いている支払いを Stripe に聞く（R-43・R-98）。聞けなかった時は throw */
export async function syncCardCheckout(householdId: number): Promise<void> {
  await syncOpenCheckout(householdId);
}

// ---------- 切る ----------

/** 開いている行を closed にし、Stripe の画面も切る（切れなくても closed のまま。間に合わず払われた分は 22 が本物の額で受ける） */
export async function expireOpenCheckout(householdId: number, reason: string): Promise<void> {
  const row = await readOpenRow(householdId);
  if (!row) return;
  await execute("UPDATE recital_checkouts SET status = 'closed' WHERE id = ? AND status = 'open'", [row.id]);
  if (row.sessionId != null) {
    const ok = await expireRecitalCheckout(await modeForRow(row, row.sessionId), row.sessionId);
    if (!ok) console.error(`[recital] Stripe の決済の画面を切れませんでした household=${householdId} checkout=${row.id}`);
  }
  console.log(`[recital] カードの決済の画面を閉じました household=${householdId} checkout=${row.id} reason=${reason}`);
}

// ---------- 作る ----------

/**
 * 「カードで払う」。金額はその時の今の残り（印があれば 残り−印の金額）。開いている支払いは世帯に1つまで。
 * 止める時は { blocked }、決済の画面へ進む時は { url }。家庭に出せる失敗は RecitalPayError。
 */
export async function startCardPayment(
  token: string,
  opts: { confirmNotBank?: boolean; confirmTold?: boolean },
): Promise<CardPayResult> {
  // 1. 鍵の世帯
  const d = await requireHouseholdByToken(token);
  if (!d || d.household.status !== 'active') throw notFound();
  const h = d.household;
  const householdId = Number(h.id);

  // 2. 開いている行があれば先に聞く（throw はそのまま上へ）
  let stillOpen: { row: OpenRow; state: RecitalCheckoutState } | null = null;
  if (await readOpenRow(householdId)) stillOpen = await syncOpenCheckout(householdId);

  // 3. 読み直して、払えるか
  const s = await getRecitalSettings(h.event_key);
  const hm = await readHouseholdMoney(householdId);
  const state = payButtonState({ gate: payGate(s, Date.now()), view: hm.view, m: hm.m, refundTodo: hm.refundTodo });
  if (state === 'before' || state === 'preparing') return { blocked: 'not_open' };
  if (state === 'refund_hold') return { blocked: 'refund_hold' };
  if (state === 'hidden') return { blocked: 'nothing_due' };

  // 4. 振込の印・振込を選んだ世帯（K204・K194）
  if (hm.told && !opts.confirmTold) return { blocked: 'told_open' };
  if (!hm.told && hm.payMethod === 'bank' && !opts.confirmNotBank) return { blocked: 'ask_bank' };

  // 5. 金額
  const amount = payableAmount(hm.m, hm.told);
  if (amount <= 0) return { blocked: 'nothing_due' };

  // 6. 開いている行：同じ額で Stripe が開いていればその画面。ちがえば切る。作っている途中の行があれば作らない
  const open = await readOpenRow(householdId);
  if (open) {
    if (open.sessionId != null) {
      if (stillOpen && stillOpen.row.id === open.id && open.amount === amount && stillOpen.state.status === 'open' && stillOpen.state.url) {
        return { url: stillOpen.state.url };
      }
      await expireOpenCheckout(householdId, 'amount_changed');
    } else if (isPastGrace(open.createdAt)) {
      await closeStaleEmptyRow(open);
    } else {
      throw busy();
    }
  }

  // 7. 開いている行を入れる（部分一意で1つまで）。読んだあと（6 で Stripe を待つ間など）に入金や合計が変わっていたら、
  //    古い額で作らないよう書き込みの中で読み直し、ちがえば入れずに「もう一度押してください」
  const expiresAtSec = Math.floor(Date.now() / 1000) + RECITAL_CHECKOUT_MINUTES * 60;
  let checkoutId: number;
  try {
    checkoutId = await withWriteTx(async (tx) => {
      const cur = await readHouseholdMoneyTx(tx, householdId);
      if (payableAmount(cur.m, cur.told) !== amount) throw busy();
      const ins = await tx.execute({
        sql: "INSERT INTO recital_checkouts (event_key, household_id, amount, status, created_at, expires_at) VALUES (?, ?, ?, 'open', ?, ?)",
        args: [h.event_key, householdId, amount, nowUtcIso(), new Date(expiresAtSec * 1000).toISOString()],
      });
      await tx.execute({ sql: "UPDATE recital_households SET pay_method = 'card' WHERE id = ?", args: [householdId] });
      return Number(ins.lastInsertRowid);
    });
  } catch (e) {
    if (e instanceof RecitalPayError) throw e;
    if (isUniqueViolation(e)) throw busy();
    throw e;
  }

  // 8. 書き込みの外で Stripe に作らせ、まだ開いている行にだけ番号を書く（生きている決済の画面はいつも1つまで）
  const myUrl = recitalMyUrl(token);
  const params = buildRecitalCheckoutParams({
    eventKey: h.event_key, householdId, checkoutId, amount, email: h.email, refCode: h.ref_code,
    successUrl: `${myUrl}&paid=1`, cancelUrl: myUrl, expiresAt: expiresAtSec,
  });
  let session: { id: string; url: string };
  try {
    session = await createRecitalCheckout(s.stripe_mode, params);
  } catch (e) {
    await execute("UPDATE recital_checkouts SET status = 'closed' WHERE id = ? AND status = 'open'", [checkoutId]);
    throw e;
  }
  let changed = 0;
  try {
    changed = (await execute("UPDATE recital_checkouts SET stripe_session_id = ? WHERE id = ? AND status = 'open'", [session.id, checkoutId])).rowsAffected;
  } catch (e) {
    await expireRecitalCheckout(s.stripe_mode, session.id);
    throw e;
  }
  if (changed === 0) {
    await expireRecitalCheckout(s.stripe_mode, session.id);
    throw busy();
  }
  return { url: session.url };
}

// ---------- 銀行振込（Task 23） ----------

export type BankChooseResult = { ok: true } | { blocked: 'not_open' | 'no_bank_text' | 'nothing_due' };

/**
 * 「払う」で銀行振込を選ぶ（04 4-2・D5 2-24・K210）。鍵が open でない → not_open／bank_text が空 → no_bank_text／
 * 払う額（印があれば 残り−印の金額）が0以下 → nothing_due。選べたら pay_method=bank にし、書き込みの外で
 * 開いているカードの画面を切り、ご案内のメールを出す（同じ金額のご案内を続けて2回は出さないのは 10 の中）。鍵の合わない世帯は throw。
 */
export async function chooseBankTransfer(token: string): Promise<BankChooseResult> {
  const d = await requireHouseholdByToken(token);
  if (!d || d.household.status !== 'active') throw notFound();
  const h = d.household;
  const householdId = Number(h.id);
  const s = await getRecitalSettings(h.event_key);
  if (payGate(s, Date.now()) !== 'open') return { blocked: 'not_open' };
  if (s.bank_text.trim() === '') return { blocked: 'no_bank_text' };
  const hm = await readHouseholdMoney(householdId);
  if (payableAmount(hm.m, hm.told) <= 0) return { blocked: 'nothing_due' };
  await execute("UPDATE recital_households SET pay_method = 'bank' WHERE id = ? AND status = 'active'", [householdId]);
  await expireOpenCheckout(householdId, 'bank_chosen');
  try {
    await maybeResendBankGuide(householdId);
  } catch (e) {
    // 払い方はもう変わっている。ご案内の画面はいつも出るので、メールの失敗はログだけ
    console.error(`[recital] お振込みのご案内を出せませんでした household=${householdId}`, e instanceof Error ? e.message : String(e));
  }
  return { ok: true };
}

export type BankToldInput = { date: string; name: string; amount: number };

/**
 * 「振り込みました」の印（家庭・スタッフ。D5 2-20・K204）。形がおかしい入力（日の形・空白だけの名前・1以上の整数でない金額）と、
 * 有効でない世帯は throw。今日（JST）より先の日 → future／残りが0 → nothing_due。
 * 印が無ければ5列を入れる。あれば日・名前・金額だけ直す（押した時・だれが押したかは変えない）。
 * 変えた記録には前とあとの { date, amount, by } だけを残す（名前は入れない。R-18）。書き込みの外で開いているカードの画面を切る。メールは出さない。
 */
export async function markBankTold(
  householdId: number,
  x: BankToldInput,
  by: 'family' | 'staff',
  actor: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; code?: 'future' | 'nothing_due' }> {
  if (!Number.isInteger(householdId)) throw new Error('recital_pay:bad_input');
  if (!x || !isIsoDate(x.date)) throw new Error('recital_pay:bad_input');
  if (typeof x.name !== 'string' || x.name.trim() === '') throw new Error('recital_pay:bad_input');
  if (!Number.isInteger(x.amount) || x.amount < 1) throw new Error('recital_pay:bad_input');
  if (by !== 'family' && by !== 'staff') throw new Error('recital_pay:bad_input');
  if (typeof actor !== 'string' || actor.trim() === '') throw new Error('recital_pay:bad_input');
  if (x.date > todayJst(now)) return { ok: false, code: 'future' };
  const name = x.name.trim();

  const r = await withWriteTx(async (tx) => {
    const hr = await tx.execute({ sql: 'SELECT event_key, status FROM recital_households WHERE id = ?', args: [householdId] });
    const h = hr.rows[0];
    if (!h || String(h.status) !== 'active') throw new Error('recital_pay:bad_input');
    const cur = await readHouseholdMoneyTx(tx, householdId);
    if (cur.m.remaining <= 0) return { ok: false as const, code: 'nothing_due' as const };
    let after: { date: string; amount: number; by: 'family' | 'staff' };
    if (cur.told == null) {
      await tx.execute({
        sql: `UPDATE recital_households SET bank_told_at = ?, bank_told_date = ?, bank_told_name = ?, bank_told_amount = ?, bank_told_by = ?
              WHERE id = ?`,
        args: [nowUtcIso(now), x.date, name, x.amount, by, householdId],
      });
      after = { date: x.date, amount: x.amount, by };
    } else {
      await tx.execute({
        sql: 'UPDATE recital_households SET bank_told_date = ?, bank_told_name = ?, bank_told_amount = ? WHERE id = ?',
        args: [x.date, name, x.amount, householdId],
      });
      after = { date: x.date, amount: x.amount, by: cur.told.by };
    }
    await logChangeTx(tx, {
      eventKey: String(h.event_key), householdId, action: 'bank_told', actor,
      before: cur.told == null ? null : { date: cur.told.date, amount: cur.told.amount, by: cur.told.by },
      after,
    });
    return { ok: true as const };
  });
  if (!r.ok) return r;
  // 二重払いを止めるため、開いているカードの画面を切る（家庭が次に「カードで払う」を押せば、確かめのあと作り直す）
  await expireOpenCheckout(householdId, 'bank_told');
  return { ok: true };
}

// ---------- Stripe の知らせ（Task 22） ----------

export type RecitalWebhookApplyResult = {
  status: 'paid' | 'duplicate' | 'expired' | 'acked' | 'mode_mismatch' | 'not_found'; householdId?: number; paymentId?: number;
};

/**
 * まとめた世帯なら、まとめ先（同じ発表会の世帯）をたどる。たどれなければ、たどれた所まで。
 * reachedActive は、たどった先が active の世帯の時だけ true（別の発表会・輪・10段をこえた・まとめ先が無い時は false）
 */
async function resolveMergedTarget(householdId: number, eventKey: string): Promise<{ id: number; reachedActive: boolean }> {
  let cur = householdId;
  const seen = new Set<number>([cur]);
  for (let i = 0; i <= 10; i++) {
    const h = await getOne('SELECT status, merged_into FROM recital_households WHERE id = ?', [cur]);
    if (!h) return { id: cur, reachedActive: false };
    if (String(h.status) !== 'merged') return { id: cur, reachedActive: String(h.status) === 'active' };
    if (h.merged_into == null || i === 10) break;
    const next = Number(h.merged_into);
    if (!Number.isInteger(next) || seen.has(next)) break;
    const t = await getOne('SELECT event_key FROM recital_households WHERE id = ?', [next]);
    if (!t || String(t.event_key) !== eventKey) break;
    seen.add(next);
    cur = next;
  }
  return { id: cur, reachedActive: false };
}

/** TARO に知らせる（題・本文に名前と金額を書かない）。知らせの失敗はログだけ */
async function tellTaro(subject: string, body: string, eventId: string): Promise<void> {
  try {
    await notifyTaro({ subject, body, subjectPrefix: '【BOOM】BW6' });
  } catch {
    console.error(`[recital] カードの知らせについて TARO に知らせられませんでした event=${eventId}`);
  }
}

const idsLine = (ev: RecitalWebhookEvent) => `知らせの番号 ${ev.eventId}・世帯の番号 ${ev.householdId}`;

/** 知らせの決済の画面の行。番号（stripe_session_id）で、こちらの状態（open・closed・expired）に関わらず引く。無ければ印の checkout の番号 */
async function findCheckoutRow(ev: RecitalWebhookEvent): Promise<{ id: number; amount: number } | null> {
  let r = ev.sessionId == null
    ? null
    : await getOne('SELECT id, amount FROM recital_checkouts WHERE stripe_session_id = ? AND household_id = ?', [ev.sessionId, ev.householdId]);
  if (!r && ev.checkoutId != null) {
    r = await getOne(
      'SELECT id, amount FROM recital_checkouts WHERE id = ? AND household_id = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?)',
      [ev.checkoutId, ev.householdId, ev.sessionId ?? ''],
    );
  }
  return r ? { id: Number(r.id), amount: Number(r.amount) } : null;
}

/**
 * 発表会の Stripe の知らせを1つ当てる。順：世帯 → 試し・本番 → 払い終わった完了（本物の額で記録）→ 切れた → ほか（受けるだけ）。
 * 払い終わった完了は、こちらで行を閉じたあとでも記録する（払っている間に閉じた時も、お金は本物なので落とさない）。
 * 金額の無い完了は throw（Stripe に送り直させる）。
 */
export async function applyRecitalWebhookEvent(ev: RecitalWebhookEvent): Promise<RecitalWebhookApplyResult> {
  // 払い終わった完了の知らせを記録できない時は、200 で受けたうえで TARO に知らせる（お金を黙って落とさない）
  const paidCompleted = ev.type === 'checkout.session.completed' && ev.paymentStatus === 'paid';

  // 1. 世帯（まとめた世帯なら、まとめ先に記録する）
  const h = await getOne('SELECT id, event_key, status FROM recital_households WHERE id = ?', [ev.householdId]);
  if (!h || String(h.event_key) !== ev.eventKey) {
    console.error(`[recital] カードの知らせの世帯が見つかりません household=${ev.householdId} event=${ev.eventId}`);
    if (paidCompleted) await tellTaro('カードの入金を記録できませんでした（世帯が見つからない）', idsLine(ev), ev.eventId);
    return { status: 'not_found' };
  }
  let householdId = ev.householdId;
  let mergeBroken = false;
  if (String(h.status) === 'merged') {
    const t = await resolveMergedTarget(ev.householdId, ev.eventKey);
    householdId = t.id;
    mergeBroken = !t.reachedActive;
    console.error(`[recital] まとめた世帯へのカードの知らせを、まとめ先に当てます household=${ev.householdId} target=${householdId} event=${ev.eventId}${mergeBroken ? ' (まとめ先をたどれない)' : ''}`);
  }

  // 2. 試し・本番（K130 の守りはここ1か所）
  const mode = (await getRecitalSettings(ev.eventKey)).stripe_mode;
  if ((mode === 'live' && !ev.livemode) || (mode !== 'live' && ev.livemode)) {
    console.error(`[recital] カードの知らせの試し・本番が設定とちがいます household=${ev.householdId} event=${ev.eventId} livemode=${ev.livemode}`);
    if (paidCompleted) await tellTaro('カードの入金を記録できませんでした（設定とちがう）', idsLine(ev), ev.eventId);
    return { status: 'mode_mismatch', householdId };
  }

  // 3. 払い終わった完了：本物の額で1回だけ記録
  if (paidCompleted) {
    const amount = ev.amountTotal;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) throw new Error('recital_pay:no_amount');
    const row = await findCheckoutRow(ev);
    const r = await recordCardPayment({
      householdId, checkoutId: row?.id ?? null, amount, source: 'stripe_webhook',
      stripeEventId: ev.eventId, stripeSessionId: ev.sessionId, stripePiId: ev.piId,
    });
    if (r.status === 'duplicate') return { status: 'duplicate', householdId };
    // まとめ先を active の世帯までたどれない時は、たどれた所に記録したうえで知らせる（見る人が世帯を直す。送り直しで2回知らせないよう記録のあと）
    if (mergeBroken) {
      await tellTaro('まとめた世帯のまとめ先をたどれませんでした（カードの入金はたどれた所の世帯に記録）', `${idsLine(ev)}・記録した世帯の番号 ${householdId}`, ev.eventId);
    }
    if (row && row.amount !== amount) {
      console.error(`[recital] カードの入金の額が決済の画面の額とちがいます household=${householdId} checkout=${row.id} checkout_amount=${row.amount} stripe_amount=${amount}`);
    }
    return { status: 'paid', householdId, paymentId: r.paymentId };
  }

  // 4. 切れた
  if (ev.type === 'checkout.session.expired') {
    if (ev.sessionId != null) {
      await execute(
        "UPDATE recital_checkouts SET status = 'expired' WHERE stripe_session_id = ? AND household_id = ? AND status = 'open'",
        [ev.sessionId, ev.householdId],
      );
    }
    return { status: 'expired', householdId };
  }

  // 5. ほか（払い済みでない完了・payment_intent.*・charge.*）は受けるだけ。charge.* の自動の記録（異議）は後の計画
  return { status: 'acked', householdId };
}

/**
 * 2つの受け口（本番の鍵・試しの鍵）が呼ぶ。発表会の知らせでなければ { handled: false }（今の流れへ）。throw しない。
 * 当てるのに失敗したら TARO に知らせて 500（Stripe が送り直す）。記録とメールは「書く核」の中（メールの失敗は 200 のまま）。
 */
export async function handleRecitalWebhook(
  event: unknown,
): Promise<{ handled: false } | { handled: true; httpStatus: 200 | 500; result: string }> {
  const ev = parseRecitalWebhookEvent(event);
  if (!ev) return { handled: false };
  try {
    const r = await applyRecitalWebhookEvent(ev);
    return { handled: true, httpStatus: 200, result: `recital_${r.status}` };
  } catch (e) {
    console.error(`[recital] カードの知らせを記録できませんでした event=${ev.eventId}`, e instanceof Error ? e.message : String(e));
    await tellTaro('カードの入金の記録に失敗しました', 'Stripe が送り直します。知らせの番号 ' + ev.eventId, ev.eventId);
    return { handled: true, httpStatus: 500, result: 'recital_apply_failed' };
  }
}
