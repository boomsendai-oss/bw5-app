import { NextResponse } from 'next/server';
import { getAll } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 公開API: ログイン画面の名前選択用
export async function GET() {
  const list = await getAll(`SELECT id, name FROM instructors WHERE active = 1 ORDER BY name`);
  return NextResponse.json({ instructors: list });
}
