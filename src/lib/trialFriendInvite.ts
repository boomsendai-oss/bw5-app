/**
 * 体験予約の「お友だち相乗り」検出（2026-11-15 TARO決定・業務ルール §7）。
 *
 * 1つのLINE（友だちID）で予約できるのは本人と家族（兄弟・双子）まで。お友だちは
 * 自分のLINEから予約してもらう（フォロー・入会特典・紹介記録が本人に届くため）。
 * そこで「同じ友だちID × 同じ枠（同じ日時）に、名字の違う申込者がいる」予約を検出し、
 * 予約した本人へ「お友だちにも公式LINE登録を伝えてね」の個別メッセージを1回だけ送る。
 * 予約は取り消さない。
 *
 * 判定は保守的に倒す（誤送信＝兄弟の親に不要な案内が行くのを避ける）:
 *   - カナ名の先頭が1文字でも共有していれば同姓扱い（＝送らない）。
 *   - カナが無ければ漢字名の先頭で判定。どちらも足りなければ別姓と断定しない。
 *   - 別姓と断定できる組が1組でもあれば、その枠を候補にする。
 */

/** 友だち追加リンク（BOOM公式LINE）。guide/mocchin 等と同じ。 */
export const BOOM_OFFICIAL_LINE_URL = 'https://lin.ee/4EYB9zZ';

/**
 * 予約した本人へ送る固定文（2026-11-15 TARO承認・一字一句このまま）。
 * ※「予約のやり直し」は頼まない（予約は取り消さない方針）。
 */
export const FRIEND_INVITE_MESSAGE = [
  'ご予約ありがとうございます😊',
  'お友だちとご一緒にご参加の場合は、お友だちの方にもBOOMの公式LINEにご登録いただけると、当日のご案内や体験後の入会特典を直接お届けできます✨',
  'お手数ですが、こちらのリンクをお友だちにお伝えいただけますと幸いです🙇',
  BOOM_OFFICIAL_LINE_URL,
].join('\n');

export type CobookingRow = {
  lstep_id: string | null;
  reserved_at: string;
  lesson_name: string | null;
  status: string;
  applicant_name: string | null;
  applicant_name_kana: string | null;
  applicant_age: number | null;
};

export type CobookingCandidate = {
  lstep_id: string;
  reserved_at: string;
  lesson_name: string | null;
  applicants: {
    applicant_name: string | null;
    applicant_name_kana: string | null;
    applicant_age: number | null;
  }[];
};

/** 来ない予約（キャンセル・ノーショー）は数えない。実際に来る予約だけ。 */
const ACTIVE_STATUS = new Set(['予約済', '来店確認済']);

/** 先頭から一致する文字数。 */
export function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

const normalize = (s: string | null | undefined): string => (s ?? '').replace(/[\s　]/g, '').trim();

/**
 * 2人が「別の名字（別世帯）」と断定できるか。保守的: 先頭1文字でも共有なら false。
 * カナが両方あればカナ、無ければ漢字名で比較。情報不足なら false（送らない側に倒す）。
 */
export function likelyDifferentFamily(
  aName: string | null | undefined,
  aKana: string | null | undefined,
  bName: string | null | undefined,
  bKana: string | null | undefined,
): boolean {
  const naK = normalize(aKana);
  const nbK = normalize(bKana);
  const useKana = naK.length > 0 && nbK.length > 0;
  const x = useKana ? naK : normalize(aName);
  const y = useKana ? nbK : normalize(bName);
  if (!x || !y) return false; // 判定材料が足りない → 断定しない
  return commonPrefixLen(x, y) === 0;
}

/**
 * 「同じ友だちID × 同じ枠」で名字の違う申込者がいる予約を検出する。
 * 戻り値は枠ごとに1件（送信先＝その友だちID＝予約した本人）。
 */
export function detectFriendCobookings(rows: CobookingRow[]): CobookingCandidate[] {
  const groups = new Map<string, CobookingRow[]>();
  for (const r of rows) {
    if (!r.lstep_id) continue;
    if (!ACTIVE_STATUS.has((r.status ?? '').trim())) continue;
    const key = `${r.lstep_id}\u0000${r.reserved_at}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const out: CobookingCandidate[] = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    let differs = false;
    for (let i = 0; i < arr.length && !differs; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        if (
          likelyDifferentFamily(
            arr[i].applicant_name,
            arr[i].applicant_name_kana,
            arr[j].applicant_name,
            arr[j].applicant_name_kana,
          )
        ) {
          differs = true;
          break;
        }
      }
    }
    if (!differs) continue;
    out.push({
      lstep_id: arr[0].lstep_id as string,
      reserved_at: arr[0].reserved_at,
      lesson_name: arr[0].lesson_name,
      applicants: arr.map((a) => ({
        applicant_name: a.applicant_name,
        applicant_name_kana: a.applicant_name_kana,
        applicant_age: a.applicant_age,
      })),
    });
  }
  return out;
}
