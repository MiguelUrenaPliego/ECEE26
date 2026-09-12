# Exporting this deck

The deck has three source files, all generated from one canonical version:

| File | Map embeds | Use it for |
|---|---|---|
| `presentation.md` | live `<iframe>`, auto-falls back to GIF if a map 404s / is offline / opened via `file://` | GitHub Pages, live browser presenting |
| `presentation.static.md` | static JPEG screenshot per map | PDF export, "static images" option |
| `presentation.gif.md` | animated GIF per map (4-5 frames, ~10s each) | PDF export, "GIF" option |

`presentation.static.md` and `presentation.gif.md` are **generated** — don't
hand-edit them. Edit `presentation.md`, then regenerate:

```bash
python3 scripts/build_presentation_variants.py
```

It finds every `<div class="map-slot map-slot--<name> ...">` placeholder
in `presentation.md` and swaps it for `figures/maps_gif/<name>.jpg` or
`.gif`, keeping any other classes the placeholder had (that's how sizing
like `.gem-exposure-bg` / `.conclusion-item` survives — see
`theme/ecee2026.css`). If you add a new map slide, just use that same
`map-slot map-slot--<name>` pattern and list `<name>` in
`maps_manifest.json`; both this script and `scripts/inject_maps.py` (used
by `build_pages.sh`) pick it up automatically.

## 1. Regenerating the map GIFs/JPEGs

Only needed when a map's content changes (new data, new default view, etc.):

```bash
python3 -m venv .venv && .venv/bin/pip install playwright pillow
.venv/bin/playwright install chromium
.venv/bin/python3 scripts/capture_map_gifs.py               # every map
.venv/bin/python3 scripts/capture_map_gifs.py height year    # just these
```

Starts its own local HTTP server (the maps need `fetch()`, which doesn't
work under `file://`), captures 3-5 JPEG-compressed frames per map, and
writes `figures/maps_gif/<name>.gif` + `.jpg`. Then re-run
`build_presentation_variants.py` (step above) so the two PDF variants pick
up the new images.

## 2. GitHub Pages (live maps)

**Always build with `scripts/build_pages.sh`, never a bare `marp ... -o
index.html` command.** A plain `marp` build produces a page with NO working
maps: presentation.md only ever contains inert `<div class="map-slot">`
placeholders (Marp hard-escapes a literal `<iframe>`/`<script>` tag in
markdown even with `html: true`), so `scripts/inject_maps.py` has to run
*after* marp to turn those into real iframes — `build_pages.sh` does both
steps together so that can't be forgotten:

```bash
./scripts/build_pages.sh
git add index.html maps/ figures/ assets/ logos/ theme/ presentation.md
git commit -m "Publish presentation"
git push
```

(If maps aren't showing on the published page or in a local preview,
this is almost always the cause — check `grep -c "<iframe" index.html`;
it should print `16`. If it prints `0`, `index.html` was built without the
`inject_maps.py` step and only has empty placeholder `<div>`s.)

Build `index.html` at the **repo root**, not into a `docs/` subfolder — the
deck's relative paths (`./maps/...`, `./figures/...`, `./theme/...`, etc.)
are all resolved from wherever `index.html` itself lives, and those folders
sit at the repo root, not inside `docs/`. (Putting the built file in
`docs/` while the assets stay at root breaks the page too — every relative
path 404s and the whole layout collapses to Marp's unstyled default.)
`build_pages.sh` already builds to the repo root.

Then in the repo settings → Pages → "Deploy from a branch", pick the branch
you pushed to and **"/ (root)"** as the folder — not `/docs`. The published
page has real, interactive maps; if a viewer's browser can't reach a given
`maps/<name>/index.html` (missing file, offline), the page swaps that one
map for its GIF automatically — nothing else to do.

(If you'd rather keep the repo root clean and use a `/docs` folder for
Pages instead, that works too — just also copy `maps/`, `figures/`,
`assets/`, `logos/`, `theme/` into `docs/` alongside `index.html`, so every
relative path still resolves. Building straight to the root, as above, is
simpler and avoids keeping two copies in sync.)

Local preview of the exact same thing — serve the whole repo root (needed
either way, since the maps `fetch()` their data and that doesn't work
under plain `file://`):

```bash
./scripts/build_pages.sh
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

## 3. PDF — static images

```bash
marp --pdf --allow-local-files --theme-set theme/ecee2026.css -o presentation_static.pdf presentation.static.md
```

## 4. PDF — GIFs

PDF pages are static, so an embedded GIF only ever shows its first frame in
most PDF viewers — a few viewers (some browsers' built-in PDF viewer) will
still animate an embedded GIF. This is the "use the GIF" option requested;
functionally it looks the same as the static-image PDF unless opened
somewhere that animates it.

```bash
marp --pdf --allow-local-files --theme-set theme/ecee2026.css -o presentation_gif.pdf presentation.gif.md
```

## 5. PPTX (bonus — also benefits from the GIF fallback)

```bash
marp --pptx --allow-local-files --theme-set theme/ecee2026.css -o presentation.pptx presentation.gif.md
```

PowerPoint doesn't run arbitrary iframes reliably either, so build the PPTX
from `presentation.gif.md` (animated in PowerPoint's own slideshow view) or
`presentation.static.md` (fully static).

## Quick reference

```bash
# after editing presentation.md:
python3 scripts/build_presentation_variants.py

# GitHub Pages
./scripts/build_pages.sh

# PDF, static images
marp --pdf --allow-local-files --theme-set theme/ecee2026.css -o presentation_static.pdf presentation.static.md

# PDF, GIFs
marp --pdf --allow-local-files --theme-set theme/ecee2026.css -o presentation_gif.pdf presentation.gif.md
```
