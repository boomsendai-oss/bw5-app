import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sniffImageType } from '@/lib/imageSniff';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `ファイルが大きすぎます (上限 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` },
        { status: 400 }
      );
    }
    if (file.type && !ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 });
    }

    // M23: 実バイトを検査(ここで一度だけ読み、blob/ローカル双方で使い回す)
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    if (!sniffImageType(buffer)) {
      return NextResponse.json(
        { error: '画像ファイルとして認識できません(拡張子だけ画像のファイルは受け付けません)' },
        { status: 400 }
      );
    }

    const timestamp = Date.now();
    const safeName = `upload_${timestamp}${ext}`;

    // Use @vercel/blob in production (when BLOB_READ_WRITE_TOKEN is set)
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob');
      const blob = await put(safeName, buffer, {
        access: 'public',
        contentType: file.type || undefined,
      });
      return NextResponse.json({ url: blob.url });
    }

    // Local dev: write to public/images/

    const uploadDir = path.join(process.cwd(), 'public', 'images');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, safeName);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({ url: `/images/${safeName}` });
  } catch (error) {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
