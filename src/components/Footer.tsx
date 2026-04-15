export default function Footer() {
  return (
    <footer className="pb-24 pt-12 px-4 text-center">
      <div className="section-divider max-w-[300px] mx-auto mb-8" />
      <div className="space-y-2">
        <p className="text-sm font-bold tracking-widest text-[var(--text-secondary)]">
          BOOM Dance School
        </p>
        <a
          href="https://boom-sendai.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] transition-colors"
        >
          boom-sendai.com
        </a>
        <p className="text-xs text-[var(--text-muted)]">
          &copy; 2026 BOOM Dance School. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
