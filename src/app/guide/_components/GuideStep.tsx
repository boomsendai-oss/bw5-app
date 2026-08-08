import Image, { type StaticImageData } from 'next/image';
import type { ReactNode } from 'react';

/**
 * 会員向けガイドの「1ステップ = 実画面キャプチャ1枚 + 短い一文」ブロック。
 *
 * 設計: docs/superpowers/specs/2026-08-08-member-guide-redesign-design.md §4.2
 * - キャプチャは375px幅の実画面そのまま。ベゼル付きモックアップにしない
 *   （旧ガイド=hacomono純正Notionの不読の主因。実画面が縮んで文字が読めなかった）
 * - タップ位置は画像に焼き込まず、%座標のオーバーレイで重ねる
 *   （あとから位置だけ直せる。高DPIでも輪郭が潰れない）
 */

/** 押す場所の囲み。画像に対する%指定（left/top/width/height） */
export type Hotspot = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type GuideStepProps = {
  /** ステップ番号（1始まり） */
  n: number;
  /** 「何をするか」を動詞で。例: 画面の下にある「マイページ」を押す */
  title: string;
  /** 補足。迷いやすい点だけ短く */
  body?: ReactNode;
  /**
   * 実画面キャプチャ。static import で渡すと width/height/blurDataURL が自動で入る。
   * 置き場所: src/app/guide/_captures/
   */
  image?: StaticImageData;
  /** 画像の説明（スクリーンリーダー向け） */
  imageAlt?: string;
  /** 押す場所の囲み（画像がある時だけ意味を持つ） */
  hotspot?: Hotspot;
  /**
   * BOOMポータルの画面キャプチャを載せる予定だが、まだ撮れていないステップ。
   * プレースホルダを出す。撮影後は image を渡してこのフラグを外す。
   * ※ 会員自身のメールアプリ操作などスクショを載せない手順では立てないこと
   *   （永久に「準備中」と表示され続けてしまう）
   */
  pendingCapture?: boolean;
};

export function GuideStep({
  n,
  title,
  body,
  image,
  imageAlt,
  hotspot,
  pendingCapture,
}: GuideStepProps) {
  return (
    <li className="relative pl-11">
      {/* ステップ番号 */}
      <span
        aria-hidden
        className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-[15px] font-bold text-white"
      >
        {n}
      </span>

      <h3 className="pt-1 text-[16px] font-bold leading-snug text-navy-800">{title}</h3>
      {body && <div className="mt-1 text-[14px] leading-relaxed text-neutral-600">{body}</div>}

      {(image || pendingCapture) && (
        <div className="mt-3">
          {image ? (
            <div className="relative inline-block overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
              <Image
                src={image}
                alt={imageAlt ?? title}
                // 実画面は375px幅で撮る。ここで横幅を器に合わせ、高さは元の比率のまま伸ばす
                className="h-auto w-full"
                sizes="(max-width: 480px) 100vw, 420px"
              />
              {hotspot && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute rounded-lg border-[3px] border-brand-500 bg-brand-500/10 shadow-[0_0_0_9999px_rgba(16,16,64,0.28)]"
                  style={{
                    left: `${hotspot.left}%`,
                    top: `${hotspot.top}%`,
                    width: `${hotspot.width}%`,
                    height: `${hotspot.height}%`,
                  }}
                />
              )}
            </div>
          ) : (
            <CapturePlaceholder />
          )}
        </div>
      )}
    </li>
  );
}

/** キャプチャ未撮影のステップ。撮影後に image を渡せば置き換わる。 */
function CapturePlaceholder() {
  return (
    <div className="flex h-36 items-center justify-center rounded-xl border-2 border-dashed border-sand-300 bg-sand-50 px-4 text-center text-[13px] leading-relaxed text-sand-700">
      この手順の画面写真は準備中です
      <br />
      （文章のとおりに進めれば操作できます）
    </div>
  );
}

/** 手順のまとまり。GuideStep を子に並べる。 */
export function GuideSteps({ children }: { children: ReactNode }) {
  return <ol className="space-y-7">{children}</ol>;
}
