# Exporting this deck

The deck has two source files, both generated from one canonical version:

| File | Map embeds | Use it for |
|---|---|---|
| `presentation.md` | live `<iframe>`, auto-falls back to a static JPEG if a map 404s / is offline / opened via `file://` | GitHub Pages, live browser presenting |
| `presentation.static.md` | static JPEG screenshot per map | PDF export |

`presentation.static.md` is **generated** — don't hand-edit it. Edit
`presentation.md`, then regenerate:

```bash
python3 scripts/build_presentation_variants.py
```

It finds every `<div class="map-slot map-slot--<name> ...">` placeholder
in `presentation.md` and swaps it for `figures/maps_gif/<name>.jpg`,
keeping any other classes the placeholder had (that's how sizing
like `.gem-exposure-bg` / `.conclusion-item` survives — see
`theme/ecee2026.css`). If you add a new map slide, just use that same
`map-slot map-slot--<name>` pattern and list `<name>` in
`maps_manifest.json`; both this script and `scripts/inject_maps.py` (used
by `build_pages.sh`) pick it up automatically.

## 1. Regenerating the map JPEGs

Only needed when a map's content changes (new data, new default view, etc.):

```bash
python3 -m venv .venv && .venv/bin/pip install playwright pillow
.venv/bin/playwright install chromium
.venv/bin/python3 scripts/capture_map_gifs.py               # every map
.venv/bin/python3 scripts/capture_map_gifs.py height year    # just these
```

Starts its own local HTTP server (the maps need `fetch()`, which doesn't
work under `file://`), captures one screenshot per map, and writes
`figures/maps_gif/<name>.jpg`. Then re-run `build_presentation_variants.py`
(step above) so the PDF variant picks up the new images. (The directory is
still named `maps_gif` for historical reasons — it only holds static JPEGs
now, animated GIFs were dropped since they only ever showed their first
frame in PDF viewers anyway.)

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
map for its static JPEG automatically — nothing else to do.

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

## 3. PDF

```bash
marp --pdf --allow-local-files --theme-set theme/ecee2026.css -o presentation_static.pdf presentation.static.md
```

## 4. PPTX (bonus)

```bash
marp --pptx --allow-local-files --theme-set theme/ecee2026.css -o presentation.pptx presentation.static.md
```

PowerPoint doesn't run arbitrary iframes reliably either, so build the PPTX
from `presentation.static.md` (fully static).

## Quick reference

```bash
# after editing presentation.md:
python3 scripts/build_presentation_variants.py

# GitHub Pages
./scripts/build_pages.sh

# PDF
marp --pdf --allow-local-files --theme-set theme/ecee2026.css -o presentation_static.pdf presentation.static.md
```
