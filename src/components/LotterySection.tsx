'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gift, X, Check, Loader2 } from 'lucide-react';

interface LotteryStatus {
  active: boolean;
  visible: boolean;
  prize_name: string;
  prize_image: string;
  winners_count: number;
  winners_cap: number;
  sold_out: boolean;
  probability: number;
  entry: {
    won: number;
    prize_name: string;
    prize_tier?: 'normal' | 'jackpot';
    winner_name?: string;
    created_at: string;
  } | null;
}

function getFingerprint(): string {
  if (typeof window === 'undefined') return '';
  let fp = localStorage.getItem('bw5_fp');
  if (!fp) {
    fp = `${Date.now()}_${Math.random().toString(36).slice(2)}_${navigator.userAgent.slice(0, 20)}`;
    localStorage.setItem('bw5_fp', fp);
  }
  return fp;
}

type Phase = 'idle' | 'spinning' | 'reveal';

export default function LotterySection() {
  const [status, setStatus] = useState<LotteryStatus | null>(null);
  const [keyword, setKeyword] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [pendingResult, setPendingResult] = useState<{
    won: boolean;
    prize_name: string;
    prize_tier?: 'normal' | 'jackpot';
    error?: string;
  } | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [winnerName, setWinnerName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const fingerprint = typeof window !== 'undefined' ? getFingerprint() : '';

  // Persist result locally so even if backend state changes, user keeps their result
  const fetchStatus = useCallback(() => {
    fetch(`/api/lottery?fingerprint=${encodeURIComponent(fingerprint)}`)
      .then((r) => r.json())
      .then((data) => {
        // Restore from localStorage if present and no DB entry
        if (typeof window !== 'undefined') {
          try {
            const saved = localStorage.getItem('bw5_lottery_entry');
            if (saved && !data.entry) {
              const parsed = JSON.parse(saved);
              data.entry = parsed;
            }
            // Save current to localStorage
            if (data.entry) {
              localStorage.setItem('bw5_lottery_entry', JSON.stringify(data.entry));
            }
          } catch {}
        }
        setStatus(data);
        if (data.entry?.winner_name) setNameSaved(true);
      })
      .catch(() => {});
  }, [fingerprint]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // インラインエラー（コード違い・開始前など、ルーレットを回さずに表示）
  const [inlineError, setInlineError] = useState<string>('');

  // Submit:
  //   ① まず API に問い合わせ → エラー（コード違い・時間外）はその場で表示してルーレット回さない
  //   ② OK ならルーレット開始 → 1.8s保持して STOP ボタン表示
  const submit = async () => {
    if (!keyword.trim() || phase !== 'idle') return;
    setInlineError('');

    // ?stage= をそのままサーバーに引き渡してプレビュー時はゲートをバイパス
    const stage = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('stage')
      : null;
    const url = stage ? `/api/lottery?stage=${encodeURIComponent(stage)}` : '/api/lottery';

    let apiData: { won: boolean; prize_name: string; prize_tier?: 'normal' | 'jackpot'; error?: string; reason?: string } | null = null;
    let apiOk = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint, keyword: keyword.trim() }),
      });
      apiData = await res.json();
      apiOk = res.ok;
    } catch {
      setInlineError('通信エラーが発生しました');
      return;
    }

    if (!apiOk) {
      const reason = apiData?.reason;
      if (reason === 'not_started') {
        setInlineError('抽選はまだ開始できません(5/5 14:30 開始予定)');
      } else if (reason === 'wrong_keyword') {
        setInlineError('シークレットコードが違います');
      } else {
        setInlineError(apiData?.error || 'エラーが発生しました');
      }
      return;
    }

    // 成功 → ルーレットを回す
    setPhase('spinning');
    setPendingResult(null);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    setPendingResult({
      won: apiData!.won,
      prize_name: apiData!.prize_name,
      prize_tier: apiData!.prize_tier,
    });
  };

  // User taps STOP: reveal result
  const stopSpin = () => {
    if (phase !== 'spinning' || !pendingResult) return;
    setPhase('reveal');
    setResultOpen(true);
    fetchStatus();
  };

  const closeResult = () => {
    setResultOpen(false);
    setPhase('idle');
    setKeyword('');
  };

  const saveName = async () => {
    if (!winnerName.trim() || savingName) return;
    setSavingName(true);
    try {
      const res = await fetch('/api/lottery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint, winner_name: winnerName.trim() }),
      });
      if (res.ok) {
        setNameSaved(true);
        fetchStatus();
      }
    } finally {
      setSavingName(false);
    }
  };

  if (!status || !status.visible) return null;

  const alreadyEntered = !!status.entry;
  const canSubmit = status.active && !alreadyEntered && phase === 'idle';

  return (
    <section id="lottery" className="py-12 px-4 sm:px-6 relative">
      <div className="max-w-md mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="rounded-3xl overflow-hidden relative"
          style={{
            background: 'linear-gradient(135deg, rgba(242,122,26,0.95), rgba(220,76,4,0.95))',
            boxShadow: '0 20px 60px rgba(220,76,4,0.4)',
          }}
        >
          <div className="absolute inset-0 pointer-events-none opacity-30">
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute"
                style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
                animate={{ scale: [0.5, 1, 0.5], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 2 + Math.random() * 2, repeat: Infinity, delay: Math.random() * 2 }}
              >
                ✨
              </motion.div>
            ))}
          </div>

          <div className="relative px-6 py-7">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
              <Gift size={20} className="text-white" />
              <h2 className="text-2xl font-black text-white tracking-tight">プレゼント企画</h2>
            </div>

            {/* SECRET prize card */}
            <div className="rounded-2xl overflow-hidden mb-5" style={{ background: 'rgba(255,255,255,0.95)' }}>
              <div
                className="relative w-full flex items-center justify-center"
                style={{
                  aspectRatio: '4 / 3',
                  background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                  overflow: 'hidden',
                }}
              >
                <div className="absolute inset-0 pointer-events-none">
                  {[...Array(20)].map((_, i) => (
                    <motion.span
                      key={i}
                      className="absolute"
                      style={{
                        left: `${Math.random() * 100}%`,
                        top: `${Math.random() * 100}%`,
                        fontSize: `${10 + Math.random() * 14}px`,
                      }}
                      animate={{ opacity: [0, 1, 0], scale: [0.5, 1.2, 0.5] }}
                      transition={{ duration: 2 + Math.random() * 2, repeat: Infinity, delay: Math.random() * 2 }}
                    >
                      ✨
                    </motion.span>
                  ))}
                </div>
                <motion.div
                  animate={{ rotate: [0, 5, -5, 0] }}
                  transition={{ duration: 4, repeat: Infinity }}
                  className="relative z-10 text-7xl"
                >
                  🎁
                </motion.div>
                <div className="absolute bottom-3 left-0 right-0 text-center">
                  <div
                    className="inline-block px-3 py-1 rounded-full text-[10px] font-black tracking-[0.2em] text-orange-300"
                    style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(242,122,26,0.5)' }}
                  >
                    ??? SECRET ???
                  </div>
                </div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[10px] font-bold tracking-widest uppercase text-orange-600">PRIZE</div>
                <div className="text-base font-black text-gray-900 mt-0.5">当日のお楽しみ 🤫</div>
              </div>
            </div>

            {/* Already entered states */}
            {alreadyEntered ? (
              <div
                className="rounded-2xl px-4 py-4 text-center"
                style={{ background: status.entry!.won === 1 ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.2)' }}
              >
                {status.entry!.won === 1 ? (
                  <>
                    {status.entry!.prize_tier === 'jackpot' ? (
                      <div className="text-3xl mb-2">🎊</div>
                    ) : (
                      <div className="text-3xl mb-2">🎉</div>
                    )}
                    <div className="text-base font-black text-orange-600">
                      {status.entry!.prize_tier === 'jackpot' ? '🎊 大当たり！ 🎊' : '当選！'}
                    </div>
                    <div className="text-sm text-gray-800 mt-1 leading-relaxed">「{status.entry!.prize_name}」</div>
                    {status.entry!.prize_tier !== 'jackpot' && (
                      <div className="text-[10px] text-gray-500 mt-0.5">※非売品 / 当選者特典</div>
                    )}

                    {/* Name input for picking up the prize */}
                    {!nameSaved ? (
                      <div className="mt-4 text-left">
                        <label className="text-[10px] font-bold text-gray-700 mb-1 block tracking-wider uppercase">
                          物販ブースで提示するお名前
                        </label>
                        <input
                          type="text"
                          value={winnerName}
                          onChange={(e) => setWinnerName(e.target.value)}
                          placeholder="お名前を入力"
                          className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800"
                          maxLength={50}
                        />
                        <button
                          onClick={saveName}
                          disabled={!winnerName.trim() || savingName}
                          className="w-full mt-2 py-2.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                          style={{ background: '#dc4c04' }}
                        >
                          {savingName ? '送信中…' : '当選者の名前を送信'}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="mt-3 px-3 py-2.5 rounded-lg flex items-center justify-center gap-2"
                        style={{ background: '#fff7ed' }}
                      >
                        <Check size={14} className="text-orange-600" />
                        <span className="text-xs font-bold text-orange-600">
                          {status.entry!.winner_name || winnerName} さんで登録済
                        </span>
                      </div>
                    )}
                    <div className="text-[10px] text-gray-500 mt-3">
                      物販ブースでお名前をお伝えください
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-2xl mb-1">😢</div>
                    <div className="text-sm font-bold text-white/80">またのチャンスをお楽しみに</div>
                  </>
                )}
              </div>
            ) : status.sold_out ? (
              <div className="rounded-2xl px-4 py-4 text-center" style={{ background: 'rgba(0,0,0,0.2)' }}>
                <div className="text-sm font-bold text-white">完売しました</div>
              </div>
            ) : !status.active ? (
              <div className="rounded-2xl px-4 py-4 text-center" style={{ background: 'rgba(0,0,0,0.2)' }}>
                <div className="text-sm font-bold text-white">受付待機中</div>
                <div className="text-[11px] text-white/70 mt-1">MCの合図でキーワードを発表します！</div>
              </div>
            ) : phase === 'spinning' ? (
              <SpinningView pendingReady={!!pendingResult} onStop={stopSpin} />
            ) : (
              <>
                <div className="mb-3">
                  <label className="text-[11px] font-bold text-white/80 mb-1 block tracking-wider uppercase">
                    シークレットコード
                  </label>
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => { setKeyword(e.target.value); if (inlineError) setInlineError(''); }}
                    placeholder="シークレットコードを入力"
                    className="w-full px-4 py-3 rounded-xl text-base font-bold text-gray-900 outline-none"
                    style={{ background: 'rgba(255,255,255,0.95)' }}
                    autoComplete="off"
                  />
                </div>

                {inlineError && (
                  <div className="rounded-xl px-3 py-2.5 text-xs font-bold"
                    style={{ background: 'rgba(255,255,255,0.95)', color: '#dc4c04', border: '2px solid #fbbf24' }}>
                    ⚠️ {inlineError}
                  </div>
                )}

                <button
                  onClick={submit}
                  disabled={!canSubmit || !keyword.trim()}
                  className="w-full py-4 rounded-xl text-base font-black transition-all"
                  style={{
                    background: canSubmit && keyword.trim() ? '#fff' : 'rgba(255,255,255,0.5)',
                    color: '#dc4c04',
                    boxShadow: canSubmit && keyword.trim() ? '0 6px 20px rgba(0,0,0,0.2)' : 'none',
                    cursor: canSubmit && keyword.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  🎯 スタート
                </button>
              </>
            )}
          </div>
        </motion.div>
      </div>

      {/* Result modal */}
      <AnimatePresence>
        {resultOpen && pendingResult && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center px-6"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeResult}
          >
            <motion.div
              className="rounded-3xl overflow-hidden max-w-sm w-full text-center relative"
              style={{
                background: pendingResult.error
                  ? 'linear-gradient(135deg, #555, #333)'
                  : pendingResult.prize_tier === 'jackpot'
                  ? 'linear-gradient(135deg, #ff006e, #ffbe0b, #ff006e)'
                  : pendingResult.won
                  ? 'linear-gradient(135deg, #FFD700, #FF8C00)'
                  : 'linear-gradient(135deg, #555, #333)',
              }}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={closeResult}
                className="absolute top-3 right-3 z-10 p-1 rounded-full"
                style={{ background: 'rgba(0,0,0,0.3)' }}
              >
                <X size={16} className="text-white" />
              </button>

              {/* Sparkle layer for jackpot */}
              {pendingResult.prize_tier === 'jackpot' && (
                <div className="absolute inset-0 pointer-events-none">
                  {[...Array(30)].map((_, i) => (
                    <motion.span
                      key={i}
                      className="absolute"
                      style={{
                        left: `${Math.random() * 100}%`,
                        top: `${Math.random() * 100}%`,
                        fontSize: `${12 + Math.random() * 18}px`,
                      }}
                      animate={{ opacity: [0, 1, 0], scale: [0.5, 1.4, 0.5], rotate: [0, 360] }}
                      transition={{ duration: 1.5 + Math.random() * 1.5, repeat: Infinity, delay: Math.random() }}
                    >
                      {['✨', '🎉', '⭐', '💫', '🎊'][i % 5]}
                    </motion.span>
                  ))}
                </div>
              )}

              {/* Prize image header */}
              {pendingResult.won && (
                <div className="relative w-full" style={{ aspectRatio: '4 / 3', background: 'rgba(0,0,0,0.15)' }}>
                  {pendingResult.prize_tier === 'jackpot' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <motion.div
                        animate={{ scale: [0.9, 1.1, 0.9], rotate: [-3, 3, -3] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="text-7xl"
                      >
                        🎁
                      </motion.div>
                      <div className="mt-2 text-3xl font-black tracking-widest"
                        style={{
                          color: '#fff',
                          textShadow: '0 4px 12px rgba(0,0,0,0.4), 0 0 20px rgba(255,255,255,0.5)',
                        }}
                      >
                        JACKPOT!
                      </div>
                    </div>
                  ) : (
                    <img
                      src="/merch/kirakira_boomkun.png"
                      alt="きらきらシール BOOMくん"
                      className="absolute inset-0 w-full h-full"
                      style={{ objectFit: 'contain', background: '#fff' }}
                    />
                  )}
                </div>
              )}

              <div className="px-6 py-7 relative">
                {!pendingResult.won && (
                  <div className="text-6xl mb-3">{pendingResult.error ? '⚠️' : '😢'}</div>
                )}
                <div className="text-3xl font-black text-white mb-2"
                  style={pendingResult.prize_tier === 'jackpot' ? { textShadow: '0 0 20px rgba(255,255,255,0.6)' } : {}}
                >
                  {pendingResult.error
                    ? 'エラー'
                    : pendingResult.prize_tier === 'jackpot'
                    ? '🎊 大当たり！ 🎊'
                    : pendingResult.won
                    ? '🎉 当選！ 🎉'
                    : 'はずれ'}
                </div>
                {pendingResult.won && (
                  <div className="text-sm text-white mt-2 font-bold leading-relaxed px-2">
                    {pendingResult.prize_name}
                  </div>
                )}
                <div className="text-xs text-white/90 mt-3">
                  {pendingResult.error || (pendingResult.won
                    ? pendingResult.prize_tier === 'jackpot'
                      ? '物販ブースで好きなアイテム1つ選んでね！'
                      : 'おめでとうございます！'
                    : 'またのチャンスをお楽しみに')}
                </div>
                {pendingResult.won && (
                  <div className="mt-5 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.25)' }}>
                    <div className="text-[11px] font-bold text-white mb-2">
                      続いてお名前を入力してください 👇
                    </div>
                    <button
                      onClick={closeResult}
                      className="w-full py-2 rounded-lg text-xs font-black"
                      style={{ background: '#fff', color: '#dc4c04' }}
                    >
                      次へ →
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// Spinning roulette view with stop button
function SpinningView({ pendingReady, onStop }: { pendingReady: boolean; onStop: () => void }) {
  const items = ['🎁', '🎰', '🎉', '✨', '🍀', '⭐', '💎', '🎲'];
  return (
    <div className="rounded-2xl p-5 text-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div className="text-[10px] font-bold tracking-widest uppercase text-yellow-300 mb-3">
        🎰 抽選中... 🎰
      </div>

      {/* Spinning emoji wheel */}
      <div
        className="relative h-24 mx-auto rounded-2xl overflow-hidden mb-4"
        style={{
          width: 200,
          background: '#fff',
          border: '3px solid #fbbf24',
          boxShadow: '0 0 30px rgba(251,191,36,0.6), inset 0 4px 12px rgba(0,0,0,0.1)',
        }}
      >
        <motion.div
          className="absolute inset-y-0 left-0 flex items-center"
          animate={{ x: ['-50%', '0%', '-50%'] }}
          transition={{ duration: 0.6, repeat: Infinity, ease: 'linear' }}
        >
          {[...items, ...items, ...items].map((e, i) => (
            <span key={i} className="mx-3 text-4xl select-none">
              {e}
            </span>
          ))}
        </motion.div>
        {/* Highlight bar in center */}
        <div
          className="absolute top-0 bottom-0 left-1/2 w-1 -translate-x-1/2 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, #f59e0b, transparent)' }}
        />
      </div>

      <button
        onClick={onStop}
        disabled={!pendingReady}
        className="w-full py-4 rounded-xl text-base font-black transition-all flex items-center justify-center gap-2"
        style={{
          background: pendingReady ? '#fff' : 'rgba(255,255,255,0.4)',
          color: '#dc4c04',
          boxShadow: pendingReady ? '0 6px 20px rgba(0,0,0,0.3)' : 'none',
          cursor: pendingReady ? 'pointer' : 'wait',
        }}
      >
        {pendingReady ? (
          <>🛑 STOP！</>
        ) : (
          <>
            <Loader2 size={16} className="animate-spin" />
            準備中…
          </>
        )}
      </button>
      <div className="text-[10px] text-white/50 mt-2">
        STOP ボタンを押すと結果発表
      </div>
    </div>
  );
}
