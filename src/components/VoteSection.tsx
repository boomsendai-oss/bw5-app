"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion, useInView } from "framer-motion";
import { Star } from "lucide-react";
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

  const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
  const maxVotes = Math.max(...candidates.map((c) => c.votes), 1);

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
                  onClick={() => handleVote(candidate.id)}
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
            <div className="space-y-4">
              {candidates.map((candidate, i) => {
                const pct = totalVotes > 0 ? (candidate.votes / totalVotes) * 100 : 0;
                const barWidth = maxVotes > 0 ? (candidate.votes / maxVotes) * 100 : 0;
                const isMyVote = candidate.id === votedId;
                return (
                  <motion.div
                    key={candidate.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.1 }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-sm font-bold ${
                          isMyVote
                            ? "text-[var(--accent-primary)]"
                            : "text-white"
                        }`}
                      >
                        {candidate.name}
                        {isMyVote && (
                          <span className="ml-2 text-xs text-[var(--accent-secondary)]">
                            (あなたの投票)
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)] font-mono">
                        {candidate.votes}票 ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${
                          isMyVote
                            ? "bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)]"
                            : "bg-[var(--text-muted)]"
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${barWidth}%` }}
                        transition={{ duration: 1, delay: i * 0.15, ease: "easeOut" }}
                      />
                    </div>
                  </motion.div>
                );
              })}
              <p className="text-center text-xs text-[var(--text-muted)] mt-4">
                合計 {totalVotes} 票
              </p>
            </div>
          )}
        </motion.div>

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
