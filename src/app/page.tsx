'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import {
  FaYoutube, FaInstagram, FaLine, FaXTwitter,
  FaApple, FaSpotify, FaAmazon, FaPlay,
  FaChevronLeft, FaChevronRight, FaArrowUp,
  FaShoppingCart, FaVideo, FaMusic, FaCalendarDays,
  FaBookOpen, FaStar, FaShareNodes, FaCheck,
  FaLocationDot, FaClock
} from 'react-icons/fa6';

/* ============================
   Types
   ============================ */
interface ScheduleItem {
  id: number; time: string; title: string; description: string; sort_order: number;
}
interface MerchItem {
  id: number; name: string; price: number; image_url: string; stock: number; description: string;
}
interface VoteCandidate {
  id: number; name: string; votes: number;
}
interface MusicRelease {
  id: number; artist: string; title: string; jacket_url: string;
  apple_music_url: string; spotify_url: string; amazon_music_url: string; youtube_music_url: string;
  release_at: string;
}
interface SnsLink {
  id: number; platform: string; url: string;
}
interface PamphletPage {
  id: number; image_url: string; sort_order: number;
}

/* ============================
   Animation Variants
   ============================ */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: 'easeOut' } },
};

/* ============================
   Section Wrapper
   ============================ */
function Section({ id, children, className = '' }: { id: string; children: React.ReactNode; className?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.section
      id={id}
      ref={ref}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      variants={stagger}
      className={`relative py-16 sm:py-20 px-4 sm:px-6 ${className}`}
    >
      {children}
    </motion.section>
  );
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <motion.div variants={fadeUp} className="text-center mb-10 sm:mb-14">
      <h2 className="font-display text-4xl sm:text-5xl md:text-6xl tracking-wider gradient-text inline-block">
        {children}
      </h2>
      {sub && <p className="mt-2 text-sm sm:text-base text-[var(--text-secondary)]">{sub}</p>}
      <div className="mt-4 mx-auto w-16 h-0.5 bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] rounded-full" />
    </motion.div>
  );
}

/* ============================
   Fingerprint (simple)
   ============================ */
function getFingerprint(): string {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem('bw5_fp');
  if (stored) return stored;
  const nav = window.navigator;
  const raw = [
    nav.userAgent,
    nav.language,
    screen.width, screen.height, screen.colorDepth,
    new Date().getTimezoneOffset(),
    nav.hardwareConcurrency || '',
    (nav as unknown as { deviceMemory?: number }).deviceMemory || '',
  ].join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  const fp = 'fp_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
  localStorage.setItem('bw5_fp', fp);
  return fp;
}

/* ============================
   Main Page
   ============================ */
export default function Home() {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [merch, setMerch] = useState<MerchItem[]>([]);
  const [votes, setVotes] = useState<VoteCandidate[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [votedFor, setVotedFor] = useState<number | null>(null);
  const [music, setMusic] = useState<MusicRelease[]>([]);
  const [sns, setSns] = useState<SnsLink[]>([]);
  const [pamphlet, setPamphlet] = useState<PamphletPage[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [pamphletPage, setPamphletIdx] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [activeNav, setActiveNav] = useState('hero');
  const [menuOpen, setMenuOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [schedRes, merchRes, musicRes, snsRes, settingsRes, pamRes] = await Promise.all([
        fetch('/api/schedule').then(r => r.json()),
        fetch('/api/merch').then(r => r.json()),
        fetch('/api/music').then(r => r.json()),
        fetch('/api/sns').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/pamphlet').then(r => r.json()).catch(() => []),
      ]);
      setSchedule(schedRes);
      if (Array.isArray(merchRes)) setMerch(merchRes);
      else if (merchRes.items) setMerch(merchRes.items);
      setMusic(musicRes);
      setSns(snsRes);
      setSettings(settingsRes);
      if (Array.isArray(pamRes)) setPamphlet(pamRes);
    } catch (e) {
      console.error('Fetch error:', e);
    }
  }, []);

  const fetchVotes = useCallback(async () => {
    const fp = getFingerprint();
    const res = await fetch('/api/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check', fingerprint: fp }),
    });
    const data = await res.json();
    if (data.candidates) setVotes(data.candidates);
    if (data.voted) { setHasVoted(true); setVotedFor(data.voted_for); }
  }, []);

  useEffect(() => { fetchAll(); fetchVotes(); }, [fetchAll, fetchVotes]);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 500);
      const sections = ['hero', 'schedule', 'pamphlet', 'merch', 'video', 'music', 'vote', 'sns'];
      for (const sec of [...sections].reverse()) {
        const el = document.getElementById(sec);
        if (el && window.scrollY >= el.offsetTop - 200) {
          setActiveNav(sec);
          break;
        }
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleVote = async (candidateId: number) => {
    if (hasVoted) return;
    const fp = getFingerprint();
    const res = await fetch('/api/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vote', candidate_id: candidateId, fingerprint: fp }),
    });
    if (res.ok) {
      setHasVoted(true);
      setVotedFor(candidateId);
      fetchVotes();
    }
  };

  const totalVotes = votes.reduce((sum, v) => sum + v.votes, 0);
  const maxVotes = Math.max(...votes.map(v => v.votes), 1);

  const navItems = [
    { id: 'schedule', label: 'SCHEDULE', icon: <FaCalendarDays /> },
    { id: 'pamphlet', label: 'PAMPHLET', icon: <FaBookOpen /> },
    { id: 'merch', label: 'MERCH', icon: <FaShoppingCart /> },
    { id: 'video', label: 'VIDEO', icon: <FaVideo /> },
    { id: 'music', label: 'MUSIC', icon: <FaMusic /> },
    { id: 'vote', label: 'VOTE', icon: <FaStar /> },
    { id: 'sns', label: 'SNS', icon: <FaShareNodes /> },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-noise">
      {/* ===== Navigation ===== */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-strong">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="#hero" className="font-display text-xl tracking-widest gradient-text">
            BW5
          </a>
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(item => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`px-3 py-1.5 text-xs font-medium tracking-wider transition-colors rounded-full
                  ${activeNav === item.id ? 'text-[var(--accent-primary)] bg-[rgba(230,57,70,0.1)]' : 'text-[var(--text-secondary)] hover:text-white'}`}
              >
                {item.label}
              </a>
            ))}
          </div>
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden flex flex-col gap-1.5 p-2" aria-label="Menu">
            <span className={`w-5 h-0.5 bg-white transition-all duration-300 ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`w-5 h-0.5 bg-white transition-all duration-300 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`w-5 h-0.5 bg-white transition-all duration-300 ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="md:hidden overflow-hidden border-t border-[var(--border-color)]"
            >
              <div className="px-4 py-3 flex flex-col gap-1">
                {navItems.map(item => (
                  <a key={item.id} href={`#${item.id}`} onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors
                      ${activeNav === item.id ? 'text-[var(--accent-primary)] bg-[rgba(230,57,70,0.1)]' : 'text-[var(--text-secondary)]'}`}>
                    <span className="text-base">{item.icon}</span>
                    {item.label}
                  </a>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* ===== Hero ===== */}
      <section id="hero" className="relative min-h-[100svh] flex items-center justify-center hero-gradient overflow-hidden pt-14">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[var(--accent-primary)] opacity-[0.04] blur-3xl" />
          <div className="absolute -bottom-48 -left-48 w-[500px] h-[500px] rounded-full bg-[var(--accent-secondary)] opacity-[0.03] blur-3xl" />
          <div className="absolute top-1/3 left-1/4 w-2 h-2 rounded-full bg-[var(--accent-primary)] opacity-30 animate-float" />
          <div className="absolute top-1/2 right-1/3 w-1.5 h-1.5 rounded-full bg-[var(--accent-secondary)] opacity-20 animate-float" style={{ animationDelay: '1s' }} />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
          <motion.div initial={{ opacity: 0, scale: 0.8, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }} className="mb-6">
            <Image src="/images/banner/bw5_hero.png" alt="BOOM WOP vol.5" width={700} height={394} priority
              className="mx-auto rounded-2xl shadow-2xl" style={{ maxWidth: '90vw', height: 'auto' }} />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.6 }}>
            <h1 className="font-display text-5xl sm:text-7xl md:text-8xl tracking-[0.15em] gradient-text leading-none">BOOM WOP</h1>
            <span className="font-display text-3xl sm:text-4xl md:text-5xl tracking-[0.2em] text-white/80 block mt-1">vol.5</span>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }} className="mt-6 space-y-2">
            <p className="font-display text-xl sm:text-2xl tracking-[0.3em] text-[var(--accent-secondary)]">2026.05.05 TUE</p>
            <div className="flex items-center justify-center gap-2 text-[var(--text-secondary)] text-sm sm:text-base">
              <FaLocationDot className="text-[var(--accent-primary)]" />
              <span>太白区文化センター 楽楽楽ホール</span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">仙台市太白区長町5-3-2</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.6 }} className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#schedule" className="btn-primary text-sm"><FaCalendarDays className="inline mr-2" />タイムスケジュール</a>
            <a href="#merch" className="btn-secondary text-sm"><FaShoppingCart className="inline mr-2" />物販コーナー</a>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mt-12">
            <div className="w-6 h-10 mx-auto border-2 border-white/20 rounded-full flex items-start justify-center p-1">
              <motion.div animate={{ y: [0, 16, 0] }} transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
                className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
            </div>
          </motion.div>
        </div>
      </section>

      <div className="section-divider" />

      {/* ===== Schedule ===== */}
      <Section id="schedule" className="section-gradient">
        <div className="max-w-3xl mx-auto">
          <SectionTitle sub="出演プログラム 全23演目">PROGRAM</SectionTitle>
          <motion.div variants={fadeUp} className="space-y-2">
            {schedule.map((item, i) => {
              const parts = item.title.split(' / ');
              const className_ = parts[0] || item.title;
              const instructor = parts[1] || '';
              return (
                <motion.div key={item.id} variants={fadeUp}
                  className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-[rgba(230,57,70,0.2)] transition-all group">
                  <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-[var(--accent-primary)] to-[var(--accent-secondary)] flex items-center justify-center font-display text-lg sm:text-xl text-white">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm sm:text-base text-white truncate">{className_}</p>
                    {instructor && <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">{instructor}</p>}
                  </div>
                  {item.time && (
                    <div className="flex-shrink-0 flex items-center gap-1 text-xs sm:text-sm text-[var(--accent-secondary)] font-medium">
                      <FaClock className="text-xs" />{item.time}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </Section>

      <div className="section-divider" />

      {/* ===== Pamphlet ===== */}
      {pamphlet.length > 0 && (
        <>
          <Section id="pamphlet">
            <div className="max-w-3xl mx-auto">
              <SectionTitle sub="デジタルパンフレット">PAMPHLET</SectionTitle>
              <motion.div variants={fadeUp} className="relative">
                <div className="relative aspect-[3/4] sm:aspect-[4/3] rounded-2xl overflow-hidden bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <AnimatePresence mode="wait">
                    <motion.div key={pamphletPage} initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -50 }} transition={{ duration: 0.3 }} className="absolute inset-0">
                      <Image src={pamphlet[pamphletPage]?.image_url || ''} alt={`Page ${pamphletPage + 1}`}
                        fill className="object-contain" />
                    </motion.div>
                  </AnimatePresence>
                </div>
                {pamphlet.length > 1 && (
                  <div className="flex items-center justify-center gap-4 mt-4">
                    <button onClick={() => setPamphletIdx(Math.max(0, pamphletPage - 1))} disabled={pamphletPage === 0}
                      className="btn-icon disabled:opacity-30"><FaChevronLeft /></button>
                    <span className="text-sm text-[var(--text-secondary)] font-medium">{pamphletPage + 1} / {pamphlet.length}</span>
                    <button onClick={() => setPamphletIdx(Math.min(pamphlet.length - 1, pamphletPage + 1))} disabled={pamphletPage === pamphlet.length - 1}
                      className="btn-icon disabled:opacity-30"><FaChevronRight /></button>
                  </div>
                )}
              </motion.div>
            </div>
          </Section>
          <div className="section-divider" />
        </>
      )}
      {pamphlet.length === 0 && <section id="pamphlet" className="py-0" />}

      {/* ===== Merch ===== */}
      <Section id="merch">
        <div className="max-w-5xl mx-auto">
          <SectionTitle sub="オリジナルグッズ">MERCHANDISE</SectionTitle>
          <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {merch.map(item => <MerchCard key={item.id} item={item} settings={settings} onPurchased={fetchAll} />)}
          </motion.div>
        </div>
      </Section>

      <div className="section-divider" />

      {/* ===== Video ===== */}
      <Section id="video" className="section-gradient">
        <div className="max-w-2xl mx-auto">
          <SectionTitle sub="映像データ予約販売">VIDEO DATA</SectionTitle>
          <VideoSection settings={settings} />
        </div>
      </Section>

      <div className="section-divider" />

      {/* ===== Music ===== */}
      <Section id="music">
        <div className="max-w-3xl mx-auto">
          <SectionTitle sub="音源リリース情報">MUSIC</SectionTitle>
          <motion.div variants={stagger} className="space-y-6">
            {music.map(release => <MusicCard key={release.id} release={release} />)}
          </motion.div>
          {music.length === 0 && (
            <motion.p variants={fadeUp} className="text-center text-[var(--text-muted)] text-sm">Coming Soon...</motion.p>
          )}
        </div>
      </Section>

      <div className="section-divider" />

      {/* ===== Vote ===== */}
      <Section id="vote" className="section-gradient">
        <div className="max-w-2xl mx-auto">
          <SectionTitle sub="マスコットキャラクターの名前を投票しよう！">CHARACTER VOTE</SectionTitle>

          <motion.div variants={fadeUp} className="text-center mb-8">
            <div className="inline-block rounded-2xl overflow-hidden border-2 border-[var(--border-color)] shadow-lg">
              <Image src="/images/character/boomkun_2d.png" alt="BOOMくん" width={300} height={200} className="object-cover" />
            </div>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">この子の名前を決めよう！</p>
          </motion.div>

          <motion.div variants={stagger} className="space-y-4">
            {votes.map(candidate => {
              const pct = totalVotes > 0 ? Math.round((candidate.votes / totalVotes) * 100) : 0;
              const barWidth = maxVotes > 0 ? (candidate.votes / maxVotes) * 100 : 0;
              const isSelected = votedFor === candidate.id;
              return (
                <motion.div key={candidate.id} variants={fadeUp}>
                  <button onClick={() => handleVote(candidate.id)} disabled={hasVoted}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      isSelected ? 'border-[var(--accent-primary)] bg-[rgba(230,57,70,0.08)]'
                      : hasVoted ? 'border-[var(--border-color)] bg-[var(--bg-card)] opacity-80'
                      : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-card-hover)] cursor-pointer'
                    }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-base">{candidate.name}</span>
                        {isSelected && <span className="text-[var(--accent-primary)]"><FaCheck /></span>}
                      </div>
                      <span className="text-sm text-[var(--text-secondary)]">{candidate.votes}票 ({pct}%)</span>
                    </div>
                    <div className="w-full h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] transition-all duration-1000"
                        style={{ width: `${barWidth}%` }} />
                    </div>
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
          {hasVoted && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mt-4 text-sm text-[var(--accent-secondary)]">
              投票ありがとうございました！
            </motion.p>
          )}
          <motion.p variants={fadeUp} className="text-center mt-3 text-xs text-[var(--text-muted)]">
            ※ 1端末につき1回のみ投票できます
          </motion.p>
        </div>
      </Section>

      <div className="section-divider" />

      {/* ===== SNS ===== */}
      <Section id="sns">
        <div className="max-w-md mx-auto">
          <SectionTitle sub="BOOM Dance School をフォローしよう">SNS</SectionTitle>
          <motion.div variants={stagger} className="grid grid-cols-2 gap-4">
            {sns.map(link => <SnsButton key={link.id} link={link} />)}
          </motion.div>
        </div>
      </Section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-[var(--border-color)] py-8 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <p className="font-display text-2xl tracking-widest gradient-text mb-2">BOOM WOP vol.5</p>
          <p className="text-xs text-[var(--text-muted)] mb-1">2026.05.05 (TUE) | 太白区文化センター 楽楽楽ホール</p>
          <p className="text-xs text-[var(--text-muted)]">
            Presented by{' '}
            <a href="https://www.boom-sendai.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline">
              BOOM Dance School
            </a>
          </p>
          <div className="mt-4 flex justify-center gap-3">
            {sns.map(link => {
              const Icon = snsIconMap[link.platform] || FaShareNodes;
              return (
                <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer"
                  className="text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors text-lg">
                  <Icon />
                </a>
              );
            })}
          </div>
        </div>
      </footer>

      {/* Scroll to top */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-6 right-6 z-40 btn-icon glow-red !w-12 !h-12">
            <FaArrowUp />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================
   SNS Helpers
   ============================ */
const snsIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  youtube: FaYoutube, instagram: FaInstagram, line: FaLine, x: FaXTwitter,
};
const snsColors: Record<string, string> = {
  youtube: '#FF0000', instagram: '#E4405F', line: '#06C755', x: '#ffffff',
};
const snsLabels: Record<string, string> = {
  youtube: 'YouTube', instagram: 'Instagram', line: 'LINE', x: 'X (Twitter)',
};

function SnsButton({ link }: { link: SnsLink }) {
  const Icon = snsIconMap[link.platform] || FaShareNodes;
  const color = snsColors[link.platform] || '#fff';
  const label = snsLabels[link.platform] || link.platform;
  return (
    <motion.a variants={scaleIn} href={link.url} target="_blank" rel="noopener noreferrer"
      className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-[var(--border-hover)] transition-all group hover:scale-105">
      <Icon className="text-3xl transition-transform group-hover:scale-110" style={{ color }} />
      <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-white transition-colors">{label}</span>
    </motion.a>
  );
}

/* ============================
   Merch Card
   ============================ */
function MerchCard({ item, settings, onPurchased }: { item: MerchItem; settings: Record<string, string>; onPurchased: () => void }) {
  const [showPurchase, setShowPurchase] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [purchasing, setPurchasing] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const soldOut = item.stock <= 0;

  const handlePurchase = async (method: string) => {
    if (!buyerName.trim()) return;
    setPurchasing(true);
    try {
      if (method === 'paypay' && settings.paypay_link) window.open(settings.paypay_link, '_blank');
      const res = await fetch('/api/merchandise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purchase', merch_id: item.id, buyer_name: buyerName, payment_method: method }),
      });
      if (res.ok) {
        setPurchased(true);
        onPurchased();
        setTimeout(() => { setShowPurchase(false); setPurchased(false); setBuyerName(''); }, 2000);
      }
    } catch (e) { console.error(e); }
    setPurchasing(false);
  };

  return (
    <motion.div variants={scaleIn} className="card relative group">
      <div className="relative aspect-square bg-[var(--bg-secondary)] overflow-hidden">
        {item.image_url ? (
          <Image src={item.image_url} alt={item.name} fill className="object-cover transition-transform duration-500 group-hover:scale-110" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]"><FaShoppingCart className="text-4xl" /></div>
        )}
        {soldOut && <div className="sold-out-overlay"><span className="sold-out-text">SOLD OUT</span></div>}
        {!soldOut && <div className="absolute top-3 right-3"><span className="badge badge-success">残り {item.stock}</span></div>}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm sm:text-base mb-1 truncate">{item.name}</h3>
        {item.description && <p className="text-xs text-[var(--text-secondary)] mb-2 line-clamp-2">{item.description}</p>}
        <div className="flex items-center justify-between">
          <span className="font-display text-xl text-[var(--accent-secondary)]">¥{item.price.toLocaleString()}</span>
          {!soldOut && <button onClick={() => setShowPurchase(true)} className="btn-primary !py-2 !px-4 text-xs">購入する</button>}
        </div>
      </div>

      <AnimatePresence>
        {showPurchase && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => !purchasing && setShowPurchase(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-6">
              {purchased ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4"><FaCheck className="text-green-500 text-2xl" /></div>
                  <p className="font-semibold text-lg">ご予約完了！</p>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">当日会場でお渡しします</p>
                </div>
              ) : (
                <>
                  <h3 className="font-semibold text-lg mb-1">{item.name}</h3>
                  <p className="font-display text-2xl text-[var(--accent-secondary)] mb-4">¥{item.price.toLocaleString()}</p>
                  <input type="text" placeholder="お名前" value={buyerName} onChange={e => setBuyerName(e.target.value)} className="admin-input mb-4" />
                  <div className="space-y-2">
                    <button onClick={() => handlePurchase('card')} disabled={!buyerName.trim() || purchasing}
                      className="w-full btn-primary text-sm disabled:opacity-50">カード決済 (Square)</button>
                    <button onClick={() => handlePurchase('paypay')} disabled={!buyerName.trim() || purchasing}
                      className="w-full py-3 rounded-full text-sm font-semibold bg-[#FF0033] text-white hover:bg-[#E6002E] transition-colors disabled:opacity-50">
                      PayPay で支払う</button>
                  </div>
                  <button onClick={() => setShowPurchase(false)} className="w-full mt-3 py-2 text-sm text-[var(--text-secondary)] hover:text-white transition-colors">
                    キャンセル</button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ============================
   Video Section
   ============================ */
function VideoSection({ settings }: { settings: Record<string, string> }) {
  const [showForm, setShowForm] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState('');
  const [purchasing, setPurchasing] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const price = parseInt(settings.video_price || '2500');
  const active = settings.video_sale_active !== 'false';

  const handlePurchase = async (method: string) => {
    if (!buyerName.trim() || !email.trim()) return;
    setPurchasing(true);
    try {
      if (method === 'paypay' && settings.paypay_link) window.open(settings.paypay_link, '_blank');
      await fetch('/api/video-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purchase', buyer_name: buyerName, email, payment_method: method }),
      });
      setPurchased(true);
      setTimeout(() => { setShowForm(false); setPurchased(false); setBuyerName(''); setEmail(''); }, 3000);
    } catch (e) { console.error(e); }
    setPurchasing(false);
  };

  return (
    <motion.div variants={fadeUp}>
      <div className="card p-6 sm:p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--accent-primary)] to-[var(--accent-secondary)] flex items-center justify-center mx-auto mb-6 glow-red">
          <FaVideo className="text-3xl text-white" />
        </div>
        <h3 className="font-display text-3xl sm:text-4xl tracking-wider mb-2">VIDEO DATA</h3>
        <p className="text-[var(--text-secondary)] text-sm mb-4">BOOM WOP vol.5 発表会映像データ</p>
        <p className="font-display text-4xl text-[var(--accent-secondary)] mb-6">¥{price.toLocaleString()}</p>
        {active ? (
          !showForm ? (
            <button onClick={() => setShowForm(true)} className="btn-primary"><FaPlay className="inline mr-2" />予約購入する</button>
          ) : purchased ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="py-6">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4"><FaCheck className="text-green-500 text-2xl" /></div>
              <p className="font-semibold text-lg">ご予約ありがとうございます！</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">確認メールをお送りします</p>
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-sm mx-auto space-y-3">
              <input type="text" placeholder="お名前" value={buyerName} onChange={e => setBuyerName(e.target.value)} className="admin-input" />
              <input type="email" placeholder="メールアドレス" value={email} onChange={e => setEmail(e.target.value)} className="admin-input" />
              <button onClick={() => handlePurchase('card')} disabled={!buyerName.trim() || !email.trim() || purchasing}
                className="w-full btn-primary text-sm disabled:opacity-50">カード決済 (Square)</button>
              <button onClick={() => handlePurchase('paypay')} disabled={!buyerName.trim() || !email.trim() || purchasing}
                className="w-full py-3 rounded-full text-sm font-semibold bg-[#FF0033] text-white hover:bg-[#E6002E] transition-colors disabled:opacity-50">
                PayPay で支払う</button>
              <button onClick={() => setShowForm(false)} className="w-full py-2 text-sm text-[var(--text-secondary)] hover:text-white transition-colors">キャンセル</button>
            </motion.div>
          )
        ) : (
          <p className="text-[var(--text-muted)] text-sm">現在販売準備中です</p>
        )}
      </div>
    </motion.div>
  );
}

/* ============================
   Music Card
   ============================ */
function MusicCard({ release }: { release: MusicRelease }) {
  const now = new Date();
  const releaseTime = release.release_at ? new Date(release.release_at) : null;
  const isReleased = !releaseTime || now >= releaseTime;
  const links = [
    { url: release.apple_music_url, icon: FaApple, label: 'Apple Music', color: '#fc3c44' },
    { url: release.spotify_url, icon: FaSpotify, label: 'Spotify', color: '#1DB954' },
    { url: release.amazon_music_url, icon: FaAmazon, label: 'Amazon Music', color: '#25d1da' },
    { url: release.youtube_music_url, icon: FaYoutube, label: 'YouTube Music', color: '#FF0000' },
  ].filter(l => l.url);

  return (
    <motion.div variants={fadeUp} className="card p-5 flex gap-4 items-start">
      <div className="flex-shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[var(--bg-secondary)] relative">
        {release.jacket_url ? (
          <Image src={release.jacket_url} alt={release.title} fill className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]"><FaMusic className="text-2xl" /></div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--text-secondary)] mb-0.5">{release.artist}</p>
        <h3 className="font-semibold text-base sm:text-lg mb-3 truncate">{release.title}</h3>
        {isReleased ? (
          <div className="flex flex-wrap gap-2">
            {links.map(link => (
              <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--border-hover)] transition-all hover:scale-105"
                style={{ color: link.color }}>
                <link.icon className="text-sm" />{link.label}
              </a>
            ))}
            {links.length === 0 && <span className="text-xs text-[var(--text-muted)]">リンク準備中</span>}
          </div>
        ) : (
          <div className="coming-soon">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)] text-sm text-[var(--accent-secondary)]">
              <FaClock />Coming Soon
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
