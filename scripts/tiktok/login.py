#!/usr/bin/env python3
"""
TikTok投稿用の専用ブラウザに、一度だけログインするためのスクリプト。

なぜ専用ブラウザが要るか:
  Chrome拡張のファイル転送は10MB上限で、リール動画(18〜53MB)を渡せない。
  TikTokのページはCSPが厳しく、ページ内fetchでのファイル取り込みも塞がれている。
  Playwrightの set_input_files はブラウザ本体がローカルファイルを直接読むので、
  この2つの制約を両方回避できる。

ログインは1回だけ。プロフィール(USER_DATA_DIR)にセッションが残るので、
以降 post.py はログイン不要で動く。

使い方:
    python3 scripts/tiktok/login.py
  → ブラウザが開くので、TikTokにログインする(QRコードが一番速い)。
    ログインが終わったらターミナルで Enter。
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

USER_DATA_DIR = Path.home() / ".boom_tiktok_profile"

# 自動化ブラウザだと分かる既定のUAを避ける(普段TAROが使っているChromeに合わせる)
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def main() -> int:
    USER_DATA_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(USER_DATA_DIR),
            headless=False,
            channel="chrome",           # 実物のChromeを使う(Chromium同梱版より素性が良い)
            user_agent=UA,
            viewport={"width": 1440, "height": 900},
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.tiktok.com/login", wait_until="domcontentloaded")

        print("ブラウザが開きました。")
        print("『QRコードを使う』→ スマホのTikTokアプリで読み取るのが一番速いです。")
        print("ログインできたら、このターミナルで Enter を押してください。")
        input()

        page.goto("https://www.tiktok.com/tiktokstudio/content", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        ok = "/login" not in page.url
        print("ログイン状態:", "OK" if ok else "まだログインできていません")
        print("プロフィール保存先:", USER_DATA_DIR)
        ctx.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
