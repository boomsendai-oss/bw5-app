#!/bin/zsh
# BF6 切り抜き係を起動する(会場のMacBook Airで、当日この1コマンドを叩くだけ)。
set -e
cd "$(dirname "$0")/.."
if [ ! -f .env.cutout.local ]; then
  echo ".env.cutout.local がありません(合言葉が要ります)"; exit 1
fi
set -a; source .env.cutout.local; set +a
exec python3 scripts/bf6_cutout_worker.py
