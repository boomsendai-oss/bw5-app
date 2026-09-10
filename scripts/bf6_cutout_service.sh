#!/bin/zsh
# BF6 切り抜き係を「常駐サービス」として入れる/外す/様子を見る。
#
#   ./scripts/bf6_cutout_service.sh on      入れて今すぐ動かす(以後、落ちても自動で起き直る)
#   ./scripts/bf6_cutout_service.sh off     止めて外す
#   ./scripts/bf6_cutout_service.sh status  動いているか見る
#   ./scripts/bf6_cutout_service.sh log     直近のログを見る
#
# ログイン時だけでなく KeepAlive で常時見張るので、
# ログインしっぱなしでMacを持ち歩いても動き続ける。
set -e
LABEL=com.boom.bf6.cutout
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/scripts/launchd/$LABEL.plist"
DST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/bf6-cutout.log"
UID_NUM=$(id -u)

# launchd の管理から外れて生き残った切り抜きプロセスを片付ける。
# 二重に動くとCPUを取り合って1枚あたりの時間が倍以上になる。
sweep_strays() {
  local pids
  pids=$(pgrep -f 'bf6_cutout_worker\.py$' || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
    pids=$(pgrep -f 'bf6_cutout_worker\.py$' || true)
    [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

case "${1:-status}" in
  on)
    if [ ! -f "$ROOT/.env.cutout.local" ]; then
      echo "⚠️ $ROOT/.env.cutout.local がありません(合言葉が要ります)"; exit 1
    fi
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cp "$SRC" "$DST"
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    sweep_strays
    # bootout は非同期で、すぐ bootstrap すると "Input/output error" で落ちる
    ok=0
    for _ in 1 2 3 4 5 6; do
      if launchctl bootstrap "gui/$UID_NUM" "$DST" 2>/dev/null; then ok=1; break; fi
      sleep 2
    done
    if [ "$ok" != "1" ]; then echo "⚠️ 登録に失敗しました。もう一度 $0 on を試してください"; exit 1; fi
    launchctl enable "gui/$UID_NUM/$LABEL"
    echo "✅ 常駐させました。Macを再起動しても、落ちても、自動で起き直ります"
    echo "   様子を見る: $0 status / ログ: $0 log"
    ;;
  off)
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    sleep 2
    sweep_strays
    rm -f "$DST"
    echo "🛑 止めて外しました"
    ;;
  status)
    if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
      PID=$(launchctl print "gui/$UID_NUM/$LABEL" | awk '/^\tpid = /{print $3}')
      if [ -n "$PID" ]; then echo "✅ 動いています (pid $PID)"; else echo "⚠️ 登録済みですが今は動いていません(すぐ起き直るはず)"; fi
    else
      echo "❌ 常駐していません。入れる: $0 on"
    fi
    N=$(pgrep -f 'bf6_cutout_worker\.py$' 2>/dev/null | wc -l | tr -d " ")
    [ "$N" -gt 1 ] && echo "⚠️ 切り抜きプロセスが${N}個あります(取り合いで遅くなる)。$0 on で入れ直してください"
    [ -f "$LOG" ] && echo "--- 最後の3行 ---" && tail -3 "$LOG"
    ;;
  log)
    [ -f "$LOG" ] && tail -40 "$LOG" || echo "ログはまだありません"
    ;;
  *)
    echo "使い方: $0 {on|off|status|log}"; exit 1
    ;;
esac
