"""
Captures a single static screenshot of each live map (see
../maps_manifest.json) with a headless browser — the offline / PDF fallback
used by presentation.md and scripts/build_presentation_variants.py.

Every map needs `fetch()` to load its data, so it must be served over HTTP —
this script starts its own local `http.server` on the repo root for the
duration of the capture (no manual server needed).

Output (per map):
    figures/maps_gif/<name>.jpg   — for the "static image" PDF export

Usage:
    pip install playwright pillow
    playwright install chromium
    python3 scripts/capture_map_gifs.py            # all maps in the manifest
    python3 scripts/capture_map_gifs.py intro year  # only these maps
"""

import io
import json
import sys
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "maps_manifest.json"
OUT_DIR = ROOT / "figures" / "maps_gif"

# The maps size their UI panels (legend, charts, controls) in fixed CSS
# pixels, same as any normal responsive webpage — so the browser viewport
# has to be a real desktop size, or those panels take up a much bigger
# fraction of the screenshot than they do on an actual display. Capture at
# a realistic desktop viewport, then downscale the *image* afterwards to
# keep the JPEG light — that keeps the on-screen proportions correct while
# still shrinking the file size.
VIEWPORT_WIDTH = 1600
VIEWPORT_HEIGHT = 900
DEVICE_SCALE_FACTOR = 2    # renders at 2x pixel density (CSS layout/proportions
                           # unchanged) so the screenshot is sharp before the
                           # JPEG's static image gets embedded and scaled up
                           # inside a PDF page.
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1080
JPEG_QUALITY = 85

PORT = 8934


def start_server():
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def capture_map(page, entry):
    url = f"http://127.0.0.1:{PORT}/{entry['url']}"
    print(f"[{entry['name']}] loading {url}")
    page.goto(url, wait_until="load", timeout=60000)
    page.wait_for_timeout(entry.get("wait_ms", 3000))

    png_bytes = page.screenshot(type="png")
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    im = im.resize((OUTPUT_WIDTH, OUTPUT_HEIGHT), Image.LANCZOS)
    return im


def save_output(name, im):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    jpg_path = OUT_DIR / f"{name}.jpg"
    im.save(jpg_path, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    print(f"[{name}] wrote {jpg_path.relative_to(ROOT)} ({jpg_path.stat().st_size / 1024:.0f} KB)")


def main():
    manifest = json.loads(MANIFEST_PATH.read_text())["maps"]
    only = set(sys.argv[1:])
    if only:
        manifest = [m for m in manifest if m["name"] in only]
        missing = only - {m["name"] for m in manifest}
        if missing:
            print(f"Unknown map name(s), skipping: {sorted(missing)}")

    httpd = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(
                viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
                device_scale_factor=DEVICE_SCALE_FACTOR,
            )
            for entry in manifest:
                try:
                    im = capture_map(page, entry)
                    save_output(entry["name"], im)
                except Exception as exc:  # noqa: BLE001
                    print(f"[{entry['name']}] FAILED: {exc}")
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
