// ─────────────────────────────────────────────────────────────
// /api/photo/[id] — Drive 画像プロキシ
// クライアントから直接 Drive にアクセスすると CORS / リダイレクトで詰まるため、
// サーバー経由で画像を Blob として返す。
//
// EXIF 撮影日時を「現在時刻」に書き換える:
//   iPhone「写真」App が撮影日でソートするため、書き換えないと 5/5 (撮影日) に
//   埋もれてしまう。書き換えると「最近の項目」最上部に表示される。
//   piexifjs は画像データを再エンコードせず EXIF だけ差し替えるので画質劣化なし。
// ─────────────────────────────────────────────────────────────

import piexif from "piexifjs";

export const runtime = "nodejs";

const ALLOWED_ID = /^[A-Za-z0-9_-]{20,80}$/;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function nowExifString(): string {
  const d = new Date();
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type ExifObj = Record<string, Record<number, unknown> | null>;

function rewriteExifDate(jpegBuf: Buffer): Buffer {
  try {
    const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString("base64")}`;
    let exifObj: ExifObj;
    try {
      exifObj = piexif.load(dataUrl);
    } catch {
      exifObj = { "0th": {}, Exif: {}, GPS: {}, "1st": {}, thumbnail: null };
    }
    const dt = nowExifString();
    if (!exifObj["0th"]) exifObj["0th"] = {};
    if (!exifObj["Exif"]) exifObj["Exif"] = {};
    (exifObj["0th"] as Record<number, unknown>)[piexif.ImageIFD.DateTime] = dt;
    (exifObj["Exif"] as Record<number, unknown>)[piexif.ExifIFD.DateTimeOriginal] = dt;
    (exifObj["Exif"] as Record<number, unknown>)[piexif.ExifIFD.DateTimeDigitized] = dt;
    const exifBytes = piexif.dump(exifObj);
    const newDataUrl = piexif.insert(exifBytes, dataUrl);
    const base64 = newDataUrl.split(",")[1];
    return Buffer.from(base64, "base64");
  } catch (e) {
    console.warn("EXIF rewrite failed, returning original", e);
    return jpegBuf;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!ALLOWED_ID.test(id)) {
    return new Response("invalid id", { status: 400 });
  }

  const upstream = await fetch(`https://lh3.googleusercontent.com/d/${id}=s0`, {
    cache: "force-cache",
  });

  if (!upstream.ok) {
    return new Response("upstream error", { status: 502 });
  }

  const arr = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const isJpeg = contentType.includes("jpeg") || contentType.includes("jpg");

  let outBuf: Buffer = Buffer.from(arr);
  if (isJpeg) {
    outBuf = rewriteExifDate(outBuf);
  }

  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
    ? "webp"
    : "jpg";

  return new Response(new Uint8Array(outBuf), {
    headers: {
      "Content-Type": isJpeg ? "image/jpeg" : contentType,
      "Content-Disposition": `attachment; filename="bw5-${id}.${ext}"`,
      // EXIF 書き換えのため、CDN キャッシュはやや短めに。
      // (現在時刻が入るので何度かに分けて保存しても近接 = OK)
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
