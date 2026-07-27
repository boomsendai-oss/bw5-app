# 集客計測基盤の整備 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google広告→LINE→体験予約→入会 のつながりを月次×流入経路別で自動的に追えるようにする。

**Architecture:** 判定ロジックはすべて `src/lib/*.ts` の**純関数**に置き、vitestで単体テストする。DBアクセスとGA4アクセスは薄いAPI route / Server Component側に閉じる。`status` 列は書き換えず集計時ルールで来店を判定し、人の訂正だけ `attendance_override` に永続化する。体験→入会の突合はカナ正規化（既存 `linkSuggest.normalizeKana` を再利用）＋日付窓でメモリ内実行する（対象は体験140件×会員約200件で十分小さい）。

**Tech Stack:** Next.js 16 (App Router) / TypeScript / Turso(libSQL) / vitest / GA4 Data API (`@google-analytics/data`)

**設計書:** `docs/superpowers/specs/2026-07-27-acquisition-measurement-design.md`

---

## ファイル構成

**新規作成**

| ファイル | 責務 |
|---|---|
| `scripts/migrations/20260727_trial_enrollment_match.sql` | `trial_records` に4列追加 |
| `src/lib/trialAttendance.ts` | 来店/キャンセル/ノーショー/予約済 の判定（純関数） |
| `src/lib/enrollmentMatch.ts` | 体験↔会員のカナ突合（純関数） |
| `src/lib/referralSource.ts` | 流入経路の正規化（旧/新選択肢の両対応・純関数） |
| `src/lib/acquisitionFunnel.ts` | 月次ファネル・流入経路別の集計（純関数） |
| `src/app/api/staff/operations/match-enrollments/route.ts` | 突合の実行と永続化 |
| `src/app/api/staff/trials/attendance/route.ts` | ノーショー訂正の書き込み |
| `src/app/api/staff/insights/acquisition-funnel/route.ts` | ファネル用データを返す |
| `src/app/staff/insights/AcquisitionFunnel.tsx` | ファネル表示コンポーネント |
| 各 `src/lib/__tests__/*.test.ts` | 上記純関数のテスト |

**変更**

| ファイル | 変更内容 |
|---|---|
| `src/lib/ga4.ts` | 広告費取得 `getAdCost()` を追加・`ADS_DAILY_BUDGET_JPY` を削除 |
| `src/app/api/staff/insights/line-clicks/route.ts` | CPA概算を実費用ベースに差し替え |
| `src/app/api/staff/operations/sync/route.ts` | 会員突合成功後に体験→入会突合を呼ぶ |
| `src/app/staff/insights/page.tsx` | ファネルコンポーネントを差し込む（page.tsx は1036行あるのでロジックは持たせない） |
| `src/app/staff/trials/page.tsx` + `TrialCopyList.tsx` | ノーショー訂正ボタン |
| `BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py` | ノーショー候補のメール通知を廃止（**別リポジトリ**） |

---

## Task 1: マイグレーション（trial_records に4列追加）

**Files:**
- Create: `scripts/migrations/20260727_trial_enrollment_match.sql`
- Modify: `src/lib/db/schema.ts:354-365`

- [ ] **Step 1: マイグレーションSQLを作成**

`scripts/migrations/20260727_trial_enrollment_match.sql`:

```sql
-- 集客計測基盤の整備 (WS AA / 2026-07-27)
--
-- ①体験→入会の自動突合の結果を保持する列を追加する。enrolled_after は既存だが、
--   「誰と突合したか」「何を根拠に突合したか」が残らず監査も解除もできないため補う。
-- ②来店判定は status 列を書き換えず集計時に行う。人が下した訂正だけを
--   attendance_override に永続化する (Lstep CSV の再取込で消えないようにするため)。
--
-- 本番は SKIP_DB_INIT=1 で initDb/runMigrations が走らないため、列追加はこの台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、各 ALTER の ; は行末に置く(行内コメント禁止)。

ALTER TABLE trial_records ADD COLUMN enrolled_member_id INTEGER;

ALTER TABLE trial_records ADD COLUMN matched_by TEXT;

ALTER TABLE trial_records ADD COLUMN matched_at TEXT;

ALTER TABLE trial_records ADD COLUMN attendance_override TEXT;
```

- [ ] **Step 2: 正本スキーマにも同じ列を足す**

`src/lib/db/schema.ts` の `trial_records` の `CREATE TABLE`（354行付近）を次に置き換える:

```ts
      sql: `CREATE TABLE IF NOT EXISTS trial_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lstep_id TEXT,
      member_id INTEGER,
      reserved_at TEXT NOT NULL,
      lesson_name TEXT,
      status TEXT,
      status_source TEXT,
      status_updated_at TEXT,
      enrolled_after INTEGER DEFAULT 0,
      enrolled_member_id INTEGER,
      matched_by TEXT,
      matched_at TEXT,
      attendance_override TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
```

- [ ] **Step 3: dry-run で未適用として見えることを確認**

Run: `npm run migrate -- --dry-run`
Expected: 出力に `未適用: 20260727_trial_enrollment_match.sql` が含まれる

⚠️ **この時点では本番に適用しない**（Task 5 でTARO承認を得てから）。ローカルDBに対してのみ `npm run migrate` を実行してよい。

- [ ] **Step 4: コミット**

```bash
git add scripts/migrations/20260727_trial_enrollment_match.sql src/lib/db/schema.ts
git commit -m "feat(計測基盤): trial_records に突合結果と来店訂正の列を追加"
```

---

## Task 2: 来店判定の純関数

**Files:**
- Create: `src/lib/trialAttendance.ts`
- Test: `src/lib/__tests__/trialAttendance.test.ts`

**背景:** `status` 列は Lstep CSV が正本で、再取込のたびに上書きされる。よって「来店したか」は列に書かず判定ルールにする。判定は**日付単位**で行う（`reserved_at` はJSTの `'YYYY-MM-DD HH:MM:SS'`、当日分は日が終わるまで「予約済」扱い）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/trialAttendance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveAttendance, isTrialDenominator } from '../trialAttendance';

const TODAY = '2026-07-27';

describe('resolveAttendance', () => {
  it('Lstepでキャンセル済みなら キャンセル', () => {
    const r = resolveAttendance(
      { status: 'キャンセル', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('キャンセル');
  });

  it('人がノーショー訂正していれば ノーショー', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: 'noshow', reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('ノーショー');
  });

  it('キャンセルは訂正より優先する(キャンセル済みをノーショーとは数えない)', () => {
    const r = resolveAttendance(
      { status: 'キャンセル', attendance_override: 'noshow', reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('キャンセル');
  });

  it('過去日の予約はキャンセルでなければ来店みなし', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('来店');
  });

  it('Lstepで来店確認済が打たれていればもちろん来店', () => {
    const r = resolveAttendance(
      { status: '来店確認済', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('来店');
  });

  it('当日の予約はまだ予約済(日が終わるまで来店に数えない)', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '2026-07-27 19:00:00' },
      TODAY
    );
    expect(r).toBe('予約済');
  });

  it('未来の予約は予約済', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '2026-08-18 19:00:00' },
      TODAY
    );
    expect(r).toBe('予約済');
  });
});

describe('isTrialDenominator', () => {
  it('来店みなしはCVRの分母に入る', () => {
    expect(
      isTrialDenominator(
        { status: '予約済', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
        TODAY
      )
    ).toBe(true);
  });

  it('キャンセル・ノーショー・未消化の予約は分母に入らない', () => {
    const base = { reserved_at: '2026-07-01 19:00:00' };
    expect(isTrialDenominator({ ...base, status: 'キャンセル', attendance_override: null }, TODAY)).toBe(false);
    expect(isTrialDenominator({ ...base, status: '予約済', attendance_override: 'noshow' }, TODAY)).toBe(false);
    expect(
      isTrialDenominator({ status: '予約済', attendance_override: null, reserved_at: '2026-08-18 19:00:00' }, TODAY)
    ).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/trialAttendance.test.ts`
Expected: FAIL — `Failed to resolve import "../trialAttendance"`

- [ ] **Step 3: 実装する**

`src/lib/trialAttendance.ts`:

```ts
// src/lib/trialAttendance.ts — 体験予約の「来店したか」判定 (WS AA / 2026-07-27)
//
// 背景: 元は運営がLstepで来店フラグを手で打つ設計だったが実行されておらず、
// 140件中 来店確認済はわずか5件・「ノーショー候補50人」が毎日通知される状態だった。
// 実際に発生しているシグナル(顧客/スタッフが押すキャンセル)だけで自動判定する方式に変えた。
//
// status 列は書き換えない。Lstep CSV が正本で再取込のたびに上書きされるため、
// 書き込んでも次の同期で消える。人が下した訂正だけ attendance_override に永続化する。
//
// 判定は日付単位で行う。reserved_at はJSTの 'YYYY-MM-DD HH:MM:SS'、
// 当日分は日が終わるまで「予約済」に留める(まだ来ていないかもしれないため)。

export type TrialAttendance = '予約済' | '来店' | 'キャンセル' | 'ノーショー';

export type AttendanceInput = {
  /** Lstep CSV 由来のステータス */
  status: string | null;
  /** 人が下した訂正。'noshow' または null */
  attendance_override: string | null;
  /** 'YYYY-MM-DD HH:MM:SS' (JST) */
  reserved_at: string;
};

/**
 * @param todayJstStr 今日の日付(JST) 'YYYY-MM-DD'。lib/dateJst の todayJst() を渡す
 */
export function resolveAttendance(row: AttendanceInput, todayJstStr: string): TrialAttendance {
  // キャンセルは最優先。キャンセル済みをノーショーとして二重に数えない。
  if ((row.status ?? '').trim() === 'キャンセル') return 'キャンセル';
  if ((row.attendance_override ?? '').trim() === 'noshow') return 'ノーショー';
  const day = (row.reserved_at ?? '').slice(0, 10);
  if (day && day < todayJstStr) return '来店';
  return '予約済';
}

/** CVRの分母(=実施済みの体験)に数えるか。 */
export function isTrialDenominator(row: AttendanceInput, todayJstStr: string): boolean {
  return resolveAttendance(row, todayJstStr) === '来店';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/trialAttendance.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/trialAttendance.ts src/lib/__tests__/trialAttendance.test.ts
git commit -m "feat(計測基盤): 来店判定を集計時ルールの純関数として実装"
```

---

## Task 3: 体験→入会の突合（純関数）

**Files:**
- Create: `src/lib/enrollmentMatch.ts`
- Test: `src/lib/__tests__/enrollmentMatch.test.ts`

**背景:** 本番実データで検証済み。カナ完全一致＋入会日が体験日 −7〜+90日の窓で **48件ヒット・1体験に複数会員がヒットする曖昧ケースは0件**。同一会員が複数体験にヒットするのは6人いるため、**最初の体験に寄せる**。カナ正規化は既存 `linkSuggest.normalizeKana` を再利用する（ひらがな→カタカナ・記号除去・ヅ/ジの揺れ吸収を含む）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/enrollmentMatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchEnrollments, MATCH_WINDOW_BEFORE_DAYS, MATCH_WINDOW_AFTER_DAYS } from '../enrollmentMatch';

const member = (id: number, kana: string, enrolled_at: string | null) => ({
  id,
  full_name_kana: kana,
  enrolled_at,
});
const trial = (
  id: number,
  kana: string | null,
  reserved_at: string,
  matched_by: string | null = null
) => ({ id, applicant_name_kana: kana, reserved_at, matched_by });

describe('matchEnrollments', () => {
  it('カナ一致かつ入会日が窓内なら突合する', () => {
    const r = matchEnrollments(
      [trial(1, 'ヤマダ タロウ', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-06-01')]
    );
    expect(r.matches).toEqual([{ trial_id: 1, member_id: 10 }]);
    expect(r.ambiguous).toEqual([]);
  });

  it('表記揺れ(ひらがな・中点・ヅ)を吸収する', () => {
    const r = matchEnrollments(
      [trial(1, 'やまだ・みづき', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダ ミズキ', '2026-06-03')]
    );
    expect(r.matches).toEqual([{ trial_id: 1, member_id: 10 }]);
  });

  it('入会が体験より前(窓外)なら突合しない', () => {
    const r = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-01-15')]
    );
    expect(r.matches).toEqual([]);
  });

  it('窓の内側の境界は突合する', () => {
    expect(MATCH_WINDOW_BEFORE_DAYS).toBe(7);
    expect(MATCH_WINDOW_AFTER_DAYS).toBe(90);
    const before = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-08 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-06-01')]
    );
    expect(before.matches).toHaveLength(1);
    const after = matchEnrollments(
      [trial(2, 'スズキハナコ', '2026-06-01 19:00:00')],
      [member(20, 'スズキハナコ', '2026-08-30')]
    );
    expect(after.matches).toHaveLength(1);
  });

  it('窓の外側の境界は突合しない', () => {
    const tooEarly = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-09 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-06-01')]
    );
    expect(tooEarly.matches).toEqual([]);
    const tooLate = matchEnrollments(
      [trial(2, 'スズキハナコ', '2026-06-01 19:00:00')],
      [member(20, 'スズキハナコ', '2026-08-31')]
    );
    expect(tooLate.matches).toEqual([]);
  });

  it('1つの体験に複数会員がヒットしたら確定させず ambiguous に入れる', () => {
    const r = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-06-02'), member(11, 'ヤマダタロウ', '2026-06-05')]
    );
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toEqual([{ trial_id: 1, member_ids: [10, 11] }]);
  });

  it('同じ会員が複数の体験にヒットしたら最初の体験に寄せる', () => {
    const r = matchEnrollments(
      [
        trial(2, 'ヤマダタロウ', '2026-06-20 19:00:00'),
        trial(1, 'ヤマダタロウ', '2026-06-01 19:00:00'),
      ],
      [member(10, 'ヤマダタロウ', '2026-06-25')]
    );
    expect(r.matches).toEqual([{ trial_id: 1, member_id: 10 }]);
  });

  it('手動で確定済み(matched_by=manual)の体験は触らない', () => {
    const r = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-01 19:00:00', 'manual')],
      [member(10, 'ヤマダタロウ', '2026-06-02')]
    );
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });

  it('カナが無い体験・入会日が無い会員は対象外', () => {
    const r = matchEnrollments(
      [trial(1, null, '2026-06-01 19:00:00'), trial(2, '   ', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダタロウ', null)]
    );
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/enrollmentMatch.test.ts`
Expected: FAIL — `Failed to resolve import "../enrollmentMatch"`

- [ ] **Step 3: 実装する**

`src/lib/enrollmentMatch.ts`:

```ts
// src/lib/enrollmentMatch.ts — 体験予約 ↔ 入会会員 の自動突合 (WS AA / 2026-07-27)
//
// trial_records.enrolled_after が全140件0のまま運用されており「体験→入会」が
// 再現できなかった。lstep_id 経由の紐付けは新規客にほぼ効かない(直近30日はCSV30行中25行が未紐付)
// 一方 applicant_name_kana は140/140埋まっているため、カナ突合を主軸にする。
//
// 本番実データでの検証(2026-07-27):
//   - 窓 -7〜+90日で48件ヒット・1体験に複数会員がヒットする曖昧ケースは0件
//   - 同一会員が複数体験にヒットするのは6人 → 最初の体験に寄せる
//   - 月別CVRが既存KPI「体験→月額CVR 51.3%」とほぼ一致することを確認済み

import { normalizeKana } from './linkSuggest';

/** 入会日が体験日のこの日数前まではさかのぼって認める(その場で入会し登録が前後するケース)。 */
export const MATCH_WINDOW_BEFORE_DAYS = 7;
/** 体験からこの日数以内の入会を「その体験由来」とみなす。実データの最長は89日。 */
export const MATCH_WINDOW_AFTER_DAYS = 90;

export type TrialForMatch = {
  id: number;
  applicant_name_kana: string | null;
  /** 'YYYY-MM-DD HH:MM:SS' (JST) */
  reserved_at: string;
  /** 既存の突合根拠。'manual' なら自動突合は触らない */
  matched_by: string | null;
};

export type MemberForMatch = {
  id: number;
  full_name_kana: string;
  /** 'YYYY-MM-DD' 以降の書式。null なら対象外 */
  enrolled_at: string | null;
};

export type EnrollmentMatchResult = {
  matches: { trial_id: number; member_id: number }[];
  /** 1つの体験に複数会員がヒットしたもの。確定させず画面に出して人が判断する */
  ambiguous: { trial_id: number; member_ids: number[] }[];
};

/** 'YYYY-MM-DD...' を1970-01-01からの日数に。解釈できなければ null。 */
function dayNumber(dateStr: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((dateStr ?? '').trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

export function matchEnrollments(
  trials: TrialForMatch[],
  members: MemberForMatch[]
): EnrollmentMatchResult {
  // 正規化カナ → 会員(入会日つき) の索引
  const byKana = new Map<string, { id: number; day: number }[]>();
  for (const m of members) {
    const day = dayNumber(m.enrolled_at);
    if (day === null) continue;
    const kana = normalizeKana(m.full_name_kana ?? '');
    if (!kana) continue;
    const list = byKana.get(kana);
    if (list) list.push({ id: m.id, day });
    else byKana.set(kana, [{ id: m.id, day }]);
  }

  const ambiguous: EnrollmentMatchResult['ambiguous'] = [];
  // 会員ID → 候補の体験。最後に「最初の体験」を選ぶために貯める
  const perMember = new Map<number, { trial_id: number; reserved_at: string }[]>();

  for (const t of trials) {
    if ((t.matched_by ?? '') === 'manual') continue;
    const kana = normalizeKana(t.applicant_name_kana ?? '');
    if (!kana) continue;
    const tDay = dayNumber(t.reserved_at);
    if (tDay === null) continue;

    const hits = (byKana.get(kana) ?? []).filter(
      (m) => m.day >= tDay - MATCH_WINDOW_BEFORE_DAYS && m.day <= tDay + MATCH_WINDOW_AFTER_DAYS
    );
    if (hits.length === 0) continue;
    if (hits.length > 1) {
      ambiguous.push({ trial_id: t.id, member_ids: hits.map((h) => h.id).sort((a, b) => a - b) });
      continue;
    }
    const memberId = hits[0].id;
    const list = perMember.get(memberId);
    if (list) list.push({ trial_id: t.id, reserved_at: t.reserved_at });
    else perMember.set(memberId, [{ trial_id: t.id, reserved_at: t.reserved_at }]);
  }

  // 1入会=1件にする。同じ会員が複数の体験にヒットしたら最初の体験に寄せる
  // (流入経路の起点を正しく取るため)。
  const matches: EnrollmentMatchResult['matches'] = [];
  for (const [memberId, list] of perMember) {
    list.sort((a, b) => (a.reserved_at < b.reserved_at ? -1 : a.reserved_at > b.reserved_at ? 1 : a.trial_id - b.trial_id));
    matches.push({ trial_id: list[0].trial_id, member_id: memberId });
  }
  matches.sort((a, b) => a.trial_id - b.trial_id);

  return { matches, ambiguous };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/enrollmentMatch.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/enrollmentMatch.ts src/lib/__tests__/enrollmentMatch.test.ts
git commit -m "feat(計測基盤): 体験→入会のカナ突合を純関数として実装"
```

---

## Task 4: 突合の実行と永続化（API route）

**Files:**
- Create: `src/app/api/staff/operations/match-enrollments/route.ts`
- Modify: `src/app/api/staff/operations/sync/route.ts`

- [ ] **Step 1: routeを作成**

`src/app/api/staff/operations/match-enrollments/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAll, batch } from '@/lib/db';
import { withAuth } from '@/lib/eventAuth';
import { nowUtcIso } from '@/lib/dateJst';
import { matchEnrollments, type TrialForMatch, type MemberForMatch } from '@/lib/enrollmentMatch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/staff/operations/match-enrollments
 *
 * 体験予約(trial_records) と 入会会員(boom_members) をカナ+日付窓で突合し、
 * enrolled_after / enrolled_member_id / matched_by / matched_at を埋める。
 *
 * 冪等。日次同期(会員CSVが揃った時のみ)と手動再実行の両方から呼ばれる。
 * matched_by='manual' の行は対象外(人の判断を上書きしない)。
 */
export const POST = withAuth(async () => {
  const result = await runEnrollmentMatch();
  return NextResponse.json(result);
});

export type MatchSummary = {
  ok: true;
  trials_scanned: number;
  members_scanned: number;
  matched: number;
  newly_matched: number;
  cleared: number;
  ambiguous: { trial_id: number; member_ids: number[] }[];
};

export async function runEnrollmentMatch(): Promise<MatchSummary> {
  const trials = (await getAll(
    `SELECT id, applicant_name_kana, reserved_at, matched_by, enrolled_after, enrolled_member_id
       FROM trial_records`
  )) as (TrialForMatch & { enrolled_after: number; enrolled_member_id: number | null })[];

  const members = (await getAll(
    `SELECT id, full_name_kana, enrolled_at FROM boom_members WHERE enrolled_at IS NOT NULL`
  )) as MemberForMatch[];

  const { matches, ambiguous } = matchEnrollments(trials, members);

  const at = nowUtcIso();
  const desired = new Map(matches.map((m) => [m.trial_id, m.member_id]));
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  let newlyMatched = 0;
  let cleared = 0;

  for (const t of trials) {
    if ((t.matched_by ?? '') === 'manual') continue;
    const want = desired.get(t.id) ?? null;
    const have = t.enrolled_member_id ?? null;
    if (want === have) continue;

    if (want === null) {
      // 以前 kana_auto で付いていたが条件を満たさなくなった(会員の入会日修正等)。戻す。
      stmts.push({
        sql: `UPDATE trial_records
                 SET enrolled_after = 0, enrolled_member_id = NULL, matched_by = NULL, matched_at = ?
               WHERE id = ?`,
        args: [at, t.id],
      });
      cleared += 1;
    } else {
      stmts.push({
        sql: `UPDATE trial_records
                 SET enrolled_after = 1, enrolled_member_id = ?, matched_by = 'kana_auto', matched_at = ?
               WHERE id = ?`,
        args: [want, at, t.id],
      });
      newlyMatched += 1;
    }
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await batch(stmts.slice(i, i + 50));
  }

  return {
    ok: true,
    trials_scanned: trials.length,
    members_scanned: members.length,
    matched: matches.length,
    newly_matched: newlyMatched,
    cleared,
    ambiguous,
  };
}
```

- [ ] **Step 2: withAuth のシグネチャを確認する**

Run: `grep -n "export function withAuth\|export const withAuth" src/lib/eventAuth.ts`
Expected: `withAuth` の定義行が表示される。引数が `(req: NextRequest)` を受けるハンドラを取る形なら上記のままでよい。異なる場合は定義に合わせて `export const POST = withAuth(async (req) => {...})` の形を調整する。

- [ ] **Step 3: 型チェックとlintを通す**

Run: `npx tsc --noEmit && npm run lint`
Expected: エラーなし

- [ ] **Step 4: 日次同期から呼ぶ**

このrouteは「会員CSVが揃った時」にしか実行されない（揃わなかった場合は `daily_sync.py` 側でスキップされ、このrouteが呼ばれない）。よって**このroute内で無条件に呼んで問題ない**。

`src/app/api/staff/operations/sync/route.ts` の import に追加:

```ts
import { runEnrollmentMatch, type MatchSummary } from '../match-enrollments/route';
```

`generateStaffNotifications(...)` の呼び出し直後・`return NextResponse.json({` の直前（410行付近）に挿入:

```ts
  // --- 体験→入会の突合 (WS AA) ---
  // 会員データが更新された直後に実行する。失敗しても同期全体は落とさない
  // (2026-07-20に入れた部分成功の方針に合わせる)。
  let enrollmentMatch: MatchSummary | { ok: false; error: string };
  try {
    enrollmentMatch = await runEnrollmentMatch();
  } catch (e) {
    enrollmentMatch = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
```

そして `summary` オブジェクトの末尾（`lstep_total: lstepRows.length,` の次の行）に追加:

```ts
      enrollment_match: enrollmentMatch,
```

- [ ] **Step 5: 日次メールのサマリに突合結果を出す（別リポジトリ）**

`/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py` で `/api/staff/operations/sync` のレスポンスを整形している箇所を探す:

Run: `grep -n "会員突合\|def format_sync\|sync_coverage" "/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py"`

見つかった整形関数の末尾に、`summary["enrollment_match"]` があれば1行足す:

```python
    em = summary.get("enrollment_match") or {}
    if em.get("ok"):
        lines.append(
            f"[体験→入会突合] 突合済み {em.get('matched', 0)}件 "
            f"(今回 新規{em.get('newly_matched', 0)} / 解除{em.get('cleared', 0)})"
        )
        if em.get("ambiguous"):
            lines.append(f"  ⚠️ 判定保留 {len(em['ambiguous'])}件 (同姓同名の可能性・/staff/trials で確認)")
    elif em:
        lines.append(f"[体験→入会突合] 失敗: {em.get('error', '不明')}")
```

⚠️ 整形関数がリストではなく文字列連結で組み立てている場合は、その書き方に合わせること（`lines.append(...)` ではなく `summary_text += ...`）。

- [ ] **Step 6: 型チェックとPython構文チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

Run: `python3 -m py_compile "/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py"`
Expected: 出力なし（成功）

- [ ] **Step 7: コミット（2リポジトリ）**

```bash
git add src/app/api/staff/operations/match-enrollments/route.ts src/app/api/staff/operations/sync/route.ts
git commit -m "feat(計測基盤): 体験→入会突合のAPIを追加し日次同期に組み込む"
```

```bash
git -C "/Users/kimurashintarou/BOOM/BOOM_Master_template" add "05_運営/scripts/auto_sync/daily_sync.py"
git -C "/Users/kimurashintarou/BOOM/BOOM_Master_template" commit -m "daily_sync: 体験→入会突合の結果を日次サマリに出す"
```

---

## Task 5: 本番への適用（🔴 TARO承認が必要）

**Files:** なし（本番オペレーション）

⚠️ **このタスクは本番DBへの書き込みを伴う。実行前に必ずTAROの承認を得ること。**

- [ ] **Step 1: 適用予定の内容をTAROに提示して承認を得る**

伝える内容:
- `trial_records` に4列追加（既存データは変更しない）
- 突合を実行すると過去の体験 **約48件** の `enrolled_after` が0→1になる
- 逆方向の変更（1→0）は現状発生しない（全件0のため）

- [ ] **Step 2: 本番の未適用マイグレーションを確認**

Run: `npm run migrate -- --dry-run`
Expected: `未適用: 20260727_trial_enrollment_match.sql` のみが出る（他に想定外の未適用が無いこと）

- [ ] **Step 3: マイグレーションを適用**

Run: `npm run migrate`
Expected: `20260727_trial_enrollment_match.sql` が適用された旨の出力

- [ ] **Step 4: 突合をドライに確認してから実行**

デプロイ後、本番で1回だけ手動実行する:

```bash
curl -s -X POST https://bw5-app.vercel.app/api/staff/operations/match-enrollments -H "x-admin-password: $EVENT_PASSWORD" | head -40
```

Expected: `matched` が **40〜55程度**、`ambiguous` が **空配列**

⚠️ `ambiguous` が空でない、または `matched` が0や100超など想定から大きく外れる場合は**そこで止めてTAROに報告**する。

- [ ] **Step 5: 結果をSTATE.mdに記録**

`~/BOOM/boom-events-hub/STATE.md` の WS AA 行に、適用日と突合件数を追記して commit & push する。

---

## Task 6: ノーショー訂正UI

**Files:**
- Create: `src/app/api/staff/trials/attendance/route.ts`
- Modify: `src/app/staff/trials/page.tsx`, `src/app/staff/trials/TrialCopyList.tsx`

**背景:** 自動判定を入れても「本当に来なかった」ケースは残る。1クリックで直せる口だけ用意し、**使わなくても壊れない**状態にする。

- [ ] **Step 1: 書き込みrouteを作成**

`src/app/api/staff/trials/attendance/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { withAuth } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/staff/trials/attendance
 * body: { trial_id: number, override: 'noshow' | null }
 *
 * 来店判定の人手による訂正。status 列は Lstep CSV が正本で再取込のたびに
 * 上書きされるため、訂正は attendance_override に持つ。
 */
export const POST = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as
    | { trial_id?: number; override?: string | null }
    | null;
  const trialId = Number(body?.trial_id);
  if (!Number.isFinite(trialId) || trialId <= 0) {
    return NextResponse.json({ error: 'trial_id が不正です' }, { status: 400 });
  }
  const raw = body?.override ?? null;
  if (raw !== null && raw !== 'noshow') {
    return NextResponse.json({ error: "override は 'noshow' か null のみです" }, { status: 400 });
  }
  await execute(`UPDATE trial_records SET attendance_override = ? WHERE id = ?`, [raw, trialId]);
  return NextResponse.json({ ok: true, trial_id: trialId, override: raw });
});
```

- [ ] **Step 2: 型チェックを通す**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: 訂正用のクライアントコンポーネントを作成**

⚠️ **既存の「周知リスト」のクエリ（`rows` / `buildTrialGroups`）には手を触れない。** あれは「今日以降の体験を担当者に周知する」ためのもので、過去分を混ぜると本来の用途が壊れる。訂正UIは**別セクション**として足す。

`src/app/staff/trials/NoshowCorrections.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// 来店訂正 (WS AA / 2026-07-27)。
// 来店判定は「キャンセル以外は来店みなし」の自動判定にしたため、本当に来なかった
// ケースだけをここで直す。使わなくても集計は壊れない。

export type PastTrial = {
  id: number;
  reservedLabel: string;   // '7/20(月) 19:00'
  name: string;
  lessonName: string;
  attendanceOverride: string | null;
};

export default function NoshowCorrections({ trials }: { trials: PastTrial[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [state, setState] = useState<Record<number, string | null>>(
    Object.fromEntries(trials.map((t) => [t.id, t.attendanceOverride]))
  );

  if (trials.length === 0) return null;

  const toggle = async (id: number, makeNoshow: boolean) => {
    setBusy(id);
    try {
      const res = await fetch('/api/staff/trials/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trial_id: id, override: makeNoshow ? 'noshow' : null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState((s) => ({ ...s, [id]: makeNoshow ? 'noshow' : null }));
      toast.success(makeNoshow ? 'ノーショーにしました' : '来店に戻しました');
    } catch {
      toast.error('更新に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardContent className="pt-3 pb-3 space-y-2">
        <div className="text-xs text-muted-foreground">
          直近2週間の体験（来店として集計中）。実際に来なかった方だけ「ノーショー」に直してください。
        </div>
        {trials.map((t) => {
          const isNoshow = state[t.id] === 'noshow';
          return (
            <div key={t.id} className="flex items-center justify-between gap-2 border-t border-sand-100 pt-2">
              <div className="min-w-0 text-sm">
                <span className="text-muted-foreground mr-2">{t.reservedLabel}</span>
                <span className={isNoshow ? 'line-through text-muted-foreground' : 'font-medium text-navy-800'}>
                  {t.name}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">{t.lessonName}</span>
              </div>
              <Button
                size="sm"
                variant={isNoshow ? 'secondary' : 'outline'}
                disabled={busy === t.id}
                onClick={() => toggle(t.id, !isNoshow)}
              >
                {isNoshow ? '来店に戻す' : 'ノーショー'}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: page.tsx に別クエリで差し込む**

`src/app/staff/trials/page.tsx` の import に追加:

```ts
import NoshowCorrections, { type PastTrial } from './NoshowCorrections';
import { toHiragana } from '@/lib/trialNotify';
```

既存の `rows` クエリの**後ろ**に、過去14日分の別クエリを足す（既存クエリは変更しない）:

```ts
  // 直近2週間の実施済み体験 — 来店訂正用 (WS AA)。キャンセル済みは訂正不要なので除く。
  const pastRows = (await getAll(
    `SELECT id, reserved_at, lesson_name, status, attendance_override,
            applicant_name, applicant_name_kana
       FROM trial_records
      WHERE date(reserved_at) < date(?) AND date(reserved_at) >= date(?, '-14 day')
        AND COALESCE(status, '') <> 'キャンセル'
      ORDER BY reserved_at DESC`,
    [today, today]
  )) as {
    id: number;
    reserved_at: string;
    lesson_name: string | null;
    status: string | null;
    attendance_override: string | null;
    applicant_name: string | null;
    applicant_name_kana: string | null;
  }[];

  const pastTrials: PastTrial[] = pastRows.map((r) => {
    const kana = (r.applicant_name_kana ?? '').trim();
    return {
      id: r.id,
      reservedLabel: r.reserved_at.slice(5, 16).replace('-', '/'),
      name: kana ? toHiragana(kana) : (r.applicant_name ?? '（お名前未取得）').trim(),
      lessonName: r.lesson_name ?? '',
      attendanceOverride: r.attendance_override,
    };
  });
```

`<TrialCopyList ... />` の**下**に追加:

```tsx
        <NoshowCorrections trials={pastTrials} />
```

- [ ] **Step 5: 既存テストと型チェック**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 全PASS・エラーなし

⚠️ `trialNotify.ts` の `TrialRow` 型は**変更していない**ので `trialNotify.test.ts` は無傷のはず。もし失敗したら、既存クエリを誤って変更していないか確認する。

- [ ] **Step 6: コミット**

```bash
git add src/app/api/staff/trials/attendance/route.ts src/app/staff/trials
git commit -m "feat(計測基盤): 体験のノーショー訂正UIを追加"
```

---

## Task 7: ノーショー候補のメール通知を廃止（**別リポジトリ**）

**Files:**
- Modify: `/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py:1588-1596`

**背景:** 毎日「ノーショー候補50人」が通知されるが誰も消化していない。自動判定に移行したので通知は不要。**APIとJSON出力は残す**（`/staff/trials` の訂正UIが候補一覧として使えるため）。

- [ ] **Step 1: 現在の該当箇所を確認**

Run: `grep -n "ノーショー候補" "/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py"`
Expected: サマリへ連結している行（1591-1592付近）が見つかる

- [ ] **Step 2: メール本文への連結だけを止める**

`summary += "\n\n[ノーショー候補]\n" + noshow_text` の2行をコメントアウトし、理由を書く:

```python
            noshow_list, noshow_text = fetch_noshow_candidates(NOSHOW_HOURS)
            # [ノーショー候補] のメール通知は廃止 (WS AA / 2026-07-27)。
            # 来店判定を「キャンセル以外は来店みなし」の自動判定に変えたため、
            # 毎日50人の候補リストを人が消化する運用そのものが不要になった。
            # JSON出力は /staff/trials の訂正UIの材料として残す。
            # if noshow_text:
            #     summary += "\n\n[ノーショー候補]\n" + noshow_text
```

- [ ] **Step 3: 構文チェック**

Run: `python3 -m py_compile "/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py"`
Expected: 出力なし（成功）

- [ ] **Step 4: バックアップを作成する（⚠️ このディレクトリはgit管理外）**

`/Users/kimurashintarou/BOOM/BOOM_Master_template` は **gitリポジトリではない**（`~/BOOM` 直下にも `.git` は無い）。
このディレクトリには `03_生徒`（生徒の個人情報）が含まれるため、**勝手に `git init` してはいけない**
（PIIをバージョン管理に載せる判断はTAROのもの）。

代わりに、同ディレクトリで既に使われているバックアップ規約に従うこと。既存例:
`daily_sync.py.bak_20260610` / `daily_sync.py.bak_task4_20260720_144049`

**編集する前に**必ず退避を取る:

```bash
cd "/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync"
cp daily_sync.py "daily_sync.py.bak_before_noshow_removal_20260727"
```

編集後、退避版と現行の差分が意図した変更だけであることを確認する:

```bash
diff "daily_sync.py.bak_before_noshow_removal_20260727" daily_sync.py
```

---

## Task 8: GA4から広告費を取得する

**Files:**
- Modify: `src/lib/ga4.ts`
- Test: `src/lib/__tests__/ga4Cost.test.ts`

**背景:** GA4はGoogle広告とリンク済みで `advertiserAdCost` / `advertiserAdClicks` を持つ。**`yearMonth` 次元とは互換性がなく全月に同じ値を返す**ため、必ず `date` 次元で取得して合算する（本番で検証済み）。

- [ ] **Step 1: 月の期間を出す純関数のテストを書く**

`src/lib/__tests__/ga4Cost.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { monthRange, sumAdRows } from '../ga4';

describe('monthRange', () => {
  it('月初と月末を返す', () => {
    expect(monthRange('2026-07')).toEqual({ startDate: '2026-07-01', endDate: '2026-07-31' });
  });
  it('2月・うるう年を正しく扱う', () => {
    expect(monthRange('2026-02')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
  });
});

describe('sumAdRows', () => {
  it('日次の行を合計する', () => {
    const rows = [
      { metricValues: [{ value: '12.31' }, { value: '22' }] },
      { metricValues: [{ value: '7.93' }, { value: '14' }] },
    ];
    expect(sumAdRows(rows)).toEqual({ cost: 20.24, clicks: 36 });
  });
  it('行が無ければゼロ', () => {
    expect(sumAdRows([])).toEqual({ cost: 0, clicks: 0 });
    expect(sumAdRows(undefined)).toEqual({ cost: 0, clicks: 0 });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/ga4Cost.test.ts`
Expected: FAIL — `monthRange` / `sumAdRows` が export されていない

- [ ] **Step 3: ga4.ts に実装を足す**

`src/lib/ga4.ts` の**末尾に**次を追加する。

⚠️ `ADS_DAILY_BUDGET_JPY` は**このタスクではまだ削除しない**。`line-clicks/route.ts` がまだ import しているため、先に消すとビルドが壊れる。削除は Task 9 で行う。

```ts
/** 'YYYY-MM' → GA4のdateRange。月末はうるう年も含めて正しく出す。 */
export function monthRange(ym: string): { startDate: string; endDate: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: `${ym}-01`, endDate: `${ym}-${String(last).padStart(2, '0')}` };
}

type AdRow = { metricValues?: ({ value?: string | null } | null)[] | null };

/** 日次行を合計する。cost は小数第2位で丸める(浮動小数の誤差を表示に持ち込まないため)。 */
export function sumAdRows(rows: AdRow[] | null | undefined): { cost: number; clicks: number } {
  let cost = 0;
  let clicks = 0;
  for (const r of rows ?? []) {
    cost += Number(r?.metricValues?.[0]?.value ?? 0);
    clicks += Number(r?.metricValues?.[1]?.value ?? 0);
  }
  return { cost: Math.round(cost * 100) / 100, clicks };
}

export type AdCost = {
  available: boolean;
  error?: string;
  /** GA4プロパティの通貨建て。2026-07-27時点でJPY化をTARO承認済み */
  cost: number;
  clicks: number;
};

/**
 * Google広告の費用とクリック数を取得する。
 *
 * ⚠️ advertiserAdCost は yearMonth 次元と互換性が無く、全月に同じ値を返してしまう
 * (本番で確認済み)。必ず date 次元で取得して合算すること。
 *
 * @param startDate 'YYYY-MM-DD' または '30daysAgo' 等のGA4表現
 */
export async function getAdCost(startDate: string, endDate: string): Promise<AdCost> {
  const cfg = getClient();
  if (!cfg) {
    return { available: false, error: 'GA4_PROPERTY_ID / GA4_SA_KEY_JSON が未設定です', cost: 0, clicks: 0 };
  }
  try {
    const [res] = await cfg.client.runReport({
      property: cfg.property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }],
      limit: 400,
    });
    const { cost, clicks } = sumAdRows(res.rows);
    return { available: true, cost, clicks };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), cost: 0, clicks: 0 };
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/ga4Cost.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/ga4.ts src/lib/__tests__/ga4Cost.test.ts
git commit -m "feat(計測基盤): GA4から広告費を取得する getAdCost を追加"
```

---

## Task 9: 広告CPA概算のバグ修正

**Files:**
- Modify: `src/app/api/staff/insights/line-clicks/route.ts`, `src/app/staff/insights/page.tsx:658-663`

**背景（実バグ）:** `ADS_DAILY_BUDGET_JPY = 200` を日予算として使っているが**実際の日予算は¥1,000**（実消化 約¥890/日）。そのため画面のCPA概算が**実態の約1/5に過小表示**されている。Task 8 の実費用に置き換えて解消する。

- [ ] **Step 1: 使われなくなる定数を削除する**

`src/lib/ga4.ts` から次の行を削除する:

```ts
export const ADS_DAILY_BUDGET_JPY = 200; // スマートキャンペーン日予算 (CPA概算用)
```

- [ ] **Step 2: routeを実費用ベースに書き換える**

`src/app/api/staff/insights/line-clicks/route.ts` を全置換:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getLineClickStats, getAdCost, GA4_MEASUREMENT_START } from '@/lib/ga4';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/staff/insights/line-clicks
//   GA4の line_click イベント集計 (直近7日/30日、総数と google/cpc 経由) と、
//   同期間のGoogle広告の実費用。
//
//   以前は日予算の決め打ち(¥200)×経過日数でCPAを概算していたが、実際の日予算は
//   ¥1,000でありCPAが実態の約1/5に過小表示されていた (WS AA / 2026-07-27)。
//   GA4に実費用(advertiserAdCost)が入っているのでそれを使う。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const force = new URL(req.url).searchParams.get('force') === '1';
  const [stats, cost7, cost30] = await Promise.all([
    getLineClickStats(force),
    getAdCost('7daysAgo', 'today'),
    getAdCost('30daysAgo', 'today'),
  ]);

  const costByDays: Record<number, { cost: number; available: boolean }> = {
    7: { cost: cost7.cost, available: cost7.available },
    30: { cost: cost30.cost, available: cost30.available },
  };

  const ranges = stats.ranges.map((r) => {
    const c = costByDays[r.days];
    const cost = c?.available ? Math.round(c.cost) : null;
    return {
      ...r,
      cost_jpy: cost,
      cpa_jpy: cost != null && r.ads > 0 ? Math.round(cost / r.ads) : null,
    };
  });

  return NextResponse.json({
    ok: stats.available,
    error: stats.error ?? cost30.error,
    measurement_start: GA4_MEASUREMENT_START,
    ranges,
    fetched_at: stats.fetchedAt,
  });
}
```

- [ ] **Step 3: 画面側のフィールド名を合わせる**

`src/app/staff/insights/page.tsx:302` の型を変更:

```ts
  type LineClickRange = { days: number; total: number; ads: number; cost_jpy: number | null; cpa_jpy: number | null };
```

658-663行付近の「広告CPA概算」カードを置き換える:

```tsx
                <KpiCard
                  label="広告CPA (30日)"
                  value={(() => { const r = lineClicks?.ranges.find((x) => x.days === 30); return r?.cpa_jpy != null ? `¥${num(r.cpa_jpy)}` : '—'; })()}
                  sub={(() => {
                    const r = lineClicks?.ranges.find((x) => x.days === 30);
                    return r?.cost_jpy != null
                      ? `広告費¥${num(r.cost_jpy)} ÷ 広告経由クリック${num(r.ads)}件 (GA4実費用)`
                      : 'GA4から広告費を取得できません';
                  })()}
                  accent="purple"
                />
```

- [ ] **Step 4: 型チェックとlint**

Run: `npx tsc --noEmit && npm run lint`
Expected: エラーなし。`ADS_DAILY_BUDGET_JPY` の未解決参照が残っていたらすべて除去する

- [ ] **Step 5: 参照が残っていないことを確認**

Run: `grep -rn "ADS_DAILY_BUDGET_JPY\|est_cpa_jpy\|est_cost_jpy" src/`
Expected: 出力なし

- [ ] **Step 6: コミット**

```bash
git add src/lib/ga4.ts src/app/api/staff/insights/line-clicks/route.ts src/app/staff/insights/page.tsx
git commit -m "fix(insights): 広告CPAを日予算¥200の決め打ちからGA4実費用に修正"
```

---

## Task 10: 流入経路の正規化

**Files:**
- Create: `src/lib/referralSource.ts`
- Test: `src/lib/__tests__/referralSource.test.ts`

**背景:** Lstepの選択肢を改訂する予定だが、**旧選択肢のデータを捨てない**。旧「googleなどのWEB検索」と新「Google・ネット検索」は同じ経路に寄せる。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/referralSource.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeReferral, REFERRAL_CHANNELS } from '../referralSource';

describe('normalizeReferral', () => {
  it('旧選択肢を正しい経路に寄せる', () => {
    expect(normalizeReferral('知り合いからのご紹介')).toBe('紹介');
    expect(normalizeReferral('googleなどのWEB検索')).toBe('ネット検索');
    expect(normalizeReferral('インスタグラム')).toBe('インスタ');
    expect(normalizeReferral('その他')).toBe('その他');
  });

  it('新選択肢も同じ経路に寄せる', () => {
    expect(normalizeReferral('ご紹介（お友だち・ご家族）')).toBe('紹介');
    expect(normalizeReferral('Google・ネット検索')).toBe('ネット検索');
    expect(normalizeReferral('Googleマップ')).toBe('マップ');
    expect(normalizeReferral('Instagram')).toBe('インスタ');
    expect(normalizeReferral('チラシ・看板')).toBe('チラシ・看板');
  });

  it('マップは検索より優先して判定する(Googleを両方含むため)', () => {
    expect(normalizeReferral('Googleマップを見て')).toBe('マップ');
  });

  it('未入力は未記入', () => {
    expect(normalizeReferral(null)).toBe('未記入');
    expect(normalizeReferral('')).toBe('未記入');
    expect(normalizeReferral('   ')).toBe('未記入');
  });

  it('知らない値はその他に倒す', () => {
    expect(normalizeReferral('通りすがり')).toBe('その他');
  });

  it('経路の一覧は表示順に並んでいる', () => {
    expect(REFERRAL_CHANNELS).toEqual([
      '紹介',
      'ネット検索',
      'マップ',
      'インスタ',
      'チラシ・看板',
      'その他',
      '未記入',
    ]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/referralSource.test.ts`
Expected: FAIL — `Failed to resolve import "../referralSource"`

- [ ] **Step 3: 実装する**

`src/lib/referralSource.ts`:

```ts
// src/lib/referralSource.ts — 流入経路(自己申告)の正規化 (WS AA / 2026-07-27)
//
// Lstepの選択肢を改訂しても過去データを捨てないよう、旧選択肢と新選択肢の
// 両方を同じ経路に寄せる。
//
// 「広告経由かどうか」はここでは判定しない。一般のお客さんはスポンサー表示を
// 見ても広告と自然検索の区別を認識しておらず、自己申告では正確に取れないため。
// 広告経由の判定はLstepの流入経路タグとGA4(sessionSourceMedium)が担当する。

export const REFERRAL_CHANNELS = [
  '紹介',
  'ネット検索',
  'マップ',
  'インスタ',
  'チラシ・看板',
  'その他',
  '未記入',
] as const;

export type ReferralChannel = (typeof REFERRAL_CHANNELS)[number];

export function normalizeReferral(raw: string | null | undefined): ReferralChannel {
  const s = (raw ?? '').trim();
  if (!s) return '未記入';
  // マップは「Google」を含むため検索より先に判定する
  if (/マップ|map/i.test(s)) return 'マップ';
  if (/紹介|口コミ|くちこみ/.test(s)) return '紹介';
  if (/インスタ|instagram|\big\b/i.test(s)) return 'インスタ';
  if (/検索|google|グーグル|yahoo|ヤフー|ネット|web/i.test(s)) return 'ネット検索';
  if (/チラシ|看板|ポスティング|新聞/.test(s)) return 'チラシ・看板';
  return 'その他';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/referralSource.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/referralSource.ts src/lib/__tests__/referralSource.test.ts
git commit -m "feat(計測基盤): 流入経路の正規化(旧/新選択肢の両対応)を追加"
```

---

## Task 11: ファネル集計の純関数

**Files:**
- Create: `src/lib/acquisitionFunnel.ts`
- Test: `src/lib/__tests__/acquisitionFunnel.test.ts`

**集計の定義（設計書 §4 と一致させる）:**
- 分母 = 来店みなしの体験（`isTrialDenominator`）
- 分子 = `enrolled_after = 1`
- 月次の帰属は**体験日の月**（入会日の月ではない）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/acquisitionFunnel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMonthlyFunnel, buildReferralBreakdown, type FunnelTrialRow } from '../acquisitionFunnel';

const TODAY = '2026-07-27';

const row = (o: Partial<FunnelTrialRow> & { reserved_at: string }): FunnelTrialRow => ({
  status: '予約済',
  attendance_override: null,
  enrolled_after: 0,
  referral_source: null,
  ...o,
});

describe('buildMonthlyFunnel', () => {
  it('体験日の月に集計し、キャンセル・ノーショーは分母から外す', () => {
    const rows = [
      row({ reserved_at: '2026-06-01 19:00:00', enrolled_after: 1 }),
      row({ reserved_at: '2026-06-10 19:00:00' }),
      row({ reserved_at: '2026-06-15 19:00:00', status: 'キャンセル' }),
      row({ reserved_at: '2026-06-20 19:00:00', attendance_override: 'noshow' }),
      row({ reserved_at: '2026-07-05 19:00:00', enrolled_after: 1 }),
    ];
    const r = buildMonthlyFunnel(rows, TODAY);
    expect(r).toEqual([
      { ym: '2026-06', trials: 2, enrolled: 1, canceled: 1, noshow: 1, cvr: 0.5 },
      { ym: '2026-07', trials: 1, enrolled: 1, canceled: 0, noshow: 0, cvr: 1 },
    ]);
  });

  it('まだ来ていない予約は月にも分母にも入れない', () => {
    const r = buildMonthlyFunnel([row({ reserved_at: '2026-08-18 19:00:00' })], TODAY);
    expect(r).toEqual([]);
  });

  it('分母0の月は cvr を null にする(0%と区別する)', () => {
    const r = buildMonthlyFunnel([row({ reserved_at: '2026-06-15 19:00:00', status: 'キャンセル' })], TODAY);
    expect(r).toEqual([{ ym: '2026-06', trials: 0, enrolled: 0, canceled: 1, noshow: 0, cvr: null }]);
  });
});

describe('buildReferralBreakdown', () => {
  it('流入経路ごとに体験と入会を数える', () => {
    const rows = [
      row({ reserved_at: '2026-06-01 19:00:00', referral_source: '知り合いからのご紹介', enrolled_after: 1 }),
      row({ reserved_at: '2026-06-02 19:00:00', referral_source: '知り合いからのご紹介' }),
      row({ reserved_at: '2026-06-03 19:00:00', referral_source: 'googleなどのWEB検索', enrolled_after: 1 }),
      row({ reserved_at: '2026-06-04 19:00:00', referral_source: null }),
      row({ reserved_at: '2026-06-05 19:00:00', referral_source: 'インスタグラム', status: 'キャンセル' }),
    ];
    const r = buildReferralBreakdown(rows, TODAY);
    expect(r).toEqual([
      { channel: '紹介', trials: 2, enrolled: 1, cvr: 0.5 },
      { channel: 'ネット検索', trials: 1, enrolled: 1, cvr: 1 },
      { channel: '未記入', trials: 1, enrolled: 0, cvr: 0 },
    ]);
  });

  it('体験が1件も無い経路は行に出さない', () => {
    const r = buildReferralBreakdown([row({ reserved_at: '2026-06-01 19:00:00' })], TODAY);
    expect(r.map((x) => x.channel)).toEqual(['未記入']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/acquisitionFunnel.test.ts`
Expected: FAIL — `Failed to resolve import "../acquisitionFunnel"`

- [ ] **Step 3: 実装する**

`src/lib/acquisitionFunnel.ts`:

```ts
// src/lib/acquisitionFunnel.ts — 集客ファネルの集計 (WS AA / 2026-07-27)
//
// 分母は「来店みなしの体験」(キャンセル・ノーショー・未消化を除く)。
// 分子は突合済みの入会 (enrolled_after=1)。
// 月次の帰属は入会日ではなく *体験日* の月にする。施策を打った月に効果を帰属させるため。

import { isTrialDenominator, resolveAttendance, type AttendanceInput } from './trialAttendance';
import { normalizeReferral, REFERRAL_CHANNELS, type ReferralChannel } from './referralSource';

export type FunnelTrialRow = AttendanceInput & {
  enrolled_after: number;
  referral_source: string | null;
};

export type MonthlyFunnelRow = {
  ym: string;
  trials: number;
  enrolled: number;
  canceled: number;
  noshow: number;
  /** 分母0のときは null (0%と区別する) */
  cvr: number | null;
};

export type ReferralBreakdownRow = {
  channel: ReferralChannel;
  trials: number;
  enrolled: number;
  cvr: number | null;
};

function ratio(enrolled: number, trials: number): number | null {
  return trials > 0 ? enrolled / trials : null;
}

export function buildMonthlyFunnel(rows: FunnelTrialRow[], todayJstStr: string): MonthlyFunnelRow[] {
  const acc = new Map<string, MonthlyFunnelRow>();
  for (const r of rows) {
    const att = resolveAttendance(r, todayJstStr);
    if (att === '予約済') continue; // まだ結果が出ていない予約は集計しない
    const ym = (r.reserved_at ?? '').slice(0, 7);
    if (!ym) continue;
    let cur = acc.get(ym);
    if (!cur) {
      cur = { ym, trials: 0, enrolled: 0, canceled: 0, noshow: 0, cvr: null };
      acc.set(ym, cur);
    }
    if (att === 'キャンセル') cur.canceled += 1;
    else if (att === 'ノーショー') cur.noshow += 1;
    else {
      cur.trials += 1;
      if (Number(r.enrolled_after) === 1) cur.enrolled += 1;
    }
  }
  const out = [...acc.values()].sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
  for (const r of out) r.cvr = ratio(r.enrolled, r.trials);
  return out;
}

export function buildReferralBreakdown(
  rows: FunnelTrialRow[],
  todayJstStr: string
): ReferralBreakdownRow[] {
  const acc = new Map<ReferralChannel, { trials: number; enrolled: number }>();
  for (const r of rows) {
    if (!isTrialDenominator(r, todayJstStr)) continue;
    const ch = normalizeReferral(r.referral_source);
    const cur = acc.get(ch) ?? { trials: 0, enrolled: 0 };
    cur.trials += 1;
    if (Number(r.enrolled_after) === 1) cur.enrolled += 1;
    acc.set(ch, cur);
  }
  // 表示順は REFERRAL_CHANNELS に従う。体験0件の経路は行に出さない。
  return REFERRAL_CHANNELS.flatMap((ch) => {
    const v = acc.get(ch);
    if (!v || v.trials === 0) return [];
    return [{ channel: ch, trials: v.trials, enrolled: v.enrolled, cvr: ratio(v.enrolled, v.trials) }];
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/acquisitionFunnel.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/acquisitionFunnel.ts src/lib/__tests__/acquisitionFunnel.test.ts
git commit -m "feat(計測基盤): 月次ファネルと流入経路別の集計を純関数として実装"
```

---

## Task 12: ファネルAPIと画面

**Files:**
- Create: `src/app/api/staff/insights/acquisition-funnel/route.ts`
- Create: `src/app/staff/insights/AcquisitionFunnel.tsx`
- Modify: `src/app/staff/insights/page.tsx`

- [ ] **Step 1: APIを作成**

`src/app/api/staff/insights/acquisition-funnel/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { withAuth } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import { getAdCost, getLineClickStats, monthRange } from '@/lib/ga4';
import {
  buildMonthlyFunnel,
  buildReferralBreakdown,
  type FunnelTrialRow,
} from '@/lib/acquisitionFunnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/staff/insights/acquisition-funnel
//   集客ファネル(広告費→LINEクリック→体験→入会)を月次と流入経路別で返す。
export const GET = withAuth(async () => {
  const today = todayJst();
  const rows = (await getAll(
    `SELECT reserved_at, status, attendance_override, enrolled_after, referral_source
       FROM trial_records`
  )) as FunnelTrialRow[];

  const monthly = buildMonthlyFunnel(rows, today).slice(-6);
  const referral = buildReferralBreakdown(rows, today);

  // 当月の広告費 (GA4)。GA4は数時間〜1日遅れる。
  const ym = today.slice(0, 7);
  const { startDate, endDate } = monthRange(ym);
  const [adCost, lineClicks] = await Promise.all([
    getAdCost(startDate, endDate),
    getLineClickStats(),
  ]);

  return NextResponse.json({
    ok: true,
    today,
    month: ym,
    monthly,
    referral,
    ad: { available: adCost.available, error: adCost.error, cost: Math.round(adCost.cost), clicks: adCost.clicks },
    line_clicks_30d: lineClicks.available ? lineClicks.ranges.find((r) => r.days === 30) ?? null : null,
  });
});
```

- [ ] **Step 2: 表示コンポーネントを作成**

`src/app/staff/insights/AcquisitionFunnel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

// 集客ファネル (WS AA / 2026-07-27)。
// page.tsx が既に1000行超のため、この機能のロジックと表示はここに閉じる。

type MonthlyRow = { ym: string; trials: number; enrolled: number; canceled: number; noshow: number; cvr: number | null };
type ReferralRow = { channel: string; trials: number; enrolled: number; cvr: number | null };
type Payload = {
  ok: boolean;
  month: string;
  monthly: MonthlyRow[];
  referral: ReferralRow[];
  ad: { available: boolean; error?: string; cost: number; clicks: number };
  line_clicks_30d: { days: number; total: number; ads: number } | null;
};

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num = (v: number) => v.toLocaleString('ja-JP');

export default function AcquisitionFunnel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/staff/insights/acquisition-funnel')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="text-xs text-neutral-400">読み込みに失敗しました: {error}</p>;
  if (!data) return <p className="text-xs text-neutral-400">読込中...</p>;

  const cur = data.monthly.find((m) => m.ym === data.month);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sand-200 p-3 text-sm">
        <div className="font-semibold text-navy-800 mb-2">{data.month} の集客ファネル</div>
        <dl className="space-y-1">
          <Step label="広告費" value={data.ad.available ? `¥${num(data.ad.cost)}` : '—'} note={data.ad.available ? undefined : 'GA4から取得できません'} />
          <Step label="広告クリック" value={data.ad.available ? num(data.ad.clicks) : '—'} />
          <Step label="LINEクリック (30日)" value={data.line_clicks_30d ? `${num(data.line_clicks_30d.total)} (うち広告 ${num(data.line_clicks_30d.ads)})` : '—'} />
          <Step label="体験 (来店)" value={cur ? num(cur.trials) : '0'} note={cur ? `キャンセル${cur.canceled} / ノーショー${cur.noshow}` : undefined} />
          <Step label="入会" value={cur ? `${num(cur.enrolled)}　CVR ${pct(cur.cvr)}` : '0'} />
        </dl>
      </div>

      <div>
        <div className="text-xs font-semibold text-navy-800 mb-1">月次推移</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 pr-3">月</th><th className="py-1 pr-3">体験</th><th className="py-1 pr-3">入会</th><th className="py-1">CVR</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m) => (
                <tr key={m.ym} className="border-t border-sand-100">
                  <td className="py-1 pr-3">{m.ym}</td>
                  <td className="py-1 pr-3">{num(m.trials)}</td>
                  <td className="py-1 pr-3">{num(m.enrolled)}</td>
                  <td className="py-1">{pct(m.cvr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-navy-800 mb-1">流入経路別（全期間・自己申告ベース）</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 pr-3">経路</th><th className="py-1 pr-3">体験</th><th className="py-1 pr-3">入会</th><th className="py-1">CVR</th>
              </tr>
            </thead>
            <tbody>
              {data.referral.map((r) => (
                <tr key={r.channel} className="border-t border-sand-100">
                  <td className="py-1 pr-3">{r.channel}</td>
                  <td className="py-1 pr-3">{num(r.trials)}</td>
                  <td className="py-1 pr-3">{num(r.enrolled)}</td>
                  <td className="py-1">{pct(r.cvr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-neutral-400 leading-relaxed">
        母数が小さい経路のCVRは偶然で大きく振れます。件数を見てから判断してください。
        流入経路は2026-05以降の体験にしか記録がありません。
        「広告経由の入会」はLstepの流入経路タグ導入までは特定できないため、CPAは広告費÷広告経由のLINEクリックまでしか出せません。
      </p>
    </div>
  );
}

function Step({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right">
        <span className="font-semibold text-navy-800">{value}</span>
        {note && <span className="ml-2 text-[10px] text-neutral-400">{note}</span>}
      </dd>
    </div>
  );
}
```

- [ ] **Step 3: page.tsx に差し込む**

`src/app/staff/insights/page.tsx` の import に追加:

```ts
import AcquisitionFunnel from './AcquisitionFunnel';
```

既存の「体験→入会ファネル」`<Section>` の**直前**に、新しい Section を追加する:

```tsx
            {/* ===== 集客ファネル (WS AA) ===== */}
            <Section
              title="集客ファネル（月次・流入経路別）"
              icon={<Sprout className="h-4 w-4 text-brand-500" />}
              hint="広告費→LINE→体験→入会。投資判断はこちらを見る"
            >
              <AcquisitionFunnel />
            </Section>
```

さらに、既存の「体験→入会ファネル」Section の `hint` を、両者の違いが分かるように変更する:

```tsx
            <Section title="体験→入会ファネル（累計・参考）" icon={<Sprout className="h-4 w-4 text-brand-500" />} hint="HACOMONO会員登録=体験来店とみなした累計CVR。月次/経路別は上の集客ファネルを見る">
```

- [ ] **Step 4: 型チェック・lint・全テスト**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: すべてエラーなし・全テストPASS

- [ ] **Step 5: 開発サーバで実際に表示を確認**

`.claude/launch.json` に `bw5-app` の dev 設定が無ければ作成し、preview_start で起動して `/staff/insights` を開く。
確認すること:
- 「集客ファネル（月次・流入経路別）」が表示される
- 月次推移に2026-05以降の行が出る
- コンソールエラーが無い

- [ ] **Step 6: コミット**

```bash
git add src/app/api/staff/insights/acquisition-funnel src/app/staff/insights
git commit -m "feat(insights): 集客ファネル(月次・流入経路別)を追加"
```

---

## 完了後に残ること（このプランの外）

| 項目 | 担当 | 状態 |
|---|---|---|
| GA4プロパティ通貨をJPYに変更 | TARO/サイドバー | 指示書は作成済み・承認済み |
| Lstepの流入経路機能が使えるか確認 | TARO/サイドバー | 指示書は作成済み |
| Lstep体験予約フォームの選択肢改訂 | TARO | **変更前にTARO承認必須** |
| 流入経路タグ導入後にCPAを「広告費÷広告経由の入会」へ精度向上 | 次のプラン | タグ導入が前提 |
