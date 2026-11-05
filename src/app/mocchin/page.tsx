// ⚠️ 公開ページ(認証なし)。理由: BW6スペシャルナンバー by MOCCHIN の申込(会員以外・県外の方も申し込める)。
// 表示するのは日程・料金・受付状態などの公開情報のみ。
import { todayJst } from '@/lib/dateJst';
import { isXmasPreview } from '@/lib/partyPreview';
import {
  MOCCHIN_DEADLINE,
  MOCCHIN_FEE,
  MOCCHIN_LESSON_DAYS,
  MOCCHIN_LESSON_FEE_GUEST,
  MOCCHIN_LESSON_FEE_MEMBER,
  MOCCHIN_MEMBER_START,
  MOCCHIN_OPEN_START,
  MOCCHIN_SCHEDULE,
  addDays,
  formatJpDate,
  mocchinGate,
  yen,
} from '@/lib/mocchinEntry';
import { MOCCHIN_SETTINGS_KEY } from '@/lib/mocchinEntryDb';
import EntryForm from './EntryForm';
import { Notice, Panel, PreviewBanner, Shell } from './ui';

export const dynamic = 'force-dynamic';

export default async function MocchinPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  const isPreview = isXmasPreview(MOCCHIN_SETTINGS_KEY, preview);
  const real = mocchinGate(todayJst());
  // プレビューは受付開始前でも「会員の先行期間」の画面を出す
  const gate = isPreview && real === 'before' ? 'member' : real;

  return (
    <Shell>
      {isPreview && <PreviewBanner />}
      <h1 className="text-3xl font-black leading-tight">
        スペシャルナンバー
        <br />
        <span className="text-[#19F2D6] [text-shadow:0_0_14px_rgba(25,242,214,0.6)]">by MOCCHIN</span> 申込
      </h1>
      <p className="mt-2 text-sm font-bold text-white/85">
        BOOM WOP vol.6(2027年4月11日・若林区文化センター)で、D&apos;OAMのMOCCHINさんが振付するスペシャルナンバーです。
      </p>

      <Panel title="料金">
        <dl className="space-y-2 text-sm font-bold">
          <div>
            <dt className="text-[#19F2D6]">参加費</dt>
            <dd>
              {yen(MOCCHIN_FEE)}
              <span className="block text-xs text-white/75">
                クラスのナンバーにも出る場合は、その参加費が別にかかります
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[#19F2D6]">レッスン代</dt>
            <dd>
              1日 {yen(MOCCHIN_LESSON_FEE_MEMBER)}(2レッスン分・1レッスンあたり{yen(MOCCHIN_LESSON_FEE_MEMBER / 2)})
              <span className="block text-xs text-white/75">
                BOOM会員以外の方は1日{yen(MOCCHIN_LESSON_FEE_GUEST)}。全{MOCCHIN_LESSON_DAYS}日分のお支払いです
              </span>
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs font-bold text-white/80">お支払いは銀行振込です。一括か分割(最大3回)を、申込時に選べます。</p>
      </Panel>

      <Panel title="日程・会場">
        <ul className="space-y-2 text-sm font-bold">
          {MOCCHIN_SCHEDULE.map((s) => (
            <li key={s.date} className="border-b border-white/15 pb-2 last:border-0">
              <span className="text-[#19F2D6]">{s.date}</span> {s.venue}
              <span className="block text-xs text-white/80">{s.time}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs font-bold text-white/80">
          1日＝90分のレッスンが2本(間に15分の休憩)。2本目のあとは、参加者みんなで練習や質問の時間をとります。
        </p>
      </Panel>

      {gate === 'before' && (
        <Notice>
          申込の受付は<b>{formatJpDate(MOCCHIN_MEMBER_START)}</b>からです。{formatJpDate(MOCCHIN_MEMBER_START)}〜
          {formatJpDate(addDays(MOCCHIN_OPEN_START, -1))}はBOOM会員の方の先行申込期間です。
        </Notice>
      )}
      {gate === 'closed' && <Notice>申込の受付は終了しました。</Notice>}
      {(gate === 'member' || gate === 'open') && (
        <>
          <Notice>
            {gate === 'member' ? (
              <>
                いまは<b>BOOM会員の方の先行申込期間</b>です。会員以外の方は{formatJpDate(MOCCHIN_OPEN_START)}から申し込めます。
              </>
            ) : (
              <>BOOM会員以外の方も申し込めます。</>
            )}
            <span className="block">締切：{formatJpDate(MOCCHIN_DEADLINE)}</span>
          </Notice>
          <EntryForm memberOnly={gate === 'member'} preview={isPreview ? preview : undefined} />
        </>
      )}
    </Shell>
  );
}
