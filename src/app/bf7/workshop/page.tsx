// ⚠️ 公開ページ(認証なし)。理由: HIRO ワークショップの申込(会員以外・県外の方も申し込める)。
// 表示するのは日程・料金・残り枠などの公開情報のみ。受付開始前は中身を出さない(TARO「内容はまだ言えない」)。
import type { Metadata } from 'next';
import Link from 'next/link';
import { BF7_WORKSHOP } from '@/lib/bf7';
import { bf7WsGate, formatBf7WsDate } from '@/lib/bf7Workshop';
import { getBf7WsRemaining } from '@/lib/bf7WorkshopDb';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import { Bf7Card, Bf7Hero, Bf7Shell, btnDarkCls } from '../ui';
import WorkshopForm from './WorkshopForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'HIRO WORKSHOP 申込 | 2027.1.31(日) エル・パーク仙台',
  description: "BOOMER'S FIGHT!!! vol.7 の翌日に開催する HIRO WORKSHOP のお申込みページです。",
};

export const viewport = { themeColor: '#0b1b36' };

export default async function Bf7WorkshopPage() {
  const real = bf7WsGate(todayJst());
  const preview = (real === 'before' || real === 'closed') && (await isAuthorizedServer());
  const gate = preview ? 'member' : real;

  if (gate === 'before' || gate === 'closed') {
    return (
      <Bf7Shell>
        <Bf7Hero title="WORKSHOP" subtitle="HIRO ワークショップ お申込み" />
        <div className="space-y-5 px-4 py-6">
          <Bf7Card>
            <p className="text-sm font-bold leading-relaxed text-neutral-200">
              {gate === 'before' ? 'お申込みの受付開始まで、今しばらくお待ちください。' : 'お申込みの受付は終了しました。'}
            </p>
          </Bf7Card>
          <Link href="/bf7" className={`block w-full rounded-2xl py-4 text-center font-black ${btnDarkCls}`}>
            イベントページへ戻る
          </Link>
        </div>
      </Bf7Shell>
    );
  }

  const remaining = await getBf7WsRemaining();
  const ws = BF7_WORKSHOP;
  return (
    <Bf7Shell>
      {preview && (
        <div className="bg-amber-400 px-4 py-2.5 text-center text-xs font-black text-neutral-950">
          確認用モード(スタッフのログイン中だけ表示・一般の方には「受付開始前」と出ます)
          <span className="block font-bold">送れるのは「銀行振込」だけ。テスト申込は定員に数えません</span>
        </div>
      )}
      <Bf7Hero title="WORKSHOP" subtitle="HIRO ワークショップ お申込み" />
      <div className="px-4">
        <Bf7Card>
          <p className="text-2xl font-black italic leading-none text-white">
            2027.1.31 <span className="text-base not-italic text-sky-300">SUN</span>
          </p>
          <p className="mt-2 text-sm font-bold text-neutral-100">{ws.venue}</p>
          <p className="mt-0.5 text-xs text-neutral-400">{ws.address}</p>
          <p className="text-xs text-neutral-400">{ws.access}</p>
          <p className="mt-2 text-xs font-bold text-neutral-300">定員 各クラス{ws.capacity}名(先着順)</p>
        </Bf7Card>
        {gate === 'member' && (
          <p className="mt-3 rounded-xl border border-sky-500/50 bg-sky-950/40 p-3 text-sm font-bold text-sky-200">
            ただいまBOOM会員の方の先行受付期間です。会員以外の方は{formatBf7WsDate(ws.openFrom)}から申し込めます。
          </p>
        )}
      </div>
      {/* 確認用モードでは、一般の人の画面(会員ではありません)も試せるようにする */}
      <WorkshopForm memberOnly={gate === 'member' && !preview} remaining={remaining} />
    </Bf7Shell>
  );
}
