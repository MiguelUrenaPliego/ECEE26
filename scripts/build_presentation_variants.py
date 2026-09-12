"""
Generates the two PDF-safe variants of the deck from the canonical
presentation.md (the "live" version, meant for GitHub Pages / browser use):

    presentation.static.md  — every map placeholder replaced by its static JPEG
                               (figures/maps_gif/<name>.jpg)
    presentation.gif.md     — every map placeholder replaced by its animated GIF
                               (figures/maps_gif/<name>.gif)

Marp always HTML-escapes a literal <iframe>/<script> tag in markdown (a
hardcoded security restriction, even with `html: true`), and also strips
`data-*`/`style` attributes off any hand-written tag -- only `class`
survives. So presentation.md never writes a real iframe or carries a map's
URL as an attribute; every map is authored as a plain
`<div class="map-slot map-slot--<name> ...">` placeholder (see
maps_manifest.json for the full list of names), which a build-time or
runtime step resolves by name:

  - scripts/inject_maps.py resolves it to a real <iframe> (for the live
    GitHub Pages build, run as a *post*-processing step on the already
    -compiled HTML -- see that script's docstring for why).
  - THIS script resolves it to a plain <img> at the *markdown* level, for
    the two PDF-safe variants, keeping any extra (non map-slot, non
    map-slot--<name>) classes the placeholder had so its own sizing CSS
    (see theme/ecee2026.css, e.g. `.gem-exposure-bg` / `.conclusion-item`)
    still applies.

Run scripts/capture_map_gifs.py first so the figures/maps_gif/*.jpg|gif
files this script references actually exist.

Usage:
    python3 scripts/build_presentation_variants.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "presentation.md"
GIF_DIR = "figures/maps_gif"

# Matches: <div class="map-slot map-slot--name ..."></div>
SLOT_RE = re.compile(r'<div class="([^"]*\bmap-slot\b[^"]*)"></div>')
NAME_RE = re.compile(r'\bmap-slot--([\w-]+)\b')

# The runtime <script> block (with its preceding HTML-comment explanation)
# that resolves map-slot divs at view time -- not present in presentation.md
# itself any more (that logic now lives in scripts/inject_maps.py), but this
# stays here harmlessly in case an older copy of the comment block reappears.
FALLBACK_SCRIPT_RE = re.compile(
    r'<!-- Every map above is authored.*?</script>\n?', re.S
)


def make_variant(kind: str) -> str:
    assert kind in ("static", "gif")
    ext = "jpg" if kind == "static" else "gif"
    text = SRC.read_text(encoding="utf-8")

    def repl(m: re.Match) -> str:
        classes = m.group(1)
        name_match = NAME_RE.search(classes)
        if not name_match:
            return m.group(0)
        name = name_match.group(1)
        rest_classes = " ".join(
            c for c in classes.split() if c not in ("map-slot", f"map-slot--{name}")
        )
        class_attr = f' class="{rest_classes}"' if rest_classes else ""
        alt = name.replace("_", " ")
        return f'<img src="./{GIF_DIR}/{name}.{ext}" alt="{alt} map"{class_attr}>'

    new_text, n = SLOT_RE.subn(repl, text)
    print(f"{kind}: replaced {n} map embeds")

    new_text, n_script = FALLBACK_SCRIPT_RE.subn("", new_text)
    if n_script:
        print(f"{kind}: removed {n_script} stray runtime fallback comment/script block(s)")

    return new_text


def main():
    for kind in ("static", "gif"):
        out_path = ROOT / f"presentation.{kind}.md"
        out_path.write_text(make_variant(kind), encoding="utf-8")
        print(f"wrote {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
