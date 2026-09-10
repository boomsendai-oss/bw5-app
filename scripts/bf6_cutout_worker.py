#!/usr/bin/env python3
"""
BF6 顔写真の切り抜き係(会場のMacBook Airで常駐させる)。

スマホで撮った写真は、端末内の粗い切り抜きが「仮」としてすぐLEDに使える状態になる。
このプログラムは数秒おきにサーバの待ち行列を見て、元画像を取り、rembg で抜き直し、
サーバへ返して差し替える。Macが落ちていても仮の切り抜きが残るので、ゼロにはならない。

使い方:
  cd ~/BOOM/BW5_2026/bw5-app && ./scripts/bf6_cutout_worker.sh
  (合言葉とURLは .env.cutout.local から読む)

⚠️ onnxruntime の CoreML プロバイダはモデル変換で長時間止まることがある(2026-09-10実測)。
   必ず CPU に固定する。M1 で isnet + マッティングは1枚 20〜40秒程度。
"""
import io
import os
import sys
import time
import json
import urllib.request
import urllib.error

from PIL import Image

MODEL = os.environ.get("BF6_CUTOUT_MODEL", "isnet-general-use")
BASE = os.environ.get("BF6_BASE_URL", "https://bw5-app.vercel.app").rstrip("/")
KEY = os.environ.get("BF6_WORKER_KEY", "")
POLL_SEC = float(os.environ.get("BF6_POLL_SEC", "4"))
# 保存サイズ(LEDで必要な高さ)。マッティングは画素数に比例して遅いのでこれ以上にしない
TARGET_H = int(os.environ.get("BF6_TARGET_H", "760"))
ERODE = int(os.environ.get("BF6_ERODE", "10"))

if not KEY:
    print("BF6_WORKER_KEY が未設定です(.env.cutout.local を読んでください)", file=sys.stderr)
    sys.exit(2)


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def req(path: str, method: str = "GET", data=None, headers=None):
    h = {"x-bf6-worker-key": KEY}
    if headers:
        h.update(headers)
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    return urllib.request.urlopen(r, timeout=60)


def multipart(fields: dict, files: dict) -> tuple[bytes, str]:
    boundary = "----bf6cutout%d" % int(time.time() * 1000)
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for k, (fname, ctype, blob) in files.items():
        out.write(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n".encode()
        )
        out.write(blob)
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


def main() -> None:
    from rembg import remove, new_session

    log(f"モデル {MODEL} を読み込み中(CPU固定)…")
    session = new_session(MODEL, providers=["CPUExecutionProvider"])
    log(f"待機開始: {BASE} を {POLL_SEC}秒おきに確認")

    while True:
        try:
            with req("/api/bf6/photo/queue") as r:
                items = json.load(r).get("items", [])
        except urllib.error.HTTPError as e:
            log(f"待ち行列の取得に失敗 HTTP {e.code}(合言葉やURLを確認)")
            time.sleep(POLL_SEC * 3)
            continue
        except Exception as e:  # noqa: BLE001
            log(f"通信エラー: {e}")
            time.sleep(POLL_SEC * 3)
            continue

        if not items:
            time.sleep(POLL_SEC)
            continue

        for it in items:
            item_id = int(it["itemId"])
            try:
                with req(f"/api/bf6/photo/raw/{item_id}") as r:
                    raw = r.read()
                src = Image.open(io.BytesIO(raw)).convert("RGB")
                if src.height > TARGET_H:
                    src = src.resize((round(src.width * TARGET_H / src.height), TARGET_H), Image.LANCZOS)
                t = time.time()
                out = remove(
                    src,
                    session=session,
                    alpha_matting=True,
                    alpha_matting_foreground_threshold=240,
                    alpha_matting_background_threshold=15,
                    alpha_matting_erode_size=ERODE,
                )
                dt = time.time() - t
                buf = io.BytesIO()
                out.save(buf, "PNG", optimize=True)
                body, ctype = multipart(
                    {"itemId": str(item_id), "model": f"{MODEL}+matting{ERODE}"},
                    {"photo": ("photo.png", "image/png", buf.getvalue())},
                )
                with req("/api/bf6/photo/upload", "POST", body, {"Content-Type": ctype}) as r:
                    res = json.load(r)
                log(f"item {item_id}: 抜き直し {dt:.1f}s → 返送 {res} ({len(buf.getvalue())//1000}KB)")
            except Exception as e:  # noqa: BLE001
                log(f"item {item_id}: 失敗 {e}(次の周回で再試行)")
                time.sleep(2)


if __name__ == "__main__":
    main()
