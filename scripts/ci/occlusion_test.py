"""Vérifie que le calque de dessin ne fige pas les applications situées dessous.

Chrome, Edge et les applications Electron cessent de se dessiner quand une fenêtre opaque
les recouvre. On ouvre donc dans Edge une page animée (requestAnimationFrame) qui signale
chaque image à un petit serveur local, puis on mesure sa cadence avant et pendant le mode dessin.

    python scripts/ci/occlusion_test.py <NeonInk.exe> --expect live|freeze [--shots dossier]
"""
import argparse
import ctypes
import http.server
import os
import subprocess
import sys
import tempfile
import threading
import time

PORT = 8777
PAGE = b"""<!doctype html><title>occlusion</title>
<body style="margin:0;background:#123;color:#fff;font:120px sans-serif;display:grid;place-items:center;height:100vh">
<div id="n">0</div><script>
let i = 0;
function f() { i++; n.textContent = i; if (i % 6 === 0) fetch('/tick', { cache: 'no-store' }); requestAnimationFrame(f); }
requestAnimationFrame(f);
</script>"""

ticks = 0
user32 = ctypes.windll.user32


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global ticks
        body = b"ok" if self.path.startswith("/tick") else PAGE
        if self.path.startswith("/tick"):
            ticks += 1
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def rate(seconds=4.0):
    start = ticks
    time.sleep(seconds)
    return (ticks - start) / seconds


def press_f10():
    user32.keybd_event(0x79, 0, 0, 0)
    time.sleep(0.05)
    user32.keybd_event(0x79, 0, 2, 0)


def overlay_info():
    hwnd = user32.FindWindowW(None, "NeonInk")
    if not hwnd:
        return "introuvable"
    ex = user32.GetWindowLongW(hwnd, -20)
    return f"visible={bool(user32.IsWindowVisible(hwnd))} exstyle=0x{ex & 0xFFFFFFFF:08X} toolwindow={bool(ex & 0x80)}"


def screenshot(folder, name):
    if not folder:
        return
    try:
        import mss
        import mss.tools

        with mss.mss() as s:
            img = s.grab(s.monitors[1])
            mss.tools.to_png(img.rgb, img.size, output=os.path.join(folder, name))
    except Exception as e:  # capture facultative
        print(f"capture impossible : {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("exe")
    ap.add_argument("--expect", choices=["live", "freeze"], default="live")
    ap.add_argument("--shots")
    args = ap.parse_args()
    if args.shots:
        os.makedirs(args.shots, exist_ok=True)
    tag = os.path.splitext(os.path.basename(args.exe))[0]

    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    edge = next(p for p in [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ] if os.path.exists(p))
    profile = tempfile.mkdtemp()
    browser = subprocess.Popen([edge, f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
                                "--start-maximized", f"--app=http://127.0.0.1:{PORT}/"])
    app = None
    try:
        for _ in range(60):
            if ticks > 5:
                break
            time.sleep(0.5)
        else:
            print("La page de test ne s'anime pas : environnement inutilisable.")
            return 2
        time.sleep(2)
        before = rate()

        env = dict(os.environ, NEONINK_NO_UPDATE="1")
        app = subprocess.Popen([args.exe], env=env)
        time.sleep(6)
        press_f10()
        time.sleep(3)
        info = overlay_info()
        drawing = rate()
        screenshot(args.shots, f"{tag}-dessin.png")
        press_f10()
        time.sleep(2)
        after = rate()

        frozen = drawing < before * 0.3
        verdict = "FIGÉ" if frozen else "fluide"
        lines = [
            f"### Occlusion : `{os.path.basename(args.exe)}`",
            f"- Calque en mode dessin : {info}",
            f"- Edge, images signalées par seconde : avant {before:.1f} · pendant le dessin {drawing:.1f} · après {after:.1f}",
            f"- Résultat : **{verdict}** (attendu : {'figé' if args.expect == 'freeze' else 'fluide'})",
        ]
        print("\n".join(lines))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n\n")
        if "visible=True" not in info:
            print("Le calque ne s'est pas affiché : test non concluant.")
            return 2
        return 0 if frozen == (args.expect == "freeze") else 1
    finally:
        if app:
            app.kill()
        browser.kill()
        subprocess.run(["taskkill", "/F", "/IM", "msedge.exe"], capture_output=True)
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
