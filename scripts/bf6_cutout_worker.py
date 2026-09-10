#!/usr/bin/env python3
"""
BF6 顔写真の切り抜き係(会場のMacBook Airで常駐させる)。

スマホで撮った写真は、端末内の粗い切り抜きが「仮」としてすぐLEDに使える状態になる。
このプログラムは数秒おきにサーバの待ち行列を見て、元画像を取り、rembg で抜き直し、
サーバへ返して差し替える。Macが落ちていても仮の切り抜きが残るので、ゼロにはならない。

使い方:
  常駐させる(当日はこちら): ./scripts/bf6_cutout_service.sh on
  その場で動かす:           ./scripts/bf6_cutout_worker.sh
  (合言葉とURLは .env.cutout.local から読む)

⚠️ onnxruntime の CoreML プロバイダはモデル変換で長時間止まることがある(2026-09-10実測)。
   必ず CPU に固定する。

実測(2026-09-10・M1 MacBook Air・760px高): 1枚あたり約5秒(4.8〜5.7s)。
⚠️ このプログラムが二重に動くとCPUを取り合って13〜17秒に落ちる。
   起動は必ず bf6_cutout_service.sh 経由にする(迷子プロセスを掃除してから起こす)。
"""
import io
import os
import sys
import time
import json
import urllib.request
import urllib.error

from PIL import Image, ImageDraw

MODEL = os.environ.get("BF6_CUTOUT_MODEL", "isnet-general-use")
BASE = os.environ.get("BF6_BASE_URL", "https://bw5-app.vercel.app").rstrip("/")
KEY = os.environ.get("BF6_WORKER_KEY", "")
POLL_SEC = float(os.environ.get("BF6_POLL_SEC", "4"))
# 誰も撮っていない間はサーバへの問い合わせを減らす(常駐しっぱなしのため)。
# 仕事を1件でも見たら即 POLL_SEC に戻る。
IDLE_POLL_SEC = float(os.environ.get("BF6_IDLE_POLL_SEC", "60"))
IDLE_AFTER_SEC = float(os.environ.get("BF6_IDLE_AFTER_SEC", "600"))
HEARTBEAT_SEC = float(os.environ.get("BF6_HEARTBEAT_SEC", "3600"))
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

    # 空打ちで温める。1枚目だけ推論が3〜4倍遅くなる(ONNXの初回最適化)ため、
    # 受付の最初の一人を待たせないよう起動時に済ませておく。
    t = time.time()
    try:
        # 本番と同じ大きさ・中央に人くらいの塊。マッティングの重さは
        # 「輪郭まわりの不明画素の量」で決まるので、真っ平らな画像では温まらない。
        dummy = Image.new("RGB", (round(TARGET_H * 0.78), TARGET_H), (40, 60, 90))
        d = ImageDraw.Draw(dummy)
        d.ellipse((dummy.width * 0.2, TARGET_H * 0.05, dummy.width * 0.8, TARGET_H * 0.95),
                  fill=(200, 170, 150))
        remove(dummy, session=session, alpha_matting=True,
               alpha_matting_foreground_threshold=240,
               alpha_matting_background_threshold=15,
               alpha_matting_erode_size=ERODE)
        log(f"モデルの空打ち完了 {time.time() - t:.1f}s")
    except Exception as e:  # noqa: BLE001
        log(f"空打ちに失敗(無視して続行): {e}")

    log(f"待機開始: {BASE} を {POLL_SEC:.0f}秒おきに確認"
        f"(仕事が無い時間が{IDLE_AFTER_SEC/60:.0f}分続いたら{IDLE_POLL_SEC:.0f}秒おきに落とす)")

    last_work = time.time()
    last_beat = time.time()
    slow = False

    while True:
        now = time.time()
        idle = now - last_work
        if not slow and idle > IDLE_AFTER_SEC:
            slow = True
            log(f"待ち受けを{IDLE_POLL_SEC:.0f}秒おきに落とす(仕事なし)")
        wait = IDLE_POLL_SEC if slow else POLL_SEC
        if now - last_beat >= HEARTBEAT_SEC:
            last_beat = now
            log(f"生存確認: 待ち受け中({wait:.0f}秒おき)")

        try:
            with req("/api/bf6/photo/queue") as r:
                items = json.load(r).get("items", [])
        except urllib.error.HTTPError as e:
            log(f"待ち行列の取得に失敗 HTTP {e.code}(合言葉やURLを確認)")
            time.sleep(wait * 3)
            continue
        except Exception as e:  # noqa: BLE001
            log(f"通信エラー: {e}")
            time.sleep(wait * 3)
            continue

        if not items:
            time.sleep(wait)
            continue

        last_work = time.time()
        if slow:
            slow = False
            log(f"仕事を検知: 待ち受けを{POLL_SEC:.0f}秒おきに戻す")

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
