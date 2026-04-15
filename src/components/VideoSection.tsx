"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Film, CreditCard, QrCode, CheckCircle } from "lucide-react";

export default function VideoSection() {
  const [price, setPrice] = useState<number | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [email, setEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("square");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    fetch("/api/video")
      .then((r) => r.json())
      .then((data) => setPrice(data.price))
      .catch(() => {});
  }, []);

  const handlePurchase = async () => {
    if (!buyerName.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_name: buyerName.trim(),
          email: email.trim(),
          payment_method: paymentMethod,
        }),
      });
      if (res.ok) {
        setSuccess(true);
      }
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="video" className="py-20 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto" ref={ref}>
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight gradient-text mb-2">
            VIDEO
          </h2>
          <div className="section-divider max-w-[200px] mx-auto" />
        </motion.div>

        <motion.div
          className="card p-6 sm:p-8 max-w-md mx-auto"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {success ? (
            <motion.div
              className="text-center py-8"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              <CheckCircle
                size={48}
                className="mx-auto mb-4 text-green-400"
              />
              <h3 className="text-lg font-bold text-white mb-2">
                ご購入ありがとうございます!
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                決済確認後、メールにてお届けします
              </p>
            </motion.div>
          ) : (
            <>
              {/* Header */}
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-primary)]/20 to-[var(--accent-secondary)]/20 mb-4">
                  <Film size={28} className="text-[var(--accent-primary)]" />
                </div>
                <h3 className="text-lg font-bold text-white">
                  イベント映像
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  BOOM WOP vol.5 全編映像
                </p>
                {price !== null && (
                  <div className="text-3xl font-black gradient-text mt-3">
                    &yen;{price.toLocaleString()}
                  </div>
                )}
              </div>

              {/* Form */}
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
                  <label className="text-xs text-[var(--text-secondary)] mb-1 block">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="admin-input"
                    placeholder="example@email.com"
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-2 block">
                    お支払い方法
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPaymentMethod("square")}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
                        paymentMethod === "square"
                          ? "bg-[var(--accent-primary)] text-white glow-red"
                          : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                      }`}
                    >
                      <CreditCard size={16} />
                      Square
                    </button>
                    <button
                      onClick={() => setPaymentMethod("paypay")}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${
                        paymentMethod === "paypay"
                          ? "bg-[var(--accent-primary)] text-white glow-red"
                          : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                      }`}
                    >
                      <QrCode size={16} />
                      PayPay
                    </button>
                  </div>
                </div>

                <button
                  onClick={handlePurchase}
                  disabled={
                    !buyerName.trim() || !email.trim() || submitting
                  }
                  className="btn-primary w-full text-base disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "処理中..." : "購入する"}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </section>
  );
}
