# 太白区民まつり2026 出演者募集・集計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 太白区民まつり2026の出演者を保護者/生徒が公開フォームで登録(兄弟複数可・自己編集可)し、運営が `/staff/events/[eventId]` から全体名簿・パート別名簿・人数・CSVで集計できるようにする。

**Architecture:** 既存イベント基盤(`events` テーブル・`/staff/events`)に統合。募集データは event_id をキーにした汎用3テーブル(申込→出演者→パート)で持つ。公開フォームは Server Actions(認証なし・書込み専用・名簿を返さない)、スタッフ集計は既存 events API と同じ `isAuthorized` パターンの API route。ロジックは純関数 `src/lib/eventSignup.ts` に寄せて vitest でTDD。

**Tech Stack:** Next.js 16.2.3 (webpack) / libSQL(Turso) / TypeScript / vitest / Tailwind / shadcn(スタッフ画面)

**設計書:** `docs/superpowers/specs/2026-07-22-taihaku-signup-design.md`

---

## 前提・規約(必読)

- **カスタムNext.js**: 新規ページ/ルート前に必要なら `node_modules/next/dist/docs/` を参照。訓練データのNext APIを盲信しない。
- **認証**: `src/lib/eventAuth.ts` の `isAuthorized(req)`/`unauthorized()`(API route)・`isAuthorizedServer()`(Server Action)・`checkRateLimit(key,max,windowSec)` を流用。独自セッションを作らない。
- **DB**: `src/lib/db.ts` 経由(`getAll`/`getOne`/`execute`/`withWriteTx`)。`createClient` を直接呼ばない。
- **公開route/Actionには必ずファイル冒頭に「なぜ公開か」コメント**(規約4.5)。
- **PII**: 出演者名は未成年含むPII。名簿を列挙/検索するGETを作らない。氏名をログに出さない。
- **スタッフ画面**: ブランド3色(navy/teal/sand)。`@/components/StaffPageHeader` を使う。`orange-*` 新規使用禁止。
- **マイグレーション**: `scripts/migrations/YYYYMMDD_name.sql`。**文末 `;` は行末・行内コメント禁止**(`migrate.mjs` が `;\s*$` で分割)。ローカル/テスト用に `src/lib/db/schema.ts` にも同じ `CREATE TABLE IF NOT EXISTS` を追加。

---

## File Structure

**新規作成:**
- `scripts/migrations/20260722_event_signups.sql` — 本番DDL(3テーブル+インデックス)
- `src/lib/eventSignup.ts` — 純ロジック(パート定義/バリデーション/トークン生成/CSV/集計/デフォルト設定)
- `src/lib/__tests__/eventSignup.test.ts` — 上記のvitest
- `src/lib/eventSignupDb.ts` — DBアクセス層(申込のCRUD・設定の解決/保存)
- `src/app/entry/[code]/actions.ts` — 公開Server Actions(閲覧/送信/自己編集)
- `src/app/entry/[code]/page.tsx` — 公開フォーム(説明→入力→サンクス/編集)
- `src/app/entry/[code]/FlowDiagram.tsx` — 演目の流れ図(小コンポーネント)
- `src/app/api/staff/events/[eventId]/signups/route.ts` — 集計取得(GET・認証)
- `src/app/api/staff/events/[eventId]/signups/[signupId]/route.ts` — 申込削除(DELETE・認証)
- `src/app/api/staff/events/[eventId]/signups/performers/[performerId]/route.ts` — 出演者の編集/削除(PATCH/DELETE・認証)
- `src/app/api/staff/events/[eventId]/signups/settings/route.ts` — 設定 取得/保存(GET/PUT・認証)
- `src/app/api/staff/events/[eventId]/signups/export/route.ts` — CSV出力(GET・認証)
- `src/app/staff/events/[eventId]/signups/page.tsx` — スタッフ集計画面

**修正:**
- `src/lib/db/schema.ts` — 3テーブルの `CREATE TABLE IF NOT EXISTS` を追加
- `src/app/staff/events/[eventId]/page.tsx` — 無効カードを「出演者募集・集計」リンクに差し替え

---

## Task 1: マイグレーションとスキーマ(3テーブル)

**Files:**
- Create: `scripts/migrations/20260722_event_signups.sql`
- Modify: `src/lib/db/schema.ts`(`getSchemaStatements()` の return 配列末尾に3つ追加)

- [ ] **Step 1: マイグレーションSQLを作成**

Create `scripts/migrations/20260722_event_signups.sql`（**行末 `;`・行内コメント禁止**）:

```sql
CREATE TABLE IF NOT EXISTS event_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  edit_token TEXT NOT NULL UNIQUE,
  understood INTEGER NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_signups_event ON event_signups (event_id);

CREATE TABLE IF NOT EXISTS event_signup_performers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signup_id INTEGER NOT NULL,
  performer_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_signup_performers_signup ON event_signup_performers (signup_id);

CREATE TABLE IF NOT EXISTS event_signup_parts (
  performer_id INTEGER NOT NULL,
  part_key TEXT NOT NULL,
  PRIMARY KEY (performer_id, part_key)
);

CREATE TABLE IF NOT EXISTS event_signup_settings (
  event_id INTEGER PRIMARY KEY,
  parts_json TEXT NOT NULL DEFAULT '[]',
  fee_text TEXT NOT NULL DEFAULT '',
  deadline TEXT DEFAULT '',
  intro_md TEXT NOT NULL DEFAULT '',
  calendar_url TEXT DEFAULT '',
  is_open INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT ''
);
```

- [ ] **Step 2: schema.ts にローカル/テスト用の同一DDLを追加**

`src/lib/db/schema.ts` の `getSchemaStatements()` が返す配列の**末尾**(最後の `}` の直前)に以下の要素を追加（既存要素と同じ `{ sql: \`...\`, args: [] }` 形式）:

```ts
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      edit_token TEXT NOT NULL UNIQUE,
      understood INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_event_signups_event ON event_signups (event_id)`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signup_performers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signup_id INTEGER NOT NULL,
      performer_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_signup_performers_signup ON event_signup_performers (signup_id)`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signup_parts (
      performer_id INTEGER NOT NULL,
      part_key TEXT NOT NULL,
      PRIMARY KEY (performer_id, part_key)
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signup_settings (
      event_id INTEGER PRIMARY KEY,
      parts_json TEXT NOT NULL DEFAULT '[]',
      fee_text TEXT NOT NULL DEFAULT '',
      deadline TEXT DEFAULT '',
      intro_md TEXT NOT NULL DEFAULT '',
      calendar_url TEXT DEFAULT '',
      is_open INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT ''
    )`,
      args: [],
    },
```

- [ ] **Step 3: ローカルDBにマイグレーション適用して確認**

Run:
```bash
node scripts/migrate.mjs --dry-run
node scripts/migrate.mjs
```
Expected: `apply` 実行後、`20260722_event_signups.sql` が適用され「未適用なし」に近いログ。エラーなし。

- [ ] **Step 4: テーブルが出来たか確認**

Run:
```bash
node -e "const {createClient}=require('@libsql/client'); (async()=>{const c=createClient({url:'file:./data/bw5.db'}); const r=await c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'event_signup%'\"); console.log(r.rows.map(x=>x.name));})()"
```
Expected: `[ 'event_signups', 'event_signup_performers', 'event_signup_parts', 'event_signup_settings' ]`

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/20260722_event_signups.sql src/lib/db/schema.ts
git commit -m "feat(taihaku): 出演者募集テーブル(申込/出演者/パート/設定)を追加"
```

---

## Task 2: 純ロジック `eventSignup.ts`(TDD)

**Files:**
- Create: `src/lib/eventSignup.ts`
- Test: `src/lib/__tests__/eventSignup.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/eventSignup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PART_KEYS,
  isPartKey,
  validateSignupInput,
  generateEditToken,
  buildSignupCsv,
  countByPart,
  defaultSettings,
} from '../eventSignup';

describe('isPartKey', () => {
  it('正しいキーだけ true', () => {
    expect(isPartKey('girls_hh')).toBe(true);
    expect(isPartKey('waack')).toBe(true);
    expect(isPartKey('hiphop')).toBe(true);
    expect(isPartKey('ballet')).toBe(false);
    expect(isPartKey('')).toBe(false);
  });
});

describe('validateSignupInput', () => {
  const ok = {
    understood: true,
    note: ' メモ ',
    performers: [
      { name: ' 太郎 ', parts: ['girls_hh', 'girls_hh', 'waack'] },
      { name: '', parts: [] },
      { name: '次郎', parts: ['hiphop'] },
    ],
  };

  it('正常系: 空行を捨て・名前trim・パート重複除去', () => {
    const r = validateSignupInput(ok);
    expect(typeof r).not.toBe('string');
    if (typeof r === 'string') return;
    expect(r.note).toBe('メモ');
    expect(r.performers).toEqual([
      { name: '太郎', parts: ['girls_hh', 'waack'] },
      { name: '次郎', parts: ['hiphop'] },
    ]);
  });

  it('理解チェック未通過はエラー', () => {
    expect(validateSignupInput({ ...ok, understood: false })).toContain('チェック');
  });

  it('出演者が0人はエラー', () => {
    expect(validateSignupInput({ understood: true, performers: [{ name: '', parts: [] }] })).toContain('1人以上');
  });

  it('パート未選択の出演者はエラー(名前入り)', () => {
    const r = validateSignupInput({ understood: true, performers: [{ name: '花子', parts: [] }] });
    expect(r).toContain('花子');
    expect(r).toContain('パート');
  });

  it('不正なパートキーは無視される', () => {
    const r = validateSignupInput({ understood: true, performers: [{ name: 'A', parts: ['ballet', 'waack'] }] });
    if (typeof r === 'string') throw new Error(r);
    expect(r.performers[0].parts).toEqual(['waack']);
  });

  it('11人以上はエラー', () => {
    const performers = Array.from({ length: 11 }, (_, i) => ({ name: `p${i}`, parts: ['waack'] }));
    expect(validateSignupInput({ understood: true, performers })).toContain('10人');
  });
});

describe('generateEditToken', () => {
  it('十分長い16進で毎回違う', () => {
    const a = generateEditToken();
    const b = generateEditToken();
    expect(a).toMatch(/^[0-9a-f]{32,}$/);
    expect(a).not.toBe(b);
  });
});

describe('countByPart', () => {
  it('パートごとに人数を数える(複数パートは各カウント)', () => {
    const r = countByPart([
      { parts: ['girls_hh', 'waack'] },
      { parts: ['waack'] },
      { parts: ['hiphop'] },
    ]);
    expect(r).toEqual({ girls_hh: 1, waack: 2, hiphop: 1 });
  });
});

describe('buildSignupCsv', () => {
  it('ヘッダ+1行1出演者・パートはラベルを / 連結・カンマはエスケープ', () => {
    const csv = buildSignupCsv(
      [{ performerName: '太郎', parts: ['girls_hh', 'waack'], createdAt: '2026-07-22T00:00:00.000Z' }],
      { girls_hh: 'ガールズHIPHOP', waack: 'WAACK', hiphop: 'HIPHOP' }
    );
    expect(csv).toContain('出演者名,希望パート,申込日時');
    expect(csv).toContain('太郎,ガールズHIPHOP / WAACK,2026-07-22T00:00:00.000Z');
  });
});

describe('defaultSettings', () => {
  it('参加費3000円・パート3種・受付ON', () => {
    const s = defaultSettings();
    expect(s.feeText).toContain('3,000');
    expect(s.parts.map((p) => p.key)).toEqual([...PART_KEYS]);
    expect(s.isOpen).toBe(true);
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

Run: `npx vitest run src/lib/__tests__/eventSignup.test.ts`
Expected: FAIL(`../eventSignup` が存在しない / 各関数未定義)

- [ ] **Step 3: `eventSignup.ts` を実装**

Create `src/lib/eventSignup.ts`:

```ts
// 太白区民まつり 出演者募集の純ロジック(DB非依存・vitest対象)。
import { randomBytes } from 'node:crypto';

export const PART_KEYS = ['girls_hh', 'waack', 'hiphop'] as const;
export type PartKey = (typeof PART_KEYS)[number];

export function isPartKey(v: string): v is PartKey {
  return (PART_KEYS as readonly string[]).includes(v);
}

export interface PartDef {
  key: PartKey;
  label: string;
  note?: string;
}

export const DEFAULT_PARTS: PartDef[] = [
  { key: 'girls_hh', label: 'ガールズHIPHOP' },
  { key: 'waack', label: 'WAACK' },
  { key: 'hiphop', label: 'HIPHOP', note: '長町では調整中(仙台HIPHOP合流等)' },
];

export interface ResolvedSettings {
  parts: PartDef[];
  feeText: string;
  deadline: string;
  introMd: string;
  calendarUrl: string;
  isOpen: boolean;
}

export function defaultSettings(): ResolvedSettings {
  return {
    parts: DEFAULT_PARTS,
    feeText: '参加費：お一人 3,000円',
    deadline: '2026-08-01',
    calendarUrl: '',
    isOpen: true,
    introMd: [
      '## 太白区民まつり2026 出演者募集',
      '',
      '- 日時：2026年10月18日(日) 9:30〜15:30（出演時間は当日ご案内）',
      '- 会場：杜の広場公園（あすと長町1丁目・ゼビオアリーナ仙台 東側）',
      '- 衣装：BOOM Tシャツ',
      '- 参加費：お一人 3,000円',
      '',
      '### 全体リハーサル（2回）',
      '日程は会員向けGoogleカレンダーで公開しています。下のボタンからご確認ください。',
      'HIPHOPパートの練習日程もカレンダーに掲載しています。',
    ].join('\n'),
  };
}

export interface PerformerInput {
  name: string;
  parts: string[];
}
export interface SignupInput {
  understood: boolean;
  note?: string;
  performers: PerformerInput[];
}
export interface ValidatedPerformer {
  name: string;
  parts: PartKey[];
}
export interface ValidatedSignup {
  note: string;
  performers: ValidatedPerformer[];
}

// 検証OKなら ValidatedSignup、NGなら日本語エラー文字列を返す。
export function validateSignupInput(input: SignupInput): ValidatedSignup | string {
  if (!input || !input.understood) return '内容の確認にチェックを入れてください';
  const rows = Array.isArray(input.performers) ? input.performers : [];
  const cleaned: ValidatedPerformer[] = [];
  for (const p of rows) {
    const name = (p?.name ?? '').trim();
    if (!name) continue;
    if (name.length > 50) return '出演者名が長すぎます（50文字以内）';
    const parts = Array.from(new Set((p?.parts ?? []).filter(isPartKey)));
    if (parts.length === 0) return `${name} さんの希望パートを1つ以上選んでください`;
    cleaned.push({ name, parts });
  }
  if (cleaned.length === 0) return '出演者を1人以上入力してください';
  if (cleaned.length > 10) return '一度に登録できるのは10人までです';
  const note = (input.note ?? '').trim().slice(0, 500);
  return { note, performers: cleaned };
}

export function generateEditToken(): string {
  return randomBytes(24).toString('hex');
}

export function countByPart(performers: { parts: PartKey[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of PART_KEYS) out[k] = 0;
  for (const p of performers) {
    for (const k of p.parts) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface SignupRowForCsv {
  performerName: string;
  parts: PartKey[];
  createdAt: string;
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function buildSignupCsv(rows: SignupRowForCsv[], labels: Record<string, string>): string {
  const header = ['出演者名', '希望パート', '申込日時'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const parts = r.parts.map((k) => labels[k] ?? k).join(' / ');
    lines.push([csvCell(r.performerName), csvCell(parts), csvCell(r.createdAt)].join(','));
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: テストを実行し全通過を確認**

Run: `npx vitest run src/lib/__tests__/eventSignup.test.ts`
Expected: PASS（全ケース緑）

- [ ] **Step 5: Commit**

```bash
git add src/lib/eventSignup.ts src/lib/__tests__/eventSignup.test.ts
git commit -m "feat(taihaku): 募集の純ロジック(検証/トークン/CSV/集計)をTDDで追加"
```

---

## Task 3: DBアクセス層 `eventSignupDb.ts`

**Files:**
- Create: `src/lib/eventSignupDb.ts`

DB接続を要するためvitestではなく、末尾のStep4でローカルDBに対する手動スクリプトで検証する。

- [ ] **Step 1: 実装を書く**

Create `src/lib/eventSignupDb.ts`:

```ts
// 太白まつり募集のDBアクセス層。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
import { getAll, getOne, execute, withWriteTx } from '@/lib/db';
import {
  PART_KEYS,
  isPartKey,
  defaultSettings,
  type PartKey,
  type PartDef,
  type ResolvedSettings,
  type ValidatedSignup,
} from '@/lib/eventSignup';

export interface OwnPerformer {
  name: string;
  parts: PartKey[];
}
export interface OwnSignup {
  note: string;
  performers: OwnPerformer[];
}
export interface StaffPerformer {
  id: number;
  name: string;
  parts: PartKey[];
}
export interface StaffSignup {
  id: number;
  note: string;
  createdAt: string;
  performers: StaffPerformer[];
}

export async function findEventByCode(code: string): Promise<{ id: number; name: string } | null> {
  const row = await getOne('SELECT id, name FROM events WHERE UPPER(code) = UPPER(?)', [code]);
  return row ? { id: Number(row.id), name: String(row.name) } : null;
}

// 設定行が無ければデフォルトを返す(永続化はしない=公開/スタッフ双方から安全に読める)。
export async function resolveSettings(eventId: number): Promise<ResolvedSettings> {
  const row = await getOne('SELECT * FROM event_signup_settings WHERE event_id = ?', [eventId]);
  if (!row) return defaultSettings();
  let parts: PartDef[];
  try {
    const parsed = JSON.parse(String(row.parts_json || '[]'));
    parts = Array.isArray(parsed) && parsed.length ? parsed : defaultSettings().parts;
  } catch {
    parts = defaultSettings().parts;
  }
  return {
    parts,
    feeText: String(row.fee_text ?? ''),
    deadline: String(row.deadline ?? ''),
    introMd: String(row.intro_md ?? ''),
    calendarUrl: String(row.calendar_url ?? ''),
    isOpen: Number(row.is_open ?? 1) === 1,
  };
}

export async function saveSettings(eventId: number, s: ResolvedSettings): Promise<void> {
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO event_signup_settings
       (event_id, parts_json, fee_text, deadline, intro_md, calendar_url, is_open, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       parts_json = excluded.parts_json,
       fee_text = excluded.fee_text,
       deadline = excluded.deadline,
       intro_md = excluded.intro_md,
       calendar_url = excluded.calendar_url,
       is_open = excluded.is_open,
       updated_at = excluded.updated_at`,
    [
      eventId,
      JSON.stringify(s.parts),
      s.feeText,
      s.deadline,
      s.introMd,
      s.calendarUrl,
      s.isOpen ? 1 : 0,
      now,
    ]
  );
}

async function insertPerformers(
  tx: Parameters<Parameters<typeof withWriteTx>[0]>[0],
  signupId: number,
  performers: ValidatedSignup['performers']
): Promise<void> {
  for (let i = 0; i < performers.length; i++) {
    const p = performers[i];
    const res = await tx.execute({
      sql: 'INSERT INTO event_signup_performers (signup_id, performer_name, sort_order) VALUES (?, ?, ?)',
      args: [signupId, p.name, i],
    });
    const performerId = Number(res.lastInsertRowid);
    for (const part of p.parts) {
      await tx.execute({
        sql: 'INSERT INTO event_signup_parts (performer_id, part_key) VALUES (?, ?)',
        args: [performerId, part],
      });
    }
  }
}

// 新規申込を作成しトークンを返す。
export async function createSignup(
  eventId: number,
  token: string,
  data: ValidatedSignup
): Promise<void> {
  const now = new Date().toISOString();
  await withWriteTx(async (tx) => {
    const res = await tx.execute({
      sql: 'INSERT INTO event_signups (event_id, edit_token, understood, note, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)',
      args: [eventId, token, data.note, now, now],
    });
    const signupId = Number(res.lastInsertRowid);
    await insertPerformers(tx, signupId, data.performers);
  });
}

// トークン一致の1件だけ返す(列挙不可)。無ければ null。
export async function loadByToken(eventId: number, token: string): Promise<OwnSignup | null> {
  const su = await getOne(
    'SELECT id, note FROM event_signups WHERE event_id = ? AND edit_token = ?',
    [eventId, token]
  );
  if (!su) return null;
  const performers = await getAll(
    'SELECT id, performer_name FROM event_signup_performers WHERE signup_id = ? ORDER BY sort_order ASC, id ASC',
    [Number(su.id)]
  );
  const out: OwnPerformer[] = [];
  for (const p of performers) {
    const parts = await getAll(
      'SELECT part_key FROM event_signup_parts WHERE performer_id = ?',
      [Number(p.id)]
    );
    out.push({
      name: String(p.performer_name),
      parts: parts.map((r) => String(r.part_key)).filter(isPartKey) as PartKey[],
    });
  }
  return { note: String(su.note ?? ''), performers: out };
}

// トークン一致の申込を丸ごと差し替える(出演者・パートを作り直す)。成功可否を返す。
export async function updateByToken(
  eventId: number,
  token: string,
  data: ValidatedSignup
): Promise<boolean> {
  const su = await getOne(
    'SELECT id FROM event_signups WHERE event_id = ? AND edit_token = ?',
    [eventId, token]
  );
  if (!su) return false;
  const signupId = Number(su.id);
  const now = new Date().toISOString();
  await withWriteTx(async (tx) => {
    const perfIds = await tx.execute({
      sql: 'SELECT id FROM event_signup_performers WHERE signup_id = ?',
      args: [signupId],
    });
    for (const r of perfIds.rows) {
      await tx.execute({ sql: 'DELETE FROM event_signup_parts WHERE performer_id = ?', args: [Number(r.id)] });
    }
    await tx.execute({ sql: 'DELETE FROM event_signup_performers WHERE signup_id = ?', args: [signupId] });
    await tx.execute({
      sql: 'UPDATE event_signups SET note = ?, updated_at = ? WHERE id = ?',
      args: [data.note, now, signupId],
    });
    await insertPerformers(tx, signupId, data.performers);
  });
  return true;
}

// スタッフ用: 全申込を出演者・パート込みで返す(トークンは返さない)。
export async function listByEvent(eventId: number): Promise<StaffSignup[]> {
  const signups = await getAll(
    'SELECT id, note, created_at FROM event_signups WHERE event_id = ? ORDER BY created_at ASC, id ASC',
    [eventId]
  );
  const out: StaffSignup[] = [];
  for (const su of signups) {
    const performers = await getAll(
      'SELECT id, performer_name FROM event_signup_performers WHERE signup_id = ? ORDER BY sort_order ASC, id ASC',
      [Number(su.id)]
    );
    const ps: StaffPerformer[] = [];
    for (const p of performers) {
      const parts = await getAll('SELECT part_key FROM event_signup_parts WHERE performer_id = ?', [Number(p.id)]);
      ps.push({
        id: Number(p.id),
        name: String(p.performer_name),
        parts: parts.map((r) => String(r.part_key)).filter(isPartKey) as PartKey[],
      });
    }
    out.push({ id: Number(su.id), note: String(su.note ?? ''), createdAt: String(su.created_at), performers: ps });
  }
  return out;
}

export async function deleteSignup(eventId: number, signupId: number): Promise<void> {
  const su = await getOne('SELECT id FROM event_signups WHERE id = ? AND event_id = ?', [signupId, eventId]);
  if (!su) return;
  await withWriteTx(async (tx) => {
    const perfIds = await tx.execute({
      sql: 'SELECT id FROM event_signup_performers WHERE signup_id = ?',
      args: [signupId],
    });
    for (const r of perfIds.rows) {
      await tx.execute({ sql: 'DELETE FROM event_signup_parts WHERE performer_id = ?', args: [Number(r.id)] });
    }
    await tx.execute({ sql: 'DELETE FROM event_signup_performers WHERE signup_id = ?', args: [signupId] });
    await tx.execute({ sql: 'DELETE FROM event_signups WHERE id = ?', args: [signupId] });
  });
}

// スタッフ用: 出演者1人の名前/パートを更新。event_id 経由で所有チェック。
export async function updatePerformer(
  eventId: number,
  performerId: number,
  name: string,
  parts: PartKey[]
): Promise<boolean> {
  const row = await getOne(
    `SELECT p.id FROM event_signup_performers p
       JOIN event_signups s ON s.id = p.signup_id
      WHERE p.id = ? AND s.event_id = ?`,
    [performerId, eventId]
  );
  if (!row) return false;
  await withWriteTx(async (tx) => {
    await tx.execute({ sql: 'UPDATE event_signup_performers SET performer_name = ? WHERE id = ?', args: [name, performerId] });
    await tx.execute({ sql: 'DELETE FROM event_signup_parts WHERE performer_id = ?', args: [performerId] });
    for (const k of parts) {
      await tx.execute({ sql: 'INSERT INTO event_signup_parts (performer_id, part_key) VALUES (?, ?)', args: [performerId, k] });
    }
  });
  return true;
}

// スタッフ用: 出演者1人を削除。最後の1人を消すと申込ごと消す。
export async function deletePerformer(eventId: number, performerId: number): Promise<void> {
  const row = await getOne(
    `SELECT p.id, p.signup_id FROM event_signup_performers p
       JOIN event_signups s ON s.id = p.signup_id
      WHERE p.id = ? AND s.event_id = ?`,
    [performerId, eventId]
  );
  if (!row) return;
  const signupId = Number(row.signup_id);
  await withWriteTx(async (tx) => {
    await tx.execute({ sql: 'DELETE FROM event_signup_parts WHERE performer_id = ?', args: [performerId] });
    await tx.execute({ sql: 'DELETE FROM event_signup_performers WHERE id = ?', args: [performerId] });
    const remain = await tx.execute({
      sql: 'SELECT COUNT(*) AS n FROM event_signup_performers WHERE signup_id = ?',
      args: [signupId],
    });
    if (Number(remain.rows[0].n) === 0) {
      await tx.execute({ sql: 'DELETE FROM event_signups WHERE id = ?', args: [signupId] });
    }
  });
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: `eventSignupDb.ts` 由来のエラーが無い（既存の無関係エラーがあれば無視。新規ファイルに関する赤が無いことを確認）

- [ ] **Step 3: ローカルDBで往復を手動検証**

Create a temp script `scripts/_tmp_signup_check.mjs`（検証後に削除）:

```js
import { createSignup, loadByToken, listByEvent, updateByToken, deleteSignup } from '../src/lib/eventSignupDb.ts';
```
※ `.ts` を node で直接importできないため、代わりに **vitestで一時検証**する方が速い。次のStepの一時テストを使う。

- [ ] **Step 3(改): 一時的な統合テストで往復を確認(ローカルfile DB)**

Create `src/lib/__tests__/eventSignupDb.local.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { initDb } from '../db';
import { execute, getOne } from '../db';
import {
  findEventByCode,
  createSignup,
  loadByToken,
  listByEvent,
  updateByToken,
  deletePerformer,
  deleteSignup,
} from '../eventSignupDb';

let eventId = 0;
beforeAll(async () => {
  await initDb();
  await execute("INSERT INTO events (code, name, status) VALUES ('TESTEV', 'テスト', 'planning')", []);
  const ev = await getOne("SELECT id FROM events WHERE code = 'TESTEV'", []);
  eventId = Number(ev.id);
});

describe('eventSignupDb 往復', () => {
  it('作成→トークン読込→更新→一覧→出演者削除→申込削除', async () => {
    const found = await findEventByCode('testev');
    expect(found?.id).toBe(eventId);

    const token = 'tok_' + Date.now();
    await createSignup(eventId, token, {
      note: 'よろしく',
      performers: [
        { name: '太郎', parts: ['girls_hh', 'waack'] },
        { name: '次郎', parts: ['hiphop'] },
      ],
    });

    const own = await loadByToken(eventId, token);
    expect(own?.performers.length).toBe(2);
    expect(own?.performers[0]).toEqual({ name: '太郎', parts: ['girls_hh', 'waack'] });

    const okUpd = await updateByToken(eventId, token, {
      note: '変更',
      performers: [{ name: '太郎', parts: ['waack'] }],
    });
    expect(okUpd).toBe(true);
    const own2 = await loadByToken(eventId, token);
    expect(own2?.performers.length).toBe(1);
    expect(own2?.note).toBe('変更');

    const list = await listByEvent(eventId);
    const mine = list.find((s) => s.note === '変更');
    expect(mine?.performers[0].name).toBe('太郎');

    await deleteSignup(eventId, mine!.id);
    expect(await loadByToken(eventId, token)).toBeNull();
  });
});
```

Run: `npx vitest run src/lib/__tests__/eventSignupDb.local.test.ts`
Expected: PASS（ローカル `file:./data/bw5.db` に対して往復成功）

- [ ] **Step 4: 一時テストを削除(ローカルDBを汚さない/CIを軽く保つ)**

Run: `git rm -f --cached src/lib/__tests__/eventSignupDb.local.test.ts 2>/dev/null; rm -f src/lib/__tests__/eventSignupDb.local.test.ts`
理由: このテストは実DBファイルに書き込むため恒久テストには含めない(純ロジックはTask2でカバー済み)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/eventSignupDb.ts
git commit -m "feat(taihaku): 募集DBアクセス層(申込CRUD・設定解決/保存)"
```

---

## Task 4: 公開Server Actions `entry/[code]/actions.ts`

**Files:**
- Create: `src/app/entry/[code]/actions.ts`

- [ ] **Step 1: 実装を書く**

Create `src/app/entry/[code]/actions.ts`:

```ts
'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: 太白まつり出演者募集の公開フォーム
// src/app/entry/[code]/page.tsx が生徒/保護者用に叩くため。
// PII対策: 名簿を列挙するアクションは提供しない。閲覧はトークン一致の自分の1件のみ。
// 送信/編集はIP単位でレート制限する。
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { validateSignupInput, generateEditToken, type SignupInput, type ResolvedSettings } from '@/lib/eventSignup';
import {
  findEventByCode,
  resolveSettings,
  createSignup,
  loadByToken,
  updateByToken,
  type OwnSignup,
} from '@/lib/eventSignupDb';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export type PublicView =
  | { ok: true; eventName: string; settings: ResolvedSettings }
  | { ok: false; error: string };

// 公開: イベント名と設定(パート/参加費/説明/カレンダー/受付状態)を返す。名簿は返さない。
export async function getPublicView(code: string): Promise<PublicView> {
  const ev = await findEventByCode(code);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };
  const settings = await resolveSettings(ev.id);
  return { ok: true, eventName: ev.name, settings };
}

export type SubmitResult = { ok: true; token: string } | { ok: false; error: string };

export async function submitSignup(code: string, payload: SignupInput): Promise<SubmitResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`signup:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const ev = await findEventByCode(code);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };
  const settings = await resolveSettings(ev.id);
  if (!settings.isOpen) return { ok: false, error: '現在は受付を停止しています' };
  const validated = validateSignupInput(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const token = generateEditToken();
  await createSignup(ev.id, token, validated);
  return { ok: true, token };
}

export type LoadOwnResult = { ok: true; signup: OwnSignup } | { ok: false; error: string };

export async function loadOwnSignup(code: string, token: string): Promise<LoadOwnResult> {
  if (!token) return { ok: false, error: 'トークンがありません' };
  const ev = await findEventByCode(code);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };
  const signup = await loadByToken(ev.id, token);
  if (!signup) return { ok: false, error: '申込が見つかりません' };
  return { ok: true, signup };
}

export type UpdateResult = { ok: true } | { ok: false; error: string };

export async function updateOwnSignup(code: string, token: string, payload: SignupInput): Promise<UpdateResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`signup:${ip}`, 20, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const ev = await findEventByCode(code);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };
  const validated = validateSignupInput(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const ok = await updateByToken(ev.id, token, validated);
  if (!ok) return { ok: false, error: '申込が見つかりません' };
  return { ok: true };
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: このファイル由来のエラー無し。

- [ ] **Step 3: Commit**

```bash
git add src/app/entry/[code]/actions.ts
git commit -m "feat(taihaku): 公開フォームのServer Actions(閲覧/送信/自己編集・レート制限)"
```

---

## Task 5: 公開フォーム画面 `entry/[code]/page.tsx` + 流れ図

**Files:**
- Create: `src/app/entry/[code]/FlowDiagram.tsx`
- Create: `src/app/entry/[code]/page.tsx`

- [ ] **Step 1: 流れ図コンポーネントを作成**

Create `src/app/entry/[code]/FlowDiagram.tsx`:

```tsx
'use client';

import type { PartDef } from '@/lib/eventSignup';

// 演目の流れ: 全員(冒頭) → パート別(交代) → 全員(締め)
export default function FlowDiagram({ parts }: { parts: PartDef[] }) {
  const box = 'rounded-xl px-3 py-2 text-center text-xs font-bold border';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">演目の流れ</div>
      <div className="flex flex-col gap-2">
        <div className={`${box} bg-amber-50 border-amber-200 text-amber-700`}>全員（冒頭 1分）</div>
        <div className="text-center text-slate-300 text-sm">▼</div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] text-slate-400 text-center mb-1.5">パートごとに交代</div>
          <div className="grid grid-cols-1 gap-1.5">
            {parts.map((p) => (
              <div key={p.key} className={`${box} bg-teal-50 border-teal-200 text-teal-700`}>
                {p.label}
                {p.note ? <span className="block text-[9px] font-normal text-teal-500 mt-0.5">{p.note}</span> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="text-center text-slate-300 text-sm">▼</div>
        <div className={`${box} bg-amber-50 border-amber-200 text-amber-700`}>全員（締め 1分）</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 公開ページ本体を作成**

Create `src/app/entry/[code]/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState, use as usePromise } from 'react';
import {
  getPublicView,
  submitSignup,
  loadOwnSignup,
  updateOwnSignup,
  type PublicView,
} from './actions';
import type { PartDef, PartKey, SignupInput } from '@/lib/eventSignup';
import FlowDiagram from './FlowDiagram';

type PerformerRow = { name: string; parts: PartKey[] };

function tokenStorageKey(code: string) {
  return `taihaku_signup_token_${code}`;
}

export default function EntryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = usePromise(params);
  const [view, setView] = useState<PublicView | null>(null);
  const [loading, setLoading] = useState(true);

  // token（自己編集用）: URLの ?t= か localStorage から
  const [token, setToken] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [understood, setUnderstood] = useState(false);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<PerformerRow[]>([{ name: '', parts: [] }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneToken, setDoneToken] = useState<string | null>(null);

  const parts: PartDef[] = useMemo(
    () => (view && view.ok ? view.settings.parts : []),
    [view]
  );

  useEffect(() => {
    (async () => {
      const v = await getPublicView(code);
      setView(v);
      setLoading(false);
      // token 解決: URL優先→localStorage
      const url = new URL(window.location.href);
      const t = url.searchParams.get('t') || localStorage.getItem(tokenStorageKey(code));
      if (t) setToken(t);
    })();
  }, [code]);

  // token があれば自分の申込をロードして編集モードに
  useEffect(() => {
    if (!token) return;
    (async () => {
      const r = await loadOwnSignup(code, token);
      if (r.ok) {
        setUnderstood(true);
        setNote(r.signup.note);
        setRows(r.signup.performers.map((p) => ({ name: p.name, parts: p.parts })));
        setEditing(true);
        localStorage.setItem(tokenStorageKey(code), token);
      }
    })();
  }, [token, code]);

  const togglePart = useCallback((idx: number, key: PartKey) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx
          ? { ...r, parts: r.parts.includes(key) ? r.parts.filter((k) => k !== key) : [...r.parts, key] }
          : r
      )
    );
  }, []);

  function addRow() {
    setRows((r) => [...r, { name: '', parts: [] }]);
  }
  function removeRow(idx: number) {
    setRows((r) => (r.length <= 1 ? r : r.filter((_, i) => i !== idx)));
  }

  async function onSubmit() {
    setError('');
    setSubmitting(true);
    try {
      const payload: SignupInput = { understood, note, performers: rows };
      if (editing && token) {
        const r = await updateOwnSignup(code, token, payload);
        if (!r.ok) { setError(r.error); return; }
        setDoneToken(token);
      } else {
        const r = await submitSignup(code, payload);
        if (!r.ok) { setError(r.error); return; }
        localStorage.setItem(tokenStorageKey(code), r.token);
        setDoneToken(r.token);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">読み込み中…</div>;
  }
  if (!view || !view.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center text-slate-500">
        {view && !view.ok ? view.error : 'エラーが発生しました'}
      </div>
    );
  }

  // サンクス画面
  if (doneToken) {
    const editUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/entry/${code}?t=${doneToken}`;
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="max-w-md mx-auto space-y-4">
          <div className="rounded-2xl border border-teal-200 bg-white p-5 text-center">
            <div className="text-2xl mb-1">✅</div>
            <h1 className="text-lg font-bold text-slate-800">申込を受け付けました</h1>
            <p className="text-sm text-slate-500 mt-1">ありがとうございます。</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-bold text-slate-500 mb-1">編集用リンク（保管してください）</div>
            <p className="text-[11px] text-slate-400 mb-2">
              このリンクから、あとで内容を修正できます。別の端末で直すときに使うので、LINEのトークに残すかブックマークしてください。
            </p>
            <input
              readOnly
              value={editUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-slate-50"
            />
            <button
              onClick={() => navigator.clipboard?.writeText(editUrl)}
              className="mt-2 w-full rounded-lg bg-teal-600 text-white text-sm font-bold py-2"
            >
              リンクをコピー
            </button>
          </div>
          <button
            onClick={() => { setDoneToken(null); setEditing(true); setToken(doneToken); }}
            className="w-full text-sm text-slate-500 underline"
          >
            続けて内容を確認・修正する
          </button>
        </div>
      </div>
    );
  }

  const s = view.settings;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-xl font-bold text-slate-800 text-center">{view.eventName}</h1>

        {/* 説明 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
          {s.introMd}
        </div>

        {/* 参加費 */}
        {s.feeText && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-sm font-bold text-amber-800">
            {s.feeText}
          </div>
        )}

        {/* 流れ図 */}
        <FlowDiagram parts={parts} />

        {/* カレンダーリンク */}
        {s.calendarUrl && (
          <a
            href={s.calendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm font-bold text-teal-700"
          >
            📅 全体リハ・HIPHOPの日程（Googleカレンダー）を見る
          </a>
        )}

        {/* 受付停止 */}
        {!s.isOpen && !editing && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">
            現在は受付を停止しています。
          </div>
        )}

        {(s.isOpen || editing) && (
          <>
            {/* 理解チェック */}
            <label className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>上記の内容（日時・会場・参加費・演目の流れ）を読み、理解しました。</span>
            </label>

            {/* 出演者ブロック */}
            <div className="space-y-3">
              {rows.map((row, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-slate-500">出演者 {idx + 1}</div>
                    {rows.length > 1 && (
                      <button onClick={() => removeRow(idx)} className="text-xs text-red-500">削除</button>
                    )}
                  </div>
                  <input
                    value={row.name}
                    onChange={(e) => setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
                    placeholder="出演者名（お名前）"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1.5">希望パート（複数選べます）</div>
                    <div className="flex flex-wrap gap-2">
                      {parts.map((p) => {
                        const on = row.parts.includes(p.key);
                        return (
                          <button
                            key={p.key}
                            type="button"
                            onClick={() => togglePart(idx, p.key)}
                            className={`rounded-full px-3 py-1.5 text-xs font-bold border ${
                              on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-300'
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={addRow}
                className="w-full rounded-2xl border border-dashed border-slate-300 bg-white py-3 text-sm font-bold text-slate-500"
              >
                ＋ 出演者を追加（兄弟など）
              </button>
            </div>

            {/* メモ */}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="連絡事項があればご記入ください（任意）"
              rows={2}
              className="w-full border border-slate-200 rounded-2xl px-3 py-2 text-sm bg-white"
            />

            {error && <div className="text-sm text-red-600 text-center">{error}</div>}

            <button
              onClick={onSubmit}
              disabled={submitting}
              className="w-full rounded-2xl bg-teal-600 text-white text-base font-bold py-3 disabled:opacity-50"
            >
              {submitting ? '送信中…' : editing ? '内容を更新する' : '申し込む'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: このディレクトリ由来のエラー無し。

- [ ] **Step 4: 手動確認(dev)**

preview_start(name=dev) → `/entry/taihaku2026` を開く。まだ `TAIHAKU2026` イベントが無い場合は「イベントが見つかりません」表示でOK（Task 8でイベント作成後に本確認）。コンソール/preview_logs にエラーが無いこと。

- [ ] **Step 5: Commit**

```bash
git add src/app/entry/[code]/page.tsx src/app/entry/[code]/FlowDiagram.tsx
git commit -m "feat(taihaku): 公開フォーム(説明→流れ図→兄弟対応入力→サンクス/自己編集)"
```

---

## Task 6: スタッフ集計 API(GET/DELETE/PATCH/設定/CSV)

**Files:**
- Create: `src/app/api/staff/events/[eventId]/signups/route.ts`
- Create: `src/app/api/staff/events/[eventId]/signups/[signupId]/route.ts`
- Create: `src/app/api/staff/events/[eventId]/signups/performers/[performerId]/route.ts`
- Create: `src/app/api/staff/events/[eventId]/signups/settings/route.ts`
- Create: `src/app/api/staff/events/[eventId]/signups/export/route.ts`

Next 16 の route handler は `context.params` が Promise。既存 events API に倣い `isAuthorized(req)`/`unauthorized()` を使う。

- [ ] **Step 1: 一覧+サマリー GET**

Create `src/app/api/staff/events/[eventId]/signups/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { resolveSettings, listByEvent } from '@/lib/eventSignupDb';
import { countByPart, type PartKey } from '@/lib/eventSignup';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { eventId } = await ctx.params;
  const id = Number(eventId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'bad eventId' }, { status: 400 });

  const settings = await resolveSettings(id);
  const signups = await listByEvent(id);

  const flatPerformers = signups.flatMap((s) => s.performers.map((p) => ({ parts: p.parts as PartKey[] })));
  const counts = countByPart(flatPerformers);
  const byPart = settings.parts.map((p) => ({ key: p.key, label: p.label, count: counts[p.key] ?? 0 }));
  const performerCount = flatPerformers.length;

  return NextResponse.json({
    summary: { signupCount: signups.length, performerCount, byPart },
    parts: settings.parts.map((p) => ({ key: p.key, label: p.label })),
    signups,
  });
}
```

- [ ] **Step 2: 申込削除 DELETE**

Create `src/app/api/staff/events/[eventId]/signups/[signupId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { deleteSignup } from '@/lib/eventSignupDb';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ eventId: string; signupId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { eventId, signupId } = await ctx.params;
  await deleteSignup(Number(eventId), Number(signupId));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 出演者の編集/削除 PATCH/DELETE**

Create `src/app/api/staff/events/[eventId]/signups/performers/[performerId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { updatePerformer, deletePerformer } from '@/lib/eventSignupDb';
import { isPartKey, type PartKey } from '@/lib/eventSignup';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ eventId: string; performerId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { eventId, performerId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: '名前は必須です' }, { status: 400 });
  const parts = (Array.isArray(body?.parts) ? body.parts : []).filter(isPartKey) as PartKey[];
  if (parts.length === 0) return NextResponse.json({ error: 'パートを1つ以上選んでください' }, { status: 400 });
  const ok = await updatePerformer(Number(eventId), Number(performerId), name, parts);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ eventId: string; performerId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { eventId, performerId } = await ctx.params;
  await deletePerformer(Number(eventId), Number(performerId));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: 設定 GET/PUT**

Create `src/app/api/staff/events/[eventId]/signups/settings/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { resolveSettings, saveSettings } from '@/lib/eventSignupDb';
import { DEFAULT_PARTS, type ResolvedSettings } from '@/lib/eventSignup';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { eventId } = await ctx.params;
  const settings = await resolveSettings(Number(eventId));
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { eventId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const next: ResolvedSettings = {
    parts: Array.isArray(body?.parts) && body.parts.length ? body.parts : DEFAULT_PARTS,
    feeText: String(body?.feeText ?? ''),
    deadline: String(body?.deadline ?? ''),
    introMd: String(body?.introMd ?? ''),
    calendarUrl: String(body?.calendarUrl ?? ''),
    isOpen: Boolean(body?.isOpen),
  };
  await saveSettings(Number(eventId), next);
  return NextResponse.json({ ok: true, settings: next });
}
```

- [ ] **Step 5: CSV出力 GET**

Create `src/app/api/staff/events/[eventId]/signups/export/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { resolveSettings, listByEvent } from '@/lib/eventSignupDb';
import { buildSignupCsv, type SignupRowForCsv } from '@/lib/eventSignup';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { eventId } = await ctx.params;
  const id = Number(eventId);
  const settings = await resolveSettings(id);
  const labels = Object.fromEntries(settings.parts.map((p) => [p.key, p.label]));
  const signups = await listByEvent(id);
  const rows: SignupRowForCsv[] = signups.flatMap((s) =>
    s.performers.map((p) => ({ performerName: p.name, parts: p.parts, createdAt: s.createdAt }))
  );
  const csv = '﻿' + buildSignupCsv(rows, labels);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="taihaku_signups_${id}.csv"`,
    },
  });
}
```

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: これらのroute由来のエラー無し。

- [ ] **Step 7: Commit**

```bash
git add src/app/api/staff/events/[eventId]/signups
git commit -m "feat(taihaku): スタッフ集計API(一覧/サマリー/削除/編集/設定/CSV・認証)"
```

---

## Task 7: スタッフ集計画面 + イベント詳細への導線

**Files:**
- Create: `src/app/staff/events/[eventId]/signups/page.tsx`
- Modify: `src/app/staff/events/[eventId]/page.tsx`（無効カードを差し替え）

- [ ] **Step 1: 集計画面を作成**

Create `src/app/staff/events/[eventId]/signups/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Download, Trash2 } from 'lucide-react';
import StaffPageHeader from '@/components/StaffPageHeader';

type PartMeta = { key: string; label: string };
type Performer = { id: number; name: string; parts: string[] };
type Signup = { id: number; note: string; createdAt: string; performers: Performer[] };
type Summary = { signupCount: number; performerCount: number; byPart: { key: string; label: string; count: number }[] };

export default function SignupsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [parts, setParts] = useState<PartMeta[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/events/${eventId}/signups`, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = `/staff/events/login?next=/staff/events/${eventId}/signups`;
        return;
      }
      const data = await res.json();
      setSummary(data.summary);
      setParts(data.parts ?? []);
      setSignups(data.signups ?? []);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  async function delSignup(id: number) {
    if (!confirm('この申込（兄弟含む）を削除しますか？')) return;
    const res = await fetch(`/api/staff/events/${eventId}/signups/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { toast.success('削除しました'); load(); } else { toast.error('削除に失敗しました'); }
  }

  const labelOf = (key: string) => parts.find((p) => p.key === key)?.label ?? key;

  if (loading) return <div className="p-8 text-muted-foreground">読み込み中...</div>;

  return (
    <div>
      <StaffPageHeader
        title="出演者募集・集計"
        description="太白区民まつり2026 出演者の申込状況"
        backHref={`/staff/events/${eventId}`}
        backLabel="イベント"
        rightExtra={
          <Button asChild size="sm" variant="outline">
            <a href={`/api/staff/events/${eventId}/signups/export`}>
              <Download className="size-3.5 mr-1" />CSV
            </a>
          </Button>
        }
      />

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* サマリー */}
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card><CardContent className="py-3 text-center">
            <div className="text-2xl font-bold text-navy-700">{summary?.performerCount ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">総出演者</div>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <div className="text-2xl font-bold text-navy-700">{summary?.signupCount ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">申込数</div>
          </CardContent></Card>
          {summary?.byPart.map((p) => (
            <Card key={p.key}><CardContent className="py-3 text-center">
              <div className="text-2xl font-bold text-brand-600">{p.count}</div>
              <div className="text-xs text-muted-foreground mt-1">{p.label}</div>
            </CardContent></Card>
          ))}
        </section>

        {/* パート別名簿 */}
        {parts.map((part) => {
          const members = signups.flatMap((s) =>
            s.performers.filter((p) => p.parts.includes(part.key)).map((p) => p.name)
          );
          return (
            <section key={part.key} className="space-y-2">
              <h2 className="text-sm font-bold text-navy-700 flex items-center gap-2">
                {part.label}
                <Badge variant="secondary" className="text-[10px]">{members.length}名</Badge>
              </h2>
              <Card><CardContent className="py-3">
                {members.length === 0 ? (
                  <div className="text-xs text-muted-foreground">まだいません</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((n, i) => (
                      <span key={i} className="text-xs bg-sand-100 rounded-full px-2.5 py-1">{n}</span>
                    ))}
                  </div>
                )}
              </CardContent></Card>
            </section>
          );
        })}

        {/* 全体名簿（申込単位・兄弟グルーピング） */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-navy-700">全体名簿（申込ごと）</h2>
          {signups.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">まだ申込がありません</CardContent></Card>
          ) : (
            <ul className="space-y-2">
              {signups.map((s) => (
                <li key={s.id}>
                  <Card><CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 min-w-0">
                        {s.performers.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                            {p.parts.map((k) => (
                              <Badge key={k} variant="outline" className="text-[10px]">{labelOf(k)}</Badge>
                            ))}
                          </div>
                        ))}
                        {s.note && <div className="text-xs text-muted-foreground mt-1">メモ: {s.note}</div>}
                        <div className="text-[10px] text-muted-foreground">{s.createdAt}</div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => delSignup(s.id)} className="shrink-0">
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </div>
                  </CardContent></Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: イベント詳細ページに導線を追加**

Modify `src/app/staff/events/[eventId]/page.tsx`。`<nav>` 内の「スタッフ管理(Phase 2)」の無効カードを、以下の有効カードに差し替える（`Users` アイコンは既にimport済み）:

```tsx
          <NavCard
            href={`/staff/events/${eventId}/signups`}
            title="出演者募集・集計"
            desc="申込状況・パート別名簿・CSV"
            icon={<Users className="size-4" />}
          />
```

（差し替え対象は現状の `<NavCard href="#" title="スタッフ管理" desc="(Phase 2 で実装)" ... disabled />` の1枚。他の disabled カードはそのまま。）

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: これらの画面由来のエラー無し。

- [ ] **Step 4: Commit**

```bash
git add src/app/staff/events/[eventId]/signups/page.tsx src/app/staff/events/[eventId]/page.tsx
git commit -m "feat(taihaku): スタッフ集計画面(パート別/全体名簿/CSV/削除)とイベント詳細の導線"
```

---

## Task 8: セットアップ・エンドツーエンド確認

**Files:** なし（運用手順+動作確認）

- [ ] **Step 1: TAIHAKU2026 イベントを作成**

dev起動: preview_start(name=dev)。`/staff/events` を開き「新規イベント」で作成:
- コード: `TAIHAKU2026`
- 名称: `太白区民まつり2026`
- 開催日: `2026-10-18`
- ステータス: `preparing`

（認証が要る場合は `/staff/events/login` でパスワード `boom2026`）

- [ ] **Step 2: 公開フォームを確認**

`/entry/taihaku2026` を開く:
- 説明・参加費(3,000円)・演目の流れ図・（calendar_url未設定ならリンク非表示）が出る
- 理解チェック→出演者名+パート→「＋出演者を追加」で兄弟追加→申し込む
- サンクスに編集リンクが出る。`?t=` 付きURLで再訪すると内容がロードされ更新できる
- read_console_messages / preview_logs にエラーが無いこと

- [ ] **Step 3: スタッフ集計を確認**

`/staff/events` → TAIHAKU2026 → 「出演者募集・集計」カード:
- サマリー(総出演者/申込数/パート別人数)が反映
- パート別名簿・全体名簿(兄弟グルーピング)が出る
- CSVボタンでダウンロードでき、1行=1出演者・パートがラベルで入っている
- 申込削除が効く

- [ ] **Step 4: 全テスト+型+lint**

Run:
```bash
npx vitest run
npx tsc --noEmit
npm run lint
```
Expected: vitest 全緑 / 型エラー無し / lint 新規エラー無し

- [ ] **Step 5: 設定編集(任意・calendar_url投入)**

TAROが後で参加費/締切/説明/カレンダーURL/受付ON-OFFを変える導線として、設定PUT APIは実装済み。
（設定編集UIは本計画ではAPIまで。UIが必要なら別タスクで `/staff/events/[eventId]/signups/settings/page.tsx` を追加。まずは `resolveSettings` のデフォルトで公開可能。calendar_url は暫定で settings PUT を叩いて投入するか、次スプリントでUI追加。）

- [ ] **Step 6: STATE.md 更新**

`~/BOOM/boom-events-hub/STATE.md` のWS U行/更新ログに「実装完了・本番マイグレーション未適用(要 `node scripts/migrate.mjs` 本番実行)・TARO動作確認待ち」を追記し commit && push。

- [ ] **Step 7: 最終Commit（未コミット分があれば）**

```bash
git add -A
git commit -m "chore(taihaku): E2E確認と後片付け"
```

---

## 本番反映メモ（実装後・TARO作業）

1. 本番DBへマイグレーション適用: 本番env(`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`)で `node scripts/migrate.mjs`
2. Vercelデプロイ(main push で自動)
3. `/staff/events` で `TAIHAKU2026` を作成（本番でも1回必要）
4. 設定でGoogleカレンダーURL・締切・参加費文言を確定
5. `/entry/taihaku2026` のURLを生徒グループLINEへ

## Self-Review 結果

- **Spec coverage**: 演目の流れ図(Task5) / 兄弟複数登録(Task2,3,5) / PII最小・名簿非列挙(Task4 コメント+トークン限定read) / 参加費3000円(Task2 defaultSettings) / 自己編集 端末+リンク(Task5) / カレンダー誘導(Task5) / スタッフ集計 全体+パート別+人数+CSV(Task6,7) / events基盤統合(Task7) — 全項目にタスク対応あり。
- **Placeholders**: 各コードステップに実コードを記載。TBD無し。設定編集UIは明示的にスコープ外(APIは実装)としStep5に理由記載。
- **型整合**: `PartKey`/`ResolvedSettings`/`ValidatedSignup`/`SignupInput` を Task2 で定義し Task3-7 で一貫使用。関数名(`resolveSettings`/`listByEvent`/`countByPart`/`buildSignupCsv` 等)は定義と参照で一致を確認。
