# BOOMアプリ (旧 BW5アプリ)

BOOMダンススクール (仙台) の常設運営機能 + 各イベント (BW5/BW6など) を統合したNext.jsアプリ。

> 📌 内部呼称: 「BOOMアプリ」に統一 (リポジトリ名 `bw5-app` は当面据え置き、URLも変更しない)

---

## 🌐 アクセス

| 項目 | 値 |
|---|---|
| 本番URL | https://bw5-app.vercel.app/ |
| 将来カスタムドメイン (予定) | https://app.boom-sendai.com/ |
| 認証パスワード | `boom2026` |
| 認証実装 | `src/lib/eventAuth.ts` |

---

## 🗂 機能一覧

### お客さん向け (BW5発表会用)
- `/` — トップ
- `/photo` — 写真ダウンロード
- `/video` — 動画ダウンロード
- `/event/bw5/*` — BW5専用ページ群

### 運営向け (`/staff/*`)
| パス | 用途 |
|---|---|
| `/staff/members` | 会員172人の管理 (検索・プランフィルタ・詳細モーダル) |
| `/staff/operations` | 運営オペレーション (HACOMONO×Lstep突合・紐付け推測・CSV出力) |
| `/staff/schedule` | レッスンスケジュール (一覧・編集・休講・振替・CSV一括投入) |
| `/staff/dashboard` | KPIダッシュボード |
| `/staff/events` | イベント運営 (BW5/BW6/WS) |

---

## 🛠 技術スタック

- **Next.js 16.2.3** (Custom build — App Routerの一部APIに破壊的変更あり)
  - ⚠️ 詳細: `AGENTS.md` と `node_modules/next/dist/docs/` を必ず参照
- **DB**: Turso (libSQL)
- **デプロイ**: Vercel
- **言語**: TypeScript
- **スタイル**: Tailwind CSS (テーマカラー: オレンジ)

---

## 🚀 開発

```bash
npm install
npm run dev
# http://localhost:3000
```

### ローカルDB
- `local.db` (libSQL) を同梱
- 本番接続は環境変数 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`

### スクリプト
- `scripts/daily_sync.py` — HACOMONO/Lstep CSV 自動DL (毎朝実行)
- `scripts/db_check.ts` — DB整合性チェック

---

## 📐 開発ガイドライン

詳細は `CLAUDE.md` 参照。要点:

1. **カスタムNext.jsの罠を踏まない** — 訓練データのAPIを盲信せず、必ず `node_modules/next/dist/docs/` を確認
2. **スタッフ画面は `/staff/*` に統一** — 直下に新規ルートを増やさない
3. **認証は `src/lib/eventAuth.ts` を流用** — 独自実装しない
4. **DB変更時はマイグレーションを `scripts/migrations/` に追加**
5. **テーマカラーはオレンジ** (BOOMブランド)

---

## 📚 関連ドキュメント (SOP)

すべて `/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/SOP/` 配下。

- [`アプリ運用マニュアル.md`](../../BOOM_Master_template/05_運営/SOP/アプリ運用マニュアル.md) — KEIKO/新スタッフ向け
- [`運営月次バッチ手順.md`](../../BOOM_Master_template/05_運営/SOP/運営月次バッチ手順.md) — daily_sync, 突合, Lstepインポート
- [`Lstep_自動応答作成ルール.md`](../../BOOM_Master_template/05_運営/SOP/Lstep_自動応答作成ルール.md) — 対応マーク運用を壊さないために
- [`カレンダー編集ルール.md`](../../BOOM_Master_template/05_運営/SOP/カレンダー編集ルール.md) — 3カレンダーの役割分担
- [`セキュリティ対策ガイド.md`](../../BOOM_Master_template/05_運営/SOP/セキュリティ対策ガイド.md) — 個人情報の取扱

---

## 🏛 リブランド注記

- 旧称: `BW5アプリ` (BW5発表会向けに開発開始)
- 新称: `BOOMアプリ` (常設運営機能を統合)
- リポジトリ名・URL・パスワードは**当面変更なし** (お客さん影響回避)
- 内部ドキュメント・コードコメントから順次「BOOMアプリ」に統一していく
