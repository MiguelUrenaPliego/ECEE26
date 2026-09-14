#!/usr/bin/env python3
"""One-off preprocessing: cache/ + drone rasters -> BerlinConference/data/height/.

Run inside the same gdalenv as prepare_roof_data.py (GDAL python bindings +
numpy<2 + Pillow):
  /usr/bin/python3 -m venv --system-site-packages /tmp/gdalenv
  source /tmp/gdalenv/bin/activate && pip install "numpy<2" pillow

Produces, per dataset, under BerlinConference/data/height/<dataset>/:
  - buildings.geojson (santo_domingo_pilot_region.gpkg / _700_buildings.gpkg,
    reprojected to 4326 -- has n_floors/height/gba_height, unlike the
    roof map's own buildings.geojson which comes from a different gpkg)
  - gba_height.png + gba_height.bounds.json (GlobalBuildingAtlas raster,
    sequential blue ramp, clamped 0-20m for visual contrast, reprojected)

Quisquella only, additionally:
  - low_res_image.png / max_res_image.png (+ bounds.json): drone orthophoto
    mosaics, already RGBA Byte -- reprojected to 4326 as-is, no stretch.
  - dtm.png / dsm.png (+ bounds.json): drone-derived terrain/surface models,
    colorized with a terrain ramp (already EPSG:4326, so no warp needed).
"""
import json

import numpy as np
from osgeo import gdal

gdal.UseExceptions()

CACHE_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo"
GPKG_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo"
DRONE_DIR = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/height"
OUT_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/height"

DATASETS = {
    "quisquella": {"cache": "EnsancheQuisquella/cache", "gpkg": f"{GPKG_ROOT}/EnsancheQuisquella/santo_domingo_pilot_region.gpkg"},
    "naco": {"cache": "Naco/cache", "gpkg": f"{GPKG_ROOT}/Naco/santo_domingo_naco.gpkg"},
}

# Warm amber ramp for GBA -- deliberately NOT the same blue as the building
# "Height" fill (main.js's SEQUENTIAL_STEPS), so the two don't visually merge
# into one indistinguishable mass where GBA sits directly under buildings.
SEQUENTIAL_RAMP = [(255, 236, 179), (255, 202, 108), (247, 159, 63), (219, 111, 39), (163, 66, 20)]
# Same blue ramp as the building "Height" fill (main.js's SEQUENTIAL_STEPS) --
# used only for dsm_dtm, which the map labels "Height DSM-DTM" specifically
# to read as the same quantity/cmap as the building height attribute.
HEIGHT_BLUE_RAMP = [(205, 226, 251), (158, 197, 244), (109, 167, 236), (57, 135, 229), (28, 92, 171)]
# Terrain ramp for DTM/DSM: a proper multi-hue hypsometric ramp (blue-green
# lowland -> yellow -> orange -> red highland), not the old narrow green-to-
# white ramp that read as "almost no difference" once actually stretched
# across the real (non-zero-based) elevation range -- see colorize_single_band's
# use_data_min below, which was the bigger bug: vmin was hardcoded to 0 while
# these rasters' real values start around 44-120m, so 60-70% of this ramp was
# never even reached.
TERRAIN_RAMP = [(37, 100, 120), (86, 156, 120), (184, 191, 96), (223, 148, 62), (176, 60, 48)]

GBA_CLAMP_MAX_M = 20  # matches the base template's own building-height exaggeration reasoning: a handful of outliers must not desaturate every ordinary low-rise building


def ramp_color(t, ramp):
    t = min(1, max(0, t))
    scaled = t * (len(ramp) - 1)
    lo = int(scaled)
    hi = min(len(ramp) - 1, lo + 1)
    frac = scaled - lo
    r = ramp[lo][0] + (ramp[hi][0] - ramp[lo][0]) * frac
    g = ramp[lo][1] + (ramp[hi][1] - ramp[lo][1]) * frac
    b = ramp[lo][2] + (ramp[hi][2] - ramp[lo][2]) * frac
    return int(r), int(g), int(b)


def write_rgba_geotiff(path, rgba, geotransform, projection):
    driver = gdal.GetDriverByName("GTiff")
    height, width, _ = rgba.shape
    ds = driver.Create(path, width, height, 4, gdal.GDT_Byte)
    ds.SetGeoTransform(geotransform)
    ds.SetProjection(projection)
    for i in range(4):
        ds.GetRasterBand(i + 1).WriteArray(rgba[:, :, i])
    ds.FlushCache()
    ds = None


def warp_to_4326_png(src_tif, out_png, out_bounds_json, needs_warp=True):
    if needs_warp:
        target_tif = src_tif.replace(".tif", "_4326.tif")
        gdal.Warp(target_tif, src_tif, dstSRS="EPSG:4326", resampleAlg="near", format="GTiff")
    else:
        target_tif = src_tif
    ds = gdal.Open(target_tif)
    width, height = ds.RasterXSize, ds.RasterYSize
    gt = ds.GetGeoTransform()
    min_lon, max_lat = gt[0], gt[3]
    max_lon = gt[0] + width * gt[1]
    min_lat = gt[3] + height * gt[5]
    arr = np.dstack([ds.GetRasterBand(i + 1).ReadAsArray() for i in range(ds.RasterCount)])
    from PIL import Image

    Image.fromarray(arr, mode="RGBA").save(out_png, optimize=True)
    with open(out_bounds_json, "w") as f:
        json.dump({"west": min_lon, "south": min_lat, "east": max_lon, "north": max_lat}, f)
    ds = None
    print(f"  wrote {out_png} ({width}x{height})")


def colorize_single_band(path, ramp, out_dir, out_name, clamp_max=None, nodata_override=None, use_data_min=False, array_override=None, geo_override=None):
    if array_override is not None:
        arr, mask = array_override
        gt, proj = geo_override
    else:
        ds = gdal.Open(path)
        band = ds.GetRasterBand(1)
        nodata = nodata_override if nodata_override is not None else band.GetNoDataValue()
        arr = band.ReadAsArray().astype(np.float64)
        mask = np.ones(arr.shape, dtype=bool) if nodata is None else ~np.isclose(arr, nodata)
        mask &= ~np.isnan(arr)
        gt, proj = ds.GetGeoTransform(), ds.GetProjection()

    vmax = clamp_max if clamp_max is not None else (arr[mask].max() if mask.any() else 1)
    # DTM/DSM elevations sit well above 0 (e.g. 44-120m absolute) -- a fixed
    # vmin=0 wasted most of the ramp on values that never occur. Stretching
    # from the data's own minimum instead uses the full ramp for the actual
    # range present, which is what "no visible differences" needed.
    vmin = (arr[mask].min() if mask.any() else 0) if use_data_min else 0
    t = np.clip((arr - vmin) / (vmax - vmin), 0, 1)

    rgba = np.zeros((*arr.shape, 4), dtype=np.uint8)
    # Vectorized ramp lookup: sample the ramp at 256 steps, then index.
    lut = np.array([ramp_color(i / 255, ramp) for i in range(256)], dtype=np.uint8)
    idx = (t * 255).astype(np.uint8)
    rgba[:, :, 0] = lut[idx, 0]
    rgba[:, :, 1] = lut[idx, 1]
    rgba[:, :, 2] = lut[idx, 2]
    rgba[:, :, 3] = np.where(mask, 255, 0).astype(np.uint8)

    tmp_tif = f"{out_dir}/_{out_name}_native.tif"
    write_rgba_geotiff(tmp_tif, rgba, gt, proj)
    # dtm.tif/dsm_very_low_res.tif are already lon/lat (no explicit CRS
    # authority in the file, but coordinates are plainly degrees) -- gdal.Warp
    # with dstSRS=4326 on a src with no defined SRS would fail, so those
    # skip the warp step entirely and go straight to PNG.
    # Bug fixed here: a *projected* CRS's WKT always embeds a base GEOGCS
    # too (every PROJCS wraps one), so checking for "GEOGCS" absence never
    # actually caught anything -- it always evaluated to "don't warp",
    # which is why GBA (real UTM data) was silently left in UTM meters as
    # its bounds.json, placing it nowhere near lon/lat 0. The real signal
    # for "already plain lon/lat, nothing to warp" is the absence of a
    # *projected* CRS wrapper (PROJCS/PROJCRS), not of GEOGCS.
    needs_warp = "PROJCS" in proj or "PROJCRS" in proj
    warp_to_4326_png(tmp_tif, f"{out_dir}/{out_name}.png", f"{out_dir}/{out_name}.bounds.json", needs_warp=needs_warp)


def process_gba(dataset_id, cache_name, out_dir):
    # Same blue ramp as the building "Height" fill (and dsm_dtm) -- GBA is
    # the same physical quantity, and the map's "Color by: Height" legend
    # should describe every height raster on screen, not just the buildings.
    src = f"{CACHE_ROOT}/{cache_name}/height_munich/gba_height_raster.tif"
    colorize_single_band(src, HEIGHT_BLUE_RAMP, out_dir, "gba_height", clamp_max=GBA_CLAMP_MAX_M, nodata_override=-9999)


def process_dsm_dtm(out_dir):
    # Canopy/building height model = DSM - DTM (surface minus bare terrain),
    # i.e. "how tall is whatever is sitting on the ground here" -- the same
    # physical quantity GBA's height raster represents, so it gets that same
    # amber ramp/clamp rather than the terrain ramp. DTM (49x37) is coarser
    # than DSM (368x247), so it's resampled onto the DSM's own grid first.
    dsm_ds = gdal.Open(f"{DRONE_DIR}/dsm_very_low_res.tif")
    gt = dsm_ds.GetGeoTransform()
    proj = dsm_ds.GetProjection()
    width, height = dsm_ds.RasterXSize, dsm_ds.RasterYSize
    dsm_band = dsm_ds.GetRasterBand(1)
    dsm_nodata = dsm_band.GetNoDataValue()
    dsm_arr = dsm_band.ReadAsArray().astype(np.float64)

    min_x, max_y = gt[0], gt[3]
    max_x = gt[0] + width * gt[1]
    min_y = gt[3] + height * gt[5]
    # DTM's own extent is narrower than DSM's (it doesn't reach DSM's western
    # edge) -- dstNodata=-9999 is required so gdal.Warp marks the area outside
    # DTM's real coverage as nodata rather than silently filling it with 0,
    # which previously turned into a fake "huge canopy height" block (DSM -
    # 0) covering that whole uncovered strip.
    dtm_resampled = gdal.Warp(
        "", f"{DRONE_DIR}/dtm.tif", format="MEM",
        outputBounds=(min_x, min_y, max_x, max_y),
        width=width, height=height, resampleAlg="bilinear",
        dstNodata=-9999,
    )
    dtm_band = dtm_resampled.GetRasterBand(1)
    dtm_arr = dtm_band.ReadAsArray().astype(np.float64)

    mask = np.ones(dsm_arr.shape, dtype=bool)
    if dsm_nodata is not None:
        mask &= ~np.isclose(dsm_arr, dsm_nodata)
    mask &= ~np.isclose(dtm_arr, -9999)
    canopy = dsm_arr - dtm_arr
    canopy = np.clip(canopy, 0, None)  # negative = noise (DTM interpolation above DSM), not real height

    colorize_single_band(
        None, HEIGHT_BLUE_RAMP, out_dir, "dsm_dtm",
        clamp_max=GBA_CLAMP_MAX_M, array_override=(canopy, mask), geo_override=(gt, proj),
    )


def process_drone(out_dir):
    # Orthophotos: already Byte RGBA, no stretch needed -- just reproject.
    for name, src in [("low_res_image", f"{DRONE_DIR}/image_very_low_res.tif"), ("max_res_image", f"{DRONE_DIR}/image_max_res_tile.tif")]:
        warp_to_4326_png(src, f"{out_dir}/{name}.png", f"{out_dir}/{name}.bounds.json", needs_warp=True)
    # DTM/DSM: single-band elevation, colorize with a terrain ramp stretched
    # from the data's own min (not 0 -- these are absolute elevations well
    # above sea level). Both already sit in lon/lat coordinates with no
    # explicit CRS in the file, so no warp.
    colorize_single_band(f"{DRONE_DIR}/dtm.tif", TERRAIN_RAMP, out_dir, "dtm", use_data_min=True)
    colorize_single_band(f"{DRONE_DIR}/dsm_very_low_res.tif", TERRAIN_RAMP, out_dir, "dsm", use_data_min=True)
    process_dsm_dtm(out_dir)


def process_buildings(gpkg_path, out_dir):
    import geopandas as gpd

    gdf = gpd.read_file(gpkg_path)
    # survey_n_floors: this gpkg's own n_floors, under an explicit name --
    # confirmed NOT derived from height (ceil(height/3) matches it only 34%
    # of the time), i.e. it already is the survey/raw-data floor count, not
    # a height-divided estimate. Kept alongside n_floors (unchanged) rather
    # than renaming it, so nothing else that reads n_floors breaks.
    gdf["survey_n_floors"] = gdf["n_floors"]
    dst = f"{out_dir}/buildings.geojson"
    gdf.to_crs(epsg=4326).to_file(dst, driver="GeoJSON")
    print(f"  wrote {dst}")


def main():
    for dataset_id, info in DATASETS.items():
        out_dir = f"{OUT_ROOT}/{dataset_id}"
        import os

        os.makedirs(out_dir, exist_ok=True)
        print(f"=== {dataset_id} ===")
        process_buildings(info["gpkg"], out_dir)
        process_gba(dataset_id, info["cache"], out_dir)
        if dataset_id == "quisquella":
            process_drone(out_dir)


if __name__ == "__main__":
    main()
