// BW6 発表会（段階1）の入金を当てる計算。銀行の入金の行が、どの世帯の入金かを決める。
// 純関数。DB にさわらない。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 決まりの正本は設計書 05 5-6（D5 2-19・2-23、K147〜K151・K191・K199・K203・K216）。
// 自動で当てるのは、番号・金額・姓が全部合う時だけ（番号の検査の数字が1けたの打ちまちがいを防ぐ）。
// 姓が合うだけ・金額が合うだけでは当てない。ほかは「見てほしい入金」に回して候補を出す。
import { FIRST5_LIMIT, type HouseholdView } from '@/lib/recital';
import { isValidRef, REF_SEPARATORS } from '@/lib/recitalRef';

export type ReviewKind = 'unread' | 'manual' | 'no_ref' | 'bad_ref' | 'gone' | 'paid' | 'sum' | 'short' | 'over' | 'name' | 'first5';
export type MatchHousehold = { id: number; refCode: string; status: 'active' | 'merged'; mergedInto: number | null; view: HouseholdView; remaining: number; totalBeforeLastDrop: number | null; surnamesKana: string[]; told: { date: string; name: string | null; amount: number } | null };
export type MatchRow = { id: number; source: string; dir: string; kind: string; amount: number; remainingOfRow: number; refRead: string | null; refOk: number; nameRaw: string; unread: string | null; cut: number; checkFlag: string | null; rowDate: string };
export type Candidate = { householdId: number; why: ('ref' | 'told' | 'amount' | 'surname' | 'sum' | 'before_drop')[]; top: boolean };

type Why = Candidate['why'][number];
type Decision = { auto: true; householdId: number } | { auto: false; reviewKind: ReviewKind | null; householdId: number | null };

/** 足すとぴったりを試す、同じ番号のまだ当てていない入金の数の上限。こえたら sum にしない */
const SUM_MAX_OPEN = 10;
/** 「振り込みました」の印の日が、行の日から前後何日までなら近いとみるか（U43 で TARO が変えると言えばここだけ直す） */
const TOLD_NEAR_DAYS = 3;
const CAND_MAX = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const SMALL_KANA: Record<string, string> = { ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ', ヵ: 'カ', ヶ: 'ケ' };

/** 姓・名義のそろえ方：NFKC → 空白を取る → ひらがなをカタカナに → 小さいカナを大きく → 長音（ー・-）を取る。ヅ/ズは同じにしない */
function norm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[ァィゥェォッャュョヮヵヶ]/g, (ch) => SMALL_KANA[ch])
    .replace(/[ー-]/g, '');
}

const escapeForClass = (s: string) => s.replace(/[\\\]\[^\-]/g, (ch) => `\\${ch}`);
/** 「振り込みました」の名義の頭の番号と区切り（Task 4 の REF_SEPARATORS）と空白 */
const TOLD_HEAD = new RegExp(`^[\\s]*\\d*[${escapeForClass(REF_SEPARATORS)}\\s]*`);

export function surnameMatches(nameRaw: string, surnamesKana: string[], toldName: string | null): boolean {
  const name = norm(nameRaw);
  if (surnamesKana.some((s) => {
    const n = norm(s);
    return n !== '' && name.startsWith(n);
  })) return true;
  if (toldName === null) return false;
  const told = norm(toldName.normalize('NFKC').replace(TOLD_HEAD, ''));
  return told !== '' && told === name;
}

/** amounts の空でない部分和のどれかが target か（全部の組を試す） */
function someSubsetSums(amounts: number[], target: number): boolean {
  if (amounts.length === 0 || amounts.length > SUM_MAX_OPEN) return false;
  for (let mask = 1; mask < 1 << amounts.length; mask++) {
    let s = 0;
    for (let i = 0; i < amounts.length; i++) if (mask & (1 << i)) s += amounts[i];
    if (s === target) return true;
  }
  return false;
}

/** 1行を決める。上から見て最初に当たった物を返す（K149）。比べるのは今の残りと、行ののこりの額 */
export function decideRow(row: MatchRow, byRef: Map<string, MatchHousehold>, ctx: { first5Done: number; firstOk: boolean; sameRefOpenAmounts: number[] }): Decision {
  const amt = row.remainingOfRow;
  const h = row.refRead ? byRef.get(row.refRead) : undefined;
  const review = (reviewKind: ReviewKind | null, householdId: number | null = h ? h.id : null): Decision => ({ auto: false, reviewKind, householdId });

  if (row.dir !== 'in' || row.kind !== 'transfer') return { auto: false, reviewKind: null, householdId: null };
  if (row.unread) return review('unread');
  if (row.source === 'manual') return review('manual');
  if (row.refRead === null) return review('no_ref', null);
  if (row.refOk !== 1 || !h) return review('bad_ref', null);
  if (h.status === 'merged' || h.view === 'none') return review('gone');
  if (h.remaining === 0) return review('paid');
  if (amt < h.remaining && someSubsetSums(ctx.sameRefOpenAmounts, h.remaining - amt)) return review('sum');
  if (amt < h.remaining) return review('short');
  if (amt > h.remaining) return review('over');
  if (!surnameMatches(row.nameRaw, h.surnamesKana, h.told?.name ?? null)) return review('name');
  // 印（twin・last・manual_twin）は、5つそろっても・はいの束でも自動にしない。種類は付けない
  if (row.checkFlag) return review(null);
  if (ctx.first5Done < FIRST5_LIMIT && !ctx.firstOk) return review('first5');
  return { auto: true, householdId: h.id };
}

/** 'YYYY-MM-DD' 2つの差が前後 days 日以内か。読めない日付は false */
function withinDays(a: string, b: string, days: number): boolean {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= days * DAY_MS;
}

/** 番号と名義の数字の並び（4けた以上）の中の、4けたの切り出しのうち検査に合う物 */
function validRefsIn(s: string): Set<string> {
  const out = new Set<string>();
  for (const run of s.normalize('NFKC').match(/\d{4,}/g) ?? []) {
    for (let i = 0; i + 4 <= run.length; i++) {
      const code = run.slice(i, i + 4);
      if (isValidRef(code)) out.add(code);
    }
  }
  return out;
}

/** 「見てほしい入金」の候補と、上に出す印、押す前の文（K203） */
export function candidatesFor(row: MatchRow, all: MatchHousehold[]): { list: Candidate[]; notice: string | null } {
  const amt = row.remainingOfRow;
  const whys = new Map<number, Set<Why>>();
  const add = (id: number, w: Why) => {
    const set = whys.get(id) ?? new Set<Why>();
    set.add(w);
    whys.set(id, set);
  };

  // ref：状態は問わない。まとめた世帯なら、まとめた先の世帯にも
  const refs = validRefsIn((row.refRead ?? '') + row.nameRaw);
  for (const h of all) {
    if (!refs.has(h.refCode)) continue;
    add(h.id, 'ref');
    if (h.status === 'merged' && h.mergedInto !== null) add(h.mergedInto, 'ref');
  }

  // ここから下は、まだ出演がある世帯だけ
  const live = all.filter((h) => h.status === 'active' && h.view !== 'none');
  const surnameIds: MatchHousehold[] = [];
  for (const h of live) {
    if (h.told && h.told.amount === amt && withinDays(h.told.date, row.rowDate, TOLD_NEAR_DAYS)) add(h.id, 'told');
    if (amt > 0 && h.remaining === amt) add(h.id, 'amount');
    if (surnameMatches(row.nameRaw, h.surnamesKana, h.told?.name ?? null)) {
      add(h.id, 'surname');
      surnameIds.push(h);
    }
    if (h.totalBeforeLastDrop === amt) add(h.id, 'before_drop');
  }
  for (let i = 0; i < surnameIds.length; i++) {
    for (let j = i + 1; j < surnameIds.length; j++) {
      if (surnameIds[i].remaining + surnameIds[j].remaining === amt) {
        add(surnameIds[i].id, 'sum');
        add(surnameIds[j].id, 'sum');
      }
    }
  }

  // 上に出す
  const has = (id: number, w: Why) => whys.get(id)?.has(w) ?? false;
  const sa = live.filter((h) => has(h.id, 'amount') && has(h.id, 'surname'));
  const top = new Set<number>();
  let notice: string | null = null;
  if (sa.length === 1) {
    top.add(sa[0].id);
    if ([...whys.keys()].some((id) => id !== sa[0].id && has(id, 'ref'))) notice = '番号とお名前が、別のご家庭を指しています。家庭に確かめてから、押してください';
  } else if (sa.length >= 2) {
    const toldOk = sa.filter((h) => has(h.id, 'told') && surnameMatches(row.nameRaw, [], h.told?.name ?? null));
    if (toldOk.length === 1) top.add(toldOk[0].id);
    notice = `同じ姓・同じ金額のご家庭が ${sa.length}つあります。家庭に確かめてから、押してください`;
  }

  // 並び：top → ref → why の数が多い順 → householdId の小さい順。理由が無い世帯は入れない（whys に無い）
  const ORDER: Why[] = ['ref', 'told', 'amount', 'surname', 'sum', 'before_drop'];
  const list: Candidate[] = [...whys.entries()].map(([householdId, set]) => ({ householdId, why: ORDER.filter((w) => set.has(w)), top: top.has(householdId) }));
  list.sort((a, b) =>
    Number(b.top) - Number(a.top)
    || Number(b.why.includes('ref')) - Number(a.why.includes('ref'))
    || b.why.length - a.why.length
    || a.householdId - b.householdId);
  return { list: list.slice(0, CAND_MAX), notice };
}
