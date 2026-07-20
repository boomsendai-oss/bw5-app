/**
 * M23: アップロードされたファイルが本当に画像かをマジックバイトで判定する。
 *
 * 拡張子(file.name)もContent-Type(file.type)もクライアントの自己申告なので、
 * `evil.php` を `evil.png` にリネームするだけで従来の検査は素通りしていた。
 * 実バイト先頭のシグネチャで判定する(依存追加なしの自前判定)。
 */
export type SniffedImageType = 'jpeg' | 'png' | 'gif' | 'webp';

export function sniffImageType(buf: Buffer): SniffedImageType | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';
  // GIF: "GIF87a" / "GIF89a"
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  // WEBP: "RIFF" ....(size) "WEBP"
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) return 'webp';
  return null;
}
