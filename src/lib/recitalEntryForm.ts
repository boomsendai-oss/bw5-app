// BW6 発表会（段階1）の申込フォーム /bw6/entry の純関数（Task 13）。DB にさわらない（client の部品からも読む）。
// 下書きの形・カナ・画面ごとの確かめ・送る形への詰め替え・画面7の文。
// 文の正本は設計書 04 4-2（申込フォームの流れ・画面3の決まり・画面7 の世帯ごとのちがい）。
// 確かめは家庭の手間を減らすための先回り。本当の確かめは「送る」のサーバ（recitalEntryDb.ts の submitEntry）がやり直す。
import { ageOn, normalizeEmail, normalizePhone, type HouseholdView, type PayGate } from './recital';
import { isIsoDate } from './dateJst';
import { jpDate } from './recitalPublic';
import type { EntrySubmission } from './recitalEntryDb';

export type DraftPerson = {
  tempId: string; sameAsContact: boolean; lastName: string; firstName: string; lastKana: string; firstKana: string;
  birthday: string; instaHandle: string; tshirtSize: string | null; works: Record<number, 'in' | 'maybe'>;
};
export type EntryDraft = {
  contact: { lastName: string; firstName: string; lastKana: string; firstKana: string; email: string; phone: string };
  people: DraftPerson[];
};

const KANA_RE = /^[ァ-ヺー\s]+$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ひらがな（U+3041〜U+3096）をカタカナに。ほかはそのまま */
export function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

function needName(e: Record<string, string>, key: string, v: string): void {
  if ((v ?? '').trim() === '') e[key] = '入力してください';
}

function needKana(e: Record<string, string>, key: string, v: string): void {
  const t = toKatakana(v ?? '').trim();
  if (t === '') e[key] = '入力してください';
  else if (!KANA_RE.test(t)) e[key] = 'カタカナで入力してください';
}

/** 出る・迷っている作品の数 */
function chosenCount(p: DraftPerson): number {
  return Object.values(p.works).filter((v) => v === 'in' || v === 'maybe').length;
}

/** 画面ごとの確かめ。欄の名前 → 文。空なら先へ進める */
export function entryStepErrors(
  step: 1 | 2 | 3,
  draft: EntryDraft,
  personIdx: number,
  ctx: { todayYmd: string; minSelfApplyAge: number; maxWorks: number },
): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 1) {
    const c = draft.contact;
    needName(e, 'lastName', c.lastName);
    needName(e, 'firstName', c.firstName);
    needKana(e, 'lastKana', c.lastKana);
    needKana(e, 'firstKana', c.firstKana);
    if (!EMAIL_RE.test(normalizeEmail(c.email ?? ''))) e.email = 'メールアドレスの形で入力してください';
    const phone = normalizePhone(c.phone ?? '');
    if (phone.length < 10 || phone.length > 11) e.phone = '電話番号は10〜11けたで入力してください';
    return e;
  }
  const p = draft.people[personIdx];
  if (!p) return e;
  if (step === 2) {
    if (!p.sameAsContact) {
      needName(e, 'lastName', p.lastName);
      needName(e, 'firstName', p.firstName);
      needKana(e, 'lastKana', p.lastKana);
      needKana(e, 'firstKana', p.firstKana);
    }
    if (!isIsoDate(p.birthday) || p.birthday > ctx.todayYmd) {
      e.birthday = '生年月日をえらんでください';
    } else if (p.sameAsContact && ageOn(p.birthday, ctx.todayYmd) < ctx.minSelfApplyAge) {
      e.sameAsContact = `${ctx.minSelfApplyAge}歳より下の方が出るときは、前の画面に、保護者の方のことを書いてください`;
    }
    return e;
  }
  const n = chosenCount(p);
  if (n === 0) e.works = '作品を1つ以上えらんでください（迷っているだけでも送れます）';
  else if (n > ctx.maxWorks) e.works = `1人${ctx.maxWorks}作品までです。`;
  return e;
}

/** 「出る」が3つ以上で1行（止めない。BW5 の決まり） */
export function workCountNotice(p: DraftPerson): string | null {
  const ins = Object.values(p.works).filter((v) => v === 'in').length;
  return ins >= 3 ? '3作品以上に出るときは、担当イントラに相談してからにしてください' : null;
}

/** 下書き → 「送る」の形。category はいつも student（会員かは 7 の照合で決まる） */
export function draftToSubmission(
  d: EntryDraft,
  x: { eventKey: string; submitKey: string; confirmNotFamily: boolean; confirmSamePerson: boolean; consentAccepted: boolean; tshirtOn: boolean },
): EntrySubmission {
  const c = d.contact;
  const contact = {
    lastName: c.lastName.trim(),
    firstName: c.firstName.trim(),
    lastKana: toKatakana(c.lastKana).trim(),
    firstKana: toKatakana(c.firstKana).trim(),
    email: c.email,
    phone: c.phone,
  };
  return {
    eventKey: x.eventKey,
    submitKey: x.submitKey,
    contact,
    people: d.people.map((p) => {
      const same = p.sameAsContact;
      const insta = p.instaHandle.trim();
      return {
        tempId: p.tempId,
        lastName: same ? contact.lastName : p.lastName.trim(),
        firstName: same ? contact.firstName : p.firstName.trim(),
        lastKana: same ? contact.lastKana : toKatakana(p.lastKana).trim(),
        firstKana: same ? contact.firstKana : toKatakana(p.firstKana).trim(),
        birthday: p.birthday,
        isContact: same,
        category: 'student' as const,
        tshirtSize: x.tshirtOn ? p.tshirtSize : null,
        instaHandle: insta === '' ? null : insta,
        works: Object.entries(p.works)
          .filter(([, v]) => v === 'in' || v === 'maybe')
          .map(([k, v]) => ({ workId: Number(k), status: v }))
          .sort((a, b) => a.workId - b.workId),
      };
    }),
    confirmNotFamily: x.confirmNotFamily,
    confirmSamePerson: x.confirmSamePerson,
    consentAccepted: x.consentAccepted,
  };
}

const TENTATIVE_LINE = 'お申し込みを受け付けました。いまは『仮受付』です。お支払いが済むと、『申込完了』になります。';
const MAYBE_LINE = '迷っている作品がある方は、決まってからお支払いください。お支払いのあとは、お返しできません。';

/**
 * 画面7 の文とボタン（04 4-2 の世帯ごとのちがい）。
 * 「迷っている作品だけ」の 1月31日（日）は 4-2 の文のまま（締切の延長はしない決まり）。
 */
export function doneScreen(x: {
  view: HouseholdView; total: number; gate: PayGate; payOpenAt: string; payDue: string; hasMaybe: boolean;
}): { lines: string[]; button: 'マイページでお支払いへ進む' | 'マイページを見る' } {
  if (x.view === 'complete' && x.total === 0) {
    return { lines: ['お申し込みが完了しました。お支払いはありません。'], button: 'マイページを見る' };
  }
  if (x.total === 0 && x.hasMaybe) {
    return {
      lines: ['いまは『仮受付』です。迷っている作品を、1月31日（日）までに決めてください。出る作品が決まったら、マイページからお支払いいただけます。'],
      button: 'マイページを見る',
    };
  }
  const lines = [TENTATIVE_LINE];
  let button: 'マイページでお支払いへ進む' | 'マイページを見る' = 'マイページを見る';
  if (x.gate === 'open') {
    lines.push(`お支払いは、${jpDate(x.payDue)}までです。今すぐでも、あとからでも大丈夫です。`);
    button = 'マイページでお支払いへ進む';
  } else if (x.gate === 'before') {
    lines.push(`お支払いは、${jpDate(x.payOpenAt)}から、マイページでできます。`);
  } else {
    lines.push('お支払いは、準備ができしだい、マイページでできます。');
  }
  if (x.hasMaybe) lines.push(MAYBE_LINE);
  return { lines, button };
}
