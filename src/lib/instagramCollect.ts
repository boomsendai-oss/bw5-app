// 会員Instagramアカウント収集の純ロジック (2026-08-14)
//
// 目的: 会員のInstagramアカウントを任意で提出してもらい、会員DB(boom_members)へ紐付ける。
//
// ⚠️ 正本は boom_members.instagram_handle の1箇所。
//   instagram_entries は「回答の受信箱(生ログ)」であって参照先ではない。
//   アプリの他の場所から会員のInstagramを読むときは必ず boom_members を見ること。
//   受信箱を残すのは ①誤紐付けを後から追跡・解除するため ②本人が編集URLで直したときに
//   追随するため (trial_records.matched_by / matched_at と同じ思想)。
//
// ⚠️ 突合は自動確定しない。suggestMatches は候補を出すだけで、
//   boom_members への書き込みはスタッフ画面の「承認」を経たときだけ行う(LSTEP表示名一括更新と同じ承認キュー方式)。
//   同姓同名・旧姓・表記ゆれで誤紐付けすると被害が読めないため。
//
// ※ このモジュールは公開フォーム(クライアント)からも import されるため node: 依存を持たない。

import { normalizeKana } from './linkSuggest';

export const OWNER_KINDS = ['self', 'father', 'mother', 'other'] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export function isOwnerKind(v: unknown): v is OwnerKind {
  return typeof v === 'string' && (OWNER_KINDS as readonly string[]).includes(v);
}

const OWNER_LABELS: Record<OwnerKind, string> = {
  self: '本人',
  father: '父',
  mother: '母',
  other: 'その他',
};

export function ownerKindLabel(kind: string): string {
  return isOwnerKind(kind) ? OWNER_LABELS[kind] : kind;
}

/** 一度の送信で登録できる人数の上限(兄弟まとめ登録の想定上限)。 */
export const MAX_ENTRIES = 10;

/** Instagramのユーザー名として実在しうる形。英小文字・数字・ピリオド・アンダースコアのみ、30文字以内。 */
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

/** 全角英数字・全角＠/＿を半角に寄せる(スマホのかな入力で混ざる)。 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/＠/g, '@')
    .replace(/＿/g, '_')
    .replace(/．/g, '.')
    .replace(/／/g, '/');
}

export type HandleResult = { ok: true; handle: string } | { ok: false; error: string };

/**
 * 入力されたものからInstagramアカウント名を取り出して正規化する。
 * `@`付き / URL貼り付け / 全角 / 大文字 のどれで来ても同じ値に落とす。
 * 表示名(日本語)を書かれた場合は弾く — 突合できない値を溜めても意味がないため。
 */
export function normalizeHandle(input: string): HandleResult {
  const empty = { ok: false as const, error: 'Instagramのアカウント名を入力してください' };
  let s = toHalfWidth((input ?? '').trim());
  if (!s) return empty;

  // URL形式なら パス先頭のセグメントがアカウント名。
  // 例: https://www.instagram.com/boom_sendai/profilecard/?igsh=xxx
  const urlMatch = /(?:^|\/\/|\s)(?:www\.)?instagram\.com\/([^/?#\s]+)/i.exec(s);
  if (urlMatch) {
    s = urlMatch[1];
  } else {
    // クエリ・ハッシュだけ付いてくるケースを落とす
    s = s.split(/[?#]/)[0];
  }

  s = s.replace(/^@+/, '').replace(/\/+$/, '').trim().toLowerCase();
  if (!s) return empty;
  if (s.length > 30) return { ok: false, error: `「${input.trim()}」はアカウント名として長すぎます（30文字以内）` };
  if (!HANDLE_RE.test(s)) {
    return {
      ok: false,
      error: `「${input.trim()}」はInstagramのアカウント名として読み取れませんでした。プロフィール画面の「@」から始まる名前をそのまま入れてください`,
    };
  }
  return { ok: true, handle: s };
}

// 出演者名と同じく、フリガナは全角カタカナのみ許可(長音符・中点・スペースは可)。
const KATAKANA_RE = /^[゠-ヿ　\s]+$/;
export function isKatakana(s: string): boolean {
  return KATAKANA_RE.test(s);
}

export interface EntryInput {
  memberName: string;
  memberNameKana: string;
  handle: string;
  ownerKind: string;
}

export interface CollectInput {
  entries: EntryInput[];
  note?: string;
}

export interface ValidatedEntry {
  memberName: string;
  memberNameKana: string;
  handle: string;
  ownerKind: OwnerKind;
}

export interface ValidatedCollect {
  entries: ValidatedEntry[];
  note: string;
}

/** 検証OKなら ValidatedCollect、NGなら会員に見せる日本語エラー文字列を返す。 */
export function validateCollectInput(input: CollectInput): ValidatedCollect | string {
  const rows = Array.isArray(input?.entries) ? input.entries : [];
  const cleaned: ValidatedEntry[] = [];

  for (const row of rows) {
    const memberName = (row?.memberName ?? '').trim();
    const memberNameKana = (row?.memberNameKana ?? '').trim();
    const handleRaw = (row?.handle ?? '').trim();
    const ownerKind = (row?.ownerKind ?? '').trim();

    // 「＋もう1人追加」を押しただけの空行は無視する(エラーにしない)
    if (!memberName && !memberNameKana && !handleRaw && !ownerKind) continue;

    if (!memberName) return 'お名前を入力してください';
    if (memberName.length > 50) return 'お名前が長すぎます（50文字以内）';
    if (!memberNameKana) return `${memberName} さんのフリガナを入力してください`;
    if (memberNameKana.length > 50) return 'フリガナが長すぎます（50文字以内）';
    if (!isKatakana(memberNameKana)) return `${memberName} さんのフリガナはカタカナで入力してください`;
    if (!isOwnerKind(ownerKind)) return `${memberName} さんの欄で、どなたのアカウントかを選んでください`;

    const h = normalizeHandle(handleRaw);
    if (!h.ok) return h.error;

    cleaned.push({ memberName, memberNameKana, handle: h.handle, ownerKind });
  }

  if (cleaned.length === 0) return '入力がありません';
  if (cleaned.length > MAX_ENTRIES) return `一度に登録できるのは${MAX_ENTRIES}人までです`;

  const note = (input?.note ?? '').trim().slice(0, 500);
  return { entries: cleaned, note };
}

// ============================================
// 突合(候補出しのみ・確定はしない)
// ============================================

export type MemberForIgMatch = {
  id: number;
  hacomono_member_id: string;
  full_name: string;
  full_name_kana: string;
  status: string;
  instagram_handle: string | null;
};

export type MatchCandidate = {
  member_id: number;
  hacomono_member_id: string;
  full_name: string;
  status: string;
  /** 何で当たったか。kana(フリガナ一致) が主軸、name(漢字一致) はフォールバック */
  reason: 'kana' | 'name';
  /** その会員に既に入っているアカウント(あれば) */
  existing_handle: string | null;
  /** 承認すると別のアカウントを上書きすることになるか */
  overwrites: boolean;
};

export type EntryForMatch = {
  id: number;
  memberName: string;
  memberNameKana: string;
  handle: string;
  ownerKind: string;
};

export type MatchSuggestion = {
  entry_id: number;
  candidates: MatchCandidate[];
  /** 高=候補1件で在籍中 / 要確認=複数ヒットまたは退会済み / なし=候補0件 */
  confidence: '高' | '要確認' | 'なし';
};

/** 漢字氏名の比較用正規化(空白と記号だけ落とす。字体は寄せない)。 */
function normalizeName(s: string): string {
  return (s ?? '').replace(/[\s　・,、.。\-ー－/]/g, '');
}

const isActive = (status: string) => (status ?? '').trim() === 'active';

/**
 * 回答1行ごとに会員の候補を出す。**確定はしない**。
 *
 * 主軸はフリガナ(normalizeKana で四つ仮名・空白の揺れを吸収)。
 * カナが外れた行だけ漢字氏名でフォールバックする(会員が旧字体や送り仮名で書くケース)。
 * 候補が複数、または在籍中でない会員しか当たらない場合は「要確認」に落として
 * スタッフが目で見るまで boom_members に触らせない。
 */
export function suggestMatches(entries: EntryForMatch[], members: MemberForIgMatch[]): MatchSuggestion[] {
  const byKana = new Map<string, MemberForIgMatch[]>();
  const byName = new Map<string, MemberForIgMatch[]>();
  for (const m of members) {
    const kana = normalizeKana(m.full_name_kana ?? '');
    if (kana) {
      const list = byKana.get(kana);
      if (list) list.push(m);
      else byKana.set(kana, [m]);
    }
    const name = normalizeName(m.full_name ?? '');
    if (name) {
      const list = byName.get(name);
      if (list) list.push(m);
      else byName.set(name, [m]);
    }
  }

  return entries.map((e) => {
    const kanaHits = byKana.get(normalizeKana(e.memberNameKana)) ?? [];
    const reason: 'kana' | 'name' = kanaHits.length > 0 ? 'kana' : 'name';
    const hits = kanaHits.length > 0 ? kanaHits : byName.get(normalizeName(e.memberName)) ?? [];

    const candidates: MatchCandidate[] = hits.map((m) => ({
      member_id: m.id,
      hacomono_member_id: m.hacomono_member_id,
      full_name: m.full_name,
      status: m.status,
      reason,
      existing_handle: m.instagram_handle ?? null,
      overwrites: !!m.instagram_handle && m.instagram_handle !== e.handle,
    }));

    const confidence: MatchSuggestion['confidence'] =
      candidates.length === 0 ? 'なし'
        : candidates.length === 1 && isActive(candidates[0].status) ? '高'
          : '要確認';

    return { entry_id: e.id, candidates, confidence };
  });
}

/** 本人が自分の回答を編集/取り消しするためのトークン(URLに載る)。 */
export function generateEditToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
