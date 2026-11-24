// スタッフ: 特設ワークショップの申込CSV(回ごと・個人情報込み)。withAuth で本検証する(規約4.5)。
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { toCSV } from '@/lib/csvUtil';
import { SP_WS_STATUS_LABEL, formatSpWsReceiptNo } from '@/lib/spWs';
import { getSpWsEvent, listSpWsEntriesStaff } from '@/lib/spWsDb';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest) => {
  const ev = await getSpWsEvent(req.nextUrl.searchParams.get('e') ?? '');
  if (!ev) return NextResponse.json({ error: 'event not found' }, { status: 404 });
  const entries = await listSpWsEntriesStaff(ev.slug);
  const rows: (string | number)[][] = [
    ['受付番号', '状態', 'お名前', 'ふりがな', '年齢', '会員(自己申告)', '保護者', '保護者同意', 'メール', '電話', '支払い方法', '金額', 'Stripe PaymentIntent', '申込日時(UTC)', 'メモ'],
    ...entries.map((x) => [
      formatSpWsReceiptNo(x, ev.slug), SP_WS_STATUS_LABEL[x.paymentStatus] ?? x.paymentStatus,
      x.name, x.kana, x.age ?? '', x.isMember ? '会員' : '一般', x.guardianName, x.guardianConsent ? '同意' : '',
      x.email, x.phone, x.payMethod === 'onsite' ? '当日現金' : 'カード', x.amountTotal, x.paymentIntentId, x.createdAt, x.note,
    ]),
  ];
  // Excelで文字化けしないよう BOM をつける
  return new NextResponse('﻿' + toCSV(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ws_${ev.slug}.csv"`,
    },
  });
});
