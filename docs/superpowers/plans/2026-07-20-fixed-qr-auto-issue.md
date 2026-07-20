# HACOMONO固定QR 自動発行＆メール送信 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新規入会者全員に、HACOMONOの固定メンバーコード(QR)を自動発行し、保護者の実メールアドレスへQR画像を添付メールで届ける。

**Architecture:** GitHub Actions(毎朝8時台JST)上のPlaywrightがHACOMONO管理にログイン→ML001全メンバーCSVを直接エクスポート→未発行の新規入会者を特定→管理画面操作で固定コード発行→QR画像を取得→bw5-appの新API(`/api/staff/qr-issues`)へPOST→アプリが宛先解決(家族ダミーアドレス→代表アドレス)してGmail SMTPで送信・台帳記録。Mac非依存。

**Tech Stack:** GitHub Actions / Playwright(Node, `scripts/fixed_qr/`自己完結) / Next.js API route / Turso / nodemailer(既存email.ts) / vitest

**仕様書:** `docs/superpowers/specs/2026-07-20-fixed-qr-auto-issue-design.md`

**確定済みの事実(調査済み・2026-07-20):**
- ダミーアドレス = `@dummy.hacomono.mail`(実CSV 203名中21件)。家族(子)アカウントの親の実アドレスはML001の**「代表メールアドレス」列**に入っている(「その他メンバー（代表以外）」22名中22名で充足)
- ML001 = HACOMONO analysis query **id=7**。`GET /api/analysis/queries/export?query={"id":7,...}&file_type=csv&encoding=BOM--UTF-8` で直DL可(認証済みcontextから)
- HACOMONOログイン = `https://boom-admin.hacomono.jp/` で `input[type="text"]`/`input[type="password"]` に入力(daily_sync.py:278-283で毎日成功)
- 通知は既存 `staff_notifications(type,title,detail,severity)` へINSERT
- 本番マイグレーションは台帳SQL+migrate.mjs必須(`SKIP_DB_INIT=1`のためruntimeマイグレーション不走)。**台帳SQLは行内コメント禁止**
- TARO承認ゲート: **[A]** workflowのmain push+GH Secrets登録 **[B]** 実会員(TARO自身)でのE2E送信 **[C]** 本番マイグレーション適用+cron有効化+FAQ公開

---

### Task 1: 宛先解決・メール文面の純ロジック (TDD)

**Files:**
- Create: `src/lib/qrIssue.ts`
- Test: `src/lib/__tests__/qrIssue.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/qrIssue.test.ts
import { describe, it, expect } from 'vitest';
import { isDummyEmail, resolveRecipient, maskEmail, buildQrEmail } from '../qrIssue';

describe('isDummyEmail', () => {
  it('hacomonoダミーアドレスを判定する', () => {
    expect(isDummyEmail('abc123@dummy.hacomono.mail')).toBe(true);
    expect(isDummyEmail('ABC@DUMMY.HACOMONO.MAIL')).toBe(true);
    expect(isDummyEmail('taro@gmail.com')).toBe(false);
    expect(isDummyEmail('')).toBe(false);
    expect(isDummyEmail(null)).toBe(false);
  });
});

describe('resolveRecipient', () => {
  it('本人アドレスが実アドレスならそれを使う', () => {
    expect(resolveRecipient('taro@gmail.com', '')).toEqual({ ok: true, to: 'taro@gmail.com' });
  });
  it('本人がダミーなら代表アドレスへ', () => {
    expect(resolveRecipient('x@dummy.hacomono.mail', 'parent@gmail.com')).toEqual({ ok: true, to: 'parent@gmail.com' });
  });
  it('本人ダミー+代表なし → manual', () => {
    expect(resolveRecipient('x@dummy.hacomono.mail', '')).toEqual({ ok: false, reason: 'rep_email_missing' });
  });
  it('本人ダミー+代表もダミー → manual', () => {
    expect(resolveRecipient('x@dummy.hacomono.mail', 'y@dummy.hacomono.mail')).toEqual({ ok: false, reason: 'rep_email_dummy' });
  });
  it('本人アドレスが空 → 代表があれば代表へ、無ければmanual', () => {
    expect(resolveRecipient('', 'parent@gmail.com')).toEqual({ ok: true, to: 'parent@gmail.com' });
    expect(resolveRecipient('', '')).toEqual({ ok: false, reason: 'no_email' });
  });
});

describe('maskEmail', () => {
  it('ローカル部を伏せ字にしドメインは残す', () => {
    expect(maskEmail('taro@gmail.com')).toBe('t***@gmail.com');
    expect(maskEmail('a@icloud.com')).toBe('a***@icloud.com');
  });
  it('不正形式は全伏せ', () => {
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('buildQrEmail', () => {
  it('件名と本文(共有禁止・再印刷案内を含む)を組み立てる', () => {
    const m = buildQrEmail('山田 花');
    expect(m.subject).toBe('【BOOM】チェックイン用QRコード（印刷してご利用ください）');
    expect(m.text).toContain('山田 花 様');
    expect(m.text).toContain('他の人に共有しないでください');
    expect(m.text).toContain('チケットが消費');
    expect(m.text).toContain('このメールを保存しておけば、いつでも印刷し直せます');
    expect(m.text).toContain('返信でご連絡ください');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/qrIssue.test.ts`
Expected: FAIL (`Cannot find module '../qrIssue'`)

- [ ] **Step 3: 実装**

```ts
// src/lib/qrIssue.ts
// 固定QR自動発行(WS U / 2026-07-20)の純ロジック。
// 宛先解決: 家族(子)アカウントはHACOMONOがダミーアドレスを自動発行するため、
// ML001「代表メールアドレス」(親の実アドレス)へ送る。解決不能なら送らずmanual扱い。

const DUMMY_EMAIL_RE = /@dummy\.hacomono\.mail$/i;

export function isDummyEmail(email: string | null | undefined): boolean {
  return !!email && DUMMY_EMAIL_RE.test(email.trim());
}

export type RecipientResult =
  | { ok: true; to: string }
  | { ok: false; reason: 'no_email' | 'rep_email_missing' | 'rep_email_dummy' };

export function resolveRecipient(email: string | null, repEmail: string | null): RecipientResult {
  const own = (email ?? '').trim();
  const rep = (repEmail ?? '').trim();
  if (own && !isDummyEmail(own)) return { ok: true, to: own };
  if (rep && !isDummyEmail(rep)) return { ok: true, to: rep };
  if (!own && !rep) return { ok: false, reason: 'no_email' };
  if (!rep) return { ok: false, reason: 'rep_email_missing' };
  return { ok: false, reason: 'rep_email_dummy' };
}

// トラブル調査用の伏せ字 (生アドレスはDBに保存しない)
export function maskEmail(email: string): string {
  const m = email.match(/^(.).*@(.+)$/);
  return m ? `${m[1]}***@${m[2]}` : '***';
}

// メール文面 (骨子TARO承認済み 2026-07-20。清書はゲートBでTARO最終確認)
export function buildQrEmail(memberName: string): { subject: string; text: string } {
  const subject = '【BOOM】チェックイン用QRコード（印刷してご利用ください）';
  const text = `${memberName} 様

BOOMダンススクールです。いつもご利用ありがとうございます。

チェックイン用の「固定QRコード」を添付でお送りします。

■ これは何？
スタジオ入口のタブレットにかざす、チェックイン用のQRコードです。
マイページのQRコード（30分で切り替わります）と違い、このQRはずっと使えます。
印刷してお子さまに持たせていただければ、お子さまだけでもチェックインできます。

■ ⚠️ 他の人に共有しないでください
このQRで他の人がチェックインすると、あなたのチケットが消費されてしまいます。

■ なくしたときは
このメールを保存しておけば、いつでも印刷し直せます（QRは変わりません）。
QRを無効にして作り直したい場合は、このメールへの返信でご連絡ください。

BOOMダンススクール
boom.sendai@gmail.com`;
  return { subject, text };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/qrIssue.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/qrIssue.ts src/lib/__tests__/qrIssue.test.ts
git commit -m "feat: 固定QR発行の宛先解決・メール文面ロジック(WS U)"
```

---

### Task 2: member_qr_issues 台帳マイグレーション

**Files:**
- Create: `scripts/migrations/20260720_member_qr_issues.sql`

- [ ] **Step 1: 台帳SQLを書く**（⚠️行内コメント禁止: migrate.mjsは行末`;`で分割する）

```sql
-- 固定QR発行台帳(WS U / 2026-07-20)
-- QR画像・コード値・生メールアドレスは保存しない(email_to_maskedは伏せ字)
-- status: emailed / manual_needed / skipped_existing

CREATE TABLE IF NOT EXISTS member_qr_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hacomono_member_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  email_to_masked TEXT,
  issued_at TEXT,
  emailed_at TEXT,
  detail TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_member_qr_issues_status ON member_qr_issues(status);
```

- [ ] **Step 2: ローカルDBで適用テスト**

Run: `node scripts/migrate.mjs --dry-run`（TURSO_DATABASE_URL未設定=ローカルfile DB）
Expected: `未適用: 20260720_member_qr_issues.sql` が一覧に出る

Run: `node scripts/migrate.mjs`
Expected: `適用: 20260720_member_qr_issues.sql (2 statements)` → `apply 完了`

- [ ] **Step 3: コミット**（本番適用はゲートC）

```bash
git add scripts/migrations/20260720_member_qr_issues.sql
git commit -m "feat: member_qr_issues台帳マイグレーション(WS U)"
```

---

### Task 3: API `/api/staff/qr-issues` (GET=発行済み一覧 / POST=送信+記録)

**Files:**
- Create: `src/app/api/staff/qr-issues/route.ts`

- [ ] **Step 1: 実装**

```ts
// src/app/api/staff/qr-issues/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sendEmail } from '@/lib/email';
import { resolveRecipient, maskEmail, buildQrEmail } from '@/lib/qrIssue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 固定QR発行台帳 (WS U / 2026-07-20)
 * GET  : 発行済み(=台帳に記録がある) hacomono_member_id の一覧。GH Actionsスクリプトが差分計算に使う
 * POST : multipart/form-data
 *   hacomono_member_id (必須)
 *   member_name        (メール宛名。DBには保存しない)
 *   email / rep_email  (ML001の本人・代表アドレス。DBには保存しない)
 *   action             'send'(QR添付送信) | 'skipped_existing'(手動発行済みの記録のみ)
 *   qr                 PNGファイル (action=send のとき必須)
 * 冪等: 同じ member_id は2回目以降 {already:true} で何もしない
 */

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const rows = (await getAll(
    `SELECT hacomono_member_id, status FROM member_qr_issues`
  )) as { hacomono_member_id: string; status: string }[];
  return NextResponse.json({ issued: rows });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    return await handle(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `qr-issues: ${msg}` }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const form = await req.formData();
  const memberId = String(form.get('hacomono_member_id') ?? '').trim();
  const memberName = String(form.get('member_name') ?? '').trim();
  const email = String(form.get('email') ?? '');
  const repEmail = String(form.get('rep_email') ?? '');
  const action = String(form.get('action') ?? 'send');
  if (!memberId) {
    return NextResponse.json({ error: 'hacomono_member_id は必須です' }, { status: 400 });
  }

  const existing = await getOne(
    `SELECT id, status FROM member_qr_issues WHERE hacomono_member_id = ?`, [memberId]
  );
  if (existing) return NextResponse.json({ ok: true, already: true, status: existing.status });

  const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (action === 'skipped_existing') {
    await execute(
      `INSERT INTO member_qr_issues (hacomono_member_id, status, issued_at, detail)
       VALUES (?, 'skipped_existing', ?, 'HACOMONO側に既存の固定コードあり(手動発行済み)')`,
      [memberId, nowIso]
    );
    return NextResponse.json({ ok: true, status: 'skipped_existing' });
  }

  // action === 'send'
  const recipient = resolveRecipient(email, repEmail);
  if (!recipient.ok) {
    await execute(
      `INSERT INTO member_qr_issues (hacomono_member_id, status, issued_at, detail)
       VALUES (?, 'manual_needed', ?, ?)`,
      [memberId, nowIso, `宛先解決不可: ${recipient.reason}`]
    );
    await execute(
      `INSERT INTO staff_notifications (type, title, detail, severity)
       VALUES ('qr_issue_manual', '固定QR: 手動送付が必要', ?, 'warning')`,
      [`hacomono_member_id=${memberId} 宛先解決不可(${recipient.reason})。HACOMONO管理画面から手動で送付してください`]
    );
    return NextResponse.json({ ok: true, status: 'manual_needed', reason: recipient.reason });
  }

  const qr = form.get('qr') as File | null;
  if (!qr) return NextResponse.json({ error: 'qr ファイルが必要です' }, { status: 400 });
  const png = Buffer.from(await qr.arrayBuffer());

  const mail = buildQrEmail(memberName || 'メンバー');
  await sendEmail({
    to: recipient.to,
    subject: mail.subject,
    text: mail.text,
    attachments: [{ filename: 'boom_checkin_qr.png', content: png }],
  });

  await execute(
    `INSERT INTO member_qr_issues (hacomono_member_id, status, email_to_masked, issued_at, emailed_at)
     VALUES (?, 'emailed', ?, ?, ?)`,
    [memberId, maskEmail(recipient.to), nowIso, nowIso]
  );
  return NextResponse.json({ ok: true, status: 'emailed', to_masked: maskEmail(recipient.to) });
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit 2>&1 | grep -v faqKnowledge`（faqKnowledge.test.tsの既存エラーは別件）
Expected: エラーなし

- [ ] **Step 3: ローカル動作確認**（ローカルDB・GMAIL_APP_PASSWORD未設定=送信スキップでルート動作だけ確認）

```bash
npx next dev --webpack &  # 起動後
curl -s -X POST http://localhost:3000/api/staff/qr-issues \
  -H "x-admin-password: boom2026" \
  -F hacomono_member_id=TEST-1 -F member_name="テスト 太郎" \
  -F email="x@dummy.hacomono.mail" -F rep_email=""
```
Expected: `{"ok":true,"status":"manual_needed","reason":"rep_email_missing"}`（送信なし・台帳とstaff_notificationsに記録）

```bash
curl -s http://localhost:3000/api/staff/qr-issues -H "x-admin-password: boom2026"
```
Expected: `{"issued":[{"hacomono_member_id":"TEST-1","status":"manual_needed"}]}`

- [ ] **Step 4: コミット**

```bash
git add src/app/api/staff/qr-issues/route.ts
git commit -m "feat: 固定QR発行API(宛先解決→QR添付メール→台帳記録)(WS U)"
```

---

### Task 4: HACOMONOクラウドログイン疎通スパイク 【ゲートA・最重要リスク】

**Files:**
- Create: `scripts/fixed_qr/package.json`
- Create: `scripts/fixed_qr/hacomono.mjs`（ログイン+CSV取得の共通部）
- Create: `scripts/fixed_qr/login_test.mjs`
- Create: `.github/workflows/fixed-qr-login-test.yml`（workflow_dispatchのみ）

- [ ] **Step 1: 自己完結パッケージ**（アプリのdependenciesを汚さない）

```json
{
  "name": "fixed-qr-automation",
  "private": true,
  "type": "module",
  "dependencies": {
    "playwright": "^1.49.0"
  }
}
```

- [ ] **Step 2: 共通部 hacomono.mjs**

```js
// scripts/fixed_qr/hacomono.mjs
// HACOMONO管理へのログインとML001 CSV直エクスポート (daily_sync.pyで実証済みの方式の移植)
import { chromium } from 'playwright';

const LOGIN_URL = 'https://boom-admin.hacomono.jp/';

export async function launchAndLogin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.fill('input[type="text"]', process.env.HACOMONO_USERNAME);
  await page.fill('input[type="password"]', process.env.HACOMONO_PASSWORD);
  await page.click('button[type="submit"], button:has-text("ログイン")');
  // ログイン後はダッシュボードへ遷移する。メニューが出るまで待つ
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  if (page.url().includes('login') || (await page.locator('input[type="password"]').count()) > 0) {
    throw new Error('HACOMONO login failed (still on login form)');
  }
  return { browser, context, page };
}

// ML001(全メンバー) CSV直エクスポート。query id=7 (auto_sync/hacomono_query_ids.txt)
export async function downloadMl001Csv(context) {
  const query = encodeURIComponent(JSON.stringify({ id: 7, payload: { studio_id: 1 } }));
  const url = `https://boom-admin.hacomono.jp/api/analysis/queries/export?query=${query}&file_type=csv&encoding=BOM--UTF-8`;
  const res = await context.request.get(url, { timeout: 120_000 });
  if (res.status() !== 200) throw new Error(`ML001 export failed: HTTP ${res.status()}`);
  const body = await res.body();
  const text = body.toString('utf-8').replace(/^﻿/, '');
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error(`ML001 export: ${lines.length} lines (期待: ヘッダー+会員行)`);
  return text;
}
```

- [ ] **Step 3: login_test.mjs**（ログ最小・PII/スクショなし）

```js
// scripts/fixed_qr/login_test.mjs — 疎通テスト: ログイン + ML001エクスポートの行数だけ出す
import { launchAndLogin, downloadMl001Csv } from './hacomono.mjs';

const { browser, context } = await launchAndLogin();
console.log('LOGIN OK');
const csv = await downloadMl001Csv(context);
console.log(`ML001 EXPORT OK: ${csv.split('\n').filter((l) => l.trim()).length - 1} rows`);
await browser.close();
```

- [ ] **Step 4: workflow（dispatchのみ・成果物アップロードなし）**

```yaml
# .github/workflows/fixed-qr-login-test.yml
name: fixed-qr-login-test
on:
  workflow_dispatch:
concurrency:
  group: fixed-qr
  cancel-in-progress: false
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install deps
        working-directory: scripts/fixed_qr
        run: npm install && npx playwright install --with-deps chromium
      - name: Login test
        working-directory: scripts/fixed_qr
        env:
          HACOMONO_USERNAME: ${{ secrets.HACOMONO_USERNAME }}
          HACOMONO_PASSWORD: ${{ secrets.HACOMONO_PASSWORD }}
        run: node login_test.mjs
```

- [ ] **Step 5: ローカルで先に動作確認**（クラウド前にロジック検証）

```bash
cd scripts/fixed_qr && npm install
HACOMONO_USERNAME=... HACOMONO_PASSWORD=... node login_test.mjs
```
（認証情報は `auto_sync/.env` の値を環境変数で渡す。コマンド履歴に残さないよう `set -a; source ../../../BOOM_Master_template/05_運営/scripts/auto_sync/.env; set +a` 方式でもよい）
Expected: `LOGIN OK` → `ML001 EXPORT OK: 203 rows` 程度

- [ ] **Step 6: 【ゲートA】TARO承認 → main push + Secrets登録 → クラウド実行**

```bash
git add scripts/fixed_qr .github/workflows/fixed-qr-login-test.yml
git commit -m "feat: 固定QR自動化のHACOMONOクラウドログイン疎通テスト(WS U)"
# TARO承認後:
git push origin main
gh secret set HACOMONO_USERNAME --body "$HACOMONO_USERNAME" -R boomsendai-oss/bw5-app
gh secret set HACOMONO_PASSWORD --body "$HACOMONO_PASSWORD" -R boomsendai-oss/bw5-app
gh workflow run fixed-qr-login-test -R boomsendai-oss/bw5-app
gh run watch -R boomsendai-oss/bw5-app
```
Expected: ジョブ成功・ログに `LOGIN OK` / `ML001 EXPORT OK`
**失敗した場合**（IP/bot検知など）: ここで停止しTAROに報告→Mac cronフォールバックへ設計変更（以降のタスクの「GH Actions」を「Mac cron」に読み替え。スクリプト自体は共通）

---

### Task 5: メンバー詳細→セキュリティタブのDOM調査（ローカルdry-run）

**Files:**
- Create: `scripts/fixed_qr/discover.mjs`（使い捨て調査スクリプト。完了後 `scripts/archive/` へ）

- [ ] **Step 1: 調査スクリプト**（**保存ボタンは押さない**＝HACOMONOに変更を加えない）

```js
// scripts/fixed_qr/discover.mjs — メンバー詳細のURL形式とセキュリティタブのDOMを調査
// 使い方: HACOMONO_USERNAME=.. HACOMONO_PASSWORD=.. MEMBER_ID=<TAROのメンバーID> node discover.mjs
// ⚠️ 保存は押さない。ローカル専用・出力は ./discover_out/ (gitignore)
import { launchAndLogin } from './hacomono.mjs';
import fs from 'node:fs';

const MEMBER_ID = process.env.MEMBER_ID;
if (!MEMBER_ID) throw new Error('MEMBER_ID を指定してください');
fs.mkdirSync('discover_out', { recursive: true });

const { browser, page } = await launchAndLogin();

// 候補1: 直URL。ダメなら運営→メンバー画面から検索导线を調査
await page.goto(`https://boom-admin.hacomono.jp/#/operation/members/${MEMBER_ID}`, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'discover_out/member_detail.png', fullPage: true });

// セキュリティタブ
await page.click('text=セキュリティ');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'discover_out/security_tab.png', fullPage: true });
fs.writeFileSync('discover_out/security_tab.html', await page.content());

// メンバーコード「新規登録」を開く(保存はしない)
await page.click('button:has-text("新規登録")');
await page.waitForTimeout(2000);
await page.screenshot({ path: 'discover_out/new_code_dialog.png', fullPage: true });
fs.writeFileSync('discover_out/new_code_dialog.html', await page.content());

console.log('discover_out/ に保存しました。保存ボタンは押していません');
await browser.close();
```

- [ ] **Step 2: TAROのメンバーIDで実行し、以下を確定する**

Run: `cd scripts/fixed_qr && MEMBER_ID=<TAROのID> HACOMONO_USERNAME=... HACOMONO_PASSWORD=... node discover.mjs`

確定する項目（結果を `issue_qr.mjs` の SELECTORS 定数に反映）:
1. メンバー詳細の直URL形式（`#/operation/members/{id}` で開けるか）
2. セキュリティタブのセレクタ
3. 「新規登録」ボタン・「固定メンバーコード用」選択・「保存する」ボタンのセレクタ
4. **既存の固定コードが有る場合の画面上の見分け方**（skipped_existing判定に使う）
5. 保存後にQRが表示される要素（`canvas` / `img` / svg）のセレクタ
6. ML001の「メンバーID」列の値がURLのidと一致するか

- [ ] **Step 3: `discover_out/` をgitignoreに追加しコミット**

```bash
echo "scripts/fixed_qr/discover_out/" >> .gitignore
git add .gitignore scripts/fixed_qr/discover.mjs
git commit -m "chore: 固定QR DOM調査スクリプト(保存は押さないdry-run)(WS U)"
```

---

### Task 6: 発行スクリプト本体 issue_qr.mjs

**Files:**
- Create: `scripts/fixed_qr/issue_qr.mjs`
- Create: `scripts/fixed_qr/csv.mjs`（引用符対応の最小CSVパーサ）

- [ ] **Step 1: CSVパーサ**（依存追加なし・ML001のダブルクォート/カンマ内包に対応）

```js
// scripts/fixed_qr/csv.mjs
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toDicts(rows) {
  const hdr = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i] ?? ''])));
}
```

- [ ] **Step 2: 本体**（SELECTORS はTask 5の結果で確定させる。以下はtext系の暫定値で、Task 5後に差し替え箇所を明記）

```js
// scripts/fixed_qr/issue_qr.mjs
// 固定QR自動発行 (WS U): ML001から新規入会者を特定→固定コード発行→QR画像→bw5-appへPOST
// 環境変数: HACOMONO_USERNAME / HACOMONO_PASSWORD / APP_ADMIN_PASSWORD
//           DRY_RUN=1 で発行・POSTせず対象一覧の件数だけ出す
import { launchAndLogin, downloadMl001Csv } from './hacomono.mjs';
import { parseCsv, toDicts } from './csv.mjs';

const APP = 'https://bw5-app.vercel.app';
const CUTOFF = process.env.QR_CUTOFF || '2026-07-21'; // 稼働開始日: これ以降の入会者のみ対象
const MAX_PER_RUN = 10; // 安全弁: 1回の実行で処理する最大人数
const DRY = process.env.DRY_RUN === '1';

// ⚠️ Task 5 (discover.mjs) の結果で確定させる — ここが暫定のままなら動かさない
const SELECTORS = {
  memberUrl: (id) => `https://boom-admin.hacomono.jp/#/operation/members/${id}`,
  securityTab: 'text=セキュリティ',
  existingFixedCode: 'text=固定メンバーコード用', // 既存コード一覧に出る表記 (要確認)
  newCodeButton: 'button:has-text("新規登録")',
  fixedCodeOption: 'text=固定メンバーコード用',
  saveButton: 'button:has-text("保存する")',
  qrElement: 'canvas, img[src^="data:image"]', // QR表示要素 (要確認)
};

async function appGet(path) {
  const r = await fetch(`${APP}${path}`, { headers: { 'x-admin-password': process.env.APP_ADMIN_PASSWORD } });
  if (!r.ok) throw new Error(`GET ${path}: HTTP ${r.status}`);
  return r.json();
}

async function appPostForm(path, form) {
  const r = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: { 'x-admin-password': process.env.APP_ADMIN_PASSWORD },
    body: form,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`POST ${path}: HTTP ${r.status} ${JSON.stringify(body)}`);
  return body;
}

const { browser, context, page } = await launchAndLogin();
console.log('login ok');

const members = toDicts(parseCsv(await downloadMl001Csv(context)));
const { issued } = await appGet('/api/staff/qr-issues');
const done = new Set(issued.map((x) => x.hacomono_member_id));

const pending = members
  .filter((m) => (m['入会日時'] || '').slice(0, 10) >= CUTOFF)
  .filter((m) => m['メンバーID'] && !done.has(m['メンバーID']))
  .slice(0, MAX_PER_RUN);
console.log(`pending: ${pending.length}名 (cutoff=${CUTOFF})`);

if (DRY) { console.log('DRY_RUN: 終了'); await browser.close(); process.exit(0); }

let okCount = 0, failCount = 0;
for (const m of pending) {
  const id = m['メンバーID'];
  try {
    await page.goto(SELECTORS.memberUrl(id), { waitUntil: 'networkidle', timeout: 60_000 });
    await page.click(SELECTORS.securityTab);
    await page.waitForTimeout(1500);

    // 既に固定コードがある(TARO手動発行済み) → 記録だけして送らない
    if (await page.locator(SELECTORS.existingFixedCode).count() > 0) {
      const form = new FormData();
      form.set('hacomono_member_id', id);
      form.set('action', 'skipped_existing');
      await appPostForm('/api/staff/qr-issues', form);
      console.log(`member ${id}: skipped_existing`);
      okCount++;
      continue;
    }

    await page.click(SELECTORS.newCodeButton);
    await page.click(SELECTORS.fixedCodeOption);
    await page.click(SELECTORS.saveButton);
    await page.waitForSelector(SELECTORS.qrElement, { timeout: 30_000 });
    const png = await page.locator(SELECTORS.qrElement).first().screenshot();

    const form = new FormData();
    form.set('hacomono_member_id', id);
    form.set('member_name', m['氏名'] || '');
    form.set('email', m['メールアドレス'] || '');
    form.set('rep_email', m['代表メールアドレス'] || '');
    form.set('action', 'send');
    form.set('qr', new Blob([png], { type: 'image/png' }), 'qr.png');
    const res = await appPostForm('/api/staff/qr-issues', form);
    console.log(`member ${id}: ${res.status}`); // 氏名・アドレスはログに出さない
    okCount++;
  } catch (e) {
    failCount++;
    console.error(`member ${id}: FAILED ${e.message}`); // 失敗は台帳未記録→翌朝自動リトライ
  }
}
console.log(`done: ok=${okCount} fail=${failCount}`);
await browser.close();
if (failCount > 0 && okCount === 0) process.exit(1);
```

- [ ] **Step 3: DRY_RUNでローカル検証**

```bash
cd scripts/fixed_qr && DRY_RUN=1 HACOMONO_USERNAME=... HACOMONO_PASSWORD=... APP_ADMIN_PASSWORD=... node issue_qr.mjs
```
Expected: `login ok` → `pending: 0名 (cutoff=2026-07-21)` → `DRY_RUN: 終了`（稼働開始日以降の入会者がまだ居ないため0名が正）

- [ ] **Step 4: コミット**

```bash
git add scripts/fixed_qr/issue_qr.mjs scripts/fixed_qr/csv.mjs
git commit -m "feat: 固定QR自動発行スクリプト本体(ML001差分→発行→QR→メールAPI)(WS U)"
```

---

### Task 7: 【ゲートB】実会員1名でE2Eテスト（TARO立会い）

- [ ] **Step 1: TAROに確認**: ①メール文面の清書OK? ②テスト会員=TARO自身のメンバーIDと送付先 ③cutoffの一時変更値
- [ ] **Step 2: 本番DBへ台帳マイグレーション適用**（ゲートCの一部を前倒し。テーブルが無いとAPIが500になるため）

```bash
node scripts/migrate.mjs --dry-run  # (dotenv で .env.production.local を読む従来方式)
node -r dotenv/config scripts/migrate.mjs dotenv_config_path=.env.production.local
```
Expected: `適用: 20260720_member_qr_issues.sql (2 statements)` → `apply 完了`

- [ ] **Step 3: アプリをデプロイ**（qrIssue.ts / qr-issues API を含むmain push → Vercel）
- [ ] **Step 4: TAROのメンバーだけを対象にローカルから実行**

```bash
cd scripts/fixed_qr && QR_CUTOFF=<TAROの入会日時以前の日付> HACOMONO_USERNAME=... HACOMONO_PASSWORD=... APP_ADMIN_PASSWORD=... node issue_qr.mjs
```
⚠️ cutoffを下げると対象が増えるため、実行前にDRY_RUN=1で `pending: 1名` になるcutoff値を探す（TARO以外が混ざるなら `MAX_PER_RUN=1`+ML001の順序に頼らず、issue_qr.mjsに `ONLY_MEMBER_ID` 環境変数ガードを一時追加して限定する）
Expected: TAROのメールにQR添付メールが届く → **タブレットに実際にかざしてチェックインできることを確認**（これが最終の受入基準）

- [ ] **Step 5: 台帳確認**（読み取り専用）

```bash
node -e "...(Turso) SELECT hacomono_member_id, status, email_to_masked FROM member_qr_issues"
```
Expected: TAROの行が `emailed` / 伏せ字アドレス

---

### Task 8: 【ゲートC】cron有効化・本組み

**Files:**
- Create: `.github/workflows/fixed-qr.yml`
- Delete: `.github/workflows/fixed-qr-login-test.yml`（本組みに置き換え）

- [ ] **Step 1: 本番workflow**

```yaml
# .github/workflows/fixed-qr.yml
name: fixed-qr-issue
on:
  schedule:
    - cron: '10 23 * * *'   # 23:10 UTC = 8:10 JST (GH遅延60-90分織り込みで9時台にメール到着)
  workflow_dispatch:
concurrency:
  group: fixed-qr
  cancel-in-progress: false
jobs:
  issue:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install deps
        working-directory: scripts/fixed_qr
        run: npm install && npx playwright install --with-deps chromium
      - name: Issue fixed QR codes
        working-directory: scripts/fixed_qr
        env:
          HACOMONO_USERNAME: ${{ secrets.HACOMONO_USERNAME }}
          HACOMONO_PASSWORD: ${{ secrets.HACOMONO_PASSWORD }}
          APP_ADMIN_PASSWORD: ${{ secrets.APP_ADMIN_PASSWORD }}
        run: node issue_qr.mjs
```

- [ ] **Step 2: Secrets追加**: `gh secret set APP_ADMIN_PASSWORD --body "..." -R boomsendai-oss/bw5-app`
- [ ] **Step 3: cutoffを本稼働値に確定**（issue_qr.mjs の `CUTOFF` 既定値。E2Eで一時変更していたら戻す）
- [ ] **Step 4: TARO承認 → main push → `gh workflow run fixed-qr` で手動1回成功確認**
- [ ] **Step 5: コミット**

```bash
git add .github/workflows/fixed-qr.yml
git rm .github/workflows/fixed-qr-login-test.yml
git commit -m "feat: 固定QR自動発行を毎朝8時台に本稼働(GH Actions cron)(WS U)"
```

---

### Task 9: FAQ・記録系

- [ ] **Step 1: FAQ文面ドラフトをTAROに提示**（承認後 `/staff/faq` で登録=公開ON。文面案:）

> **Q: 子どもがスマホを持っていなくても、一人でチェックインできますか？**
> A: できます。印刷して使える「固定QRコード」をご用意しています。入会時にメールでお送りしています（届いていない場合は公式LINEでご連絡ください）。紙に印刷してお子さまに持たせていただければ、入口のタブレットにかざすだけでチェックインできます。⚠️ QRコードは他の方と共有しないようご注意ください。

- [ ] **Step 2: memoryに保存** `project_hacomono_fixed_qr.md`（固定QRの仕組み・手動手順・自動化の構成・ダミーアドレス/代表メール解決・cutoff運用・既存会員は未展開）+ MEMORY.mdに1行
- [ ] **Step 3: STATE.md WS U更新**（稼働開始・運用方法・既存会員展開は保留中とTAROの判断待ちであることを明記）→ commit&push
- [ ] **Step 4: HPには載せない**（作業なし・方針の再確認のみ）

---

## Self-Review結果

- 仕様の全要件がタスクに割当済み（自動発行=T4-8 / 宛先解決=T1,3 / メール文面=T1(清書ゲート=T7) / クラウド=T4,8 / 記録系=T9 / cutoff=T6 / 二重発行ガード=T3(冪等)+T6(skipped_existing) / 失敗リトライ=T6(台帳未記録→翌朝再試行)）
- SELECTORS はTask 5で確定するまで暫定であることを本体に明記（プレースホルダではなく調査タスクの出力先として定義）
- 型/名前の整合: `member_qr_issues` 列名・API フィールド名・status値はT2/T3/T6で一致確認済み
