// Googleカレンダー(boom.sendai@gmail.com)のイベントを「実績」として解釈する純関数群。
// 設計: docs/superpowers/specs/2026-08-28-monthly-close-automation-design.md
//
// なぜ必要か:
//   給与・スタジオ料は lesson_instances / lesson_master 展開を入力にしているが、
//   実績とはズレる(会場が週替わり・休講・代講・日曜の開催数が週で変わる)。
//   真実は人間が編集しているGoogleカレンダーなので、そこから実績を読む。
//
// 方針:
//   - I/Oを持たない純関数のみ(vitest対象)。カレンダー取得は lessonCalendar.ts 側。
//   - **表記ゆれは起こる前提**(TARO明示 2026-08-28: スクール側の入力ルールを固められていない)。
//   - **読めなかったものは黙って落とさず issues に積む**。静かに¥0になるのが金額事故の典型。

export type CalendarEvent = {
  id: string;
  date: string;   // 'YYYY-MM-DD' (JST)
  start: string;  // 'HH:MM'
  end: string;    // 'HH:MM'
  summary: string;
  location: string | null;
  description?: string | null;
};

export type NamedRef = { id: number; name: string; aliases?: string[] };

export type ResolvedLesson = {
  event_id: string;
  date: string;
  start: string;
  end: string;
  duration_minutes: number;
  cancelled: boolean;
  substitute: boolean;
  instructor_id: number | null;    // 代表(先頭)。連名のときは1人目
  instructor_name: string | null;
  instructors: ParsedInstructor[]; // 連名対応。給与は全員に各自の単価で付く
  studio_id: number | null;
  studio_name: string | null;
  /** 部屋がカレンダーで明示されている(説明欄のヒント等)。同一敷地ルールよりも優先する */
  room_explicit: boolean;
  class_name: string;
  payable: boolean;   // 講師への支払いが発生するレッスンか(練習会などは false)
  issues: string[];
};

/**
 * 講師への支払いが発生しない予定。会場は使うのでスタジオ料は計上するが、給与は付けない。
 * TARO確認(2026-08-28): ダンスバトル練習会はTAROが見ているが給与の対象にならない。
 * これを「講師が読めない」として要確認に積むと、本物の要確認が埋もれる。
 */
const NON_PAYABLE_PATTERNS: readonly string[] = ['練習会', '自主練'];

export function isNonPayableEvent(summary: string): boolean {
  const s = stripDecorations(summary);
  return NON_PAYABLE_PATTERNS.some((p) => s.includes(p));
}

/** 絵文字・装飾記号を除去して空白を詰める。`★おっちゃんNJS` → `おっちゃんNJS` */
export function stripDecorations(s: string): string {
  return (s ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️⃣]/gu, '')
    .replace(/[★☆♪♫◆◇■□▲△●○]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 休講かどうか。**休講はカレンダーから削除されず、タイトルに残る運用**(TARO確認済み)。
 * 生徒がカレンダーで休講を確認できるようにするためと、
 * 「元々無かったのか休講になったのか」を後から区別するため。
 * 実データの2形式: `休講【YURI】…` / `【休講】TARO…`
 */
export function detectCancelled(summary: string): boolean {
  return stripDecorations(summary).includes('休講');
}

/** 照合用の正規化: NFKC + 小文字化 + 空白/区切り/引用符ゆれの除去 */
function normKey(s: string): string {
  return (s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[\s　/／・|｜「」『』()（）\-ー－―‐−]/g, '');
}

export type ParsedInstructor = { id: number; name: string; substitute: boolean };

/**
 * タイトルから「実際にレッスンをやった講師」を取る。実データの5パターンに対応。
 *   1. `【YURI】長町WAACK 初級`      … 【】が先頭
 *   2. `多賀城HOUSE【AOI】`          … 【】が末尾
 *   3. `SAYUKI free style`           … 括弧なしで名前が先頭
 *   4. `★おっちゃんNJS`              … 装飾つき
 *   5. `【Ryuki】キッズ HIPHOP 代講 KOKEKO` … 代講
 *
 * 代講は **マスタの担当ではなく実施者** を返す(給与は実際にやった人に払うため)。
 * 名簿に無い名前は推測せず null。`My` のような短い名前が本文中に紛れて誤爆しないよう、
 * 照合は「【】の中身」と「先頭一致」に限定し、任意位置の部分一致は使わない。
 */
/**
 * タイトルから **レッスンをやった講師を全員** 取る。連名(2人体制)に対応。
 *
 * 生徒もこのカレンダーを見て「今日はどの先生か」を確認するため、
 * `【TARO/KOKEKO】` のように連名で書ける必要がある(TARO要件 2026-08-28)。
 * 区切り文字をTAROに意識させないよう、よくある区切りは全部受ける。
 * 順序は書かれたとおりに保つ(生徒への見え方と給与明細の並びを一致させる)。
 *
 * 給与は各人の単価で別々に付く(TAROは¥0、KOKEKOは¥3,500)。
 * 会場時間が人数ぶん二重計上されないよう、集計側(studioBilling)で同一枠を1回に畳む。
 */
export function parseInstructors(summary: string, instructors: NamedRef[]): ParsedInstructor[] {
  const s = stripDecorations(summary);
  const byKey = new Map<string, NamedRef>();
  for (const i of instructors) {
    byKey.set(normKey(i.name), i);
    for (const a of i.aliases ?? []) byKey.set(normKey(a), i);
  }
  const lookup = (raw: string): NamedRef | undefined => byKey.get(normKey(raw));
  const uniq = (list: ParsedInstructor[]): ParsedInstructor[] => {
    const seen = new Set<number>();
    return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  };

  // 代講が最優先。代講回は「代わりにやった人」だけに払う。
  const sub = s.match(/代講\s*([^\s　【】]+)/);
  if (sub) {
    const hit = lookup(sub[1]);
    if (hit) return [{ id: hit.id, name: hit.name, substitute: true }];
  }

  // 【】の中身を区切り文字で割って、読めた人を順番どおりに集める
  for (const m of s.matchAll(/【\s*([^】]+?)\s*】/g)) {
    const found: ParsedInstructor[] = [];
    for (const part of m[1].split(/[/／・&＆、,･+＋]/)) {
      const hit = lookup(part);
      if (hit) found.push({ id: hit.id, name: hit.name, substitute: false });
    }
    if (found.length > 0) return uniq(found);
  }

  const single = parseInstructor(summary, instructors);
  return single ? [single] : [];
}

export function parseInstructor(summary: string, instructors: NamedRef[]): ParsedInstructor | null {
  const s = stripDecorations(summary);
  const byKey = new Map<string, NamedRef>();
  for (const i of instructors) {
    byKey.set(normKey(i.name), i);
    for (const a of i.aliases ?? []) byKey.set(normKey(a), i);
  }
  const lookup = (raw: string): NamedRef | undefined => byKey.get(normKey(raw));

  // 5. 代講が最優先。`代講 KOKEKO` / `代講KOKEKO`
  const sub = s.match(/代講\s*([^\s　【】]+)/);
  if (sub) {
    const hit = lookup(sub[1]);
    if (hit) return { id: hit.id, name: hit.name, substitute: true };
  }

  // 1 & 2. 【】の中身(先頭・末尾どちらでも)
  for (const m of s.matchAll(/【\s*([^】]+?)\s*】/g)) {
    const hit = lookup(m[1]);
    if (hit) return { id: hit.id, name: hit.name, substitute: false };
  }

  // 6. 区切り文字で区切られたセグメントの完全一致 (`七ヶ浜HIPHOP 初級クラス|TARO`)。
  //    完全一致に限るので、クラス名の一部を講師名と誤認する余地がない。
  for (const seg of s.split(/[|｜/／]/)) {
    const hit = lookup(seg);
    if (hit) return { id: hit.id, name: hit.name, substitute: false };
  }

  // 3 & 4. 先頭一致(長い名前から試して部分被りを避ける)
  const head = normKey(s);
  const sorted = [...instructors].sort((a, b) => normKey(b.name).length - normKey(a.name).length);
  for (const i of sorted) {
    for (const cand of [i.name, ...(i.aliases ?? [])]) {
      const k = normKey(cand);
      if (k && head.startsWith(k)) return { id: i.id, name: i.name, substitute: false };
    }
  }
  return null;
}

/** 住所部分(`, 日本、〒…`)を落とす。カレンダーのlocationは住所つきの回がある。 */
function stripAddress(location: string): string {
  return location
    .split(/,\s*日本|日本[、,]|〒/)[0]
    .trim();
}

/**
 * location から会場を特定する。**表記ゆれは起こる前提**。
 * 別名は長いものから試し、双方向の部分一致で拾う
 * (`仙台市戦災復興記念館 展示ホール` ⊃ `戦災復興記念館` / `長町コナスポ` ⊂ `長町コナスポスタジオ`)。
 * 未知の会場・空欄は推測せず null(呼び出し側で要確認に積む)。
 */
export function resolveStudio(location: string | null | undefined, studios: NamedRef[]): NamedRef | null {
  if (!location) return null;
  const key = normKey(stripAddress(location));
  if (!key) return null;

  const entries: { studio: NamedRef; k: string }[] = [];
  for (const st of studios) {
    for (const cand of [st.name, ...(st.aliases ?? [])]) {
      const k = normKey(cand);
      if (k) entries.push({ studio: st, k });
    }
  }
  entries.sort((a, b) => b.k.length - a.k.length);

  for (const e of entries) {
    if (key.includes(e.k)) return e.studio;
    // 逆包含(location の方が短い略記)。1文字だと誤爆するので2文字以上に限る。
    if (key.length >= 2 && e.k.includes(key)) return e.studio;
  }
  return null;
}

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** クラス名: 装飾・【講師】・休講・代講表記を落とした残り */
function extractClassName(summary: string): string {
  return stripDecorations(summary)
    .replace(/【\s*[^】]*\s*】/g, ' ')
    .replace(/休講/g, ' ')
    .replace(/代講\s*[^\s　]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * カレンダー1件を実績行に解釈する。
 * **休講は issues を積まない**(支払いが発生しないので講師・会場が読めなくても困らない)。
 */
export function resolveCalendarEvent(
  event: CalendarEvent,
  instructors: NamedRef[],
  studios: NamedRef[]
): ResolvedLesson {
  const cancelled = detectCancelled(event.summary);
  const found = parseInstructors(event.summary, instructors);
  const inst = found[0] ?? null;
  let studio = resolveStudio(event.location, studios);
  // 説明欄の部屋ヒント(同一敷地のときだけ適用。別会場の週は誤爆させない)
  let roomExplicit = false;
  const hint = detectRoomHint(event.description);
  if (hint && studio && sameSite(studio.id, ROOM_ID[hint])) {
    const hinted = studios.find((s) => s.id === ROOM_ID[hint]);
    if (hinted) { studio = hinted; roomExplicit = true; }
  }
  // locationが部屋名を直接指している(「GOAT 小スタジオ」等)場合も明示扱い
  if (!roomExplicit && studio) {
    const g = SITE_GROUPS.find((x) => x.members.includes(studio!.id));
    if (g && studio.id !== g.generic) roomExplicit = true;
  }
  const dur = toMinutes(event.end) - toMinutes(event.start);

  const payable = !isNonPayableEvent(event.summary);
  const issues: string[] = [];
  if (!cancelled && payable) {
    if (!inst) issues.push('講師が特定できない');
    if (!studio) issues.push('会場が特定できない');
    if (inst?.substitute) issues.push('代講のため単価が自動で決まらない');
    if (!Number.isFinite(dur) || dur <= 0) issues.push('開始・終了時刻が読めない');
  }

  return {
    event_id: event.id,
    date: event.date,
    start: event.start,
    end: event.end,
    duration_minutes: Number.isFinite(dur) ? dur : 0,
    cancelled,
    substitute: inst?.substitute ?? false,
    instructor_id: inst?.id ?? null,
    instructor_name: inst?.name ?? null,
    instructors: found,
    studio_id: studio?.id ?? null,
    studio_name: studio?.name ?? null,
    room_explicit: roomExplicit,
    class_name: extractClassName(event.summary),
    payable,
    issues,
  };
}

/**
 * 会場名の別名シード。カレンダーの `location` は表記ゆれが大きく、住所つきの回もある。
 * 2026-06〜08 の実データ108コマに出現した全表記から起こした(TARO: 表記ゆれは起こる前提)。
 * キーは `studios.name` の実値。将来 `studios.name_aliases` へ移す(設計 Phase 2)。
 */
export const STUDIO_ALIAS_SEED: Record<string, string[]> = {
  'GOATスタジオ': ['GOAT DANCE STUDIO', 'GOAT'],
  'GOAT 小スタジオ': ['GOAT小スタジオ', 'GOAT小'],
  "T's STUDIO": ["レンタルスタジオT's", "スタジオT's", "T's"],
  'AZUMA スタジオ': ['DanceStudioAzuma', 'スタジオAZUMA', 'AZUMA'],
  'K スタジオ': ['Kスタジオ'],
  '七ヶ浜国際村 リハーサル室': ['七ヶ浜国際村'],
  'アクアスタジオ': ['アクアリーナ', '七ヶ浜健康スポーツセンター'],
  '長町コナスポスタジオ': ['コナスポ', '長町コナスポ', 'コナミスポーツクラブ 仙台長町', 'KONAMI'],
  'マイダンスショップ': ['マイダンスショップ'],
  '宮城野区文化センター　リハーサル室': ['宮城野区文化センター'],
  // 実費型(公共施設)。2026-08-28に studios へ登録した際、別名もここへ移した。
  // 例: `七ヶ浜町中央公民館(生涯学習センター) 中会議室` は施設名の途中に
  // 「(生涯学習センター)」が挟まるため、正式名だけでは部分一致で拾えない。
  '戦災復興記念館　展示ホール': ['戦災復興記念館'],
  '仙台市民会館　展示室': ['仙台市民会館'],
  '七ヶ浜町中央公民館 中会議室': ['七ヶ浜町中央公民館', '生涯学習センター'],
  'エルパーク仙台　フィットネススタジオ': ['エルパーク', '男女共同参画'],
  'LSC・Lスタジオ': ['LSC'],
};

/**
 * 同一敷地の部屋グループ。カレンダーのlocationは建物名(総称)しか持たないことが多く、
 * どの部屋かはマスタ側が知っている(TARO決定 2026-08-29: はじめてのHIPHOP=GOAT小)。
 * generic = 総称locationが解決される代表id。
 * ルール: カレンダーが総称(generic)に解決されたら、同一敷地内ではマスタの部屋を信じる。
 *         カレンダーが部屋を明示(小スタジオ等)していればカレンダーが勝つ(イレギュラー入替の物理入力)。
 */
/**
 * イベントの説明欄から部屋の指定を読む(イレギュラー入替の物理入力)。
 * locationは「GOAT DANCE STUDIO」のまま変えない(TARO決定 2026-08-29:
 * locationに住所が付くことでGoogleマップ導線になっており、初めて来る生徒のために保つ)。
 * 部屋だけ説明欄に「小スタジオ」「Bスタジオ」等と書けば、その日はその部屋で計上する。
 * ⚠️説明欄には道案内の定型文(GOAT/Kスタジオ/AZUMAのリンク集)が入るため、
 * 総称の「スタジオ」や会場名では判定しない。部屋を特定する語だけに反応する。
 */
export function detectRoomHint(description: string | null | undefined): 'A' | 'B' | null {
  if (!description) return null;
  const d = description.normalize('NFKC');
  if (/小スタジオ|Bスタジオ|Bスタ\b|GOAT\s*B/i.test(d)) return 'B';
  if (/大スタジオ|Aスタジオ|Aスタ\b|GOAT\s*A/i.test(d)) return 'A';
  return null;
}

const ROOM_ID: Record<'A' | 'B', number> = { A: 1, B: 2 };

export const SITE_GROUPS: { generic: number; members: number[] }[] = [
  { generic: 1, members: [1, 2] }, // GOATスタジオ(A) / GOAT 小スタジオ(B)
];

export function sameSite(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return SITE_GROUPS.some((g) => g.members.includes(a) && g.members.includes(b));
}

/** 同一敷地内で使う部屋を決める。総称→マスタの部屋 / 明示(部屋名やヒント)→カレンダーの部屋 */
export function resolveRoomWithinSite(eventStudio: number | null, slotStudio: number | null, explicit = false): number | null {
  if (eventStudio == null) return slotStudio;
  if (explicit) return eventStudio;
  if (slotStudio == null || !sameSite(eventStudio, slotStudio)) return eventStudio;
  const g = SITE_GROUPS.find((x) => x.members.includes(eventStudio))!;
  return eventStudio === g.generic ? slotStudio : eventStudio;
}

/**
 * まだ `studios` に無い会場。2026-06〜08 に実際に使われたが未登録で、
 * このままだとスタジオ料が付かない or 別会場に化ける。
 * `kind` は設計の2分類: calc=料金体系をDBに持つ / actual=実額を都度記録する公共施設。
 */
export const UNREGISTERED_VENUES: { name: string; aliases: string[]; kind: 'calc' | 'actual' }[] = [
  { name: '戦災復興記念館　展示ホール', aliases: ['戦災復興記念館'], kind: 'actual' },
  { name: '仙台市民会館　展示室', aliases: ['仙台市民会館'], kind: 'actual' },
  { name: '七ヶ浜町中央公民館 中会議室', aliases: ['七ヶ浜町中央公民館', '生涯学習センター'], kind: 'actual' },
  { name: 'エルパーク仙台　フィットネススタジオ', aliases: ['エルパーク'], kind: 'actual' },
  { name: 'LSC・Lスタジオ', aliases: ['LSC'], kind: 'calc' },
];
