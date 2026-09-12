# Santo Domingo maps — overview

All maps are frontend-only (MapLibre GL JS + deck.gl, loaded from CDN `<script>` tags, no build step). Each is a folder under `maps/` with its own `index.html` / `main.js` / `style.css`; serve this `maps/` directory (or its parent) over plain HTTP for `fetch()` to work — opening the HTML file directly (`file://`) will not load data.

```
python3 -m http.server 8080   # from BerlinConference/
# then open http://localhost:8080/maps/<name>/index.html
```

Every map (except `intro`) shares the same visual language: dark glass panels, amber accent, a top-left controls panel (title + legend, collapsible), a top-right icon row (reorient / auto-tour play-pause / 3D toggle / settings), building click → detail panel, and an idle "showcase" auto-tour that cycles through color-by attributes while orbiting the camera — any manual interaction pauses it for 30s.

---

## template

Generic building-database viewer — the base every other map is copied from. Colors by whichever attribute is selected from the dropdown (structural system, LLRS, relative position, plan/elevation regularity, soil type, building condition, occupancy, floors, construction year, plus a few shape-parameter placeholders wired up but not yet joined into the data). Good starting point for a new map: copy the folder and swap in a real dataset + attribute list.

## relative_position

Colors buildings by their relative position typology: **Isolated / Lateral / Corner / Confined / Torque**. Side panel bar chart shows the count and % of buildings per category.

## structural_system

The ML-results map — by far the most feature-rich. Two datasets (Ensanche Quisquella, Naco), four experiments, multiple models, and a 6-card charts panel (composition, confusion matrix, evaluation metrics, feature importance, learning curve, cross-experiment F1).

- **Dataset**: Ensanche Quisquella / Naco
- **Experiment**: Santo Domingo · No roof, code & year · Quisquella → Naco · Leave-one-out
- **Model**: per-experiment base models (LogReg, RandomForest, HistGB, …) plus a live-computed **Ensemble**, and (for the loo experiment) an **Ensemble + prior** variant
- **Color by**: Structural system (predicted / ground truth) · Error vs ground truth · Uncertainty · Consensus (ensemble only) · Train/val/test split
- Structural classes are **CR** (concrete) and **M** (masonry) individually; **ADO** and **W** (adobe/steel, rare) are bucketed into **"Other"** everywhere (map coloring, legend, composition chart) *except* the Leave-one-out experiment, whose composition chart lists them individually since that experiment specifically probes generalization to those rarer classes.
- **Presentation slide URLs** (`?view=...`), each restricting the color-by cycle and visible charts, with larger plots for a projector:
  - `?view=split` — train/val/test split coloring + composition chart only
  - `?view=metrics` — truth/predicted/error/uncertainty/consensus coloring + confusion matrix & metrics table
  - `?view=feature_importance` — same coloring as metrics + feature importance & learning curve charts
  - `?view=comparison` — same coloring, defaults to the Leave-one-out experiment, + cross-experiment F1 chart

## height

Colors buildings by height (sequential blue ramp) over Google Satellite imagery. Side panel: buildings-per-floor-count histogram and a height-error-vs-survey histogram (RMSE reported).

## roof_material

Colors buildings by roof material derived from multispectral clustering: **Metallic / Bright concrete / Asphalt / Dark-shadowed**. Togglable raster layers (satellite / multispectral composite / cluster raster) with opacity sliders. Side panel: pixels-per-cluster bar chart and band-cluster-centroid line chart.

## shape_parameters

Colors buildings by one of many footprint shape/irregularity metrics across five code families (EC8, ASCE 7, GNDT-II, CSCR-2010, NTC-23) plus slenderness and a composite **Shape index** (Regular / Irregular: shape / eccentricity / slenderness). The "Color by" dropdown is grouped by norm family; the auto-tour cycle order is family-interleaved. Side panel: shape-index distribution bar chart.

## year

Colors buildings by first-construction-year (sequential purple→yellow ramp, bucketed every 5 years) and by the seismic-code-quality bucket it implies (Pre-code / Low code / Medium code, per the Dominican Republic code-year table). Side panel: buildings-per-year-bucket histogram and buildings-per-code-quality bar chart.

## intro

A cinematic, non-interactive-by-default presentation map — light ("normal", non-dark) basemap instead of the dark style every other map uses. Two datasets (Ensanche Quisquella, Naco) with a concave-hull outline (not a bounding box) and a big label per dataset, and comparison plots (surveyed vs. not-surveyed coverage, plus a chart for whatever attribute is currently active) always shown as one bar per dataset — labeled "Quisquella"/"Naco" and colored to match the map's own legend, with count and percentage on every bar.

**Default sequence** (`index.html`, no params):
1. World view holding on a "Santo Domingo, Dominican Republic" marker (2s)
2. Flies into both datasets, flat 2D (7s)
3. Holds flat, both datasets outlined + labeled (5s)
4. Tilts into 3D and orbits the combined centroid forever, spotlighting one dataset at a time every 6s — colored surveyed (CR/M/Other) vs. not-surveyed; the legend only appears once 3D activates

**Attributes tour** (`?view=attributes`): skips straight into 3D, framed on one dataset's own bounds at a time (own camera/zoom/rotation per dataset, non-active dataset renders flat & dimmed), switching dataset every 12s and cycling the coloring attribute every 2s: Structural system → Height → Area → Year → Roof material → Shape index.

Independent URL toggles for the attributes tour:
- `&theme=dark` — dark basemap/panels instead of the default light theme
- `&plots=0` (or the shorthand `?view=attributes_noplot`) — hides the legend and comparison charts entirely for a bare, presentation-clean view

Clicking any building (either mode) opens a detail panel: structural system, roof material, height, area (m²), shape index, relative position, year.

Examples:
- `?view=attributes`
- `?view=attributes&theme=dark`
- `?view=attributes&theme=dark&plots=0`
- `?view=attributes_noplot`
