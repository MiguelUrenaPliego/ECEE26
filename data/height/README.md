# Height map data

Preprocessed for `BerlinConference/maps/height`. Regenerate with
`prepare_height_data.py` in this folder (needs the same gdalenv as the roof
map's script -- see `../roof/README.md` for how to build one).

The four raw drone-flight rasters at the root of this folder
(`dsm_very_low_res.tif`, `dtm.tif`, `image_max_res_tile.tif`,
`image_very_low_res.tif`, plus their `.aux.xml` sidecars) are the source
files for Ensanche Quisquella's drone survey -- kept as-is (all already well
under 50MB). Everything else lives in per-dataset subfolders:

- `quisquella/` (1464 buildings) -- has the full raster stack: `gba_height`
  (GlobalBuildingAtlas), plus the drone-derived `low_res_image`,
  `max_res_image`, `dtm`, `dsm`.
- `naco/` (13905 buildings, Random700Sample renamed per the map's dataset
  picker) -- `gba_height` only; there's no drone flight for this AOI.

Each raster above is `<name>.png` (Byte RGBA, reprojected to EPSG:4326,
transparent outside its own AOI/nodata mask) + `<name>.bounds.json`
(`{west,south,east,north}` in degrees) for placing it as a deck.gl
BitmapLayer. `gba_height`/`dtm`/`dsm` are colorized offline (sequential blue
for height, a terrain ramp for DTM/DSM); the drone photos are already
Byte RGBA orthophotos, reprojected as-is.

`buildings.geojson` per dataset comes from the *target* gpkg
(`santo_domingo_pilot_region.gpkg` / `santo_domingo_700_buildings.gpkg`,
under `code/data/SantoDomingo/<CityFolder>/`) -- not the roof map's own
`buildings_roof_material.gpkg` -- because this is the one that carries
`n_floors`/`height`/`gba_height`.
