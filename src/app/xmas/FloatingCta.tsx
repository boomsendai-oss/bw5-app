// 受付中は、画面の下に「チケット予約」「出演エントリー」のボタンを常に出す(TARO 2026-10-15)。
// 受付していない方は出さない。iPhoneの下端(ホームバー)に重ならないよう safe-area 分を足す。
import Link from 'next/link';
import { MicVocal, Ticket } from 'lucide-react';

export default function FloatingCta({ ticketHref, entryHref }: { ticketHref?: string; entryHref?: string }) {
  if (!ticketHref && !entryHref) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t-[3px] border-[#1a1410] bg-[#f3e6c4]/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto flex max-w-xl gap-2">
        {ticketHref && (
          <Link
            href={ticketHref}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#1a1410] bg-[#d4302a] py-3 text-base font-black text-white shadow-[3px_3px_0_#1a1410] active:translate-y-[2px]"
          >
            <Ticket className="size-5" strokeWidth={2.5} aria-hidden />
            チケット予約
          </Link>
        )}
        {entryHref && (
          <Link
            href={entryHref}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border-[3px] border-[#1a1410] bg-[#2f8a3e] py-3 text-base font-black text-white shadow-[3px_3px_0_#1a1410] active:translate-y-[2px]"
          >
            <MicVocal className="size-5" strokeWidth={2.5} aria-hidden />
            出演エントリー
          </Link>
        )}
      </div>
    </div>
  );
}
