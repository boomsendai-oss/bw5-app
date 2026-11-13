// クチコミ声がけ: 「次にお願いする家族」を選ぶ決まり (2026-11-10 TARO決定)
//
// - 送り方: TAROの個人LINEから5家族ずつ・週2〜3回 (M5セッションが tools/line_mac_send で送る)
// - 対象: 入会して30日以上 かつ 来館2回以上。体験当日にはお願いしない(TARO: 変なことを書かれる恐れ)
// - 呼び名: 子どもの家族は「(子の名前ひらがな)ママ」(TARO指定: 「〜ちゃんママ」「〜くんママ」ではない)
//           大人の会員は「(姓)さん」。決められない家族は自動では選ばない
// - 純関数のみ(DBは呼び出し側)。画面(/staff/review-outreach)と M5用スクリプト
//   (scripts/review-outreach-next.mjs)の両方がこのファイルを使う。

export const PICK_RULES = {
  minDaysSinceEnroll: 30,
  minCheckins: 2,
  batchSize: 5,
  adultAge: 18,
} as const;

export const REVIEW_LINK = 'https://g.page/r/CYUIsn9ZQ3TBEAE/review';
export const REVIEW_TARGET = 100;

export type OutreachMember = { name: string; kana: string | null; birthday: string | null };
export type OutreachLineLink = { relation: string; lineName: string | null };

export type OutreachCandidate = {
  familyKey: number;
  familyName: string;
  /** 在籍中の会員。並びは会員番号(id)の小さい順 */
  members: OutreachMember[];
  lineLinks: OutreachLineLink[];
  /** 家族の中で最も早い入会日時 */
  enrolledAt: string | null;
  /** 家族全員のチェックイン回数の合計 */
  checkins: number;
  lastCheckin: string | null;
  isInstructorFamily: boolean;
  askedAt: string | null;
  postedAt: string | null;
  /** gbp_review_family で「確実」「たぶん」に紐付いた口コミがある */
  hasMatchedReview: boolean;
  /** TAROが「この家族には送らない」と決めた日時(恒久的に候補から外す・2026-11-13〜) */
  excludedAt?: string | null;
};

export function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function ageOn(birthday: string, todayIso: string): number {
  const [by, bm, bd] = birthday.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = todayIso.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

function isAdult(m: OutreachMember, todayIso: string): boolean {
  if (!m.birthday) return false;
  return ageOn(m.birthday, todayIso) >= PICK_RULES.adultAge;
}

function givenKana(kana: string | null): string | null {
  if (!kana) return null;
  const parts = kana.trim().split(/[\s　]+/);
  return parts.length >= 2 ? parts[parts.length - 1] : null;
}

function surname(name: string): string | null {
  const parts = name.trim().split(/[\s　]+/);
  return parts.length >= 2 ? parts[0] : null;
}

/** 1行目の呼び名。決められないときは null */
export function greetingFor(c: OutreachCandidate, todayIso: string): string | null {
  const children = c.members.filter((m) => !isAdult(m, todayIso));
  const hasGuardianLine = c.lineLinks.some((l) => l.relation === '保護者');
  if (children.length > 0) {
    if (!hasGuardianLine) return null;
    const g = givenKana(children[0].kana);
    return g ? `${kataToHira(g)}ママ` : null;
  }
  const hasSelfLine = c.lineLinks.some((l) => l.relation === '本人');
  if (!hasSelfLine || c.members.length === 0) return null;
  const s = surname(c.members[0].name);
  return s ? `${s}さん` : null;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(toIso + 'T00:00:00Z');
  return Math.floor((b - a) / 86400000);
}

export function isEligible(c: OutreachCandidate, todayIso: string): boolean {
  if (c.askedAt || c.postedAt || c.hasMatchedReview) return false;
  if (c.excludedAt) return false;
  if (c.isInstructorFamily) return false;
  if (c.lineLinks.length === 0) return false;
  if (!c.enrolledAt || !c.enrolledAt.trim()) return false;
  if (daysBetween(c.enrolledAt, todayIso) < PICK_RULES.minDaysSinceEnroll) return false;
  if (c.checkins < PICK_RULES.minCheckins) return false;
  return greetingFor(c, todayIso) !== null;
}

/** 対象の家族を「最終来館が新しい順 → 来館回数の多い順 → 家族番号の小さい順」で最大n件 */
export function pickNextFamilies(
  cands: OutreachCandidate[],
  todayIso: string,
  n: number = PICK_RULES.batchSize
): OutreachCandidate[] {
  return cands
    .filter((c) => isEligible(c, todayIso))
    .sort(
      (a, b) =>
        (b.lastCheckin ?? '').localeCompare(a.lastCheckin ?? '') ||
        b.checkins - a.checkins ||
        a.familyKey - b.familyKey
    )
    .slice(0, n);
}

/** TAROが2026-07に送った文面がベース(2026-11-10 TARO確認済み)。件数だけ毎回差し込む */
export function buildReviewRequest(greeting: string, reviewCount: number): string {
  return [
    `${greeting}お疲れ様です🙇`,
    '',
    'ちょっとお願いがあるのですが良いでしょうか？？💦',
    '',
    '今年から数年、BOOMとしては攻めの年になると思ってて、告知宣伝に力を入れたく、可能であればgoogleの口コミ投稿にご協力いただけないでしょうか？😭',
    '',
    '一言でも良いですし、星も5じゃなくても良いです',
    '',
    `東北一のダンススクールを目指していまして、現在${reviewCount}件。目標は${REVIEW_TARGET}件です！`,
    '',
    'お手数かと思いますが、2,3分で済みますので何卒よろしくお願いします！！🙇🙇🙇',
    '',
    REVIEW_LINK,
    '',
    '↑こちらから可能です〜！',
    'もうすでに書いてくださっていたら、本当にありがとうございます！その場合はスルーしてください🙏',
  ].join('\n');
}

type QueryFn = (sql: string, args?: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * DBから候補を組み立てる。家族の単位と家族番号は /staff/review-outreach と同じ
 * (保護者名 rep_name、無ければ本人名。番号は同名の全会員(退会含む)の最小id)。
 */
export async function loadOutreachCandidates(query: QueryFn): Promise<OutreachCandidate[]> {
  const members = await query(
    `SELECT bm.id, bm.full_name, bm.full_name_kana, bm.birthday, bm.enrolled_at,
            COALESCE(NULLIF(TRIM(bm.rep_name), ''), bm.full_name) AS fam_name,
            (SELECT COUNT(*) FROM hacomono_reservations r
               WHERE r.boom_member_id = bm.id AND r.status = 'チェックイン') AS checkins,
            (SELECT MAX(r.lesson_date) FROM hacomono_reservations r
               WHERE r.boom_member_id = bm.id AND r.status = 'チェックイン') AS last_checkin
     FROM boom_members bm
     WHERE bm.status = 'active' AND bm.member_type IN ('regular', 'college', 'ticket')
     ORDER BY bm.id`
  );
  const keys = await query(
    `SELECT COALESCE(NULLIF(TRIM(rep_name), ''), full_name) AS fam_name, MIN(id) AS min_id
     FROM boom_members GROUP BY fam_name`
  );
  const links = await query(
    `SELECT l.member_id, l.relation, f.line_register_name
     FROM member_lstep_links l LEFT JOIN lstep_friends f ON f.lstep_id = l.lstep_id
     WHERE COALESCE(f.blocked, 0) = 0`
  );
  const outreach = await query(`SELECT family_key, asked_at, posted_at, excluded_at FROM review_outreach`);
  const matched = await query(
    `SELECT DISTINCT family_key FROM gbp_review_family
     WHERE family_key IS NOT NULL AND confidence IN ('確実', 'たぶん')`
  );

  const keyByFam = new Map(keys.map((r) => [String(r.fam_name), Number(r.min_id)]));
  const linksByMember = new Map<number, Record<string, unknown>[]>();
  for (const l of links) {
    const id = Number(l.member_id);
    linksByMember.set(id, [...(linksByMember.get(id) ?? []), l]);
  }
  const stateByKey = new Map(outreach.map((o) => [Number(o.family_key), o]));
  const matchedKeys = new Set(matched.map((m) => Number(m.family_key)));

  const fams = new Map<string, OutreachCandidate>();
  for (const m of members) {
    const famName = String(m.fam_name);
    let c = fams.get(famName);
    if (!c) {
      const key = keyByFam.get(famName) ?? Number(m.id);
      const st = stateByKey.get(key);
      c = {
        familyKey: key,
        familyName: famName,
        members: [],
        lineLinks: [],
        enrolledAt: null,
        checkins: 0,
        lastCheckin: null,
        isInstructorFamily: false,
        askedAt: (st?.asked_at as string | null) ?? null,
        postedAt: (st?.posted_at as string | null) ?? null,
        excludedAt: (st?.excluded_at as string | null) ?? null,
        hasMatchedReview: matchedKeys.has(key),
      };
      fams.set(famName, c);
    }
    c.members.push({
      name: String(m.full_name),
      kana: (m.full_name_kana as string | null) ?? null,
      birthday: (m.birthday as string | null) ?? null,
    });
    const enrolled = (m.enrolled_at as string | null) ?? null;
    if (enrolled && enrolled.trim() && (!c.enrolledAt || enrolled < c.enrolledAt)) c.enrolledAt = enrolled;
    c.checkins += Number(m.checkins ?? 0);
    const last = (m.last_checkin as string | null) ?? null;
    if (last && (!c.lastCheckin || last > c.lastCheckin)) c.lastCheckin = last;
    for (const l of linksByMember.get(Number(m.id)) ?? []) {
      if (l.relation === '講師') c.isInstructorFamily = true;
      c.lineLinks.push({
        relation: String(l.relation),
        lineName: (l.line_register_name as string | null) ?? null,
      });
    }
  }
  return [...fams.values()];
}
