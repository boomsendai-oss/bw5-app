# 日次同期の失敗通知・部分成功化・自己修復 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日次同期(`daily_sync.py`)が失敗しても実害を出さず、失敗したらTAROにメールが届き、起動しなかった場合も検知できるようにする。

**Architecture:** 4つの独立した欠陥に別々に対処する。(0) スクリプトの固定スリープを条件待ちに置換し27%の失敗率そのものを下げる (B) DL失敗をソース単位に閉じ込め、取得できた分は必ずimportする (A) 既存 `notifyTaro()` を `sync-health` API のerror分岐に配線してプッシュ通知を得る (C) 純関数 `evaluateSyncFreshness()` を既存 story-watchdog cron から呼びデッドマンスイッチにする。

**Tech Stack:** Python 3 + Playwright (`daily_sync.py` / BOOM_Master_template リポジトリ) / TypeScript + Next.js + Turso + vitest (`bw5-app` リポジトリ)

**関連spec:** `docs/superpowers/specs/2026-07-20-daily-sync-failure-notification-design.md`

---

## リポジトリが2つにまたがる点に注意

| 対象 | リポジトリ | パス |
|---|---|---|
| Task 1〜4 | **BOOM_Master_template** | `/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py` |
| Task 5〜8 | **bw5-app** (このworktree) | `/Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a/` |

### ⚠️ `BOOM_Master_template` は git リポジトリではない

`daily_sync.py` は**バージョン管理されていない**。`git add` / `git commit` は使えない（`fatal: not a git repository`）。
`daily_sync.py.bak_20260610` が存在するのは、過去に手動バックアップを取った痕跡。

**`git init` はしない。** 同ディレクトリには `.env` / `lstep_state.json`（認証情報）と
`data/raw/`（個人情報・gitignore前提）があり、リポジトリ化は情報漏洩事故のリスクがある。
CLAUDE.md 規約8（個人情報の取扱）に照らしても、独断でやるべき変更ではない。

**代わりに既存の `.bak_` 方式に従う:** 各タスクの着手前に必ずタイムスタンプ付きバックアップを取り、
「commit」の代わりに「バックアップ＋動作確認」をチェックポイントにする。

```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
cp -p daily_sync.py "daily_sync.py.bak_$(date +%Y%m%d_%H%M%S)"
```

ロールバックが必要になったら、該当バックアップを `daily_sync.py` に戻す。

**bw5-app 側（Task 5〜8）は通常通り git commit する。** main へ push すると Vercel が自動デプロイするため、
**push は TARO の承認後**（Task 9）。

## スキーマ変更なし

新しい列もテーブルも追加しない。`scripts/migrations/*.sql` の台帳追加は**不要**。
（本番は `SKIP_DB_INIT=1` で `runMigrations` が走らないため列追加は台帳必須だが、今回は該当しない）

## File Structure

| ファイル | 役割 | 新規/変更 |
|---|---|---|
| `auto_sync/daily_sync.py` | 同期本体。DLのソース別分離・条件待ち・リトライ | 変更 |
| `auto_sync/test_daily_sync.py` | `with_retry()` の純ロジックのunittest | **新規** |
| `bw5-app/src/lib/notify.ts` | 通知の単一入口。件名prefixを可変にする | 変更 |
| `bw5-app/src/lib/syncWatchdog.ts` | 同期鮮度の判定（純関数・時刻を引数注入） | **新規** |
| `bw5-app/src/lib/__tests__/syncWatchdog.test.ts` | 上記のテスト | **新規** |
| `bw5-app/src/app/api/staff/operations/sync-health/route.ts` | error時に `notifyTaro()` を呼ぶ | 変更 |
| `bw5-app/src/app/api/cron/story-watchdog/route.ts` | 同期デッドマンの判定を相乗りさせる | 変更 |

`syncWatchdog.ts` を独立ファイルにする理由: 時刻依存を引数で注入した純関数にして vitest で単体テストするため。
route.ts に直書きするとテストできない。

---

## Task 1: 同期の部分成功化 — DL失敗をソース単位に閉じ込める

**Files:**
- Modify: `/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py:1301-1305`（HACOMONO）
- Modify: 同 `:1337-1345`（Lstep）
- Modify: 同 `:1357-1359`（dry-run の `dl_lines`）
- Modify: 同 `:1376`（`post_to_sync_api` のゲート）
- Modify: 同 `:1492-1496`（最終ステータス判定）

**背景:** 現状 `download_hacomono_csvs` と `download_lstep_csv` の2つだけが例外を `raise` して `run()` 全体を止める。
他の5ソース（billing / all_members / reservations / rs002 / lstep_trial）は既に個別 `try` で継続する作りになっている。
つまり**この2箇所を閉じ込め、`post_to_sync_api` の呼び出しを条件付きにするだけ**で部分成功化が成立する。

- [ ] **Step 1: バックアップを取り、現状の構文が通ることを確認**

git が無いので、これが唯一のロールバック手段。**必ず先にやること。**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
cp -p daily_sync.py "daily_sync.py.bak_$(date +%Y%m%d_%H%M%S)"
ls -la daily_sync.py.bak_* | tail -2
python3 -c "import ast; ast.parse(open('daily_sync.py',encoding='utf-8').read()); print('構文OK')"
```
Expected: 新しいバックアップファイルが1つ増えている / `構文OK`

- [ ] **Step 2: 失敗ソース記録用の変数を run() の冒頭に追加**

`daily_sync.py:1300` の `page.set_default_timeout(60_000)` の直後に、以下を挿入する。

```python
            page.set_default_timeout(60_000)

            # 部分成功化: DLはソース単位で失敗を閉じ込め、取得できた分だけ import へ進む。
            # ここに積んだソース名が1つでもあれば最終ステータスは error 扱いにする。
            failed_sources: list[str] = []
```

- [ ] **Step 3: HACOMONO会員CSVの raise を閉じ込めに変える**

`daily_sync.py:1301-1305` の以下を、

```python
            try:
                active_csv, withdrawn_csv = download_hacomono_csvs(page)
            except Exception:
                screenshot_on_error(page, "hacomono")
                raise
```

こう置き換える。

```python
            active_csv: Path | None = None
            withdrawn_csv: Path | None = None
            try:
                active_csv, withdrawn_csv = download_hacomono_csvs(page)
            except Exception as e:
                log(f"HACOMONO会員CSV DL 失敗 (継続): {type(e).__name__}: {e}")
                screenshot_on_error(page, "hacomono")
                failed_sources.append("hacomono_members")
```

- [ ] **Step 4: Lstep友だちリストCSVの raise を閉じ込めに変える**

`daily_sync.py:1337-1345` の以下を、

```python
            lstep_csv: Path | None = None
            try:
                lstep_csv = download_lstep_csv(page)
            except Exception as e:
                screenshot_on_error(page, "lstep")
                if dry_run:
                    log(f"Lstep DL 失敗 (dry-run のため継続): {type(e).__name__}: {e}")
                else:
                    raise
```

こう置き換える。

```python
            lstep_csv: Path | None = None
            try:
                lstep_csv = download_lstep_csv(page)
            except Exception as e:
                log(f"Lstep友だちリストCSV DL 失敗 (継続): {type(e).__name__}: {e}")
                screenshot_on_error(page, "lstep")
                failed_sources.append("lstep_friends")
```

- [ ] **Step 5: 他の5ソースの except にも failed_sources を積む**

既に `try/except` で継続している5箇所の `except` 節末尾に `failed_sources.append(...)` を1行ずつ足す。
対象と追加する行は以下の通り（`log(...)` / `screenshot_on_error(...)` の**後ろ**に足す）。

| 既存の except 内のログ文言 | 追加する行 |
|---|---|
| `課金CSV DL 失敗 (継続)` | `failed_sources.append("hacomono_billing")` |
| `全メンバーCSV DL 失敗 (継続)` | `failed_sources.append("hacomono_all_members")` |
| `予約一覧CSV DL 失敗 (継続)` | `failed_sources.append("hacomono_reservations")` |
| `稼働率CSV DL 失敗 (継続)` | `failed_sources.append("hacomono_rs002")` |
| `体験予約CSV DL 失敗 (継続)` | `failed_sources.append("lstep_trial")` |

例（課金CSVの場合）:

```python
            billing_csv: Path | None = None
            try:
                billing_csv = download_hacomono_billing_csv(page)
            except Exception as e:
                log(f"課金CSV DL 失敗 (継続): {type(e).__name__}: {e}")
                screenshot_on_error(page, "hacomono_billing")
                failed_sources.append("hacomono_billing")
```

- [ ] **Step 6: dry-run の dl_lines が NameError を出さないよう直す**

`daily_sync.py:1358` の以下は `active_csv` が None の場合に落ちる。

```python
            dl_lines = [active_csv.name, withdrawn_csv.name]
```

こう置き換える。

```python
            dl_lines = []
            if active_csv and withdrawn_csv:
                dl_lines.append(active_csv.name)
                dl_lines.append(withdrawn_csv.name)
            else:
                dl_lines.append("(hacomono_members: 取得失敗)")
```

- [ ] **Step 7: post_to_sync_api を「3つ揃った時だけ」呼ぶようにする**

`daily_sync.py:1376` の以下を、

```python
        result = post_to_sync_api(active_csv, withdrawn_csv, lstep_csv)

        # 結果ログ保存
        result_path = LOGS_DIR / f"result_{NOW_TS}.json"
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

        summary = format_summary(result)
        log("結果サマリ:\n" + summary)
```

こう置き換える。

```python
        # 会員突合は active/withdrawn/lstep の3CSVが揃った時だけ実行する。
        # 部分CSVで在籍・退会判定を走らせると誤退会のリスクがあるため、揃わなければスキップし、
        # 次の成功回で追いつかせる(同期は冪等)。他のimportは独立CSVなので取得できていれば実行する。
        if active_csv and withdrawn_csv and lstep_csv:
            result = post_to_sync_api(active_csv, withdrawn_csv, lstep_csv)

            # 結果ログ保存
            result_path = LOGS_DIR / f"result_{NOW_TS}.json"
            result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

            summary = format_summary(result)
            log("結果サマリ:\n" + summary)
        else:
            summary = "[会員突合] CSVが揃わなかったためスキップ (誤退会防止)"
            log(summary)
```

- [ ] **Step 8: 最終ステータスを failed_sources で決める**

`daily_sync.py:1492-1496` の以下を、

```python
        notify(
            f"[BW5 自動突合] {datetime.now().strftime('%Y-%m-%d %H:%M')} 成功",
            summary,
        )
        report_sync_health("ok", summary)
```

こう置き換える。

```python
        # 全ソース成功した時だけ ok。1つでも落ちていれば error にして通知を鳴らす。
        if failed_sources:
            summary = (
                f"[部分成功] 取得失敗したソース: {', '.join(failed_sources)}\n"
                f"(上記以外のデータは取り込み済み)\n\n" + summary
            )
            notify(
                f"[BW5 自動突合] {datetime.now().strftime('%Y-%m-%d %H:%M')} 部分成功",
                summary,
            )
            report_sync_health("error", summary)
        else:
            notify(
                f"[BW5 自動突合] {datetime.now().strftime('%Y-%m-%d %H:%M')} 成功",
                summary,
            )
            report_sync_health("ok", summary)
```

- [ ] **Step 9: 構文チェック**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
python3 -c "import ast; ast.parse(open('daily_sync.py',encoding='utf-8').read()); print('構文OK')"
```
Expected: `構文OK`

- [ ] **Step 10: Lstepを意図的に失敗させて部分成功を実証**

`LSTEP_STORAGE_STATE` に存在しないパスを渡し、かつ `LSTEP_PASSWORD` を壊して Lstep を確実に失敗させる。
`--dry-run` では API POST しないので本番DBは汚さない。

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
LSTEP_PASSWORD=deliberately-wrong-for-fault-injection python3 daily_sync.py --dry-run 2>&1 | tail -40
```
Expected:
- `Lstep友だちリストCSV DL 失敗 (継続)` がログに出る
- **その後も処理が続き**、HACOMONO系のDLログが出て `dry-run: API POST スキップ` まで到達する
- 途中で `Traceback` を出して終了**しない**

うまくいかない場合は `logs/` の当日ログ全文を読んでから直す。

- [ ] **Step 11: チェックポイント（git commit の代わり）**

git が無いので、動作確認済みの状態をバックアップとして固定する。

```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
cp -p daily_sync.py "daily_sync.py.ok_task1_$(date +%Y%m%d_%H%M%S)"
```

変更内容の記録（あとで Task 9 Step 7 の STATE.md 更新に使う）:
> DL失敗をソース単位に閉じ込めて部分成功化。Lstep1つの失敗でHACOMONO由来の取込まで
> 全滅していた（7/19に `/staff/trials` が丸一日停止）。会員突合は誤退会防止のため
> 3CSV揃った時のみ実行。1つでも落ちたら最終ステータスを error にして通知を鳴らす。

---

## Task 2: リトライ用の純関数 `with_retry()` を追加（テスト付き）

**Files:**
- Create: `/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/test_daily_sync.py`
- Modify: `/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py`（`report_sync_health` の直後、`# ---- CSV ダウンロード` コメントの直前に追加）

ブラウザ操作そのものはテストできないが、**リトライの制御ロジックは純ロジックなのでテストできる**。
ここだけ切り出してTDDで作る。

- [ ] **Step 1: 失敗するテストを書く**

Create `test_daily_sync.py`:

```python
"""daily_sync.py の純ロジックのテスト。ブラウザ操作は対象外。

実行: cd auto_sync && python3 -m unittest test_daily_sync -v
"""
import unittest
from unittest.mock import patch

import daily_sync


class TestWithRetry(unittest.TestCase):
    def test_1回目で成功したら1回だけ呼ばれ結果を返す(self):
        calls = []

        def fn():
            calls.append(1)
            return "ok"

        with patch("daily_sync.time.sleep"):
            result, attempts = daily_sync.with_retry(fn, label="test", attempts=3, wait_sec=30)

        self.assertEqual(result, "ok")
        self.assertEqual(attempts, 1)
        self.assertEqual(len(calls), 1)

    def test_2回目で成功したら試行回数2を返す(self):
        calls = []

        def fn():
            calls.append(1)
            if len(calls) < 2:
                raise RuntimeError("一過性の失敗")
            return "ok"

        with patch("daily_sync.time.sleep"):
            result, attempts = daily_sync.with_retry(fn, label="test", attempts=3, wait_sec=30)

        self.assertEqual(result, "ok")
        self.assertEqual(attempts, 2)
        self.assertEqual(len(calls), 2)

    def test_全部失敗したら最後の例外を送出する(self):
        calls = []

        def fn():
            calls.append(1)
            raise RuntimeError(f"失敗{len(calls)}")

        with patch("daily_sync.time.sleep"):
            with self.assertRaises(RuntimeError) as cm:
                daily_sync.with_retry(fn, label="test", attempts=3, wait_sec=30)

        self.assertEqual(str(cm.exception), "失敗3")
        self.assertEqual(len(calls), 3)

    def test_リトライ間はwait_sec秒待つ(self):
        def fn():
            raise RuntimeError("常に失敗")

        with patch("daily_sync.time.sleep") as sleeper:
            with self.assertRaises(RuntimeError):
                daily_sync.with_retry(fn, label="test", attempts=3, wait_sec=30)

        # 3回試行 = リトライ前の待機は2回
        self.assertEqual(sleeper.call_count, 2)
        for call in sleeper.call_args_list:
            self.assertEqual(call.args[0], 30)

    def test_on_retryフックがリトライ前に呼ばれる(self):
        hook_calls = []

        def fn():
            raise RuntimeError("常に失敗")

        with patch("daily_sync.time.sleep"):
            with self.assertRaises(RuntimeError):
                daily_sync.with_retry(
                    fn, label="test", attempts=3, wait_sec=30,
                    on_retry=lambda: hook_calls.append(1),
                )

        self.assertEqual(len(hook_calls), 2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
python3 -m unittest test_daily_sync -v 2>&1 | tail -20
```
Expected: FAIL。`AttributeError: module 'daily_sync' has no attribute 'with_retry'`

（もし `import daily_sync` 自体で playwright 等の ImportError が出る場合は、
`daily_sync.py` の import が遅延importになっているか確認する。
`playwright` は `run()` 内で遅延importされているのでモジュールimportは通るはず）

- [ ] **Step 3: `with_retry()` を実装**

`daily_sync.py` の `report_sync_health()` 関数の直後（`# ---- CSV ダウンロード ---` コメントの直前）に追加:

```python
# ---- リトライ --------------------------------------------------------------

def with_retry(fn, label: str, attempts: int = 3, wait_sec: int = 30, on_retry=None):
    """fn() を最大 attempts 回試行し、(戻り値, 実際の試行回数) を返す。

    Lstep/HACOMONO の失敗は「8秒で終わるか、待っても永久に終わらないか」の二値で、
    遅いだけの回が存在しない(ログ実測: 成功81回中80回が7-9秒)。
    つまり待ち時間を延ばしても意味がなく、状態を作り直して押し直すのが正しい対処。

    on_retry は再試行の直前に呼ばれるフック(ページ再読込・再ログイン用)。
    全試行が失敗した場合は最後の例外をそのまま送出する。
    """
    last_exc = None
    for i in range(1, attempts + 1):
        try:
            result = fn()
            if i > 1:
                log(f"{label}: {i}回目で成功 (1〜{i - 1}回目は失敗)")
            return result, i
        except Exception as e:
            last_exc = e
            if i < attempts:
                log(f"{label}: {i}回目失敗 ({type(e).__name__}: {e}) — {wait_sec}秒後に再試行")
                time.sleep(wait_sec)
                if on_retry is not None:
                    try:
                        on_retry()
                    except Exception as hook_err:
                        log(f"{label}: 再試行前の復旧処理に失敗 (継続): {hook_err}")
            else:
                log(f"{label}: {attempts}回すべて失敗")
    raise last_exc
```

- [ ] **Step 4: `import time` を追加（現状 import されていないので必須）**

`daily_sync.py:18-29` の import 群は現状こうなっており、**`time` が無い**。

```python
import argparse
import json
import os
import smtplib
import subprocess
import sys
import traceback
```

`import sys` と `import traceback` の間（アルファベット順）に1行足す。

```python
import argparse
import json
import os
import smtplib
import subprocess
import sys
import time
import traceback
```

確認:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
grep -n "^import time" daily_sync.py
```
Expected: `27:import time` のように1件ヒットする

- [ ] **Step 5: テストを実行して通ることを確認**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
python3 -m unittest test_daily_sync -v 2>&1 | tail -20
```
Expected: `Ran 5 tests` / `OK`

- [ ] **Step 6: チェックポイント（git commit の代わり）**

```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
cp -p daily_sync.py "daily_sync.py.ok_task2_$(date +%Y%m%d_%H%M%S)"
```

変更内容の記録:
> リトライ制御 `with_retry()` を追加（unittest 5件）。失敗は8秒 or 永久待ちの二値なので、
> 待ち時間延長ではなく状態を作り直して押し直す方が効く。`on_retry` フックで
> 再読込・再ログインを差し込めるようにした。

**注意:** `test_daily_sync.py` は新規ファイルなのでバックアップ対象外だが、消さないこと。

---

## Task 3: 固定スリープを条件待ちに置換（根本対処 D-1）

**Files:**
- Modify: `/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py:492-625`（`download_lstep_csv`）

**背景:** 失敗36回のうち13回は「CSVエクスポート ボタンが見つからない(クリック失敗)」。
`page.wait_for_timeout(2500)` で固定秒数寝てから押しにいくため、Lstep側の描画がわずかに遅れた回に空振りする。
**「N秒待つ」を「その要素が出るまで待つ」に変える。**

- [ ] **Step 1: セレクタ候補群を待つヘルパーを追加**

`with_retry()` の直後（`# ---- CSV ダウンロード ---` コメントの直前）に追加:

```python
def wait_for_any_selector(page, candidates: list[str], label: str, timeout: int = 30_000) -> bool:
    """candidates のいずれかが可視になるまで待つ。出たら True、時間切れなら False。

    固定スリープ(wait_for_timeout)で「もう描画されてるはず」と決め打ちすると、
    相手側の描画がわずかに遅れた回だけ空振りする(実測27%の失敗の主因)。
    押す直前に「押せる状態か」を必ず確認するための関数。
    """
    import time as _time

    deadline = _time.monotonic() + timeout / 1000.0
    while _time.monotonic() < deadline:
        for sel in candidates:
            if not sel:
                continue
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=500):
                    return True
            except Exception:
                continue
        page.wait_for_timeout(250)
    log(f"[WARN] {label}: 候補セレクタがいずれも可視にならず時間切れ ({timeout}ms)")
    return False
```

- [ ] **Step 2: 友だちリストページ読込後の固定スリープを条件待ちに置換**

`daily_sync.py:513-520` 付近の以下を、

```python
    page.goto(LSTEP_FRIEND_LIST_URL, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_timeout(3000)

    # 最下部までスクロール (lazy-load 対策で2段階)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(1200)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(800)
```

こう置き換える。

**⚠️ 2026-07-20 実測により破棄。`networkidle` は使ってはいけない。**
Lstepの友だちリスト画面は常時接続を張っており `networkidle` が発火しない。
適用すると毎回30秒待った末に必ず失敗する（実装中に検証して発覚・差し戻し済み）。
`page.wait_for_timeout(3000)` はそのまま残し、描画待ちは Step 9 / Step 10 の
`wait_for_any_selector()`（押す直前に可視を確認する）側で達成する。
コードには再発防止の NOTE コメントを残すこと。

~~```python
    page.goto(LSTEP_FRIEND_LIST_URL, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_load_state("networkidle", timeout=30_000)~~

    # 最下部までスクロール (lazy-load 対策で2段階)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(1200)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    # スクロール後の遅延描画は「CSV操作タブが見えるまで」で待つ(下の Step 3 で待つので固定待ちは最小限)
    page.wait_for_timeout(800)
```

- [ ] **Step 3: 「CSV操作」タブを押す前に可視を待つ**

`csv_tab_candidates` のリスト定義の**直後**、`_try_click(page, csv_tab_candidates, ...)` の**直前**に1行挿入する。

変更前:
```python
    _try_click(page, csv_tab_candidates, "CSV操作タブ", timeout=4000)
    page.wait_for_timeout(800)
```

変更後:
```python
    wait_for_any_selector(page, csv_tab_candidates, "CSV操作タブ", timeout=30_000)
    _try_click(page, csv_tab_candidates, "CSV操作タブ", timeout=4000)
    page.wait_for_timeout(800)
```

- [ ] **Step 4: 「CSVエクスポート」ボタンを押す前に可視を待つ（失敗13回の直撃箇所）**

`export_btn_candidates` のリスト定義の**直後**、`_try_click(page, export_btn_candidates, ...)` の**直前**に1行挿入する。

変更前:
```python
    _try_click(page, export_btn_candidates, "CSVエクスポート", timeout=5000)
    page.wait_for_load_state("domcontentloaded", timeout=30_000)
    page.wait_for_timeout(2500)
```

変更後:
```python
    wait_for_any_selector(page, export_btn_candidates, "CSVエクスポート", timeout=30_000)
    _try_click(page, export_btn_candidates, "CSVエクスポート", timeout=5000)
    page.wait_for_load_state("domcontentloaded", timeout=30_000)
    # 「この条件でダウンロード」が出るならそれを待つ。出ない旧仕様なら時間切れで先へ進む(既存の分岐が拾う)
    wait_for_any_selector(page, confirm_btn_candidates, "この条件でダウンロード", timeout=10_000)
```

**注意:** `confirm_btn_candidates` はこの位置より**後ろ**で定義されている。
`confirm_btn_candidates` のリスト定義を、この `wait_for_any_selector` 呼び出しより**前**に移動すること。
移動後の並びは「`export_btn_candidates` 定義 → `confirm_btn_candidates` 定義 → 上記の待機＋クリック」になる。

- [ ] **Step 5: 構文チェックと既存テストの再実行**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
python3 -c "import ast; ast.parse(open('daily_sync.py',encoding='utf-8').read()); print('構文OK')"
python3 -m unittest test_daily_sync -v 2>&1 | tail -5
```
Expected: `構文OK` と `Ran 5 tests` / `OK`

- [ ] **Step 6: 実際にLstep DLを通して成功することを確認**

`--lstep-only` は Lstep CSV の DL だけを行い API POST しないモード。本番DBを汚さない。

**前提:** `run_lstep_only()` は `LSTEP_STORAGE_STATE` が設定済みかつファイルが存在しないと
`return 2` で即終了する。先に確認する。

```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
grep -n "^LSTEP_STORAGE_STATE=" .env && ls -la lstep_state.json
```
Expected: `.env` に設定があり `lstep_state.json` が存在する。
無ければ `--lstep-only` は使えないので、代わりに `--dry-run` で Lstep DL 部分のログを見ること。

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
python3 daily_sync.py --lstep-only 2>&1 | tail -30
```
Expected: `Lstep 友だちCSV DL完了` が出る。
ログに `[WARN] CSVエクスポート: 候補セレクタがいずれも可視にならず時間切れ` が出て**いない**こと。

**1回成功しただけでは競合状態が直った証明にはならない**（元々73%は成功していた）。
効果判定は Task 9 Step 8 の1週間後の失敗率で行う。ここで見るのは「壊していないこと」。

- [ ] **Step 7: チェックポイント（git commit の代わり）**

```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
cp -p daily_sync.py "daily_sync.py.ok_task3_$(date +%Y%m%d_%H%M%S)"
```

変更内容の記録:
> Lstep操作の固定スリープを条件待ちに置換。失敗36回中13回は「CSVエクスポートボタンが
> 見つからない」＝ `wait_for_timeout` で決め打ちして押しにいって空振りしていた。
> 押す直前に可視を確認する `wait_for_any_selector` を挟み、競合状態を解消する。

---

## Task 4: DL関数にリトライを配線（D-2）

**Files:**
- Modify: `/Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync/daily_sync.py`（`download_lstep_csv` のポーリング上限、`run()` の呼び出し2箇所）

- [ ] **Step 1: エクスポート完了ポーリングを3分→45秒に短縮**

`daily_sync.py` の以下を、

```python
    log("CSVエクスポート完了をポーリング (最大3分待機)...")
    max_polls = 36   # 3分 (5秒×36)
```

こう置き換える。

```python
    # 成功時は実測7-9秒で完了する(ログ全期間 81回中80回)。3分待っても終わらない回は
    # 待てば終わるのではなく状態が壊れているので、45秒で見切ってリトライに回す方が効く。
    log("CSVエクスポート完了をポーリング (最大45秒待機)...")
    max_polls = 9    # 45秒 (5秒×9)
```

- [ ] **Step 2: `run()` の Lstep DL をリトライ経由にする**

Task 1 Step 4 で置き換えた箇所を、さらにこう変える。

```python
            lstep_csv: Path | None = None
            try:
                def _reset_lstep_page():
                    page.goto(LSTEP_FRIEND_LIST_URL, wait_until="domcontentloaded", timeout=60_000)

                lstep_csv, lstep_attempts = with_retry(
                    lambda: download_lstep_csv(page),
                    label="Lstep友だちリストCSV",
                    attempts=3,
                    wait_sec=30,
                    on_retry=_reset_lstep_page,
                )
                if lstep_attempts > 1:
                    retry_notes.append(f"Lstep友だちリストCSV: {lstep_attempts}回目で成功")
            except Exception as e:
                log(f"Lstep友だちリストCSV DL 失敗 (継続): {type(e).__name__}: {e}")
                screenshot_on_error(page, "lstep")
                failed_sources.append("lstep_friends")
```

- [ ] **Step 3: `run()` の HACOMONO会員CSV DL をリトライ経由にする**

Task 1 Step 3 で置き換えた箇所を、さらにこう変える。

```python
            active_csv: Path | None = None
            withdrawn_csv: Path | None = None
            try:
                pair, hacomono_attempts = with_retry(
                    lambda: download_hacomono_csvs(page),
                    label="HACOMONO会員CSV",
                    attempts=3,
                    wait_sec=30,
                )
                active_csv, withdrawn_csv = pair
                if hacomono_attempts > 1:
                    retry_notes.append(f"HACOMONO会員CSV: {hacomono_attempts}回目で成功")
            except Exception as e:
                log(f"HACOMONO会員CSV DL 失敗 (継続): {type(e).__name__}: {e}")
                screenshot_on_error(page, "hacomono")
                failed_sources.append("hacomono_members")
```

- [ ] **Step 4: `retry_notes` を宣言する**

Task 1 Step 2 で追加した `failed_sources` の直後に足す。

```python
            failed_sources: list[str] = []
            # リトライで救えた回を可視化する(黙って直さない)。sync_runs.message に載せる。
            retry_notes: list[str] = []
```

- [ ] **Step 5: `retry_notes` を summary に載せる**

Task 1 Step 8 で置き換えたブロックの**直前**に挿入する。

```python
        if retry_notes:
            summary = "[リトライ]\n" + "\n".join(retry_notes) + "\n\n" + summary

        # 全ソース成功した時だけ ok。1つでも落ちていれば error にして通知を鳴らす。
        if failed_sources:
```

- [ ] **Step 6: 構文チェック＋テスト＋dry-run**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
python3 -c "import ast; ast.parse(open('daily_sync.py',encoding='utf-8').read()); print('構文OK')"
python3 -m unittest test_daily_sync -v 2>&1 | tail -5
python3 daily_sync.py --dry-run 2>&1 | tail -30
```
Expected: `構文OK` / `Ran 5 tests` `OK` / dry-run が `dry-run: API POST スキップ` まで到達

- [ ] **Step 7: リトライが実際に発動することを確認**

`LSTEP_PASSWORD` を壊して確実に失敗させ、**3回試行して30秒待機が2回入る**ことを確認する。

Run:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
LSTEP_PASSWORD=deliberately-wrong-for-fault-injection python3 daily_sync.py --dry-run 2>&1 | grep -E "回目失敗|すべて失敗|DL 失敗 \(継続\)"
```
Expected:
```
Lstep友だちリストCSV: 1回目失敗 (...) — 30秒後に再試行
Lstep友だちリストCSV: 2回目失敗 (...) — 30秒後に再試行
Lstep友だちリストCSV: 3回すべて失敗
Lstep友だちリストCSV DL 失敗 (継続): ...
```

- [ ] **Step 8: チェックポイント（git commit の代わり）**

```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
cp -p daily_sync.py "daily_sync.py.ok_task4_$(date +%Y%m%d_%H%M%S)"
```

変更内容の記録:
> HACOMONO/Lstepの主要DLを3回リトライにする。エクスポート待ちを3分→45秒に短縮し、
> 同じ時間予算で3回チャンスを作る。リトライで救えた回は `sync_runs.message` に残して
> 黙って直さない。

---

## Task 5: `notify.ts` の件名prefixを可変にする

**Files:**
- Modify: `bw5-app/src/lib/notify.ts`
- Create: `bw5-app/src/lib/__tests__/notify.test.ts`

現状 `notifyTaro` は件名を `[BOOM Story] ...` に固定している。同期の通知に流用するため prefix を可変にする。
**既存呼び出し側（story-watchdog / story-preflight）を壊さないよう既定値は現行のまま。**

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/notify.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatSubject } from '../notify';

describe('formatSubject', () => {
  it('prefix未指定なら既存の [BOOM Story] を保つ(既存呼び出し側の互換)', () => {
    expect(formatSubject('要対応 2026-07-20')).toBe('[BOOM Story] 要対応 2026-07-20');
  });

  it('prefixを指定したらそれを使う', () => {
    expect(formatSubject('同期が失敗しました', '[BOOM 同期]')).toBe(
      '[BOOM 同期] 同期が失敗しました'
    );
  });

  it('prefixに空文字を渡したら既定値にフォールバックする', () => {
    expect(formatSubject('件名', '')).toBe('[BOOM Story] 件名');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
npx vitest run src/lib/__tests__/notify.test.ts 2>&1 | tail -15
```
Expected: FAIL。`formatSubject` が export されていない旨のエラー。

- [ ] **Step 3: 実装する**

`src/lib/notify.ts` の以下を、

```typescript
export async function notifyTaro(opts: { subject: string; body: string }): Promise<void> {
  const subject = `[BOOM Story] ${opts.subject}`;
```

こう置き換える。

```typescript
const DEFAULT_SUBJECT_PREFIX = '[BOOM Story]';

/** 件名の組み立て(純関数・テスト用に切り出し)。prefix未指定/空なら既定値を使う。 */
export function formatSubject(subject: string, prefix?: string): string {
  return `${prefix || DEFAULT_SUBJECT_PREFIX} ${subject}`;
}

export async function notifyTaro(opts: {
  subject: string;
  body: string;
  subjectPrefix?: string;
}): Promise<void> {
  const subject = formatSubject(opts.subject, opts.subjectPrefix);
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
npx vitest run src/lib/__tests__/notify.test.ts 2>&1 | tail -10
npx tsc --noEmit
```
Expected: `3 passed` / tsc は faqKnowledge.test.ts の既存エラー8件のみ

- [ ] **Step 5: commit**

```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
git add src/lib/notify.ts src/lib/__tests__/notify.test.ts
git commit -m "notify: 件名prefixを可変にする (既定値は既存のまま)

同期失敗通知で [BOOM 同期] を使えるようにする。既定値を変えないので
story-watchdog/story-preflight の既存呼び出しは無改修。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 同期失敗時に `notifyTaro()` を呼ぶ（A）

**Files:**
- Modify: `bw5-app/src/app/api/staff/operations/sync-health/route.ts`

**設計上の要点:** 既存の `staff_notifications` INSERT には「12h以内に同種があれば入れない」抑止が入っている。
その `rowsAffected` を見て、**実際にINSERTされた時だけメールを送る**。
これで1日4回失敗してもメールは12hに1通になる。

- [ ] **Step 1: import を追加**

`src/app/api/staff/operations/sync-health/route.ts` の import 群に追加:

```typescript
import { notifyTaro } from '@/lib/notify';
```

- [ ] **Step 2: error 分岐で INSERT 結果を受け取り、入った時だけ通知する**

以下のブロックを、

```typescript
  // 失敗は staff_notifications にも (同日重複は抑止)
  if (status === 'error') {
    await execute(
      `INSERT INTO staff_notifications (type, title, detail, severity)
       SELECT 'sync_failure', '⚠️ 自動同期が失敗しました', ?, 'error'
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_notifications
         WHERE type='sync_failure' AND created_at > datetime('now','-12 hours')
       )`,
      [message ?? '詳細は事務所Macの auto_sync/logs を確認']
    );
  }
```

こう置き換える。

```typescript
  // 失敗は staff_notifications にも (同日重複は抑止)
  if (status === 'error') {
    const inserted = await execute(
      `INSERT INTO staff_notifications (type, title, detail, severity)
       SELECT 'sync_failure', '⚠️ 自動同期が失敗しました', ?, 'error'
       WHERE NOT EXISTS (
         SELECT 1 FROM staff_notifications
         WHERE type='sync_failure' AND created_at > datetime('now','-12 hours')
       )`,
      [message ?? '詳細は事務所Macの auto_sync/logs を確認']
    );

    // アプリ内通知が実際に入った時だけプッシュする。
    // 12h抑止をそのまま流用するので、1日4回失敗してもメールは12hに1通に収まる。
    // 通知の失敗で同期本体を巻き込まないよう、必ず握りつぶす。
    if (inserted.rowsAffected > 0) {
      try {
        await notifyTaro({
          subjectPrefix: '[BOOM 同期]',
          subject: '日次同期が失敗しました',
          body:
            `${message ?? '詳細不明'}\n\n` +
            `確認先: ${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://bw5-app.vercel.app'}/staff/notifications\n` +
            `ログ: 事務所Mac の auto_sync/logs/`,
        });
      } catch (e) {
        console.error(`同期失敗のプッシュ通知に失敗: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
```

- [ ] **Step 3: 型チェックと全テスト**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
npx tsc --noEmit
npx vitest run 2>&1 | tail -10
```
Expected: tsc は faqKnowledge.test.ts の既存エラー8件のみ / 既存テスト全緑（件数は実行時の実数を確認する。**赤が1件もないこと**）

- [ ] **Step 4: commit**

```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
git add src/app/api/staff/operations/sync-health/route.ts
git commit -m "sync-health: 同期失敗をTAROへメール通知する

記録はされていたが誰も見に行かない=プル型しかなかったのを、既存 notifyTaro
(LINE→メールfallback / 本番はGmail設定済)へ配線してプッシュ化。
既存の12h重複抑止のrowsAffectedを見て、INSERTされた時だけ送る=12hに1通。
通知失敗でPOSTを落とさない。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: デッドマンスイッチの判定を純関数で作る（C）

**Files:**
- Create: `bw5-app/src/lib/syncWatchdog.ts`
- Create: `bw5-app/src/lib/__tests__/syncWatchdog.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/syncWatchdog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateSyncFreshness, SYNC_STALE_HOURS } from '../syncWatchdog';

// sync_runs.ran_at は UTC の 'YYYY-MM-DD HH:MM:SS' 形式で入る
const NOW = new Date('2026-07-20T00:10:00Z'); // JST 9:10 = story-watchdog の起動時刻

describe('evaluateSyncFreshness', () => {
  it('直近にokがあれば stale ではない', () => {
    const r = evaluateSyncFreshness('2026-07-19 21:03:21', NOW); // 約3時間前
    expect(r.stale).toBe(false);
    expect(r.message).toBeNull();
  });

  it('13時間前のokは まだ stale ではない(6h間隔の1回飛ばしを許容)', () => {
    const r = evaluateSyncFreshness('2026-07-19 11:10:00', NOW);
    expect(r.stale).toBe(false);
  });

  it('15時間前のokは stale', () => {
    const r = evaluateSyncFreshness('2026-07-19 09:10:00', NOW);
    expect(r.stale).toBe(true);
    expect(r.hours).toBe(15);
    expect(r.message).toContain('15時間');
  });

  it('しきい値は14時間', () => {
    expect(SYNC_STALE_HOURS).toBe(14);
  });

  it('okの記録が1件も無ければ stale', () => {
    const r = evaluateSyncFreshness(null, NOW);
    expect(r.stale).toBe(true);
    expect(r.hours).toBeNull();
    expect(r.message).toContain('一度も成功していません');
  });

  it('日付として解釈できない値は stale 扱いにする(fail-closed)', () => {
    const r = evaluateSyncFreshness('not-a-date', NOW);
    expect(r.stale).toBe(true);
    expect(r.hours).toBeNull();
  });

  it('未来日付でも stale にはしない(時計ズレで誤爆させない)', () => {
    const r = evaluateSyncFreshness('2026-07-20 05:00:00', NOW);
    expect(r.stale).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
npx vitest run src/lib/__tests__/syncWatchdog.test.ts 2>&1 | tail -15
```
Expected: FAIL。`Failed to resolve import "../syncWatchdog"`

- [ ] **Step 3: 実装する**

Create `src/lib/syncWatchdog.ts`:

```typescript
// src/lib/syncWatchdog.ts — 日次同期(daily_sync.py)のデッドマンスイッチ判定。
//
// 「失敗した」通知だけでは *プロセスが起動すらしなかった場合* を検知できない
// (Macのスリープ・旅行中の停止)。その場合 sync_runs に行が1つも増えないため、
// 「最後に成功してから何時間経ったか」を別の故障ドメイン(Vercel Cron)から見張る。
//
// 時刻を引数で受け取る純関数にしてあるのは、単体テストで固定できるようにするため。

/** 最後の成功からこの時間を超えたら異常とみなす。通常は6h間隔なので1回飛ばしは許容する。 */
export const SYNC_STALE_HOURS = 14;

export type SyncFreshness = {
  stale: boolean;
  /** 最後の成功からの経過時間(時)。判定不能なら null */
  hours: number | null;
  /** 異常時の通知本文。正常なら null */
  message: string | null;
};

/**
 * @param lastOkAt sync_runs で status='ok' の最新 ran_at (UTC 'YYYY-MM-DD HH:MM:SS')。無ければ null
 * @param now 現在時刻
 */
export function evaluateSyncFreshness(lastOkAt: string | null, now: Date): SyncFreshness {
  if (!lastOkAt) {
    return {
      stale: true,
      hours: null,
      message:
        '日次同期が一度も成功していません。事務所Macのcronが動いているか確認してください。',
    };
  }

  // sync_runs.ran_at は UTC。'YYYY-MM-DD HH:MM:SS' を ISO に直して解釈する。
  const parsed = Date.parse(`${lastOkAt.replace(' ', 'T')}Z`);
  if (!Number.isFinite(parsed)) {
    return {
      stale: true,
      hours: null,
      message: `日次同期の最終成功時刻を解釈できませんでした (${lastOkAt})。sync_runs を確認してください。`,
    };
  }

  const hours = Math.floor((now.getTime() - parsed) / 3600000);
  // 未来日付(時計ズレ)は異常扱いにしない。誤爆でノイズを出す方が害が大きい。
  if (hours < 0) {
    return { stale: false, hours: 0, message: null };
  }
  if (hours < SYNC_STALE_HOURS) {
    return { stale: false, hours, message: null };
  }

  return {
    stale: true,
    hours,
    message:
      `⚠️ 日次同期が${hours}時間成功していません(通常は6時間ごと)。` +
      '事務所Macがスリープしている、またはcronが動いていない可能性があります。',
  };
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
npx vitest run src/lib/__tests__/syncWatchdog.test.ts 2>&1 | tail -10
npx tsc --noEmit
```
Expected: `7 passed` / tsc は faqKnowledge.test.ts の既存エラー8件のみ

- [ ] **Step 5: commit**

```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
git add src/lib/syncWatchdog.ts src/lib/__tests__/syncWatchdog.test.ts
git commit -m "syncWatchdog: 同期鮮度の判定を純関数で追加 (vitest 7件)

失敗通知だけではプロセスが起動しなかった場合を検知できないため、
最終成功からの経過時間で見張るデッドマンスイッチの判定部を作る。
時計ズレによる誤爆を避けるため未来日付はstale扱いにしない。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: デッドマンスイッチを story-watchdog に配線する

**Files:**
- Modify: `bw5-app/src/app/api/cron/story-watchdog/route.ts`

**新規cronを立てない理由:** Vercel Hobbyプランのcron本数上限。現在 `vercel.json` に2本あり、3本目でデプロイが弾かれるリスクがある。
story-watchdog は `10 0 * * *` UTC = **JST 9:10** に走るので、00:00 / 06:00 回の着地を見るのにちょうど良い。

- [ ] **Step 1: import を追加**

`src/app/api/cron/story-watchdog/route.ts` の import 群に追加:

```typescript
import { getAll, getOne } from '@/lib/db';
import { evaluateSyncFreshness } from '@/lib/syncWatchdog';
```

**注意:** 既存の import 行は `import { getAll } from '@/lib/db';` になっている。`getOne` を追加する形に直すこと。

- [ ] **Step 2: 同期鮮度チェックを anomalies に積む**

`(2b) リールの見張り` のブロックの**直後**、`// (3) 通知` の**直前**に挿入する。

```typescript
  // (2c) 日次同期(daily_sync.py)のデッドマンスイッチ。
  // 別の故障ドメイン(事務所Mac)の停止を、こちら(Vercel)から見張る。
  // 「失敗した」通知は sync-health API 側が出すので、ここが拾うのは
  // *そもそも起動しなかった* ケース(スリープ・cron停止)。
  try {
    const lastOk = await getOne(
      "SELECT ran_at FROM sync_runs WHERE status='ok' ORDER BY id DESC LIMIT 1"
    );
    const freshness = evaluateSyncFreshness(
      (lastOk as { ran_at?: string } | null)?.ran_at ?? null,
      new Date()
    );
    if (freshness.stale && freshness.message) {
      anomalies.push(freshness.message);
    }
  } catch (e) {
    console.warn(`同期鮮度チェックに失敗(ストーリー側は継続): ${e instanceof Error ? e.message : e}`);
  }
```

- [ ] **Step 3: 型チェックと全テスト**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
npx tsc --noEmit
npx vitest run 2>&1 | tail -10
```
Expected: tsc は faqKnowledge.test.ts の既存エラー8件のみ（それ以外が出たら自分の変更が原因）/ 全テスト緑

- [ ] **Step 4: 判定が本番データで正しく動くことをローカル検証（読み取りのみ）**

本番DBの実データで `evaluateSyncFreshness` の入力を確認する。**読み取りのみ・書込なし。**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app
node -e "
require('dotenv').config({path:'.env.production.local'});
const {createClient}=require('@libsql/client');
const c=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
(async()=>{
  const r=await c.execute(\"SELECT ran_at FROM sync_runs WHERE status='ok' ORDER BY id DESC LIMIT 1\");
  const lastOk=r.rows[0]?.ran_at ?? null;
  const hours=lastOk?Math.floor((Date.now()-Date.parse(String(lastOk).replace(' ','T')+'Z'))/3600000):null;
  console.log('最終成功(UTC):',lastOk,'/ 経過:',hours,'時間 / stale判定:',hours===null||hours>=14);
})();
" 2>&1 | tail -3
```
Expected: 直近に成功していれば `stale判定: false`。同期が正常に回っている限り false であること。

- [ ] **Step 5: commit**

```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
git add src/app/api/cron/story-watchdog/route.ts
git commit -m "story-watchdog: 日次同期のデッドマンスイッチを相乗りさせる

Vercel Hobbyのcron本数上限を避けるため新規cronを立てず、JST9:10に走る
既存watchdogから同期鮮度も見張る。事務所Macの停止(スリープ・旅行)を
別の故障ドメインから検知する。同期側の失敗で story 側を止めない。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: 最終検証・TARO承認・デプロイ

**このタスクは TARO の承認なしに進めないこと。** bw5-app の main push は Vercel の自動デプロイを引き起こす。

- [ ] **Step 1: 両リポジトリの全体検証**

Run:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
npx tsc --noEmit 2>&1 | grep -E '^src/' | grep -v 'faqKnowledge.test.ts' || echo 'tsc OK (既存のfaqKnowledgeエラー以外なし)'
npx vitest run 2>&1 | tail -8

cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
python3 -m unittest test_daily_sync -v 2>&1 | tail -5
python3 daily_sync.py --dry-run 2>&1 | tail -20
```
Expected: tsc OK / vitest 全緑 / unittest OK / dry-run が最後まで到達

- [ ] **Step 2: TARO に結果を報告し、push の承認を得る**

報告に含めること:
- vitest / unittest / tsc の**実際の出力**（件数を含む）
- Lstep障害注入テストで部分成功したことの確認
- **メール受信の確認は TARO 本人にしかできない**旨（デプロイ後に届くか見てもらう）

承認が得られるまで**push しない**。

- [ ] **Step 3: 承認後 — daily_sync.py 側は push 不要（git管理外）**

`BOOM_Master_template` は git リポジトリではないため push は存在しない。
ディスク上の `daily_sync.py` がそのまま本番であり、**Task 1〜4 の編集時点で既に本番に反映されている**。

つまり cron の次回起動（00:00 / 06:00 / 12:00 / 18:00 JST）から新しい挙動になる。
Task 1〜4 の各ステップで構文チェックと dry-run を必ず通しているのはこのため。

作業後の掃除:
```bash
cd /Users/kimurashintarou/BOOM/BOOM_Master_template/05_運営/scripts/auto_sync
ls -la daily_sync.py.bak_* daily_sync.py.ok_task*
```
**中間チェックポイント（`.ok_task1`〜`.ok_task3`）は消してよいが、
着手前バックアップ（`.bak_<今日の日付>`）は最低1週間は残すこと。**
効果測定（Step 8）で問題が出たら、これが唯一のロールバック手段になる。

- [ ] **Step 4: 承認後 — bw5-app を main へ merge して push**

```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.claude/worktrees/gifted-bartik-86c82a
git log --oneline main..HEAD   # 何が入るか確認してから
```
確認したうえで main へ反映し push する。

- [ ] **Step 5: デプロイ成功を確認してから疎通確認**

**デプロイ完了前に本番を叩かないこと**（2026-07-06にデプロイ反映前の本番テストでデータを破損した事例あり）。

```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app
vercel inspect --logs 2>&1 | tail -5   # deploy success を確認
```
Expected: 最新デプロイが `Ready` / `success`

- [ ] **Step 6: 通知経路の実地確認**

次に同期が失敗した回で、TARO のメールに `[BOOM 同期] 日次同期が失敗しました` が届くことを確認する。
**本番DBに擬似的な error を書き込むテストはしない**（`sync_runs` に偽の記録を残さないため）。
失敗率27%なので、放っておけば数回以内に自然に発火する。

- [ ] **Step 7: STATE.md を更新して commit & push**

`~/BOOM/boom-events-hub/STATE.md` の **TAROボトルネック一覧 項目6** の「⏳同期復旧&失敗通知」部分を、
実装済みの内容に書き換える。含める情報:
- 実測失敗率27%とその真因（スクリプトの固定スリープ＝競合状態。Lstep UI変更でもMac依存でもない）
- 対処4点（部分成功化 / メール通知 / 条件待ち＋リトライ / デッドマン）
- 残タスク（launchd化・HACOMONOのみクラウド移行・LINE push有効化）
- **顧客の実名は書かない**（会員番号で表記）

**自分のワークストリーム行だけ**触ること。

```bash
cd ~/BOOM/boom-events-hub
git add STATE.md
git commit -m "WS: 日次同期の失敗通知・部分成功化を実装(失敗率27%の真因=スクリプトの競合状態)"
git push
```

- [ ] **Step 8: 効果測定用のメモを残す**

1週間後に失敗率が下がったか確認できるよう、実装前のベースラインを記録しておく。

実装前（2026-07-20時点）:
- Lstep友だちリストCSV: 成功95 / 失敗36 = **失敗率27%**（2026-05-19〜2026-07-20）
- 同期全体（sync_runs）: 71回中24回失敗 = **失敗率34%**（2026-06-20以降）

確認コマンド（1週間後に実行）:
```bash
cd /Users/kimurashintarou/BOOM/BW5_2026/bw5-app
node -e "
require('dotenv').config({path:'.env.production.local'});
const {createClient}=require('@libsql/client');
const c=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
(async()=>{
  const r=await c.execute(\"SELECT status,COUNT(*) n FROM sync_runs WHERE ran_at>'2026-07-21' GROUP BY status\");
  console.table(r.rows);
})();
"
```

---

## Self-Review 結果

**Spec coverage:**

| spec項目 | 対応タスク |
|---|---|
| §2 欠陥0（固定スリープ＝競合状態） | Task 3 |
| §4 B 部分成功化 | Task 1 |
| §4 B `post_to_sync_api` は3CSV揃った時のみ | Task 1 Step 7 |
| §4 A 失敗のプッシュ通知 | Task 6（prefix対応は Task 5） |
| §4 D-1 固定スリープを条件待ちに置換 | Task 3 |
| §4 D-2 リトライ3回・待ち45秒・試行回数をmessageに残す | Task 2 / Task 4 |
| §4 C デッドマンスイッチ（純関数＋story-watchdog相乗り） | Task 7 / Task 8 |
| §5 検証（tsc / vitest / dry-run / 障害注入 / 本番書込しない） | Task 1 Step 10 / Task 4 Step 7 / Task 9 |
| §6 デプロイ手順（deploy success確認後に疎通） | Task 9 |

**型・名前の整合性:**
- `with_retry(fn, label, attempts, wait_sec, on_retry)` → 戻り値 `(結果, 試行回数)`。Task 2 で定義、Task 4 で2箇所使用。一致。
- `wait_for_any_selector(page, candidates, label, timeout)` → `bool`。Task 3 で定義・使用。一致。
- `evaluateSyncFreshness(lastOkAt, now)` → `{stale, hours, message}`。Task 7 で定義、Task 8 で使用。一致。
- `formatSubject(subject, prefix?)`、`notifyTaro({subject, body, subjectPrefix?})`。Task 5 で定義、Task 6 で `subjectPrefix` 使用。一致。
- `failed_sources` / `retry_notes` は Task 1 Step 2 / Task 4 Step 4 で宣言し、以降で使用。一致。
