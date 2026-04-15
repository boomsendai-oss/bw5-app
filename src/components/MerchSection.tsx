"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { ShoppingBag, X, Package } from "lucide-react";
import Image from "next/image";

interface MerchItem {
  id: number;
  name: string;
  price: number;
  image_url: string;
  stock: number;
  description: string;
}

interface OrderModal {
  item: MerchItem;
}

export default function MerchSection() {
  const [items, setItems] = useState<MerchItem[]>([]);
  const [modal, setModal] = useState<OrderModal | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("square");
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    fetch("/api/merch")
      .then((r) => r.json())
      .then((data) => setItems(data))
      .catch(() => {});
  }, []);

  const handleOrder = async () => {
    if (!modal || !buyerName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/merch/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merch_id: modal.item.id,
          buyer_name: buyerName.trim(),
          payment_method: paymentMethod,
        }),
      });
      if (res.ok) {
        setOrderSuccess(true);
        // Refresh items
        const updated = await fetch("/api/merch").then((r) => r.json());
        setItems(updated);
        setTimeout(() => {
          setModal(null);
          setOrderSuccess(false);
          setBuyerName("");
        }, 2000);
      }
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="merch" className="py-20 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto" ref={ref}>
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight gradient-text mb-2">
            MERCHANDISE
          </h2>
          <div className="section-divider max-w-[200px] mx-auto" />
        </motion.div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {items.map((item, i) => (
            <motion.div
              key={item.id}
              className="card overflow-hidden"
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              {/* Image */}
              <div className="aspect-square bg-[var(--bg-secondary)] relative overflow-hidden">
                {item.image_url ? (
                  <Image
                    src={item.image_url}
                    alt={item.name}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Package
                      size={40}
                      className="text-[var(--text-muted)] opacity-30"
                    />
                  </div>
                )}
                {/* Stock badge */}
                {item.stock <= 0 ? (
                  <div className="absolute top-2 right-2 bg-[var(--text-muted)]/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    SOLD OUT
                  </div>
                ) : item.stock <= 5 ? (
                  <div className="absolute top-2 right-2 bg-[var(--accent-primary)]/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    残り{item.stock}個
                  </div>
                ) : null}
              </div>

              <div className="p-3">
                <h3 className="font-bold text-sm text-white truncate">
                  {item.name}
                </h3>
                <p className="text-[var(--accent-secondary)] font-bold mt-1">
                  &yen;{item.price.toLocaleString()}
                </p>
                <button
                  onClick={() => item.stock > 0 && setModal({ item })}
                  disabled={item.stock <= 0}
                  className={`w-full mt-2 text-xs font-bold py-2 rounded-full transition-all ${
                    item.stock > 0
                      ? "btn-primary text-sm"
                      : "bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-not-allowed"
                  }`}
                >
                  {item.stock > 0 ? "予約する" : "SOLD OUT"}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {items.length === 0 && (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <ShoppingBag className="mx-auto mb-3 opacity-50" size={32} />
            <p className="text-sm">グッズ情報準備中...</p>
          </div>
        )}
      </div>

      {/* Order Modal */}
      <AnimatePresence>
        {modal && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => {
                setModal(null);
                setOrderSuccess(false);
                setBuyerName("");
              }}
            />

            <motion.div
              className="relative w-full max-w-sm glass rounded-2xl p-6"
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
            >
              <button
                onClick={() => {
                  setModal(null);
                  setOrderSuccess(false);
                  setBuyerName("");
                }}
                className="absolute top-4 right-4 text-[var(--text-muted)] hover:text-white transition-colors"
              >
                <X size={20} />
              </button>

              {orderSuccess ? (
                <div className="text-center py-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="text-4xl mb-3"
                  >
                    &#10003;
                  </motion.div>
                  <p className="text-white font-bold">予約完了!</p>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    ありがとうございます
                  </p>
                </div>
              ) : (
                <>
                  <h3 className="font-bold text-lg text-white mb-1">
                    {modal.item.name}
                  </h3>
                  <p className="text-[var(--accent-secondary)] font-bold mb-4">
                    &yen;{modal.item.price.toLocaleString()}
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                        お名前
                      </label>
                      <input
                        type="text"
                        value={buyerName}
                        onChange={(e) => setBuyerName(e.target.value)}
                        className="admin-input"
                        placeholder="お名前を入力"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-2 block">
                        お支払い方法
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPaymentMethod("square")}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                            paymentMethod === "square"
                              ? "bg-[var(--accent-primary)] text-white"
                              : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                          }`}
                        >
                          Square (カード)
                        </button>
                        <button
                          onClick={() => setPaymentMethod("paypay")}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                            paymentMethod === "paypay"
                              ? "bg-[var(--accent-primary)] text-white"
                              : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                          }`}
                        >
                          PayPay
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={handleOrder}
                      disabled={!buyerName.trim() || submitting}
                      className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting ? "送信中..." : "予約する"}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
