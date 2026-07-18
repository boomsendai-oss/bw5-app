// 体験予約 担当インストラクター周知(WS T / 2026-07-18)
// trial_records の行を「日付 × レッスン枠」でまとめ、LINEに貼り付ける周知テキストを組み立てる。
// 送信は人が行うため、ここは純粋な整形ロジック(副作用なし・単体テスト対象)。

export type TrialRow = {
  reserved_at: string;                 // 'YYYY-MM-DD HH:MM:SS' (JST wall-clock)
  lesson_name: string | null;          // 予約枠 (担当インストラクター名を含む)
  status: string | null;
  applicant_name: string | null;
  applicant_name_kana: string | null;  // カタカナ
  applicant_age: number | null;
  course_type: string | null;
  dance_experience: string | null;
  referral_source: string | null;
};

export type TrialVisitor = {
  name: string;        // ひらがなフルネーム
  age: number | null;
  course: string | null;
  experience: string | null;
  referral: string | null;
  line: string;        // 周知メッセージ内の1行
};

export type TrialGroup = {
  date: string;        // 'YYYY-MM-DD'
  dateLabel: string;   // '7/18(金)'
  time: string;        // 'HH:MM' (枠の代表時刻)
  lessonName: string;  // 予約枠
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

/** 'YYYY-MM-DD' → '7/18(金)'。JST正午基準で曜日を算出(日本にDSTは無い)。 */
export function formatDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 3)); // 12:00 JST = 03:00 UTC
  const wd = WEEKDAYS_JA[dt.getUTCDay()];
  return `${m}/${d}(${wd})`;
}

/** 体験者1名の周知行を組み立てる。欠損項目は省略。 */
export function buildVisitorLine(v: {
  name: string;
  age: number | null;
  course: string | null;
  experience: string | null;
  referral: string | null;
}): string {
  const head = v.age != null ? `${v.name}（${v.age}歳）` : v.name;
  const segs = [head];
  if (v.course) segs.push(v.course);
  if (v.experience) segs.push(v.experience);
  const base = `・${segs.join('／')}`;
  return v.referral ? `${base}／きっかけ: ${v.referral}` : base;
}

function toVisitor(row: TrialRow): TrialVisitor {
  const kana = (row.applicant_name_kana ?? '').trim();
  const name = kana ? toHiragana(kana) : (row.applicant_name ?? '（お名前未取得）').trim();
  const v = {
    name,
    age: row.applicant_age,
    course: row.course_type,
    experience: row.dance_experience,
    referral: row.referral_source,
  };
  return { ...v, line: buildVisitorLine(v) };
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
    const lessonName = (row.lesson_name ?? '（枠未指定）').trim() || '（枠未指定）';
    const key = `${date}|${lessonName}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        date,
        dateLabel: formatDateLabel(date),
        time,
        lessonName,
        visitors: [],
        copyText: '',
      };
      groups.set(key, g);
      order.push(key);
    }
    g.visitors.push(toVisitor(row));
  }

  const result = order.map((k) => groups.get(k)!);
  for (const g of result) g.copyText = buildCopyText(g);
  return result;
}

/** 1レッスン枠ぶんの周知メッセージ(コピー対象)を組み立てる。 */
export function buildCopyText(g: TrialGroup): string {
  const header = `【体験のお知らせ】${g.dateLabel} ${g.time}〜`;
  const lines = g.visitors.map((v) => v.line);
  return [header, g.lessonName, '──────────', ...lines].join('\n');
}
