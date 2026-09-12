"""
Turns every `<div class="map-slot map-slot--<name> ...">` placeholder in an
already-built Marp HTML file into a real `<iframe>` (URL looked up from
maps_manifest.json by `<name>`), and appends the small fallback script that
swaps a map for its pre-rendered GIF (figures/maps_gif/<name>.gif) if it
404s, can't be fetched (offline), or the page is opened via file://.

Why this has to be a *post*-processing step, and why the URL is looked up
by name instead of just being read off the div: Marp hard-escapes a literal
`<iframe>` AND `<script>` tag written in markdown (a security restriction
that applies even with `html: true`), and also strips `data-*`/`style`
attributes off any hand-written HTML tag -- only `class` survives. So
presentation.md can only ever describe each map as an inert `<div
class="map-slot map-slot--<name>">` with no way to carry its URL as an
attribute; neither a real iframe nor a runtime fallback script nor a
data-attribute survives Marp's own HTML conversion. Editing the *compiled*
HTML file directly, after marp has already produced it, is outside that
pipeline, so none of those restrictions apply.

Usage (run AFTER building the HTML, not on presentation.md itself):
    marp --allow-local-files --theme-set theme/ecee2026.css -o index.html presentation.md
    python3 scripts/inject_maps.py index.html
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "maps_manifest.json"

SLOT_RE = re.compile(r'<div class="([^"]*\bmap-slot\b[^"]*)"></div>')
NAME_RE = re.compile(r'\bmap-slot--([\w-]+)\b')

FALLBACK_SCRIPT = """
<script data-injected-by="inject_maps.py">
(function () {
  function fallback(iframe, name) {
    if (iframe.dataset.fellBack) return;
    iframe.dataset.fellBack = '1';
    var img = document.createElement('img');
    img.src = './figures/maps_gif/' + name + '.gif';
    img.alt = name.replace(/_/g, ' ') + ' map (offline fallback)';
    var style = iframe.getAttribute('style');
    if (style) img.setAttribute('style', style);
    if (iframe.className) img.className = iframe.className;
    iframe.replaceWith(img);
  }

  document.querySelectorAll('iframe[data-map-name]').forEach(function (iframe) {
    var name = iframe.getAttribute('data-map-name');
    if (location.protocol === 'file:') { fallback(iframe, name); return; }
    fetch(iframe.getAttribute('src'), { method: 'HEAD' })
      .then(function (r) { if (!r.ok) fallback(iframe, name); })
      .catch(function () { fallback(iframe, name); });
    var loaded = false;
    iframe.addEventListener('load', function () { loaded = true; });
    setTimeout(function () { if (!loaded) fallback(iframe, name); }, 6000);
  });
})();
</script>
""".strip()


def load_url_by_name():
    manifest = json.loads(MANIFEST_PATH.read_text())["maps"]
    return {m["name"]: m["url"] for m in manifest}


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/inject_maps.py <built.html>")
        sys.exit(1)

    path = Path(sys.argv[1])
    html = path.read_text(encoding="utf-8")
    url_by_name = load_url_by_name()

    missing = []

    def repl(m: re.Match) -> str:
        classes = m.group(1)
        name_match = NAME_RE.search(classes)
        if not name_match:
            return m.group(0)
        name = name_match.group(1)
        url = url_by_name.get(name)
        if url is None:
            missing.append(name)
            return m.group(0)
        rest_classes = " ".join(
            c for c in classes.split() if c not in ("map-slot", f"map-slot--{name}")
        )
        class_attr = f' class="{rest_classes}"' if rest_classes else ""
        return f'<iframe src="./{url}" data-map-name="{name}"{class_attr}></iframe>'

    new_html, n = SLOT_RE.subn(repl, html)
    print(f"Replaced {n} map-slot placeholder(s) with real <iframe>s")
    if missing:
        print(f"WARNING: no maps_manifest.json entry for: {sorted(set(missing))}")

    if 'data-injected-by="inject_maps.py"' not in new_html:
        new_html = new_html.replace("</body>", f"{FALLBACK_SCRIPT}\n</body>", 1)

    path.write_text(new_html, encoding="utf-8")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
