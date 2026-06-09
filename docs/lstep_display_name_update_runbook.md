# LSTEP表示名 一括更新 Runbook (Claude自動化手順)

HACOMONO会員とLINE(LSTEP)友だちを紐付けたあと、LSTEP側の「システム表示名」を
会員名ベース（【本人】/【保護者】/【講師】）に一括更新する手順。

**LSTEPには無料APIが無いため、唯一の更新手段は「管理画面でCSVをインポート」すること。**
そのCSVの中身（表示名の再生成）はアプリが自動生成し、エクスポート/インポートのブラウザ操作は
Claudeが代行する。TAROは変更プレビューを見てGOを出すだけ。

## 全体フロー

```
① Claude: LSTEP管理画面「友だちリスト → CSV操作 → CSVエクスポート」でフルCSV取得
② Claude: そのCSVを /api/staff/operations/lstep-transform?mode=preview にPOST → 変更プレビュー
③ TARO : プレビュー(誰が・現在名→新名・件数)を確認して GO
④ Claude: 同CSVを mode=csv にPOST → インポート用CSV(cp932)を取得
⑤ Claude: LSTEP管理画面「CSVインポート(/line/importer)」でファイル選択 → CSVアップロード
⑥ 反映完了を確認 → lstep_update_log に upload_confirmed を記録
```

①②は読み取りのみで安全。④⑤⑥は実際にお客さんのLINE表示名が変わる **後戻りしづらい操作**
なので、必ず③のTARO GOを挟む。

## 詳細手順

### 前提
- Chrome拡張(Claude in Chrome)が接続済み
- LSTEP管理画面 (https://manager.linestep.net/) にログイン済み
- 認証: アプリAPIは `x-admin-password: boom2026` ヘッダ or セッションCookie

### ① フルCSVエクスポート
1. `https://manager.linestep.net/line/show`（友だちリスト）を開く
   - 検索条件は **未指定**（=全友だち対象）。CSVエクスポートは「表示中の検索条件」を出力する
2. 下部「友だち一括操作」→「CSV操作」タブ → 左の **CSVエクスポート** ボタン
3. ダウンロードされたフルCSV(cp932・2行ヘッダー・56列)を取得
   - 列に「システム表示名」「会員名(1)」「会員番号(1)」「フェーズ４ーA/B」「イントラ / インストラクター」等を含む
   - ※ daily_sync が保存する軽量CSV(ID+表示名の2列)はインポート不可。必ずこのフルCSVを使う

### ② 変更プレビュー
```
POST /api/staff/operations/lstep-transform?mode=preview
  Header: x-admin-password: boom2026
  Body  : multipart/form-data, field `lstep` = フルCSVファイル
→ { summary:{total_rows,target_rows,updated_rows,unchanged_rows}, warnings:[], changes:[...] }
```
`changes` は {lstep_id, role, member_label, current_display, new_display, changed} の配列。

### ③ TARO GO
- `summary.updated_rows` 件の表示名が変わる。changes一覧をTAROに提示し承認を得る。
- アプリ画面 `/staff/operations/lstep-update` でも同じプレビューを見られる。

### ④ インポート用CSV生成
```
POST /api/staff/operations/lstep-transform?mode=csv
  Header: x-admin-password: boom2026
  Body  : multipart/form-data, field `lstep` = ①と同じフルCSVファイル
→ cp932のCSV (lstep_import_ready.csv) をダウンロード
  X-Lstep-Updated-Rows ヘッダで変更件数を確認
```
生成時に lstep_update_log へ `generate_csv` が自動記録される。

### ⑤ LSTEPへインポート
1. `https://manager.linestep.net/line/importer` を開く
2. 「ファイルを選択」で ④のCSVを指定（file_upload ツールでinputにセット）
3. 青い「CSVアップロード」ボタンをクリック
4. 「CSVアップロード履歴」に新しい行が出て「反映完了」になるのを確認

### ⑥ 反映記録
- アップロード反映を確認したら lstep_update_log に upload_confirmed を記録（任意）。

## 注意・制約 (LSTEP仕様)
- CSVは必ずLSTEP管理画面からエクスポートしたものを使う（列構成・タグID行を維持）
- CSV(Excel)の **上1・2行目と左1列目は絶対に編集しない**
- 友だち情報「画像」「PDF」はインポート不可
- 「年月日」は `YYYY/MM/DD` 形式のみ
- 変換ロジックは src/lib/lstepTransform.ts に集約（download/route.ts と lstep-transform/route.ts が共用）

## 表示名フォーマット
- 本人  : `【本人】ヤマダ アヤノ`
- 保護者: `【保護者】ムトウ キヨミ / 子:ムトウ サエ`（兄弟は `姓 名1・名2`）
- 講師  : `【講師】キムラ シンタロウ`
```
役割優先順位: 講師 > 保護者 > 本人（member_lstep_links.relation ベース）
```
