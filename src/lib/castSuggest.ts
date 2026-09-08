/**
 * CAST候補(TARO 2026-08-18設計)。ソースはリール種別で完全に分ける:
 *   クラスリール   = 撮影回の受講者。動画の撮影日時(com.apple.quicktime.creationdate)から
 *                    HACOMONOのチェックイン記録を引き、boom_member_id で会員名簿へID直結
 *                    (名前照合をしない=漢字ゆれ問題が構造的に無い)。
 *   発表会リール   = その演目の出演者名簿(performers)。
 * ハンドル未登録の子も名前で見せる(TAROが本人に直接聞いて集める運用)。
 * 載せるかどうかは毎回TAROのタップ=同意判断は人間に残す。
 */

export type AttendLesson = { start: string; end: string | null; program: string; staff?: string | null };

/** 'HH:MM'→分。不正はnull。 */
function toMin(s: string | null | undefined): number | null {
  const m = String(s ?? '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 講師名の照合用。全角/半角・空白・大小文字のゆれを吸収する。 */
function normStaff(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFKC').replace(/[\s　]+/g, '').toUpperCase();
}

/**
 * 撮影時刻(JSTのHH:MM)から「どのレッスンの撮影か」を選ぶ。
 * レッスン中〜終了45分後(片付け・居残り中の撮影)に収まるものを最優先し、
 * 無ければ開始時刻が一番近いレッスン。終了時刻不明は開始+90分とみなす。
 *
 * ⚠️ 時刻だけでは決められない場合がある(TARO 2026-09-08の実害):
 * 8/30は SAYUKI FREE STYLE(14:00-15:30) と ベーシックダンスクラス(15:00-16:00) が重なっており、
 * 15:33撮影の SAYUKI のリールに「開始が近い」だけでベーシックの受講者が紐づいた。
 * 下書きの講師名(instructor)が分かっている時は、まず講師でレッスンを絞る。
 */
export function pickLessonForShot(
  lessons: AttendLesson[], shotHhmm: string, instructor?: string | null
): AttendLesson | null {
  if (lessons.length === 0) return null;
  // ① 講師で絞れるなら先に絞る(複数クラスが同時間帯に重なっていても取り違えない)
  const want = normStaff(instructor);
  let scope = lessons;
  if (want) {
    const byStaff = lessons.filter((l) => {
      const got = normStaff(l.staff);
      if (!got) return false;
      return got === want || got.includes(want) || want.includes(got);
    });
    if (byStaff.length > 0) scope = byStaff;
  }
  const shot = toMin(shotHhmm);
  if (shot == null) return scope.length === 1 ? scope[0] : null;
  const within = scope.filter((l) => {
    const s = toMin(l.start);
    if (s == null) return false;
    const e = toMin(l.end) ?? s + 90;
    return shot >= s && shot <= e + 45;
  });
  const pool = within.length > 0 ? within : scope;
  return pool.reduce((best, l) =>
    Math.abs((toMin(l.start) ?? 0) - shot) < Math.abs((toMin(best.start) ?? 0) - shot) ? l : best
  );
}

/** Instagramユーザー名の入力を正規化(@や空白を除去)。不正な文字が残る場合はnull。 */
export function normalizeIgHandle(raw: string | null | undefined): string | null {
  const h = String(raw ?? '').trim().replace(/^@+/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
}

export type CastPerson = { kind: 'member' | 'performer'; id: number; name: string; handle?: string };
export type CastSuggest = { source: string; known: CastPerson[]; unknown: CastPerson[] };

/**
 * 日本語氏名の照合用正規化。空白・異体字のゆれを吸収する。
 * 発表会の出演者名簿(performers.name)と会員名簿(boom_members.full_name)を結ぶ用途。
 * ⚠️ 同名2人がいる場合は照合しない(誤タグ防止)。呼び出し側で 'DUP' を弾くこと。
 */
export function normalizeJaName(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/髙/g, '高').replace(/﨑/g, '崎').replace(/邊|邉/g, '辺').replace(/齋|齊/g, '斎');
}
