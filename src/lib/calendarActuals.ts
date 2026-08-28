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
  instructor_id: number | null;
  instructor_name: string | null;
  studio_id: number | null;
  studio_name: string | null;
  class_name: string;
  issues: string[];
};

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
  const inst = parseInstructor(event.summary, instructors);
  const studio = resolveStudio(event.location, studios);
  const dur = toMinutes(event.end) - toMinutes(event.start);

  const issues: string[] = [];
  if (!cancelled) {
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
    studio_id: studio?.id ?? null,
    studio_name: studio?.name ?? null,
    class_name: extractClassName(event.summary),
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
};

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
