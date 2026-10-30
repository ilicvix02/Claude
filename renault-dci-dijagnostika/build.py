"""Build the standalone, installable web app (PWA) from the artifact source.

The artifact file (index.html) has no <html>/<head>: claude.ai adds them when it
publishes. This wraps it in a full document with a manifest and service worker
so it can be hosted (GitHub Pages) and installed on a phone.
Run: python3 renault-dci-dijagnostika/build.py
"""
from pathlib import Path

ROOT = Path(__file__).parent
src = (ROOT / "index.html").read_text(encoding="utf-8")
head = """<!doctype html>
<html lang="sr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#070b16">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
</head>
<body>
"""
tail = """
<script>
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
</script>
</body>
</html>
"""
(ROOT / "app" / "index.html").write_text(head + src + tail, encoding="utf-8")
print("built app/index.html")
