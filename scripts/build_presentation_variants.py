"""
Generates the PDF-safe variant of the deck from the canonical presentation.md
(the "live" version, meant for GitHub Pages / browser use):

    presentation.static.md  — every map placeholder replaced by its static JPEG
                               (figures/maps_gif/<name>.jpg)

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
    the PDF-safe variant, keeping any extra (non map-slot, non
    map-slot--<name>) classes the placeholder had so its own sizing CSS
    (see theme/ecee2026.css, e.g. `.gem-exposure-bg` / `.conclusion-item`)
    still applies.

A few single-topic maps (see EXPANSIONS below) cycle through several
color-by attributes in their live "showcase" mode -- presentation.md keeps
just one slide for those (the live iframe already shows the cycle), but a
static PDF can't show a cycle, so this script expands that one slide into
one slide per attribute here, each pointing at its own manifest entry
(<name>_attr_<attribute>, captured with that attribute pinned via
?attribute=<attribute> -- see maps/height/main.js's LOCK_ATTRIBUTE and
maps/year/main.js's LOCK_ATTRIBUTE).

Run scripts/capture_map_gifs.py first so the figures/maps_gif/*.jpg files
this script references actually exist.

Usage:
    python3 scripts/build_presentation_variants.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "presentation.md"
IMG_DIR = "figures/maps_gif"

# Matches: <div class="map-slot map-slot--name ..."></div>
SLOT_RE = re.compile(r'<div class="([^"]*\bmap-slot\b[^"]*)"></div>')
NAME_RE = re.compile(r'\bmap-slot--([\w-]+)\b')

# base map-slot name -> [(manifest name, slide title or None to keep the
# original slide's title), ...], static-variant-only.
EXPANSIONS = {
    "height": [
        ("height_attr_height", None),
        ("height_attr_height_error", "Height error (vs. survey)"),
    ],
    "year": [
        ("year_attr_first_construction_year", "Construction or modification year: First construction year"),
        ("year_attr_last_modification_year", "Construction or modification year: Last modification year"),
        ("year_attr_code_quality", "Construction or modification year: Code quality"),
    ],
    "structural_system_metrics": [
        ("structural_system_metrics_truth", "Structural system: Metrics (ground truth)"),
        ("structural_system_metrics_predicted", "Structural system: Metrics (predicted)"),
        ("structural_system_metrics_error", "Structural system: Metrics (error)"),
        ("structural_system_metrics_uncertainty", "Structural system: Metrics (uncertainty)"),
        ("structural_system_metrics_consensus", "Structural system: Metrics (consensus)"),
    ],
}


def expand_slide(text: str, name: str, variants: list) -> tuple[str, int]:
    pattern = re.compile(
        r'<!-- _class: map -->\n\n# (?P<title>[^\n]*)\n\n'
        rf'<!-- MAP:{re.escape(name)} -->\n'
        rf'<div class="map-slot map-slot--{re.escape(name)}"></div>\n'
        r'(?:\n<span class="slide-ref">(?P<cite>[^<]*)</span>\n)?'
    )
    m = pattern.search(text)
    if not m:
        return text, 0

    orig_title, cite = m.group("title"), m.group("cite")
    cite_block = f'\n<span class="slide-ref">{cite}</span>\n' if cite else ""
    blocks = []
    for variant_name, title_override in variants:
        title = title_override or orig_title
        blocks.append(
            f'<!-- _class: map -->\n\n# {title}\n\n'
            f'<!-- MAP:{variant_name} -->\n'
            f'<div class="map-slot map-slot--{variant_name}"></div>\n'
            f'{cite_block}'
        )
    replacement = "\n\n---\n\n".join(blocks)
    return text[: m.start()] + replacement + text[m.end() :], 1


def make_variant() -> str:
    text = SRC.read_text(encoding="utf-8")

    for name, variants in EXPANSIONS.items():
        text, n = expand_slide(text, name, variants)
        if n:
            print(f"expanded '{name}' into {len(variants)} attribute slides")
        else:
            print(f"WARNING: could not find the '{name}' slide to expand")

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
        return f'<img src="./{IMG_DIR}/{name}.jpg" alt="{alt} map"{class_attr}>'

    new_text, n = SLOT_RE.subn(repl, text)
    print(f"replaced {n} map embeds")
    return new_text


def main():
    out_path = ROOT / "presentation.static.md"
    out_path.write_text(make_variant(), encoding="utf-8")
    print(f"wrote {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
