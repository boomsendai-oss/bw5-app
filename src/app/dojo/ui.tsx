// BOOM DOJO(/dojo)の共通パーツ。夜の道場の背景・和紙のカード・墨の見出し・朱のはんこ(デザイン案A)。
// イベント名・日付・会場などの文字は必ず設定(DB)から受け取る。ここに直書きしない。
import type { ReactNode } from 'react';

const WEEK_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 2026-12-26 → 2026.12.26 SAT */
export function formatDojoDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${m[1]}.${m[2]}.${m[3]} ${WEEK_EN[d.getUTCDay()]}`;
}

export function BattleShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d0906]">
      <div className="mx-auto min-h-screen max-w-lg bg-[#0d0906] pb-12 md:my-8 md:min-h-0 md:overflow-hidden md:rounded-3xl md:ring-1 md:ring-white/10">
        {children}
      </div>
    </div>
  );
}

/**
 * トップのヒーロー。背景画像(941x1672)と同じ縦横比の箱を作り、ロゴ・掛け軸の文字・日付・ボタンを
 * 箱に対する％で置く。文字の大きさも箱の幅(cqw)に比例させるので、画面幅が変わっても紙の位置からずれない。
 * 位置の元は見本(mockA.html・幅390px)の数値を％に直したもの。
 */
export function DojoHero({
  dateYmd,
  venue,
  startTime,
  ctaHref,
  ctaLabel,
  numbering,
}: {
  numbering?: string;
  dateYmd: string;
  venue: string;
  startTime: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <header
      className="relative w-full overflow-hidden bg-[#0d0906] bg-cover bg-top [container-type:inline-size]"
      style={{ aspectRatio: '941 / 1672', backgroundImage: 'url(/dojo/bg_dojo.webp)' }}
    >
      <a
        href="https://boom-sendai.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute left-0 right-0 top-[3%] text-center text-[2.6cqw] font-bold tracking-[0.3em] text-[#f3eadb]/60 hover:text-white"
      >
        BOOM DANCE SCHOOL PRESENTS
      </a>
      {/* 筆文字ロゴ(黒を透過済み・余白を切り落としたもの)。見本の 370px 幅のロゴの文字部分の位置に合わせる */}
      {/* eslint-disable-next-line @next/next/no-img-element -- 位置を％で合わせる静的画像 */}
      <img src="/dojo/logo_dojo.webp" alt="BOOM DOJO ROAD TO BLACK BELT" className="absolute left-[4.67%] top-[17.66%] w-[89.4%]" />

      {/* 回の呼び方(其の一・其の二…)。イベント名「BOOM DOJO 其の一」の後ろ半分を朱のはんこ風に出す */}
      {numbering && (
        <span className="f-brush absolute right-[4%] top-[6.5%] rotate-[6deg] rounded-[0.8cqw] border-[0.8cqw] border-[#c8352a] bg-[#0d0906]/40 px-[1.2cqw] py-[1.5cqw] text-[4.6cqw] leading-none text-[#e04a3c] [writing-mode:vertical-rl]">
          {numbering}
        </span>
      )}

      {/* 掛け軸の白い紙: 右に大きく「押忍」、左に小さく「7転び8ムーヴ」(縦書き・TARO 11/19) */}
      <div
        aria-hidden
        className="f-brush absolute left-[39.23%] top-[40.12%] flex h-[19.91%] w-[22.05%] flex-row-reverse items-start justify-center gap-[1cqw] pt-[2.6cqw] text-[#1b120b]"
      >
        <span className="text-[10.26cqw] leading-none [writing-mode:vertical-rl]">押忍</span>
        <span className="pt-[1.5cqw] text-[2.7cqw] tracking-[0.12em] [writing-mode:vertical-rl]"><span className="[text-combine-upright:all]">7</span>転び<span className="[text-combine-upright:all]">8</span>ムーヴ</span>
      </div>

      <div className="absolute left-0 right-0 top-[67.8%] px-[4cqw] text-center">
        <p className="f-num text-[11.28cqw] font-bold leading-tight tracking-[0.04em] text-[#f3eadb] [text-shadow:0_2px_12px_#000]">
          {formatDojoDate(dateYmd)}
        </p>
        <p className="mt-[1cqw] text-[3.1cqw] tracking-[0.16em] text-[#f3eadb]/90 [text-shadow:0_1px_6px_#000]">
          {venue}
          {startTime && <> ／ <span className="f-num">{startTime} START</span></>}
        </p>
      </div>

      {ctaHref && (
        <a
          href={ctaHref}
          className="absolute left-1/2 top-[85.1%] -translate-x-1/2 whitespace-nowrap rounded-[4px] border-2 border-[#e9b3a5] bg-[#b8261c] px-[7.7cqw] py-[3.6cqw] text-[4.6cqw] font-black tracking-[0.15em] text-white shadow-[0_4px_0_#6d140e,0_0_30px_rgba(184,38,28,0.5)] active:translate-y-[2px]"
        >
          {ctaLabel ?? '挑戦する　ENTRY'}
        </a>
      )}
    </header>
  );
}

/** 下層ページ(完了画面・エントリー一覧)の小さなヘッダー。 */
export function BattleHero({ eventTitle, title, subtitle }: { eventTitle: string; title: string; subtitle?: string }) {
  return (
    <header className="relative overflow-hidden px-4 pb-6 pt-8 text-[#f3eadb]">
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-[center_62%] opacity-35"
        style={{ backgroundImage: 'url(/dojo/bg_dojo.webp)' }}
      />
      <div className="relative">
        <a
          href="https://boom-sendai.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[11px] font-bold tracking-[0.25em] text-[#f3eadb]/60 hover:text-white"
        >
          BOOM DANCE SCHOOL PRESENTS
        </a>
        <a href="/dojo" className="mt-3 block w-56">
          {/* eslint-disable-next-line @next/next/no-img-element -- 静的なロゴ画像 */}
          <img src="/dojo/logo_dojo.webp" alt={eventTitle} className="w-full" />
        </a>
        <h1 className="f-brush mt-5 text-3xl text-[#f3eadb]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm font-bold text-[#f3eadb]/80">{subtitle}</p>}
        <div className="mt-4 h-[3px] w-16 bg-[#b8261c]" />
      </div>
    </header>
  );
}

/** 和紙のカード。title を渡すと墨の見出し(下線つき)を出す。hanko は右上の朱のはんこ。 */
export function BattleCard({ title, label, hanko, children }: { title?: string; label?: string; hanko?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative rounded-md bg-[#efe4cf] p-[18px] text-[#1d140c] shadow-[0_6px_20px_rgba(0,0,0,0.5)]">
      {hanko && <Hanko>{hanko}</Hanko>}
      {title && <h2 className="f-brush mb-3 border-b-2 border-[#1d140c] pb-1.5 pr-14 text-xl">{title}</h2>}
      {label && <p className="mb-2 text-[11px] font-black tracking-widest text-[#7a2a1c]">{label}</p>}
      {children}
    </div>
  );
}

/** 朱のはんこ(白帯限定 など)。 */
export function Hanko({ children }: { children: ReactNode }) {
  return (
    <div className="f-brush absolute right-3.5 top-3 flex h-[46px] w-[46px] rotate-[-8deg] items-center justify-center rounded border-[3px] border-[#b8261c] text-center text-[13px] leading-[1.1] text-[#b8261c]">
      {children}
    </div>
  );
}

/**
 * 出演者(ジャッジ・DJ・MC)を道場の木札(名札)の形で並べる。
 * announced=false の人は名前を出さず「近日発表」(出演が決まる前に名前を公開しないため)。
 */
export function DojoCast({ cast, numbering }: { numbering?: string; cast: { role: string; mark: string; name: string; photo: string; note: string; instagram: string; announced: boolean }[] }) {
  if (cast.length === 0) return null;
  return (
    <section>
      <h2 className="f-brush mb-3 flex items-center justify-center gap-2 text-2xl text-[#f3eadb]">
        {numbering && <span className="rounded-[3px] border-2 border-[#c8352a] px-1.5 py-0.5 text-base leading-none text-[#e04a3c]">{numbering}</span>}
        立会人
      </h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(cast.length, 3)}, minmax(0, 1fr))` }}>
        {cast.map((c, i) => {
          const shown = c.announced && c.name;
          return (
            // 伝えたいのは役割(JUDGE・DJ・MC)が先。札の上部に役割を大きく、真ん中にアーティスト写真、
            // 役職の漢字(裁・音・沸)は朱の落款として写真に添える世界観の飾り(TARO 11/19)
            <div
              key={i}
              className="relative w-full bg-contain bg-center bg-no-repeat drop-shadow-[0_6px_10px_rgba(0,0,0,0.7)] [container-type:inline-size]"
              style={{ aspectRatio: '380 / 967', backgroundImage: 'url(/dojo/plaque.webp)' }}
            >
              <p className="f-num absolute inset-x-0 top-[12%] text-center text-[21cqw] font-bold leading-none tracking-[0.04em] text-[#1b120b]">
                {c.role}
              </p>
              <div className="absolute left-[11%] top-[21%] aspect-square w-[78%] overflow-hidden rounded-[2px] border-[1.5cqw] border-[#f3eadb] bg-[#2a1a0c] shadow-[0_2px_6px_rgba(0,0,0,0.5)]">
                {shown && c.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 出演者ごとに差し替える写真
                  <img src={c.photo} alt={c.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[30cqw] text-[#f3eadb]/25">?</div>
                )}
              </div>
              {c.mark && (
                <span className="f-sho absolute inset-x-0 bottom-[5%] rotate-[-3deg] text-center text-[44cqw] leading-none text-[#120c06]/85 mix-blend-multiply">
                  {c.mark}
                </span>
              )}
              <p
                className={`f-brush absolute inset-x-[4%] top-[55%] text-center leading-tight [overflow-wrap:anywhere] ${shown ? 'text-[15cqw] text-[#1b120b]' : 'text-[11cqw] text-[#1b120b]/55'}`}
              >
                {shown ? c.name : '近日発表'}
              </p>
              {shown && (c.note || c.instagram) && (
                <div className="absolute inset-x-0 top-[62%] text-center text-[7cqw] font-bold leading-tight text-[#2a1a0c]">
                  {c.note && <p>{c.note}</p>}
                  {c.instagram && (
                    <a href={`https://www.instagram.com/${c.instagram}/`} target="_blank" rel="noopener noreferrer" className="underline">
                      @{c.instagram}
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 道場訓(格言をダンスに寄せたパロディ・TARO 11/19)。 */
export const DOJO_KUN: { word: string; note: string }[] = [
  { word: '7転び8ムーヴ', note: '負けても、何度でも次のムーヴへ。' },
  { word: '踊武両道', note: '踊りも、礼も。どちらも磨く。' },
  { word: '心・技・ノリ', note: '気持ちと技とノリ、三つそろって一人前。' },
];

export function DojoKun() {
  return (
    <div className="relative rounded-md bg-[#efe4cf] px-5 py-5 text-[#1d140c] shadow-[0_6px_20px_rgba(0,0,0,0.5)]">
      <h3 className="f-brush mb-3 border-b-2 border-[#1d140c] pb-1.5 text-xl">道場訓</h3>
      <ol className="space-y-3">
        {DOJO_KUN.map((k) => (
          <li key={k.word} className="flex items-baseline gap-2">
            <span className="f-brush text-lg text-[#7a2a1c]">一、</span>
            <div>
              <p className="f-brush text-[22px] leading-tight">{k.word}</p>
              <p className="text-xs text-[#6b5a44]">{k.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 白帯のアイコン(部門カード用)。 */
export function WhiteBelt() {
  return (
    <span aria-hidden className="relative block h-[14px] w-[46px] flex-none rounded-sm border border-[#bbb] bg-white">
      <span className="absolute left-[18px] top-[-4px] h-[22px] w-[10px] rotate-[20deg] border border-[#bbb] bg-white" />
    </span>
  );
}

/** 掟の表の1行。 */
export function DojoRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 border-b border-dashed border-[#b9a98d] py-1.5 text-sm">
      <b className="w-[70px] flex-none text-[#7a2a1c]">{k}</b>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** 墨の見出し(カードの外・黒地の上)。 */
export function DojoHeading({ children }: { children: ReactNode }) {
  return <h2 className="f-brush pt-4 text-2xl text-[#f3eadb]">{children}</h2>;
}

/**
 * 入力欄(和紙カードの中)。⚠️ 文字色と背景色を必ずセットで書く(bodyの既定文字色が白で、
 * 片方だけだと打った文字が見えなくなる事故が過去に何度も起きた・CLAUDE.md 規約11)。
 */
export const inputCls =
  'w-full rounded-md border-2 border-[#cdbb9a] bg-[#fffaf0] px-3.5 py-3 text-base text-[#1d140c] placeholder:text-[#a8977c] focus:border-[#b8261c] focus:outline-none [color-scheme:light]';

/** 朱のはんこ風ボタン。 */
export const btnPrimaryCls =
  'border-2 border-[#e9b3a5] bg-[#b8261c] tracking-[0.12em] text-white shadow-[0_4px_0_#6d140e] hover:bg-[#c92c21] active:translate-y-[2px] disabled:opacity-50';
/** 墨の枠のボタン(戻る など)。 */
export const btnDarkCls = 'border-2 border-[#1d140c] bg-transparent text-[#1d140c]';
/** 黒地の上に置く控えめなボタン。 */
export const btnOnDarkCls = 'border border-[#f3eadb]/40 bg-transparent text-[#f3eadb]';

export function BattleField({
  label,
  required,
  optional,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  /** 「(任意)」を出す */
  optional?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-[#1d140c]">
        {label} {required && <span className="text-[#b8261c]">*</span>}{optional && <span className="text-xs font-normal text-[#6b5a44]">(任意)</span>}
      </span>
      {hint && <span className="block text-xs text-[#6b5a44]">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

/** 受付前にスタッフが画面を確認しているときの帯。一般の人には出ない。 */
export function BattlePreviewBanner() {
  return (
    <div className="bg-amber-400 px-4 py-2.5 text-center text-xs font-black text-neutral-950">
      確認用モード(スタッフのログイン中だけ表示・一般の方には「受付していません」と出ます)
      <span className="block font-bold">送った申込は「テスト」として保存され、決済はせず、定員・エントリー一覧にも数えません</span>
    </div>
  );
}

/** 改行入りの設定文をそのまま段落で出す。 */
export function MultiLine({ text, className = '' }: { text: string; className?: string }) {
  return <p className={`whitespace-pre-line ${className}`}>{text}</p>;
}

/** エラー表示(和紙の上でも黒地の上でも読める色)。 */
export function DojoError({ children }: { children: ReactNode }) {
  return <p className="rounded-md border-2 border-[#b8261c] bg-[#fff1ec] p-3 text-sm font-bold text-[#8f1b13]">{children}</p>;
}
