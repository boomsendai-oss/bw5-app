"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Loader2 } from "lucide-react";
import Link from "next/link";

function ShopSuccessInner() {
  const params = useSearchParams();
  const orderId = params.get("order_id");
  const transactionId = params.get("transactionId");
  const [state, setState] = useState<"pending" | "done" | "error">("pending");

  useEffect(() => {
    if (!orderId) {
      setState("error");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/merch/payment-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: orderId, transaction_id: transactionId }),
        });
        if (res.ok) {
          setState("done");
        } else {
          setState("error");
        }
      } catch {
        setState("error");
      }
    })();
  }, [orderId, transactionId]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl p-8 text-center bg-white/95 shadow-xl">
        {state === "pending" && (
          <>
            <Loader2 size={48} className="mx-auto mb-4 animate-spin text-orange-500" />
            <h2 className="text-lg font-bold text-gray-800 mb-1">
              お支払いを確認しています...
            </h2>
          </>
        )}
        {state === "done" && (
          <>
            <CheckCircle size={52} className="mx-auto mb-4 text-green-500" />
            <h2 className="text-xl font-bold text-gray-800 mb-2">
              ご購入ありがとうございます！
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              ご予約を承りました。<br />
              当日、会場の物販ブースでお受け取りください。
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">
              確認中にエラーが発生しました
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              スタッフまでお声がけください。
            </p>
          </>
        )}
        <Link
          href="/"
          className="inline-block px-6 py-3 rounded-full font-bold text-white"
          style={{ background: "#f27a1a" }}
        >
          トップに戻る
        </Link>
      </div>
    </div>
  );
}

export default function ShopSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-6">
        <Loader2 size={32} className="animate-spin text-orange-500" />
      </div>
    }>
      <ShopSuccessInner />
    </Suspense>
  );
}
