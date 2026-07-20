import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/performers?m_id=M2 — 指定した演目の出演者のみ返す
 *
 * ⚠️ 公開API(認証なし)。理由: BW5来場者向けの公開ページ
 * `src/app/performance/[mId]/page.tsx` が現役で叩いているため認証をかけられない。
 *
 * M22: そのぶん取得範囲を絞る。出演者名は**未成年を含む個人情報**であり、
 * 旧実装は `?q=` の部分一致検索と引数なしの全件返却を許していたため、
 * `?q=` に一文字入れるだけで全出演者名簿を機械的に吸い出せる状態だった。
 * 現在は m_id 完全一致を必須とし、名簿の一括列挙をできなくしている。
 */
const MAX_ROWS = 200;

export async function GET(req: NextRequest) {
  const mId = req.nextUrl.searchParams.get('m_id');

  // M22: 自由検索(?q=)と全件列挙(引数なし)は廃止。演目の指定を必須にする。
  if (!mId) {
    return NextResponse.json(
      { error: 'm_id required', message: 'm_id を指定してください(出演者の一覧取得・名前検索は廃止されました)' },
      { status: 400 }
    );
  }

  // 演目IDの形式を固定(M1・M23 等)。想定外の値でDBを引かせない。
  if (!/^[A-Za-z]\d{1,4}$/.test(mId)) {
    return NextResponse.json({ error: 'invalid m_id' }, { status: 400 });
  }

  // 返却列は公開ページが使う最小限(name / sort_order)のみ。
  const rows = await getAll(
    `SELECT name, sort_order FROM performers WHERE m_id = ? ORDER BY sort_order ASC LIMIT ?`,
    [mId, MAX_ROWS]
  );
  return NextResponse.json(rows);
}
