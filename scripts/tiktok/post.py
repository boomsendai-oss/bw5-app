#!/usr/bin/env python3
"""
TikTokへリールを投稿する(Playwright)。

前提:
  - 先に `node scripts/tiktok/prepare.mjs` で job.json を作る
  - 先に `python3 scripts/tiktok/login.py` で一度ログインしておく

使い方:
    python3 scripts/tiktok/post.py scripts/tiktok/out/9/job.json            # 投稿する
    python3 scripts/tiktok/post.py scripts/tiktok/out/9/job.json --dry-run  # 投稿ボタンだけ押さない

--dry-run は「動画とカバーとキャプションを全部入れた状態」で止まる。
初回や仕様変更が疑われる時はこれで確認してから本番を撃つこと。

2026-08-10 の手作業で分かっている落とし穴を、そのまま実装に落としてある:
  - カバーは投稿後に変更できない → 必ず投稿前に入れる
  - キャプションはDraft.jsで、入力が二重に適用されることがある
    → 入れたあと必ず「正解と完全一致するか」を検証し、違えば直す
  - 投稿直後は「自分のみ・コンテンツ審査中」になることがある(新しめのアカウントの通常挙動)
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

USER_DATA_DIR = Path.home() / ".boom_tiktok_profile"
UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# 日本語UI / 英語UI どちらでも拾えるように両方持つ
T = {
    "uploaded": ["アップロード完了", "Uploaded"],
    "edit_cover": ["カバーを編集", "Edit cover"],
    "upload_cover": ["カバーをアップロード", "Upload cover"],
    "save": ["保存", "Save"],
    "post": ["投稿", "Post"],
    "cancel": ["キャンセル", "Cancel"],
}


def any_text(page, keys):
    """T[...] のどれかを含む可視要素を返す(無ければ None)"""
    for word in T[keys]:
        loc = page.locator(f"text={word}").first
        try:
            if loc.count() and loc.is_visible():
                return loc
        except Exception:
            pass
    return None


def click_button_in_dialog(page, dialog_words, button_words) -> bool:
    """モーダル内のボタンを、重なり要素に邪魔されずに押す。

    TikTokのモーダルは上にcanvas等が重なっていて通常のclick()が弾かれることがある。
    ボタン要素を特定してイベントを直接発火させる(手作業で確立した方法と同じ)。
    """
    return bool(page.evaluate(
        """([dialogWords, buttonWords]) => {
            const dlgs = [...document.querySelectorAll('[role="dialog"], .TUXModal, [class*="modal"]')];
            const dlg = dlgs.find(d => dialogWords.some(w => d.innerText.includes(w)));
            if (!dlg) return false;
            const btn = [...dlg.querySelectorAll('button')]
                .find(b => buttonWords.some(w => b.textContent.trim() === w));
            if (!btn) return false;
            ['pointerdown','mousedown','pointerup','mouseup','click']
                .forEach(t => btn.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true})));
            return true;
        }""",
        [dialog_words, button_words],
    ))


def dismiss_tour(page) -> bool:
    """TikTokの操作ガイド(react-joyride)を閉じる。

    初回表示の案内が画面全体にオーバーレイを敷くため、放置すると
    すべてのクリックが "overlay intercepts pointer events" で弾かれる。
    """
    return bool(page.evaluate(
        """() => {
            let acted = false;
            const skip = [...document.querySelectorAll('button')].find(b =>
                /スキップ|Skip|閉じる|Close|後で|Got it|わかりました/.test(b.textContent.trim()));
            if (skip) { skip.click(); acted = true; }
            document.querySelectorAll('#react-joyride-portal, .react-joyride__overlay')
                .forEach(el => { el.remove(); acted = true; });
            return acted;
        }"""
    ))


def dismiss_autocheck_dialog(page):
    """『コンテンツの自動チェックをオンにしますか？』はアカウント設定の変更なので必ず断る"""
    for word in T["cancel"]:
        btn = page.get_by_role("button", name=word)
        try:
            if btn.count() and btn.first.is_visible():
                btn.first.click()
                page.wait_for_timeout(600)
                return True
        except Exception:
            pass
    return False


def set_caption(page, caption: str) -> bool:
    """Draft.jsのエディタに入れる。二重適用されることがあるので一致するまで直す。"""
    ed = page.locator('[contenteditable="true"]').first
    ed.wait_for(state="visible", timeout=30_000)

    for attempt in range(4):
        ed.click()
        page.keyboard.press("Meta+A")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)
        # insert_text は1文字ずつ打たないので、# のオートコンプリートに邪魔されにくい
        ed.press_sequentially("", delay=0)  # フォーカス確定
        page.keyboard.insert_text(caption)
        page.wait_for_timeout(900)

        current = ed.inner_text()
        if " ".join(current.split()) == " ".join(caption.split()):
            # ハッシュタグの候補リストが開いたままだと、次のクリックで
            # 意図しないタグが入ることがある。必ず閉じてフォーカスも外す。
            # ⚠️ ここで座標クリックして閉じてはいけない。サイドバーに当たると
            #    「本当に終了しますか？」が出て作業が飛ぶ(2026-08-12に踏んだ)。
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            page.wait_for_timeout(500)
            return True
        print(f"  キャプションが一致しないので入れ直します (試行{attempt + 1}: "
              f"{len(current)}文字 / 正解{len(caption)}文字)")
    return False


def run(job_path: Path, dry_run: bool) -> int:
    job = json.loads(job_path.read_text(encoding="utf8"))
    video = Path(job["videoPath"])
    cover = Path(job["coverPath"])
    caption = job["caption"]
    for f, label in ((video, "動画"), (cover, "カバー")):
        if not f.exists():
            print(f"✗ {label}が見つかりません: {f}")
            return 1

    print(f"リール#{job['reelId']} {job['title']}")
    print(f"  動画   : {video.name} ({video.stat().st_size / 1e6:.1f}MB)")
    print(f"  カバー : {cover.name}")

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(USER_DATA_DIR),
            headless=False,          # 目視できるように常に表示。何か出たら人が気づける
            channel="chrome",
            user_agent=UA,
            viewport={"width": 1440, "height": 900},
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(UPLOAD_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            if "/login" in page.url:
                print("✗ ログインが切れています。python3 scripts/tiktok/login.py を先に実行してください")
                return 2

            # 1) 動画
            print("→ 動画をアップロード中…")
            page.locator('input[type="file"]').first.set_input_files(str(video))
            for _ in range(120):
                if any_text(page, "uploaded"):
                    break
                page.wait_for_timeout(1000)
            else:
                print("✗ アップロードが終わりませんでした")
                return 3
            print("  完了")
            dismiss_autocheck_dialog(page)
            dismiss_tour(page)
            page.wait_for_timeout(500)

            # 2) カバー(投稿後に変更できないので、ここで必ず入れる)
            print("→ カバーを設定中…")
            opened = page.evaluate(
                """(words) => {
                    const el = [...document.querySelectorAll('*')].find(e =>
                        e.children.length === 0 && words.includes(e.textContent.trim()));
                    if (!el) return false;
                    let b = el;
                    for (let i = 0; i < 5 && b; i++) {
                        if (b.tagName === 'BUTTON' || getComputedStyle(b).cursor === 'pointer') break;
                        b = b.parentElement;
                    }
                    ['pointerdown','mousedown','pointerup','mouseup','click']
                        .forEach(t => b.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true})));
                    return true;
                }""",
                T["edit_cover"],
            )
            if not opened:
                shot = job_path.parent / "error_cover.png"
                page.screenshot(path=str(shot), full_page=True)
                (job_path.parent / "error_cover.txt").write_text(
                    page.inner_text("body")[:3000], encoding="utf8")
                print(f"✗ 「カバーを編集」が見つかりません（画面: {shot}）")
                return 4
            page.wait_for_timeout(2500)
            # モーダル内の画像用 file input
            cover_input = page.locator('input[type="file"][accept*="image"]').last
            cover_input.set_input_files(str(cover))

            # ⚠️ ここで固定秒だけ待って保存すると、画像の反映が間に合わず
            #    **真っ黒なカバーで確定してしまう**(2026-08-14の自動投稿で実際に発生。
            #    カバーは後から変更できないため取り返しがつかない)。
            #    「カバーをアップロード」の文字が消える=独自カバーが入った合図なので、
            #    それを確認できるまで待つ。
            for _ in range(30):
                page.wait_for_timeout(1000)
                if not page.evaluate(
                    """(words) => {
                        const d = [...document.querySelectorAll('[role="dialog"], .TUXModal, [class*="modal"]')]
                            .find(x => /カバーを編集|Edit cover/.test(x.innerText));
                        return d ? words.some(w => d.innerText.includes(w)) : true;
                    }""",
                    T["upload_cover"],
                ):
                    break
            else:
                shot = job_path.parent / "error_cover_apply.png"
                page.screenshot(path=str(shot), full_page=True)
                print(f"✗ カバー画像が反映されませんでした（画面: {shot}）")
                return 5
            page.wait_for_timeout(1500)
            # カバー編集の「保存」は、フレーム選択のcanvasが上に重なっていて
            # 普通の click() だと "subtree intercepts pointer events" で弾かれる。
            # 手作業と同じくイベントを直接発火させる。
            if not click_button_in_dialog(page, T["edit_cover"], T["save"]):
                print("✗ カバー編集の「保存」を押せませんでした")
                return 5
            page.wait_for_timeout(2500)
            if any_text(page, "edit_cover") is None:
                print("✗ カバー編集画面が閉じていません")
                return 5
            print("  完了")

            # 3) キャプション
            print("→ キャプションを入力中…")
            if not set_caption(page, caption):
                print("✗ キャプションが正しく入りませんでした(手で直してください)")
                return 6
            print("  完了")

            # 4) 公開範囲の確認(既定で「誰でも」のはずだが、変わっていたら止める)
            body = page.inner_text("body")
            if ("誰でも" not in body) and ("Everyone" not in body):
                print("✗ 公開範囲が『誰でも』になっていません。手で確認してください")
                return 7

            if dry_run:
                shot = job_path.parent / "dryrun.png"
                page.screenshot(path=str(shot), full_page=True)
                print(f"\n--dry-run なので投稿はしません。確認用スクショ: {shot}")
                return 0

            # 5) 投稿
            print("→ 投稿中…")
            # 投稿ボタンは role 指定の click() だと効かないことがある
            # (同名要素が複数あり、実体は class に Button__root を持つ方)。
            # 実体を特定してイベントを直接発火させる。
            clicked = page.evaluate(
                """(words) => {
                    const btn = [...document.querySelectorAll('button')].find(b =>
                        words.includes(b.textContent.trim()) &&
                        String(b.className).includes('Button__root') && !b.disabled);
                    if (!btn) return false;
                    btn.scrollIntoView({block: 'center'});
                    ['pointerdown','mousedown','pointerup','mouseup','click']
                        .forEach(t => btn.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true})));
                    return true;
                }""",
                T["post"],
            )
            if not clicked:
                shot = job_path.parent / "error_post.png"
                page.screenshot(path=str(shot), full_page=True)
                print(f"✗ 投稿ボタンを押せませんでした（画面: {shot}）")
                return 8

            # 投稿完了は「一覧に自分の説明文が出ること」で確かめる。
            # URLの変化だけだと、送信できていなくても成功に見えることがある。
            head = " ".join(caption.split())[:18]
            for _ in range(40):
                page.wait_for_timeout(1500)
                if "/content" in page.url:
                    page.wait_for_timeout(4000)
                    if head in " ".join(page.inner_text("body").split()):
                        print("✓ 投稿しました（一覧に反映を確認）")
                        print("  ※ 新規投稿はしばらく『自分のみ・審査中』表示になることがあります(通常挙動)")
                        return 0
            shot = job_path.parent / "error_post.png"
            page.screenshot(path=str(shot), full_page=True)
            print(f"△ 投稿を確認できませんでした（画面: {shot}）")
            return 10
        except PWTimeout as e:
            print("✗ タイムアウト:", e)
            return 9
        finally:
            page.wait_for_timeout(1500)
            ctx.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(1)
    sys.exit(run(Path(args[0]), "--dry-run" in sys.argv))
