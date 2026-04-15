import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const ext = path.extname(file.name).toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    if (!allowed.includes(ext)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const timestamp = Date.now();
    const safeName = `upload_${timestamp}${ext}`;

    // Use @vercel/blob in production (when BLOB_READ_WRITE_TOKEN is set)
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import('@vercel/blob');
      const blob = await put(safeName, file, { access: 'public' });
      return NextResponse.json({ url: blob.url });
    }

    // Local dev: write to public/images/
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

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
