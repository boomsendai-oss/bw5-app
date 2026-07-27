// 体験予約 担当インストラクター周知(WS T / 2026-07-18)
// trial_records の行を「日付 × レッスン枠」でまとめ、LINEに貼り付ける周知テキストを組み立てる。
// 送信は人が行うため、ここは純粋な整形ロジック(副作用なし・単体テスト対象)。

export type TrialRow = {
  reserved_at: string;                 // 'YYYY-MM-DD HH:MM:SS' (JST wall-clock)
  lesson_name: string | null;          // 予約枠 (装飾・曜日・時刻の接頭辞を含むことがある)
  status: string | null;
  applicant_name: string | null;
  applicant_name_kana: string | null;  // カタカナ
  applicant_age: number | null;
  course_type: string | null;          // 体験レッスン / 見学
  dance_experience: string | null;
  referral_source: string | null;
};

export type TrialVisitor = {
  name: string;        // ひらがなフルネーム
  age: number | null;
  course: string | null;
  experience: string | null;
  referral: string | null;
  isObservation: boolean; // 見学かどうか
};

export type TrialGroup = {
  date: string;        // 'YYYY-MM-DD'
  dateLabel: string;   // '7/18(金)'
  time: string;        // 'HH:MM' (枠の代表時刻)
  lessonName: string;  // 整形済みのレッスン名
  visitors: TrialVisitor[];
  copyText: string;    // コピーされる完成メッセージ
};

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** カタカナ → ひらがな。区切り以外の記号・空白は保持。 */
export function toHiragana(s: string): string {
  let r = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    // カタカナ(ァ〜ヶ)をひらがなへ。長音符・中黒などはそのまま。
    if (c >= 0x30a1 && c <= 0x30f6) r += String.fromCharCode(c - 0x60);
    else r += ch;
  }
  return r;
}

/**
 * 予約枠(Lstep)の名前を整形する。
 * 実データは「(装飾・絵文字化け)(曜) HH:MM～ 実クラス名」の形が多く、曜日・時刻は
 * こちらで別途表示するため重複。最初の「HH:MM～」以降を実クラス名として採用し、
 * 無ければ先頭の装飾記号だけ落とす。
 */
export function cleanLessonName(raw: string | null): string {
  const src = (raw ?? '').trim();
  if (!src) return '（枠未指定）';
  const m = src.match(/\d{1,2}:\d{2}\s*[~～]+\s*(.+)$/);
  let s = m ? m[1] : src;
  s = s.replace(/^[\s?？!！・]+/, '').replace(/\s+/g, ' ').trim();
  return s || src;
}

/** 'YYYY-MM-DD' → '7/18(金)'。JST正午基準で曜日を算出(日本にDSTは無い)。 */
export function formatDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 3)); // 12:00 JST = 03:00 UTC
  const wd = WEEKDAYS_JA[dt.getUTCDay()];
  return `${m}/${d}(${wd})`;
}

/**
 * 体験者1名の周知ブロックを組み立てる。項目は1行ずつ「→」区切り。
 *   ・なまえ（8歳）【見学】
 *   　経験 → 未経験
 *   　きっかけ → インスタ
 * 経験・きっかけは値がある行だけ出す。
 */
export function buildVisitorBlock(v: TrialVisitor): string {
  const head =
    (v.age != null ? `・${v.name}（${v.age}歳）` : `・${v.name}`) +
    (v.isObservation ? '【見学】' : '');
  const lines = [head];
  if (v.experience) lines.push(`　経験 → ${v.experience}`);
  if (v.referral) lines.push(`　きっかけ → ${v.referral}`);
  return lines.join('\n');
}

/** 申込者の表示名。カナがあればひらがな化、無ければ漢字名、どちらも無ければプレースホルダ。 */
export function resolveVisitorName(applicantName: string | null, applicantKana: string | null): string {
  const kana = (applicantKana ?? '').trim();
  return kana ? toHiragana(kana) : (applicantName ?? '（お名前未取得）').trim();
}

function toVisitor(row: TrialRow): TrialVisitor {
  const name = resolveVisitorName(row.applicant_name, row.applicant_name_kana);
  return {
    name,
    age: row.applicant_age,
    course: row.course_type,
    experience: row.dance_experience,
    referral: row.referral_source,
    isObservation: (row.course_type ?? '').includes('見学'),
  };
}

/**
 * trial_records の行を「日付 × レッスン枠」でグルーピングし、周知メッセージを組み立てる。
 * - キャンセル/ノーショーは除外(来ないため周知不要)
 * - 予約時刻(reserved_at)昇順で日付→枠の順に並ぶ
 */
export function buildTrialGroups(rows: TrialRow[]): TrialGroup[] {
  const groups = new Map<string, TrialGroup>();
  const order: string[] = [];

  for (const row of rows) {
    const st = (row.status ?? '').trim();
    if (st === 'キャンセル' || st === 'ノーショー') continue;
    const reserved = (row.reserved_at ?? '').trim();
    if (!reserved) continue;
    const date = reserved.slice(0, 10);
    const time = reserved.slice(11, 16); // 'HH:MM'
    const lessonName = cleanLessonName(row.lesson_name);
    const key = `${date}|${lessonName}`;

    let g = groups.get(key);
    if (!g) {
      g = { date, dateLabel: formatDateLabel(date), time, lessonName, visitors: [], copyText: '' };
      groups.set(key, g);
      order.push(key);
    }
    g.visitors.push(toVisitor(row));
  }

  const result = order.map((k) => groups.get(k)!);
  for (const g of result) g.copyText = buildCopyText(g);
  return result;
}

/** 1レッスン枠ぶんの周知メッセージ(コピー対象)を組み立てる。1人ずつ空行区切り。 */
export function buildCopyText(g: TrialGroup): string {
  const blocks = g.visitors.map(buildVisitorBlock);
  return `【体験さん情報のお知らせ】\n\n${g.dateLabel} ${g.time}〜\n${g.lessonName}\n\n${blocks.join('\n\n')}`;
}
