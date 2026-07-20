# 日次同期(daily_sync)の「黙って失敗する」問題の解消 — 設計

- 日付: 2026-07-20
- 出典: Fable効率監査(2026-07-04) 残タスク / STATE.md TAROボトルネック一覧 項目6
- 承認: TARO (2026-07-20) — 通知チャネル=メール / スコープ=B+A+D+C
- 改訂: 2026-07-20 ログ実測により **D を「待ち時間延長」から「待ち方の修正＋リトライ」へ差し替え**（§2 欠陥0 参照）

## 1. 背景と実測

`daily_sync.py` は事務所Macのcronで 00:00 / 06:00 / 12:00 / 18:00 JST の1日4回動く。
2026-07-18の12:00回がHACOMONOログインの `Page.goto` タイムアウト(60s)で落ち、誰にも通知されなかった。

本番Turso `sync_runs` を実測したところ、これは単発事故ではなかった。

**2026-06-20以降: 71回中24回失敗 = 失敗率34%**（直近20回でも7回失敗）

| 原因 | 回数 |
|---|---|
| Lstep 友だちリストCSV エクスポート待ちタイムアウト(3分) | 18 |
| ページ遷移タイムアウト(60s) ※7/18 12:00のHACOMONOはこれ | 4 |
| その他タイムアウト | 1 |
| Lstep 友だちリストCSV DOMセレクタ不一致 | 1 |

主犯はHACOMONOではなく **Lstep 友だちリストCSVのエクスポート待ちタイムアウト**（24件中18件）。

## 2. 根本原因（4つの独立した欠陥）

### 欠陥0: スクリプトが「条件を待つ」のではなく「固定秒数寝ている」＝競合状態

**当初「Lstepが重い/Macが重い」と推測したが、ログ実測で否定された。**

`auto_sync/logs/2026-*.log` 全期間(5/19〜7/20)の Lstep 友だちリストCSV エクスポートを集計:

| 指標 | 実測値 |
|---|---|
| 成功 / 失敗 | 95回 / 36回（**失敗率27%**） |
| 成功時の所要時間 | **81回中80回が7〜9秒（中央値8秒）**。外れ値1件のみ184秒 |
| 失敗の内訳 | クリック成功→3分タイムアウト 20回 / **クリック失敗（ボタンが見つからない）→3分タイムアウト 13回** |

この3点から、検討した仮説はすべて否定される:

| 仮説 | 判定 | 根拠 |
|---|---|---|
| Lstep管理画面のUI変更 | ❌ | 記録初日(5/19)から失敗しており、**「ここから壊れた」という境目が存在しない** |
| storageState(セッション)の劣化 | ❌ | 6/14に再生成した直後の6/15〜6/26が最も失敗が多い。鮮度と相関しない |
| Mac/回線が重い（→クラウド移行で解決） | ❌ | 成功時は常に7〜9秒。資源不足なら「遅いが成功」が混ざるはずだが皆無。**8秒で終わるか、3分待って何も起きないかの二択** |
| **スクリプトの待ち方（競合状態）** | ⭕️ | 下記 |

`download_lstep_csv()` は要素の出現を待たず、固定スリープで次に進む書き方になっている:

```python
page.wait_for_timeout(2500)          # 2.5秒寝る（画面ができたかは確認しない）
_try_click(page, export_candidates, "CSVエクスポート", timeout=5000)
```

Lstep側の応答が普段よりわずかに遅れた回だけ、ボタンが未描画の状態でクリックしにいって空振りする。
**日単位ではなく回単位でランダムに失敗する**という観測パターン、境目が無いこと、27%という安定した割合、
「8秒か3分タイムアウトか」の二値性——すべてこれで説明がつく。
HACOMONO側の `Page.goto` タイムアウト(4回)も同系統と見られる。

→ **したがって根本対処は「固定スリープを条件待ちに書き換える」。クラウド移行はこの27%には効かない。**

### 欠陥1〜3（下記）は欠陥0とは独立した問題であり、欠陥0を直しても別途必要。

### 欠陥1: 通知が届く経路がゼロ（プル型しかない）

`daily_sync.py` の `notify()` は2経路だが、どちらも実質機能していない。

- `notify_macos()` — macOSの通知センター。Macの前にいないと消える。
- `notify_email()` — Gmail SMTP。`auto_sync/.env` に `GMAIL_SMTP_USER` / `GMAIL_SMTP_PASS` が**未設定**のため常にスキップ。ログ末尾の「Gmail SMTP 未設定のためメール通知スキップ」がこれ。

一方 `report_sync_health("error", ...)` は正常に動いており、`sync_runs` への記録と
`staff_notifications` への `sync_failure` 行の生成（12h重複抑止つき）は**成立している**。

→ **記録はされているが、TAROがアプリを開かないと分からない**。プッシュ経路が無いことが本質。

### 欠陥2: デッドマンスイッチが無い

プロセスが起動すらしなかった場合（Macのスリープ、旅行中の停止＝`session_state_20260604` の経緯）、
`sync_runs` に行が1つも残らないため、欠陥1を直しても**完全に無音**のままになる。

### 欠陥3: 部分成功しない設計（実害の本丸）

`run()` の構造は **全DL(7種) → 全import** の直列。

```
download_hacomono_csvs / billing / all_members / reservations / rs002
  → download_lstep_csv          ← ここで例外が出ると
  → download_lstep_trial_calendar_csv
  → post_to_sync_api / trial_import / billing_import / reservations / rs002 / all_members
    （↑ import段には到達しない）
```

DL段の例外は `run()` 全体の `try` に捕まって即 `return 1` するため、
**既にDL済みのHACOMONO由来CSV（体験予約・予約一覧・稼働率・課金・全メンバー）も一切importされず全滅する。**

2026-07-19は12:00・18:00の2回ともLstep起因で落ち、この経路で
2026-07-18に新設した `/staff/trials`（体験予約の担当周知ページ）のデータが丸一日止まった。
つまり **Lstep単独の不調がHACOMONO由来の鮮度まで道連れにしている**。

## 3. 活用する既存資産（新規構築はほぼ不要）

| 資産 | 状態 |
|---|---|
| `src/lib/notify.ts` `notifyTaro()` | LINE push → メールフォールバック。本番Vercelに `GMAIL_APP_PASSWORD` 設定済み＝**メールは即動く**。LINEは未設定 |
| `src/app/api/cron/story-watchdog/route.ts` | 別故障ドメインで監視・自己修復・通知する完成済みパターン。デッドマンの実装先 |
| `/api/staff/operations/sync-health` | `sync_runs` 記録＋`staff_notifications` 生成＋鮮度バッジGETが実装済み(T-165) |

**スキーマ変更なし＝`scripts/migrations/*.sql` の台帳追加は不要。**
（本番は `SKIP_DB_INIT=1` で `runMigrations` が走らないため列追加は台帳必須だが、今回は新列を足さない）

## 4. 設計

実装順は **B → A → D → C**。Bだけで7/19のような実害が消え、Aで可視化、Dで失敗率そのものを叩く。

### B. 部分成功化 — `daily_sync.py` `run()`

DL 7種をソースごとに独立した `try/except` で囲み、失敗したソースは `failed_sources: list[str]` に
記録して**次のソースへ進む**。import段は「そのCSVが取得できていれば実行」という条件に変える
（HACOMONO系importは既に個別 `try` 済みなので、DL段の分離だけで通る）。

- `sync_runs.status` は **全ソース成功時のみ `ok`**。1つでも落ちたら `error`。
- message に「落ちたソース名」と「実行できたimport」を両方書く。どこまで通ったかが後から分かるようにする。
- 想定効果: Lstep友だちリストが落ちても体験予約・予約一覧・稼働率・課金・全メンバーは取り込まれ、
  `/staff/trials` の鮮度が守られる。全滅 → 劣化 に変わる。

対象ソース（この粒度で切る）:
`hacomono_members` / `hacomono_billing` / `hacomono_all_members` /
`hacomono_reservations` / `hacomono_rs002` / `lstep_friends` / `lstep_trial`

**`post_to_sync_api` の扱い（決定）**: このAPIは `active_csv` / `withdrawn_csv` / `lstep_csv` の
3つを同時に要求する。**3つ全て揃った時だけ呼ぶ。1つでも欠けたらスキップする。**
部分CSVを渡して会員在籍・退会判定を走らせるリスク（誤退会）を取らないため。
突合は次の成功回で追いつく（同期は冪等）。他のimport（体験予約・予約一覧・稼働率・課金・全メンバー）は
それぞれ独立したCSVなので、取得できていれば実行する。

### A. 失敗のプッシュ通知 — `src/app/api/staff/operations/sync-health/route.ts`

`status === 'error'` の分岐で、**`staff_notifications` に実際にINSERTされた時だけ** `notifyTaro()` を呼ぶ。

- 既存の「12h以内に同種通知があればINSERTしない」ロジックの `rowsAffected` を見て判定する。
  → 1日4回失敗してもメールは12hに1通。ノイズにならない。
- `try/catch` で囲み、メール送信が失敗しても POST 自体は 200 を返す（同期本体を巻き込まない）。
- `notify.ts` の件名prefixが `[BOOM Story]` 固定なので、**任意prefix引数を追加**して
  `[BOOM 同期]` を使えるようにする。既定値は現行の `[BOOM Story]` のまま＝既存呼び出し側は無改修。
- 宛先は `boom.sendai@gmail.com`（`notifyTaro` の既定）。LINEは未設定なので自動的にメール経路に落ちる。
- 本文に個人情報を載せない（CLAUDE.md 規約8）。message は例外種別・落ちたソース名まで。

### D. 待ち方の修正＋リトライ — `daily_sync.py`

**当初案の「エクスポート完了待ちを3分→6分に延長」は破棄する。**
成功時の中央値が8秒である以上、3分で終わらないものが6分で終わることはない（§2 欠陥0）。

代わりに2段構えで対処する。

**D-1: 固定スリープを条件待ちに置換（根本対処）**

`download_lstep_csv()` および `_lstep_login()` の `page.wait_for_timeout(N)` のうち、
「この後に要素を操作する」ためのものを `page.wait_for_selector(...)` / `expect(...).to_be_visible()` 系に置き換える。

- 対象は**次の操作対象が決まっているスリープのみ**。
  「ダウンロード生成を待つ」等、待つ対象が要素でないスリープはそのまま残す。
- クリック対象は `_try_click` の候補リストと同じセレクタ群を使い、**いずれかが可視になるまで待ってから押す**。
- HACOMONO側の `_hacomono_download_query()` / `_hacomono_login()` にも同じ観点で必要最小限を適用する。

**D-2: リトライ（保険）**

- 各DL関数を **最大3回試行**（失敗時30秒待機、リトライ前にページを再読込しログインを再確立）
- エクスポート完了待ちは **3分 → 45秒/回**。同じ時間予算で3回チャンスを作る方が、
  「押し損ね」「エクスポート未完了」の両方の失敗パターンに効く
- リトライで成功した場合も message に「1回目失敗→リトライ成功」を残す。**黙って直さない。**
  （成功率の改善が測れるように、`sync_runs.message` に試行回数を必ず含める）

### C. デッドマンスイッチ

`src/lib/syncWatchdog.ts` を新設し、純関数として切り出す。

```ts
evaluateSyncFreshness(lastOkAt: string | null, now: Date): { stale: boolean; hours: number | null; message: string | null }
```

- 判定: 最後の `sync_runs.status='ok'` から **14時間超**なら stale。
  正常時は6h間隔なので誤爆しない。`lastOkAt` が null（記録が1つも無い）も stale 扱い。
- 呼び出し元: **既存の `/api/cron/story-watchdog`**（Vercel cron `10 0 * * *` UTC = JST 9:10）から呼び、
  stale なら `anomalies` に積んで既存の通知経路に乗せる。
- **新規cronを立てない理由**: Vercel Hobbyプランのcron本数上限。現在 `vercel.json` に2本あり、
  3本目でデプロイが弾かれるリスクを避ける。JST 9:10 は 00:00 / 06:00 回の着地を見るのに適時。
- 純関数に切り出す理由: vitestで単体テストできるようにするため（時刻依存を引数で注入）。

## 5. 検証

- `npx tsc --noEmit`
- `vitest` — `evaluateSyncFreshness` の新規テスト（ok直後 / 13h / 15h / null）を追加し、全件緑を確認
- `daily_sync.py --dry-run` で通しを確認
- Lstepを意図的に失敗させた状態（不正な `LSTEP_STORAGE_STATE` 等）で部分成功を確認し、
  HACOMONO由来のimportが実行されることをログで検証
- **本番DBへの書込テストはしない**。否定テストが必要な場合は存在しないIDで撃つ
  （[[feedback_prod_negative_test_safety]] / 2026-07-06のインシデント教訓）

## 6. デプロイ手順（TARO承認後）

1. worktreeで実装 → `tsc` / `vitest` 緑を確認
2. bw5-app側（A・C）: TARO承認後に main へ push → Vercel自動デプロイ → deploy success を確認**してから**疎通確認
3. `daily_sync.py` 側（B・D）: `BOOM_Master_template` リポジトリ。cron設定自体は変更しない
4. STATE.md のワークストリーム行を更新して commit & push

## 7. 今回やらないこと（スコープ外）

- **E. launchd化 / クラウド移行**（Mac依存の緩和）— 別途。TARO のMac操作が1回必要になるため分離。
  **重要**: クラウド移行は §2 欠陥0 の27%には**効かない**（原因がスクリプト側のため）。
  効くのは「Macが寝ている/旅行中で起動しない」という**可用性**の問題に対してのみ。
  ただし B（部分成功化）でソース別に切り分けたあとなら、**HACOMONOだけ先にクラウドへ出す**分割が可能になる
  （TAROが別セッションでHACOMONOのクラウドログイン成功を確認済み）。
  Lstepのクラウド化はデータセンターIPでのセッション弾かれリスクがあるため、最後に判断する。
- **LINE push の有効化** — `LINE_CHANNEL_ACCESS_TOKEN` / `TARO_LINE_USER_ID` の用意が必要。
  `notify.ts` は既にLINE優先に対応済みなので、env2つを設定すれば無改修で切り替わる
- **storageState の再生成** — 6/14生成で36日経過しており予防的にはやる価値があるが、
  §2 欠陥0 の通り**27%の失敗とは無関係**と判明したため、今回の対処には含めない
