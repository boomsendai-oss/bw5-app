// 当日オペの画面はどれもDBを見に行くので、押してから出るまで一瞬間が空く。
// その間なにも変わらないと「押せていない」と思って二度押ししてしまう
// (TARO実機 2026-09-16「1回ピッと押しても反応しなくて、もう1回押せば戻る」)。
// この仮表示を置くと、タップした瞬間に画面が切り替わる。
export default function CrewLoading() {
  return (
    <div className="mx-auto max-w-xl p-4" aria-busy="true">
      <div className="mt-4 h-4 w-40 animate-pulse rounded bg-sand-200" />
      <div className="mt-3 h-7 w-56 animate-pulse rounded bg-sand-200" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-sand-200/70" />
        ))}
      </div>
      <p className="mt-6 text-center text-sm font-bold text-neutral-500">読み込み中…</p>
    </div>
  );
}
