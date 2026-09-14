# Unified per-dataset source GeoPackages

`quisquella.gpkg` (1464 buildings, 1140 columns) and `naco.gpkg` (13905
buildings, 1140 columns) -- the single complete source file per dataset the
other maps' own data-prep scripts should eventually read from, so every map
pulls from one gpkg instead of several scattered originals.

Built by `build_unified_gpkg.py` (plain `python3` + geopandas, no GDAL raster
bindings needed) from:

- **`data/ml_structural_system/{ensanche_quisquella,naco}.gpkg`** -- the base:
  every column, unmodified (1136 columns: `structural_system` ground truth,
  the 19 model-experiment prediction/probability columns, and all the
  engineered shape-feature columns -- see `data/ml_structural_system/COLUMNS.md`
  for the full dictionary, and `santo_domingo_results.json` for per-experiment
  metrics).
- **The *target* gpkg** (`code/data/SantoDomingo/{EnsancheQuisquella,Random700Sample}/...`)
  -- the 4 columns ml_structural_system's files don't carry, joined in:
  `gba_height`, `survey_n_floors` (that gpkg's own `n_floors`, confirmed NOT
  derived from height -- see `data/height/prepare_height_data.py`'s own
  comment), `first_construction_year`, `last_modification_year`. Coverage:
  1174/1464 (Quisquella) and 11931/13905 (Naco) -- the rest have no GBA
  sample point nearby, same gap noted throughout `data/height/`.

Join key: centroid match (rounded to 1e-6 degrees), not `id` -- confirmed
across every one of these files that `id` is independently re-indexed per
file and not a reliable join key, while geometries themselves are identical
(same source footprints) down to sub-millimeter centroid agreement.

## Size

`naco.gpkg` is 117MB and `quisquella.gpkg` is 12MB -- both dominated by the
1136 ML columns (13905 x 1136 for Naco), not something to trim without
dropping data the request explicitly asked to keep. **These are source
files, not something any map fetches directly in the browser** -- a map's
own `prepare_*.py` should keep doing what roof/height/year's scripts already
do: read whatever columns it actually needs from here, export a small
per-map GeoJSON (well under the 50MB-per-browser-asset budget that applies
to what a map actually loads), same as today.
