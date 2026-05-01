"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import {
  ShoppingBag, X, Package, CreditCard, Banknote, CheckCircle, Loader2, Info,
} from "lucide-react";
import Image from "next/image";

// ── Types ──
interface MerchVariant {
  id: number;
  merch_id: number;
  color: string;
  size: string;
  stock: number;
}
interface MerchItem {
  id: number;
  name: string;
  price: number;
  image_url: string;
  stock: number;
  description: string;
  purchase_at_booth?: number;
  variants?: MerchVariant[];
}

type PaymentMethod = "cash_onsite" | "online_square";

// ── Color name → swatch hex ──
const COLOR_HEX: Record<string, string> = {
  "フェードグレー": "#8c8c86",
  "フェードレッド": "#c96a5a",
  "フェードブルー": "#6a8bb3",
  "ホワイト":       "#f5f5f5",
  "ブラック":       "#1b1b1b",
  "ブルー":         "#2f5fb0",
  "ライトグレー":   "#cfcfc8",
  "グリーン":       "#6b8f6b",
};

// ── Color → image override per product ──
// Returns whichever views (front / back / closeup) exist for this color.
type VariantImages = { front: string; back?: string; closeup?: string; model?: string };

function imagesForVariant(
  merchId: number,
  color: string
): VariantImages | null {
  // オフィシャルTシャツ — 各色とも 平置き + 着用モデルの2枚構成
  if (merchId === 4) {
    const map: Record<string, VariantImages> = {
      "フェードグレー": {
        front: "/merch/official_grey.png",
        model: "/merch/official_grey_model.png",
      },
      "フェードレッド": {
        front: "/merch/official_red.png",
        model: "/merch/official_red_model.png",
      },
      "フェードブルー": {
        front: "/merch/official_blue.png",
        model: "/merch/official_blue_model.png",
      },
    };
    return map[color] ?? null;
  }
  // BOOMくん刺繍Tシャツ — front / back / closeup の3視点
  if (merchId === 5) {
    const map: Record<string, VariantImages> = {
      "ホワイト": {
        front:   "/merch/embroidery_white_front.webp",
        back:    "/merch/embroidery_white_back.webp",
        closeup: "/merch/embroidery_white_closeup.webp",
      },
      "ブラック": {
        front:   "/merch/embroidery_black_front.webp",
        back:    "/merch/embroidery_black_back.webp",
        closeup: "/merch/embroidery_black_closeup.webp",
      },
      "ブルー": {
        front:   "/merch/embroidery_blue_front.webp",
        back:    "/merch/embroidery_blue_back.webp",
        closeup: "/merch/embroidery_blue_closeup.webp",
      },
    };
    return map[color] ?? null;
  }
  // ミニトート
  if (merchId === 7) {
    const map: Record<string, string> = {
      "ライトグレー": "/merch/tote_lightgrey.png",
      "グリーン":     "/merch/tote_green.png",
    };
    return map[color] ? { front: map[color] } : null;
  }
  // きらきらシール — 6種のインストラクターデザイン + BOOMくん（コンプ特典）
  if (merchId === 8) {
    const map: Record<string, string> = {
      "KEIKO":    "/merch/kirakira_keiko.png",
      "TARO":     "/merch/kirakira_taro.png",
      "K@TTSU":   "/merch/kirakira_kattsu.png",
      "SAYUKI":   "/merch/kirakira_sayuki.png",
      "ちゃんなつ": "/merch/kirakira_channatsu.png",
      "おっちゃん": "/merch/kirakira_occhan.png",
      "BOOMくん":   "/merch/kirakira_boomkun.png",
    };
    return map[color] ? { front: map[color] } : null;
  }
  return null;
}

type ViewMode = "front" | "back" | "closeup" | "model";
const VIEW_LABEL: Record<ViewMode, string> = {
  front: "FRONT",
  back: "BACK",
  closeup: "CLOSEUP",
  model: "MODEL",
};

// ════════════════════════════════════════
// Reservation mode (time-based)
// ════════════════════════════════════════
// 開演（事前予約締切）/ 公演終了（取り置き締切）
const PICKUP_DEADLINE = new Date("2026-05-05T14:30:00+09:00"); // 開演＝事前予約締切
const EVENT_END       = new Date("2026-05-05T18:30:00+09:00"); // 公演終了＝取り置き締切

type ShopMode = "pre" | "during" | "closed";

function getShopMode(): ShopMode {
  // URL クエリでプレビュー上書き ?preview=pre / event / closed
  if (typeof window !== "undefined") {
    const p = new URLSearchParams(window.location.search).get("preview");
    if (p === "pre") return "pre";
    if (p === "event" || p === "during") return "during";
    if (p === "closed") return "closed";
  }
  const now = Date.now();
  if (now < PICKUP_DEADLINE.getTime()) return "pre";
  if (now < EVENT_END.getTime()) return "during";
  return "closed";
}

const MODE_COPY: Record<ShopMode, {
  cardButton: string;
  modalButton: string;
  modalSubmitting: string;
  bannerHTML: string;
  modalInfoTitle: string;
  modalInfoBody: string;
  successMessage: string;
}> = {
  pre: {
    cardButton: "予約する",
    modalButton: "予約を確定",
    modalSubmitting: "予約中...",
    bannerHTML:
      'ご予約商品は<strong class="text-white">発表会当日（5/5）会場の物販ブース</strong>でのお受け取りです。<br />事前のお渡し・発送はございません。',
    modalInfoTitle: "受け取り：開場後すぐ（13:45〜14:30）",
    modalInfoBody:
      "物販ブースでお名前を伝えてお受け取りください。<br /><strong>※14:30 を過ぎると自動キャンセル</strong>となり商品は再販されます。<br />お支払いは現金・クレジットカード・PayPay 等に対応。",
    successMessage: "ご予約を承りました。当日 13:45〜14:30 の間に物販ブースでお受け取りください。",
  },
  during: {
    cardButton: "取り置きする",
    modalButton: "取り置きを確定",
    modalSubmitting: "確定中...",
    bannerHTML:
      '<strong class="text-white">ライブ取り置き受付中</strong> — お席からそのまま注文OK。お早めに物販ブースでお受け取りください。',
    modalInfoTitle: "受け取り：物販ブースで随時",
    modalInfoBody:
      "なるべくお早めに物販ブースでお受け取りください。<br /><strong>※公演終了（18:30）までに受け取りがない場合は自動キャンセル</strong>となります。<br />お支払いは現金・クレジットカード・PayPay 等に対応。",
    successMessage: "取り置きを承りました。物販ブースで「お名前」をお伝えください。",
  },
  closed: {
    cardButton: "受付終了",
    modalButton: "受付終了",
    modalSubmitting: "—",
    bannerHTML:
      '<strong class="text-white">物販の受付は終了しました。</strong>',
    modalInfoTitle: "受付終了",
    modalInfoBody: "本日の取り置き・予約受付は終了しました。",
    successMessage: "",
  },
};

// ════════════════════════════════════════
export default function ShopSection() {
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-80px" });

  return (
    <section id="merch" className="py-16 px-4 sm:px-6">
      <div className="max-w-lg mx-auto" ref={sectionRef}>
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight gradient-text mb-3">
            GOODS
          </h2>
          <p className="text-xs text-white/60">事前予約 / 当日取り置き OK・会場の物販ブースで受け取り</p>
        </motion.div>

        <MerchTab />
      </div>
    </section>
  );
}

// ════════════════════════════════════════
// Merch Tab
// ════════════════════════════════════════
function MerchTab() {
  const [items, setItems] = useState<MerchItem[]>([]);
  const [modal, setModal] = useState<MerchItem | null>(null);
  const [mode, setMode] = useState<ShopMode>("pre");

  // Re-evaluate mode every 30s and on mount so 14:30/18:30 transitions auto-apply
  useEffect(() => {
    const update = () => setMode(getShopMode());
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const data = await fetch("/api/merch").then((r) => r.json());
      setItems(data);
    } catch { /* silent */ }
  };
  useEffect(() => { load(); }, []);

  const copy = MODE_COPY[mode];

  return (
    <>
      {/* Pickup info banner — varies by mode (pre / during / closed) */}
      <div
        className="mb-4 rounded-xl px-3 py-2.5 flex gap-2 items-start"
        style={{
          background: mode === "during" ? "rgba(220,76,4,0.18)" : "rgba(242,122,26,0.12)",
          border: `1px solid ${mode === "during" ? "rgba(220,76,4,0.5)" : "rgba(242,122,26,0.35)"}`,
        }}
      >
        <Info size={16} className="flex-shrink-0 mt-0.5" style={{ color: "#ffb37a" }} />
        <p
          className="text-[11px] leading-snug text-white/85"
          dangerouslySetInnerHTML={{ __html: copy.bannerHTML }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {items.map((item, i) => {
          // Booth-only items don't track stock in DB (sold by hand at the booth) — never show as sold out.
          const soldOut = item.purchase_at_booth ? false : (item.stock ?? 0) <= 0;
          return (
            <motion.div
              key={item.id}
              className="rounded-2xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.12)" }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <button
                type="button"
                onClick={() => !soldOut && setModal(item)}
                disabled={soldOut}
                aria-label={item.purchase_at_booth ? `${item.name} のデザインを見る` : `${item.name} の予約画面を開く`}
                className="aspect-square relative overflow-hidden w-full block transition-transform active:scale-[0.97]"
                style={{ background: "rgba(255,255,255,0.05)", cursor: !soldOut ? "pointer" : "not-allowed" }}
              >
                {item.image_url ? (
                  <Image src={item.image_url} alt={item.name} fill className="object-cover" sizes="(max-width: 768px) 50vw, 200px" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Package size={36} className="text-white/20" />
                  </div>
                )}
                {soldOut && (
                  <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                    <span className="text-white text-sm font-black tracking-widest">SOLD OUT</span>
                  </div>
                )}
              </button>

              <div className="p-3">
                <h3 className="font-bold text-xs text-white leading-tight line-clamp-2 min-h-[2rem]">
                  {item.name}
                </h3>
                <p className="text-sm font-black text-white mt-1">&yen;{item.price.toLocaleString()}</p>

                {/* Color swatches preview */}
                {(() => {
                  const colors = Array.from(
                    new Set((item.variants ?? []).map((v) => v.color).filter(Boolean))
                  );
                  if (colors.length === 0) return null;
                  return (
                    <div className="flex gap-1 mt-2">
                      {colors.map((c) => (
                        <span
                          key={c}
                          title={c}
                          className="w-4 h-4 rounded-full border border-white/40"
                          style={{ background: COLOR_HEX[c] ?? "#888" }}
                        />
                      ))}
                    </div>
                  );
                })()}

                <button
                  onClick={() => !soldOut && setModal(item)}
                  disabled={soldOut}
                  className="w-full mt-2 text-xs font-bold py-2 rounded-full transition-all"
                  style={{
                    background: !soldOut ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.1)",
                    color: !soldOut ? "#f27a1a" : "rgba(255,255,255,0.3)",
                    cursor: !soldOut ? "pointer" : "not-allowed",
                  }}
                >
                  {soldOut ? "SOLD OUT" : item.purchase_at_booth ? "デザインを見る" : copy.cardButton}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="text-center py-12 text-white/40">
          <ShoppingBag className="mx-auto mb-3 opacity-50" size={32} />
          <p className="text-sm">グッズ情報準備中...</p>
        </div>
      )}

      <AnimatePresence>
        {modal && <OrderModal item={modal} mode={mode} onClose={() => { setModal(null); load(); }} />}
      </AnimatePresence>
    </>
  );
}

// ════════════════════════════════════════
// Order Modal
// ════════════════════════════════════════
function OrderModal({ item, mode, onClose }: { item: MerchItem; mode: ShopMode; onClose: () => void }) {
  const copy = MODE_COPY[mode];
  const variants = item.variants ?? [];
  const hasVariants = variants.length > 0 && variants.some((v) => v.color || v.size);

  const colors = useMemo(
    () => Array.from(new Set(variants.map((v) => v.color).filter(Boolean))),
    [variants]
  );
  const sizes = useMemo(
    () => Array.from(new Set(variants.map((v) => v.size).filter(Boolean))),
    [variants]
  );

  const [selectedColor, setSelectedColor] = useState<string>(colors[0] ?? "");
  const [selectedSize, setSelectedSize] = useState<string>(sizes[0] ?? "");
  // Embroidery Tee (id=5) defaults to back view since the back is the hero artwork
  const [view, setView] = useState<ViewMode>(item.id === 5 ? "back" : "front");
  const [buyerName, setBuyerName] = useState("");
  const [email, setEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash_onsite");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; message: string }>(null);

  const selectedVariant = useMemo(() => {
    if (!hasVariants) return variants[0] ?? null;
    return variants.find(
      (v) =>
        (colors.length === 0 || v.color === selectedColor) &&
        (sizes.length === 0 || v.size === selectedSize)
    ) ?? null;
  }, [variants, hasVariants, colors, sizes, selectedColor, selectedSize]);

  // Variant-specific images (front / back / closeup)
  const variantImages = imagesForVariant(item.id, selectedColor);
  const availableViews: ViewMode[] = useMemo(() => {
    if (!variantImages) return [];
    const out: ViewMode[] = ["front"];
    if (variantImages.back) out.push("back");
    if (variantImages.closeup) out.push("closeup");
    if (variantImages.model) out.push("model");
    return out;
  }, [variantImages]);
  const displayImage =
    (view === "model" && variantImages?.model) ||
    (view === "closeup" && variantImages?.closeup) ||
    (view === "back" && variantImages?.back) ||
    variantImages?.front ||
    item.image_url;

  const isColorSoldOut = (color: string) =>
    variants.filter((v) => v.color === color).every((v) => v.stock <= 0);
  const isSizeSoldOut = (size: string) => {
    const pool = colors.length > 0
      ? variants.filter((v) => v.color === selectedColor && v.size === size)
      : variants.filter((v) => v.size === size);
    return pool.length > 0 && pool.every((v) => v.stock <= 0);
  };

  const variantSoldOut = selectedVariant ? selectedVariant.stock <= 0 : false;
  const canSubmit =
    buyerName.trim().length > 0 &&
    (paymentMethod !== "online_square" || email.trim().length > 0) &&
    !variantSoldOut &&
    !submitting;

  const handleOrder = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const body = {
        merch_id: item.id,
        variant_id: selectedVariant?.id ?? null,
        buyer_name: buyerName.trim(),
        email: email.trim(),
        payment_method: paymentMethod,
      };
      const res = await fetch("/api/merch/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "予約に失敗しました" });
        return;
      }
      if (paymentMethod === "online_square") {
        if (data.redirect) { window.location.href = data.redirect; return; }
        setResult({ ok: false, message: data.checkout_error ?? "オンライン決済は現在準備中です。当日現金を選んでください。" });
      } else {
        setResult({ ok: true, message: copy.successMessage });
        setTimeout(onClose, 2400);
      }
    } catch {
      setResult({ ok: false, message: "通信エラーが発生しました" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-sm rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: "rgba(255,255,255,0.97)", border: "1px solid rgba(255,255,255,0.8)" }}
        initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
      >
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="absolute top-3 right-3 z-20 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-colors"
          style={{ background: "rgba(255,255,255,0.95)", color: "#333", border: "1px solid rgba(0,0,0,0.08)" }}
        >
          <X size={20} />
        </button>

        {result?.ok ? (
          <div className="text-center py-6">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
              <CheckCircle size={48} className="mx-auto mb-3 text-green-500" />
            </motion.div>
            <p className="font-bold text-gray-800">予約完了!</p>
            <p className="text-sm text-gray-500 mt-1">{result.message}</p>
          </div>
        ) : (
          <>
            {/* Variant image preview (large) */}
            <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-3 bg-gray-100">
              <Image
                key={displayImage}
                src={displayImage}
                alt={item.name}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 80vw, 320px"
              />
              {availableViews.length > 1 && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 rounded-full p-1 bg-white/90 backdrop-blur shadow-md">
                  {availableViews.map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className="px-3 py-1 rounded-full text-[10px] font-bold transition-all whitespace-nowrap"
                      style={{
                        background: view === v ? "#f27a1a" : "transparent",
                        color: view === v ? "#fff" : "#666",
                      }}
                    >
                      {VIEW_LABEL[v]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="pr-6">
              <h3 className="font-bold text-base text-gray-800 leading-tight">{item.name}</h3>
              <p className="text-lg font-black mt-1" style={{ color: "#f27a1a" }}>
                &yen;{item.price.toLocaleString()}
              </p>
            </div>

            {item.description && (
              <p className="text-xs text-gray-500 mb-4 mt-2 leading-relaxed">{item.description}</p>
            )}

            {/* Pickup reminder — only for pre-order items (not for booth-only) */}
            {!item.purchase_at_booth && (
              <div className="rounded-lg px-3 py-2 mb-4 text-[11px] leading-snug"
                   style={{ background: "rgba(242,122,26,0.1)", color: "#a24e00", border: "1px solid rgba(242,122,26,0.25)" }}>
                お受け取りは <strong>発表会当日、会場の物販ブース</strong> のみです（事前発送なし）。
              </div>
            )}

            <div className="space-y-4">
              {colors.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 mb-2 block font-semibold">{item.id === 8 ? "デザイン" : "カラー"}</label>
                  <div className="flex flex-wrap gap-2">
                    {colors.map((c) => {
                      const active = c === selectedColor;
                      const out = isColorSoldOut(c);
                      const hex = COLOR_HEX[c] ?? "#888";
                      return (
                        <button
                          key={c}
                          onClick={() => { if (!out) { setSelectedColor(c); setView("front"); } }}
                          disabled={out}
                          className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                          style={{
                            background: active ? "#f27a1a" : out ? "#eee" : "#f5f5f5",
                            color: active ? "#fff" : out ? "#bbb" : "#555",
                            textDecoration: out ? "line-through" : "none",
                            cursor: out ? "not-allowed" : "pointer",
                          }}
                        >
                          <span
                            className="w-4 h-4 rounded-full border"
                            style={{ background: hex, borderColor: active ? "#fff" : "rgba(0,0,0,0.15)" }}
                          />
                          {c}
                        </button>
                      );
                    })}
                    {/* きらきらシール限定: BOOMくん コンプ特典枠 */}
                    {item.id === 8 && (
                      <button
                        onClick={() => { setSelectedColor("BOOMくん"); setView("front"); }}
                        className="flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-xl text-xs font-bold transition-all relative"
                        style={{
                          background: selectedColor === "BOOMくん"
                            ? "linear-gradient(135deg, #f59e0b, #dc4c04)"
                            : "linear-gradient(135deg, #fff7ed, #ffedd5)",
                          color: selectedColor === "BOOMくん" ? "#fff" : "#dc4c04",
                          border: "1.5px solid rgba(220,76,4,0.45)",
                        }}
                      >
                        <span className="text-sm leading-none">🎁</span>
                        BOOMくん
                        <span
                          className="absolute -top-2 -right-1 text-[8px] font-black px-1.5 py-0.5 rounded-full"
                          style={{ background: "#dc4c04", color: "#fff" }}
                        >
                          特典
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {sizes.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 mb-2 block font-semibold">サイズ</label>
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((s) => {
                      const active = s === selectedSize;
                      const out = isSizeSoldOut(s);
                      return (
                        <button
                          key={s}
                          onClick={() => !out && setSelectedSize(s)}
                          disabled={out}
                          className="px-3 py-2 rounded-xl text-xs font-bold transition-all min-w-[48px]"
                          style={{
                            background: active ? "#f27a1a" : out ? "#eee" : "#f5f5f5",
                            color: active ? "#fff" : out ? "#bbb" : "#555",
                            textDecoration: out ? "line-through" : "none",
                            cursor: out ? "not-allowed" : "pointer",
                          }}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {variantSoldOut && (
                <p className="text-xs font-bold text-red-500 text-center py-2">
                  選択中の組み合わせは売り切れです
                </p>
              )}

              {item.purchase_at_booth ? (
                selectedColor === "BOOMくん" ? (
                  <div
                    className="rounded-2xl px-4 py-4 border-2"
                    style={{
                      background: "linear-gradient(135deg, #fff7ed 0%, #ffe4c4 100%)",
                      borderColor: "#f27a1a",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">🎁</span>
                      <h4 className="text-sm font-black text-orange-600">こちらは販売なし・コンプ特典です</h4>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed">
                      他6種（TARO / KEIKO / K@TTSU / SAYUKI / ちゃんなつ / おっちゃん）を
                      <strong className="text-orange-600 mx-1">全種コンプリート</strong>
                      した方限定で、BOOMくん きらきらシールを<strong className="text-orange-600 mx-1">無料プレゼント</strong>🎉<br />
                      物販ブースで6種を見せていただいた方に1枚お渡しします。
                    </p>
                  </div>
                ) : (
                  <div
                    className="rounded-2xl px-4 py-4 border-2 border-dashed"
                    style={{ background: "#fff7ed", borderColor: "#f27a1a" }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">🏪</span>
                      <h4 className="text-sm font-black text-orange-600">物販ブースで直接お買い求めください</h4>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed">
                      駄菓子屋スタイル！貯金箱に
                      <span className="font-black text-orange-600 mx-1">¥{item.price.toLocaleString()}</span>
                      を入れて、お好みのデザインを1枚お持ちください。<br />
                      お釣りが必要な場合はスタッフまでお声がけを🎫
                    </p>
                  </div>
                )
              ) : (
                <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">お名前</label>
                <input
                  type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800"
                  placeholder="お名前を入力"
                />
              </div>

              {/* Mode-aware pickup info — pre / during / closed */}
              <div className="rounded-xl px-3 py-3" style={{ background: "#fff7ed", border: "1px solid rgba(242,122,26,0.3)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <Info size={16} style={{ color: "#dc4c04" }} />
                  <span className="text-xs font-black" style={{ color: "#dc4c04" }}>{copy.modalInfoTitle}</span>
                </div>
                <div
                  className="text-[11px] leading-relaxed"
                  style={{ color: "#555" }}
                  dangerouslySetInnerHTML={{ __html: copy.modalInfoBody }}
                />
              </div>

              {result && !result.ok && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  {result.message}
                </div>
              )}

              <button
                onClick={handleOrder} disabled={!canSubmit || mode === "closed"}
                className="w-full py-3 rounded-full text-sm font-bold text-white disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                style={{ background: "#f27a1a" }}
              >
                {submitting ? (
                  <><Loader2 size={16} className="animate-spin" />{copy.modalSubmitting}</>
                ) : copy.modalButton}
              </button>
              </>
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

