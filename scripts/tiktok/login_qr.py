#!/usr/bin/env python3
"""
専用ブラウザへのログインを、QRコードの「中身のURL」経由で行う。

TikTokのQRログイン画面は canvas にQRを描くだけなので、そのままでは
別の端末に渡せない。ここでは BarcodeDetector でQRをデコードして
URL文字列を取り出し、ファイルに書く。TAROはそのURLをスマホで開いて承認するだけ。

出力:
  scripts/tiktok/out/_login_qr.txt   … スマホで開くURL
  scripts/tiktok/out/_login_status.txt … done / failed
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
USER_DATA_DIR = Path.home() / ".boom_tiktok_profile"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

DECODE_QR = """
async () => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  if (!('BarcodeDetector' in window)) return 'NO_DETECTOR';
  const det = new BarcodeDetector({formats: ['qr_code']});
  const codes = await det.detect(c);
  return codes.length ? codes[0].rawValue : null;
}
"""


def logged_in(page, wait_ms: int = 12_000) -> bool:
    """TikTok Studioが開けるか＝ログインできているか。

    URLだけ見ると誤判定する(/login へのリダイレクトが遅れて来る)。
    十分待ったうえで、URLとページ内容の両方で確かめる。
    """
    page.goto("https://www.tiktok.com/tiktokstudio/content", wait_until="domcontentloaded")
    page.wait_for_timeout(wait_ms)
    if "/login" in page.url:
        return False
    body = page.inner_text("body")
    if "TikTokにログイン" in body or "Log in to TikTok" in body:
        return False
    return ("件の投稿" in body) or ("posts" in body.lower()) or ("下書き" in body)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    status = OUT / "_login_status.txt"
    qrfile = OUT / "_login_qr.txt"
    for f in (status, qrfile):
        f.unlink(missing_ok=True)

    USER_DATA_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(USER_DATA_DIR),
            headless=False,
            channel="chrome",
            user_agent=UA,
            viewport={"width": 1440, "height": 900},
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            # すでにログイン済みなら何もしない。
            # ⚠️ URLだけで判定してはいけない: /login へのリダイレクトは数秒遅れて起きるため、
            #    早すぎる判定は「ログイン済み」と誤検知する(2026-08-10に実際に踏んだ)。
            if logged_in(page):
                status.write_text("done (already logged in)", encoding="utf8")
                print("すでにログイン済みです")
                return 0

            page.goto("https://www.tiktok.com/login/qrcode", wait_until="domcontentloaded")
            page.wait_for_timeout(4000)

            url = None
            for _ in range(20):
                url = page.evaluate(DECODE_QR)
                if url and url != "NO_DETECTOR":
                    break
                page.wait_for_timeout(1000)
            if not url or url == "NO_DETECTOR":
                status.write_text("failed: QRを読み取れませんでした", encoding="utf8")
                return 1

            qrfile.write_text(url, encoding="utf8")
            print("QR_URL:", url)

            # 承認されるまで待つ(QRは1分ほどで期限切れになるので、切れたら取り直す)。
            # ⚠️ URLを別端末に送る運用は、読む前に期限が切れて実用にならない(2026-08-10に実測)。
            #    開いたウィンドウのQRをその場でスマホで読むのが確実。
            for tick in range(300):
                page.wait_for_timeout(3000)
                if "/login" not in page.url and "qrcode" not in page.url:
                    break
                if tick % 20 == 19:  # 1分ごとにQRを取り直す
                    fresh = page.evaluate(DECODE_QR)
                    if fresh and fresh != "NO_DETECTOR" and fresh != url:
                        url = fresh
                        qrfile.write_text(url, encoding="utf8")
                        print("QR_URL(更新):", url)

            ok = logged_in(page)
            status.write_text("done" if ok else "failed: ログインが完了しませんでした", encoding="utf8")
            print("ログイン:", "OK" if ok else "NG")
            return 0 if ok else 1
        finally:
            ctx.close()


if __name__ == "__main__":
    sys.exit(main())
