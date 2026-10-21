#!/usr/bin/env bash
# Googleのパスワードを変えたあと(年1回)にやること一式。TAROが自分のターミナルで実行する。
#
# Googleのパスワードを変えると、次の2種類が自動で無効になる(Googleの仕様・2026-10-16に実際に止まった):
#   1. アプリのメール送信に使う「アプリパスワード」(Vercel の GMAIL_APP_PASSWORD)
#   2. Gmailを読む許可(受信箱アラートの鍵・ClaudeのGmail連携)
# カレンダー・GBP・YouTube・Drive などの連携は無効にならないので、ここでは触らない。
# 鍵やパスワードの値は画面にもファイルにも出さない(Vercelに直接登録する)。
#
# 使い方: bash scripts/after_google_password_change.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .vercel/project.json ]; then
  echo "このフォルダが Vercel の bw5-app につながっていません(.vercel/project.json がありません)。止めます"
  exit 1
fi

echo
echo "【1/4】アプリのメール送信(boom.sendai のアプリパスワード)"
echo "  ブラウザで boom.sendai@gmail.com としてアプリパスワードの画面を開きます。"
echo "  名前に「bw5-app」と入れて作成し、表示された16文字をコピーしてください。"
open "https://myaccount.google.com/apppasswords?authuser=boom.sendai@gmail.com" || true
node scripts/inbox_alert_setup.mjs set GMAIL_APP_PASSWORD

echo
echo "【2/4】受信箱アラート(BOOM): ブラウザで boom.sendai@gmail.com を選んで許可してください"
node scripts/inbox_alert_setup.mjs gmail boom --expect boom.sendai@gmail.com

echo
read -r -p "【3/4】受信箱アラート(個人): 個人のGmailアドレス [taro.bsb@gmail.com]: " PERSONAL
PERSONAL="${PERSONAL:-taro.bsb@gmail.com}"
echo "  ブラウザで ${PERSONAL} を選んで許可してください"
node scripts/inbox_alert_setup.mjs gmail taro --expect "$PERSONAL"

echo
echo "【4/4】Claude の Gmail 連携(boom.sendai): ブラウザで boom.sendai@gmail.com を選んで許可してください"
npx -y @gongrzhe/server-gmail-autoauth-mcp auth

echo
echo "完了です。Claude に「終わった」と伝えてください(本番への反映=再デプロイと、送信の確認は Claude がやります)。"
echo "残りの手作業: claude.ai の設定で Gmail コネクタをつなぎ直す / iPhone・Mac のメールアプリでログインし直す"
