# Year map data

Preprocessed for `BerlinConference/maps/year`. Regenerate with
`prepare_year_data.py` in this folder (needs the same gdalenv as the roof
map's script -- see `../roof/README.md` for how to build one).

Per dataset (`quisquella/`, `naco/`):

- `buildings.geojson` -- same target gpkg as the height map
  (`santo_domingo_pilot_region.gpkg` / `santo_domingo_700_buildings.gpkg`),
  reprojected to EPSG:4326; carries `first_construction_year` and
  `last_modification_year`.
- `sentinel.png` + `.bounds.json` -- false-color (SWIR1/NIR/Red) composite
  of `code/.../year/example_sentinel2_composite_2023.tif`, percentile-
  stretched, reprojected.
- `first_construction.png` + `.bounds.json` -- WSF Evolution's
  `wsf_evolution_aoi.tif` (pixel value = year of first detected built-up
  presence, 0 = none detected), colorized 1985-2015 with a sequential ramp,
  reprojected. This is the real per-pixel source `first_construction_year`
  was ultimately sampled from (see the cache's own DATA_OVERVIEW.txt) --
  there's no separate unified "first construction" raster upstream of it.

All rasters here are tiny (under 100KB each) -- both source rasters
(Sentinel-2 composite, WSF Evolution) are already coarse (tens to a couple
hundred pixels per side).
