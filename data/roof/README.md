# Roof material map data

Preprocessed from `code/data/SantoDomingo/<District>/cache/roof/roof_output/`
for `BerlinConference/maps/roof_material`. Regenerate with `prepare_roof_data.py`
in this folder -- needs GDAL's Python bindings + numpy<2 + Pillow, which no
single venv in this repo has together, so build a throwaway one first:

```bash
/usr/bin/python3 -m venv --system-site-packages /tmp/gdalenv  # inherits system osgeo.gdal
source /tmp/gdalenv/bin/activate
pip install "numpy<2" pillow
python3 BerlinConference/data/roof/prepare_roof_data.py
```

Two folders, `quisquella/` (Ensanche Quisquella, `santo_domingo_pilot_region`,
1464 buildings) and `naco/` (Random700Sample, renamed "Naco" per the map's
own dataset picker, `santo_domingo_700_buildings`, 13905 buildings). Each
contains:

- `buildings.geojson` -- `buildings_roof_material.gpkg` reprojected to
  EPSG:4326 (Naco's source was EPSG:32619).
- `multispectral.png` + `multispectral.bounds.json` -- true-color (B04/B03/
  B02, 2-98 percentile stretched) composite of `fused_bands.tif`, reprojected
  to EPSG:4326, transparent outside the AOI mask. Bounds are
  `{west,south,east,north}` in degrees, for placing the image as a
  deck.gl BitmapLayer.
- `clusters.png` + `clusters.bounds.json` -- `kmeans_clusters_4.tif`
  recolored by roof_material (via that dataset's own `cluster_mapping.yaml`)
  using the exact palette `main.js`'s `ROOF_MATERIAL_COLORS` uses for the
  buildings, so the raster and the vector layer agree.
- `pixels_per_cluster.json`, `cluster_spectral_centroids.json` -- copied
  as-is, feed the two charts.
- `cluster_mapping.json` -- `cluster_mapping.yaml` as JSON (cluster id ->
  material name).

All rasters are well under the 50MB budget (largest PNG is ~3MB) --
percentile-stretched Byte RGBA compresses far smaller than the source
Float32 GeoTIFFs (`fused_bands.tif` was up to 131MB for Naco).

Not copied here (available in the cache root if a future map needs them):
height_munich/ (GlobalBuildingAtlas height raster) and year/ (WSF/GHSL
first-construction and Sentinel-2 change-detection rasters) -- out of scope
for this roof-material map.
