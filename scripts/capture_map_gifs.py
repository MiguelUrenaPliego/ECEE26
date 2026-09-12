"""
Captures a handful of frames from each live map (see ../maps_manifest.json)
with a headless browser and assembles them into a small looping GIF, plus a
single static JPEG (first frame) — the offline / PDF fallbacks used by
presentation.md and scripts/build_presentation_variants.py.

Every map needs `fetch()` to load its data, so it must be served over HTTP —
this script starts its own local `http.server` on the repo root for the
duration of the capture (no manual server needed).

Output (per map, low-weight by design):
    figures/maps_gif/<name>.gif   — 4-5 JPEG-compressed frames, ~10s each
    figures/maps_gif/<name>.jpg   — first frame, for the "static image" PDF export

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
# keep the GIF/JPEG light — that keeps the on-screen proportions correct
# while still shrinking the file size.
VIEWPORT_WIDTH = 1600
VIEWPORT_HEIGHT = 900
OUTPUT_WIDTH = 1280
OUTPUT_HEIGHT = 720
JPEG_QUALITY = 60          # per-frame lossy compression before GIF-quantizing
GIF_MAX_COLORS = 128       # smaller palette -> smaller GIF
FRAME_DURATION_MS = 10000  # "keep passing every 10s"

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

    frames = []
    n = entry.get("frames", 4)
    interval = entry.get("interval_ms", 10000)
    for i in range(n):
        png_bytes = page.screenshot(type="png")
        im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        im = im.resize((OUTPUT_WIDTH, OUTPUT_HEIGHT), Image.LANCZOS)
        # Round-trip through JPEG to get lossy per-frame compression, same as
        # a photo-quality screenshot would be, before it goes into the GIF.
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        buf.seek(0)
        frames.append(Image.open(buf).convert("RGB"))
        print(f"[{entry['name']}] captured frame {i + 1}/{n}")
        if i < n - 1:
            page.wait_for_timeout(interval)
    return frames


def save_outputs(name, frames):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    jpg_path = OUT_DIR / f"{name}.jpg"
    gif_path = OUT_DIR / f"{name}.gif"

    frames[0].save(jpg_path, format="JPEG", quality=JPEG_QUALITY, optimize=True)

    quantized = [
        f.quantize(colors=GIF_MAX_COLORS, method=Image.MEDIANCUT) for f in frames
    ]
    quantized[0].save(
        gif_path,
        format="GIF",
        save_all=True,
        append_images=quantized[1:],
        duration=FRAME_DURATION_MS,
        loop=0,
        optimize=True,
    )
    print(
        f"[{name}] wrote {gif_path.relative_to(ROOT)} "
        f"({gif_path.stat().st_size / 1024:.0f} KB) and "
        f"{jpg_path.relative_to(ROOT)} ({jpg_path.stat().st_size / 1024:.0f} KB)"
    )


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
            page = browser.new_page(viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT})
            for entry in manifest:
                try:
                    frames = capture_map(page, entry)
                    save_outputs(entry["name"], frames)
                except Exception as exc:  # noqa: BLE001
                    print(f"[{entry['name']}] FAILED: {exc}")
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
