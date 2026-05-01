"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Star, Heart, Check, X } from "lucide-react";
import Image from "next/image";

interface Candidate {
  id: number;
  name: string;
  votes: number;
}

function getFingerprint(): string {
  let fp = localStorage.getItem("bw5_vote_fp");
  if (!fp) {
    fp =
      Math.random().toString(36).substring(2) +
      Date.now().toString(36) +
      Math.random().toString(36).substring(2);
    localStorage.setItem("bw5_vote_fp", fp);
  }
  return fp;
}

export default function VoteSection() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [votedId, setVotedId] = useState<number | null>(null);
  const [voting, setVoting] = useState(false);
  const [pendingCandidate, setPendingCandidate] = useState<Candidate | null>(null);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  // 1番目に並んだ候補が有利になるバイアスを避けるため、デバイスごとに表示順をシャッフル。
  // fingerprint をシードに決定論的に並べることで、ユーザーには毎回同じ順序になる。
  const shuffledCandidates = useMemo(() => {
    if (candidates.length === 0) return [];
    if (typeof window === 'undefined') return candidates;
    const fp = localStorage.getItem("bw5_vote_fp") || "0";
    let h = 0;
    for (let i = 0; i < fp.length; i++) h = ((h << 5) - h + fp.charCodeAt(i)) | 0;
    const arr = [...candidates];
    for (let i = arr.length - 1; i > 0; i--) {
      h = (h * 9301 + 49297) % 233280;
      const j = Math.abs(h) % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [candidates]);

  const fetchCandidates = useCallback(async () => {
    try {
      const fp = getFingerprint();
      const data = await fetch(`/api/vote?fingerprint=${encodeURIComponent(fp)}`).then((r) => r.json());
      setCandidates(data.candidates || []);
      if (data.voted) {
        setHasVoted(true);
        setVotedId(data.voted_candidate_id);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const handleVote = async (candidateId: number) => {
    if (hasVoted || voting) return;
    setVoting(true);
    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_id: candidateId,
          fingerprint: getFingerprint(),
        }),
      });
      if (res.ok) {
        setHasVoted(true);
        setVotedId(candidateId);
        await fetchCandidates();
      } else {
        const data = await res.json();
        if (data.error?.includes("already")) {
          setHasVoted(true);
          await fetchCandidates();
        }
      }
    } catch {
      // silent
    } finally {
      setVoting(false);
    }
  };

  return (
    <section id="vote" className="py-20 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto" ref={ref}>
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight gradient-text mb-2">
            VOTE
          </h2>
          <div className="section-divider max-w-[200px] mx-auto" />
        </motion.div>

        <motion.div
          className="card p-6 sm:p-8 max-w-md mx-auto"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {/* BOOMくん */}
          <div className="flex justify-center mb-6">
            <motion.div
              className="w-24 h-24 relative"
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <Image
                src="/images/boomkun.png"
                alt="BOOMくん"
                fill
                className="object-contain"
              />
            </motion.div>
          </div>

          <h3 className="text-center text-lg font-bold text-white mb-2">
            キャラクターの名前を決めよう!
          </h3>
          <p className="text-[12px] leading-relaxed text-white/70 mb-5 px-1">
            BOOMくんと呼ばれているこのキャラクター、実は<strong className="text-white">正式名称がまだありません</strong>。事前に Instagram で名前を募集し、寄せられた候補から残った 4つ を、今日この会場の皆さんと一緒に決めていきます。あなたの一票が、この子の名前になります 🎉
          </p>

          {!hasVoted ? (
            <div className="grid grid-cols-2 gap-3">
              {shuffledCandidates.map((candidate, i) => (
                <motion.button
                  key={candidate.id}
                  onClick={() => setPendingCandidate(candidate)}
                  disabled={voting}
                  className="py-4 px-3 rounded-xl text-sm font-bold transition-all bg-[var(--bg-secondary)] border border-[var(--border-color)] text-white hover:border-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 disabled:opacity-50 leading-tight"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={isInView ? { opacity: 1, scale: 1 } : {}}
                  transition={{ duration: 0.4, delay: 0.2 + i * 0.08 }}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                >
                  {candidate.name}
                </motion.button>
              ))}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="rounded-2xl p-6 text-center"
              style={{
                background: "linear-gradient(135deg, rgba(242,122,26,0.18), rgba(220,76,4,0.12))",
                border: "1px solid rgba(242,122,26,0.4)",
              }}
            >
              <Heart size={28} className="mx-auto mb-2" style={{ color: "#f27a1a", fill: "#f27a1a" }} />
              <p className="text-[11px] tracking-widest uppercase font-bold mb-2" style={{ color: "#ffb37a" }}>
                あなたが選んだ名前
              </p>
              <p className="text-2xl font-black text-white leading-tight">
                {candidates.find((c) => c.id === votedId)?.name ?? "—"}
              </p>
              <p className="text-[11px] text-white/60 mt-3">
                投票ありがとうございます！結果はMCから発表します🎤
              </p>
            </motion.div>
          )}
        </motion.div>

        {/* 投票確定の確認ダイアログ */}
        <AnimatePresence>
          {pendingCandidate && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center px-4"
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !voting && setPendingCandidate(null)} />
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="relative bg-white rounded-3xl w-full max-w-sm p-6 text-center"
              >
                <p className="text-xs text-gray-500 mb-2 font-bold tracking-widest">投票確認</p>
                <p className="text-sm text-gray-700 mb-3">本当にこの名前でOKですか？</p>
                <div className="rounded-xl py-4 px-3 mb-5"
                  style={{ background: "linear-gradient(135deg,#fff7ed,#ffedd5)", border: "2px solid #f27a1a" }}>
                  <p className="text-xl font-black" style={{ color: "#dc4c04" }}>
                    {pendingCandidate.name}
                  </p>
                </div>
                <p className="text-[11px] text-gray-500 mb-5 leading-relaxed">
                  ⚠️ 投票は <strong>1人1回のみ</strong> です。あとから変更できません。
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPendingCandidate(null)}
                    disabled={voting}
                    className="flex-1 py-3 rounded-full text-sm font-bold disabled:opacity-50"
                    style={{ background: "#f3f4f6", color: "#666" }}
                  >
                    <X size={14} className="inline mr-1 -mt-0.5" />
                    キャンセル
                  </button>
                  <button
                    onClick={async () => {
                      const id = pendingCandidate.id;
                      await handleVote(id);
                      setPendingCandidate(null);
                    }}
                    disabled={voting}
                    className="flex-[1.5] py-3 rounded-full text-sm font-bold text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg,#f27a1a,#dc4c04)" }}
                  >
                    <Check size={14} className="inline mr-1 -mt-0.5" />
                    {voting ? "投票中..." : "この名前で投票"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {candidates.length === 0 && (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <Star className="mx-auto mb-3 opacity-50" size={32} />
            <p className="text-sm">投票準備中...</p>
          </div>
        )}
      </div>
    </section>
  );
}
