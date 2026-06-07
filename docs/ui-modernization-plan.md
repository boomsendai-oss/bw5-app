# BW5 管理画面 UI 刷新計画

> 作成日: 2026-06-07
> ステータス: レビュー待ち（TAROの「ここからやって」指示を待つ）

---

## 目次

1. [現状の棚卸し](#1-現状の棚卸し)
2. [shadcn/ui 導入プラン](#2-shadcnui-導入プラン)
3. [神ファイル解体プラン](#3-神ファイル解体プラン)
4. [移行ロードマップ](#4-移行ロードマップ)

---

## 1. 現状の棚卸し

### 1.1 全ページ一覧（staff 配下）

| ページ | パス | 行数 | 主な機能 |
|--------|------|------|----------|
| スタッフハブ | `/staff` | 250 | カードグリッドのトップ画面 |
| マスタ管理 | `/staff/masters` | **1,202** | スタジオ/講師/レッスンの CRUD（3タブ） |
| スケジュール | `/staff/schedule` | 661 | レッスン予定の一覧・編集 |
| カレンダー | `/staff/schedule/calendar` | 1,082 | 月間カレンダービュー |
| 同期 | `/staff/schedule/sync` | 585 | Google Calendar / HACOMONO 同期 |
| HACOMONO タスク | `/staff/schedule/hacomono-tasks` | 320 | HACOMONO 差分タスク |
| 給与計算 | `/staff/payroll` | 661 | 月次給与計算 |
| 給与明細印刷 | `/staff/payroll/[id]/print` | 142 | 印刷用レイアウト |
| 経費管理 | `/staff/expenses` | 465 | 経費 CRUD + 定期経費 |
| スタジオ請求 | `/staff/studio-billing` | 352 | 月次スタジオ利用料 |
| KPI・分析 | `/staff/insights` | 703 | recharts グラフ + KPI カード |
| ダッシュボード | `/staff/dashboard` | 547 | レガシー KPI |
| ダッシュボード入力 | `/staff/dashboard/input` | 278 | KPI 手動入力 |
| 会員管理 | `/staff/members` | 261 | HACOMONO 連携会員一覧 |
| ブログ | `/staff/blog` | 457 | 記事 CRUD |
| オペレーション | `/staff/operations` | 471 | CSV インポート・月次レポート |
| 映像先行予約 | `/staff/video-preorders` | 418 | 映像予約管理 + メール送信 |
| キャンセル申請 | `/staff/cancel-requests` | 138 | 講師の休講承認 |
| イベント管理 | `/staff/events` | 168 | イベント一覧 |
| イベント詳細 | `/staff/events/[eventId]` | 127 | イベント詳細 |
| イベント ToDo | `/staff/events/[eventId]/todo` | 213 | イベントタスク管理 |

**合計: 20 ページ、約 9,500 行**

### 1.2 admin 配下

| ページ | パス | 行数 | 主な機能 |
|--------|------|------|----------|
| 管理パネル | `/admin` | **1,677** | イベント当日運営（8タブ: Schedule/Merch/Music/Video/Vote/SNS/Orders/Settings） |
| パフォーマンス | `/admin/performances` | 426 | 出演者管理 |
| 抽選結果 | `/admin/lottery-winners` | 138 | 当選者管理 |

### 1.3 現在の UI パターン分類

| パターン | 使用箇所 | 現状の実装 |
|----------|----------|------------|
| テーブル | masters, payroll, schedule, expenses, orders | 生 `<table>` + Tailwind |
| モーダル | masters（詳細・編集）, 各種確認 | `fixed inset-0 bg-black/50 z-40` 自前オーバーレイ |
| タブ | masters（3タブ）, admin（8タブ） | 自前ボタン切り替え + state |
| フォーム | masters 編集, admin Settings | 生 `<input>` + Tailwind |
| カード | staff ハブ, insights KPI | 自前 div + rounded-xl shadow |
| アコーディオン | admin Merch | 自前 expand/collapse state |
| トースト | admin | 自前 Toast コンポーネント |
| アイコン | staff: 絵文字, admin: lucide-react | 混在 |
| ナビゲーション | staff: StaffPageHeader（🏠ホームリンク） | ページごとに独立、サイドバーなし |
| 確認ダイアログ | masters（slug 変更等） | `window.confirm()` |
| ファイルアップロード | admin Settings（hero画像） | 生 `<input type="file">` |
| グラフ | insights, admin Vote | recharts / CSS bars |

### 1.4 技術スタック

- **Next.js** 16.2.3 / **React** 19.2.4
- **Tailwind CSS v4**（`@import "tailwindcss"` 形式、tailwind.config.ts なし）
- **lucide-react**（admin のみ）、**react-icons**（一部）
- **framer-motion**（アニメーション）
- **recharts**（グラフ）
- **Turso** (LibSQL) / **Vercel** デプロイ
- **認証**: クッキーベース（staff: 平文パスワード、instructor: scrypt PIN + DB セッション）
- **ミドルウェア**: なし（各 API ルートで個別チェック）

### 1.5 現在のテーマ

- **Staff**: ライトテーマ、`bg-neutral-50` 背景、`orange-500` アクセント
- **Admin**: ダークテーマ、CSS custom properties（`--bg-primary: #f27a1a`）、glassmorphism
- **共通**: フォント Bebas Neue / Inter / Noto Sans JP

---

## 2. shadcn/ui 導入プラン

### 2.1 選定コンポーネント一覧

| shadcn/ui | 置き換え対象 | 優先度 |
|-----------|-------------|--------|
| **Button** | 全ページの `<button>` + Tailwind 直書き | P0 |
| **Table** | 生 `<table>` (masters, payroll, schedule, expenses 等) | P0 |
| **Dialog** | 自前モーダル (masters 詳細・編集, 各種確認) | P0 |
| **Tabs** | 自前タブ切り替え (masters 3タブ) | P0 |
| **Input** | 生 `<input>` + Tailwind | P0 |
| **Select** | 生 `<select>` | P0 |
| **Card** | 自前 Card (staff ハブ, KPI カード) | P1 |
| **Badge** | ステータス表示（支払済/未払等） | P1 |
| **Sidebar** | **新規**: 左サイドバーナビゲーション | P1 |
| **Command** | **新規**: ⌘K コマンドパレット | P1 |
| **Sheet** | モバイル時のサイドバー展開 | P1 |
| **Toast / Sonner** | 自前 Toast (admin) | P1 |
| **AlertDialog** | `window.confirm()` の置き換え | P1 |
| **Accordion** | admin Merch のカード展開 | P2 |
| **DropdownMenu** | アクションメニュー（将来） | P2 |
| **Separator** | セクション区切り | P2 |
| **Skeleton** | ローディング表示 | P2 |
| **Switch** | admin Settings のトグル | P2 |
| **Label** | フォームラベル統一 | P2 |
| **Popover** | ツールチップ的な情報表示 | P3 |

### 2.2 レイアウト設計: 左サイドバー + ⌘K

```
┌──────────────────────────────────────────────────────┐
│  [BOOM Logo]          Staff Panel          [⌘K] [👤] │  ← トップバー
├──────────┬───────────────────────────────────────────┤
│          │                                           │
│ 📋 マスタ │  ┌─────────────────────────────────────┐  │
│ 📅 予定  │  │                                     │  │
│ 💰 給与  │  │         メインコンテンツ               │  │
│ 💳 経費  │  │                                     │  │
│ 🏢 スタジオ│ │                                     │  │
│ 📊 分析  │  │                                     │  │
│ 👥 会員  │  │                                     │  │
│ ⚙ 設定  │  └─────────────────────────────────────┘  │
│          │                                           │
│ ──────── │                                           │
│ 📝 ブログ │                                           │
│ 🔧 運用  │                                           │
│          │                                           │
├──────────┴───────────────────────────────────────────┤
│  (モバイル: Sheet で開閉、ハンバーガーメニュー)          │
└──────────────────────────────────────────────────────┘
```

**サイドバー構成:**

```
メイン
├── マスタ管理        → /staff/masters
├── スケジュール      → /staff/schedule
│   ├── カレンダー    → /staff/schedule/calendar
│   ├── 同期         → /staff/schedule/sync
│   └── HACOMONO     → /staff/schedule/hacomono-tasks
├── 給与計算          → /staff/payroll
├── 経費管理          → /staff/expenses
├── スタジオ請求      → /staff/studio-billing
├── KPI・分析         → /staff/insights
└── 会員管理          → /staff/members

運用
├── ブログ            → /staff/blog
├── オペレーション     → /staff/operations
├── 映像先行予約       → /staff/video-preorders
├── キャンセル申請     → /staff/cancel-requests
└── イベント管理       → /staff/events

(ダッシュボードは insights に統合予定)
```

**⌘K コマンドパレット:**
- 全ページへのクイックジャンプ
- 講師名/スタジオ名/レッスン名で検索 → 該当マスタの編集モーダルを直接開く
- アクション: 「給与計算を実行」「HP デプロイ」「Google Calendar 同期」等

### 2.3 カラーパレット統合案

Tailwind v4 の CSS variables 方式で統一。`src/app/globals.css` に定義:

```css
@theme {
  /* Brand */
  --color-brand-50: #fff7ed;
  --color-brand-100: #ffedd5;
  --color-brand-200: #fed7aa;
  --color-brand-300: #fdba74;
  --color-brand-400: #fb923c;
  --color-brand-500: #f97316;  /* = orange-500、メインアクセント */
  --color-brand-600: #ea580c;
  --color-brand-700: #c2410c;
  --color-brand-800: #9a3412;
  --color-brand-900: #7c2d12;
  --color-brand-950: #431407;

  /* shadcn/ui 用の semantic tokens */
  --color-background: #fafafa;      /* neutral-50 */
  --color-foreground: #171717;      /* neutral-900 */
  --color-card: #ffffff;
  --color-card-foreground: #171717;
  --color-primary: #f97316;         /* orange-500 */
  --color-primary-foreground: #ffffff;
  --color-secondary: #f5f5f5;       /* neutral-100 */
  --color-secondary-foreground: #171717;
  --color-muted: #f5f5f5;
  --color-muted-foreground: #737373; /* neutral-500 */
  --color-accent: #f5f5f5;
  --color-accent-foreground: #171717;
  --color-destructive: #ef4444;     /* red-500 */
  --color-destructive-foreground: #ffffff;
  --color-border: #e5e5e5;          /* neutral-200 */
  --color-input: #e5e5e5;
  --color-ring: #f97316;            /* focus ring = brand */
  --radius: 0.5rem;

  /* Sidebar tokens (shadcn Sidebar 用) */
  --color-sidebar-background: #ffffff;
  --color-sidebar-foreground: #171717;
  --color-sidebar-primary: #f97316;
  --color-sidebar-primary-foreground: #ffffff;
  --color-sidebar-accent: #fff7ed;   /* brand-50: ホバー/アクティブ背景 */
  --color-sidebar-accent-foreground: #9a3412; /* brand-800 */
  --color-sidebar-border: #e5e5e5;
}
```

**Admin ページ (ダークテーマ) は現行 CSS 変数をそのまま維持。** Staff ページだけが shadcn/ui 化の対象。

---

## 3. 神ファイル解体プラン

### 3.1 `admin/page.tsx` (1,677行) → 4分割

現在の 8 タブ構成を、独立ページ + 共通レイアウトに分離:

```
src/app/admin/
├── layout.tsx          (新規) AdminLayout: 認証 + サイドバー + テーマ
├── page.tsx            → リダイレクト先 or ダッシュボード
├── schedule/
│   └── page.tsx        ScheduleTab の内容 (~200行)
├── merch/
│   └── page.tsx        MerchTab の内容 (~350行)
├── music/
│   └── page.tsx        MusicTab の内容 (~150行)
├── video/
│   └── page.tsx        VideoTab の内容 (~100行)
├── vote/
│   └── page.tsx        VoteTab の内容 (~150行)
├── sns/
│   └── page.tsx        SNSTab の内容 (~80行)
├── orders/
│   └── page.tsx        OrdersTab の内容 (~250行)
├── settings/
│   └── page.tsx        SettingsTab の内容 (~300行)
├── performances/
│   └── page.tsx        (既存、変更なし)
└── lottery-winners/
    └── page.tsx        (既存、変更なし)
```

**注意:** Admin は BW5 イベント専用の「当日運営パネル」なので、Staff 側の shadcn/ui 化とは独立。ダークテーマ・glassmorphism はそのまま維持。タブ → ルーティングへの変換が主目的。

### 3.2 `staff/masters/page.tsx` (1,202行) → SC + CC 分離

```
src/app/staff/masters/
├── page.tsx              Server Component: DB からマスタデータ fetch、タブ UI を返す (~50行)
├── _components/
│   ├── MastersClient.tsx  Client Component: タブ切り替え + 状態管理のシェル (~100行)
│   ├── StudiosTab.tsx     Studios タブ: テーブル + 詳細/編集 Dialog (~250行)
│   ├── InstructorsTab.tsx Instructors タブ: テーブル + 詳細/編集 Dialog (~400行)
│   ├── LessonsTab.tsx     Lessons タブ: テーブル + 詳細/編集 Dialog (~300行)
│   └── MasterEditDialog.tsx 共通の編集 Dialog ラッパー (~80行)
```

**SC/CC 境界の設計:**
- `page.tsx` (SC): `getAll('SELECT * FROM studios')` 等で初期データを取得し、props で渡す
- `MastersClient.tsx` (CC, `'use client'`): `useState` でタブ・モーダル状態管理
- 各タブコンポーネント (CC): テーブル表示 + CRUD 操作（fetch → optimistic update）
- **利点**: 初回ロードで DB データが RSC payload に含まれる → ローディングスピナー不要

### 3.3 `lib/db.ts` (1,033行) → ドメイン別分割

現在 `db.ts` は 5 関数のみ export（`initDb`, `query`, `execute`, `getAll`, `getOne`, `batch`）で、大半は `initDb()` 内の CREATE TABLE 文（約 60 テーブル）。

```
src/lib/
├── db.ts                 コア: createClient, execute, getAll, getOne, batch (~80行)
├── db/
│   ├── schema.ts         全 CREATE TABLE 文 + addColumnIfMissing (~600行)
│   ├── migrations.ts     マイグレーション実行ロジック (~50行)
│   └── seed.ts           デフォルトデータ投入 (~100行)
```

**方針:**
- `db.ts` のパブリック API (`execute`, `getAll`, `getOne`, `batch`) はそのまま維持
- `initDb()` の中身（テーブル定義 + シード）を `db/schema.ts` と `db/seed.ts` に移動
- 各 API ルートの SQL クエリは移動しない（現状 API ルート内に直書きで、それが正解）
- **ドメイン別リポジトリ層は作らない**（過剰抽象化。SQL 直書きのシンプルさを維持）

---

## 4. 移行ロードマップ

### Phase 1: 基盤構築（見積もり: 2-3時間）

shadcn/ui のインストールと基盤レイアウトの構築。この Phase だけで見た目が大きく変わる。

| # | タスク | 詳細 |
|---|--------|------|
| 1-1 | shadcn/ui 初期化 | `npx shadcn@latest init` + Tailwind v4 対応設定 |
| 1-2 | カラーパレット設定 | 上記 2.3 の CSS 変数を `globals.css` に追加 |
| 1-3 | Staff Layout 刷新 | `src/app/staff/layout.tsx` に Sidebar + SidebarProvider 導入 |
| 1-4 | コマンドパレット | `⌘K` で全ページジャンプ + マスタ検索 |
| 1-5 | lucide-react 統一 | 全 staff ページの絵文字を lucide-react アイコンに置換 |

**ゴール:** サイドバーナビ + ⌘K が動く状態。各ページの中身はまだ旧 UI。

### Phase 2: 既存画面の移行（見積もり: 6-8時間）

1 ページずつ shadcn/ui コンポーネントに置き換え。**優先度順:**

| 順序 | ページ | 理由 | 見積もり |
|------|--------|------|---------|
| 2-1 | `/staff`（ハブ） | 最初に見る画面、Card だけで簡単 | 30分 |
| 2-2 | `/staff/masters` | 最頻使用、Table/Dialog/Tabs の実績作り | 2時間 |
| 2-3 | `/staff/schedule` | 予定管理、Table + Select | 1時間 |
| 2-4 | `/staff/payroll` | 給与、Table + Badge | 1時間 |
| 2-5 | `/staff/expenses` | 経費、Table + Dialog | 45分 |
| 2-6 | `/staff/insights` | KPI、Card + recharts（グラフはそのまま） | 45分 |
| 2-7 | `/staff/studio-billing` | スタジオ請求 | 30分 |
| 2-8 | 残り全ページ | members, blog, operations, video-preorders, cancel-requests, events, dashboard | 2時間 |

**各ページの移行パターン:**
1. 生 `<table>` → shadcn `<Table>` + `<TableHeader>` + `<TableRow>`
2. 自前モーダル → shadcn `<Dialog>` + `<DialogContent>`
3. 自前タブ → shadcn `<Tabs>` + `<TabsList>` + `<TabsTrigger>`
4. 生 `<input>` → shadcn `<Input>` + `<Label>`
5. 生 `<select>` → shadcn `<Select>`
6. 生 `<button>` → shadcn `<Button>` (variant: default/secondary/destructive/ghost)
7. `window.confirm()` → shadcn `<AlertDialog>`
8. ステータス表示 → shadcn `<Badge>`

### Phase 3: 神ファイル解体（見積もり: 2-3時間）

Phase 2 と並行 or 後続で実施。

| # | タスク | 見積もり |
|---|--------|---------|
| 3-1 | `lib/db.ts` → `db/schema.ts` + `db/seed.ts` 分離 | 30分 |
| 3-2 | `admin/page.tsx` → 8 ルートに分割 + AdminLayout | 1.5時間 |
| 3-3 | `staff/masters/page.tsx` → SC + CC + タブ分離 | 1時間 |

### 全体タイムライン

```
Phase 1 (基盤)     ████████░░░░░░░░░░░░  2-3h
Phase 2 (画面移行)  ░░░░░░░░████████████  6-8h
Phase 3 (解体)      ░░░░░░░░░░░░████████  2-3h
                                          --------
                              合計: 10-14h (2-3セッション)
```

### 推奨実行順序

```
セッション 1: Phase 1 全部 + Phase 2-1 (ハブ)
  → サイドバー + ⌘K + ハブのCard化。ここで見た目の変化を確認

セッション 2: Phase 2-2〜2-6 (主要5画面) + Phase 3-1 (db.ts 分離)
  → 最頻使用画面が全部新 UI に。db.ts もスッキリ

セッション 3: Phase 2-7〜2-8 (残り) + Phase 3-2〜3-3 (admin + masters 解体)
  → 全画面完了
```

---

## 付録: 判断ポイント（TAROへ）

以下の点で方針確認が必要です:

### A. Admin パネルはどうする？
- **案1 (推奨):** Staff 側だけ刷新、Admin は現状維持（ダークテーマ・glassmorphism）
- **案2:** Admin も shadcn/ui 化（ダークモード対応が追加で必要、+4-5h）
- → Admin は BW5 イベント専用なので、BW6 で作り直す可能性が高い。今回は Staff だけで十分では？

### B. ダッシュボード統合
- `/staff/dashboard` と `/staff/insights` が機能重複
- → `insights` に統合して `dashboard` を廃止する想定でよいか？

### C. レガシーダッシュボード入力
- `/staff/dashboard/input` は KPI 手動入力
- → `insights` 内のサブページとして移動でよいか？

### D. ⌘K コマンドパレットの範囲
- ページジャンプだけ？ それとも「給与計算実行」等のアクションも含める？
- 講師名・レッスン名での検索 → マスタ編集 Dialog 直接起動は欲しい？

### E. 移行中の段階的デプロイ
- Phase 1 完了時点でデプロイしてよいか？（中身は旧 UI だがナビは新しい状態）
- それとも全 Phase 完了まで一括デプロイ？
