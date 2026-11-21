// スタッフ: 月1プチバトルの申込CSV(回ごと・個人情報込み)。withAuth で本検証する(規約4.5)。
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { toCSV } from '@/lib/csvUtil';
import { BATTLE_STATUS_LABEL, entryAge, formatBattleReceiptNo } from '@/lib/battle';
import { getBattleEvent, listBattleEntriesStaff } from '@/lib/battleDb';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest) => {
  const key = req.nextUrl.searchParams.get('e') ?? '';
  const ev = await getBattleEvent(key);
  if (!ev) return NextResponse.json({ error: 'event not found' }, { status: 404 });
  const entries = await listBattleEntriesStaff(ev.eventKey);
  const divName = (k: string) => ev.divisions.find((d) => d.key === k)?.name ?? k;
  const rows: (string | number)[][] = [
    ['受付番号', '状態', 'ダンサー名', 'よみがな', '本名', '開催日の年齢', '生年月日(11/21以前の申込のみ)', '所属', 'ジャンル', '部門', '観覧(小学生以上)',
      '保護者', '保護者同意', '優勝未経験', 'メール', '電話', 'Instagram', '金額', 'Stripe PaymentIntent', '申込日時(UTC)', 'メモ'],
    ...entries.map((x) => [
      formatBattleReceiptNo(x, ev.roundNo), BATTLE_STATUS_LABEL[x.paymentStatus] ?? x.paymentStatus,
      x.dancerName, x.dancerKana, x.realName, entryAge(x, ev.eventDate) ?? '', x.birthdate, x.rep, x.genre,
      x.divisions.map(divName).join(' / '), x.spectators,
      x.guardianName, x.guardianConsent ? '同意' : '', x.noWinConfirmed ? 'はい' : '', x.email, x.phone, x.instagram,
      x.amountTotal, x.paymentIntentId, x.createdAt, x.note,
    ]),
  ];
  // Excelで文字化けしないよう BOM をつける
  return new NextResponse('﻿' + toCSV(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="battle_${ev.eventKey}.csv"`,
    },
  });
});
