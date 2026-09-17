// 当日オペの合図を1往復で取る。計算は bf6Pulse.ts、ここは問い合わせだけ。
//
// ⚠️ 端末3〜4台が2秒おきに叩く。テーブルごとに問い合わせると1回で9往復になるので、
//    サブクエリを1本のSELECTにまとめて必ず1往復にすること。
//
// ⚠️ 件数だけでは足りない。上書き更新(勝者が決まる・集金でpaidになる・写真を撮り直す)は
//    行が増えないため、件数に加えて「状態を表す値」も混ぜている。
import { getOne } from './db';
import { pulseToken } from './bf6Pulse';

export async function getBf6Pulse(): Promise<string> {
  const row = await getOne(
    `SELECT
       (SELECT COUNT(*) FROM bf_checkin)                                        AS checkin,
       (SELECT COUNT(item_id) FROM bf_draw)                                     AS draw,
       (SELECT COUNT(*) FROM bf_qualifier)                                      AS qualifier,
       -- 勝者が入ると行は増えず winner_slot だけ埋まる
       (SELECT COUNT(*) || '/' || COUNT(winner_slot) FROM bf_match)             AS match_,
       -- 撮り直しは同じ item_id を上書きするので件数が変わらない
       (SELECT COUNT(*) || '/' || COALESCE(MAX(created_at), '') FROM bf_photo)  AS photo,
       (SELECT COUNT(*) || '/' || COALESCE(SUM(handed), 0) || '/' ||
               COALESCE(MAX(updated_at), '') FROM bf_gate_entry)                AS gate,
       (SELECT COUNT(*) || '/' || COALESCE(SUM(amount), 0) FROM bf_cash_collect) AS cash,
       -- 集金すると cash_due → paid に変わる(行は増えない)
       (SELECT COUNT(*) FROM bf_orders WHERE payment_status = 'paid')           AS paid,
       (SELECT rev FROM bf_screen_state WHERE id = 1)                           AS screen`
  ).catch(() => null);

  // 会場の回線が一瞬切れても画面を壊さない。取れなければ「変化なし」と同じ扱いにする。
  if (!row) return '';
  return pulseToken({
    checkin: row.checkin as number,
    draw: row.draw as number,
    qualifier: row.qualifier as number,
    match: row.match_ as string,
    photo: row.photo as string,
    gate: row.gate as string,
    cash: row.cash as string,
    paid: row.paid as number,
    screen: row.screen as number | null,
  });
}
