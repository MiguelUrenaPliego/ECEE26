#!/usr/bin/env python3
"""One-off preprocessing: cache/ year rasters + gpkg -> BerlinConference/data/year/.

Run inside the same gdalenv as prepare_roof_data.py / prepare_height_data.py.

Produces, per dataset, under BerlinConference/data/year/<dataset>/:
  - buildings.geojson (santo_domingo_pilot_region.gpkg / _700_buildings.gpkg,
    reprojected to 4326 -- has first_construction_year/last_modification_year)
  - sentinel.png + sentinel.bounds.json (example_sentinel2_composite_2023.tif,
    false-color SWIR1/NIR/Red composite, percentile-stretched, reprojected)
  - first_construction.png + .bounds.json (wsf_evolution_aoi.tif, year values
    1985-2015 colorized with a sequential ramp; 0 = no detection -> transparent)
"""
import json

import numpy as np
from osgeo import gdal

gdal.UseExceptions()

GPKG_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo"
CACHE_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo"
OUT_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/year"

DATASETS = {
    "quisquella": {"cache": "EnsancheQuisquella/cache", "gpkg": f"{GPKG_ROOT}/EnsancheQuisquella/santo_domingo_pilot_region.gpkg"},
    "naco": {"cache": "Naco/cache", "gpkg": f"{GPKG_ROOT}/Naco/santo_domingo_naco.gpkg"},
}

# Sequential ramp for construction year: older (dark/violet) -> newer (bright gold).
YEAR_RAMP = [(59, 48, 92), (86, 78, 140), (86, 140, 158), (140, 191, 110), (232, 197, 71)]


def ramp_color(t, ramp):
    t = min(1, max(0, t))
    scaled = t * (len(ramp) - 1)
    lo = int(scaled)
    hi = min(len(ramp) - 1, lo + 1)
    frac = scaled - lo
    return tuple(int(ramp[lo][c] + (ramp[hi][c] - ramp[lo][c]) * frac) for c in range(3))


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
    target_tif = src_tif
    if needs_warp:
        target_tif = src_tif.replace(".tif", "_4326.tif")
        gdal.Warp(target_tif, src_tif, dstSRS="EPSG:4326", resampleAlg="near", format="GTiff")
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


def percentile_stretch(band, mask, lo=2, hi=98):
    valid = band[mask]
    if valid.size == 0:
        return np.zeros(band.shape, dtype=np.uint8)
    p_lo, p_hi = np.percentile(valid, [lo, hi])
    if p_hi <= p_lo:
        p_hi = p_lo + 1
    scaled = np.clip((band - p_lo) / (p_hi - p_lo), 0, 1) * 255
    return scaled.astype(np.uint8)


def process_sentinel(dataset_dir, out_dir):
    ds = gdal.Open(f"{dataset_dir}/example_sentinel2_composite_2023.tif")
    # Bands: green(1) red(2) nir(3) swir1(4) swir2(5) -- false color
    # R=swir1 G=nir B=red highlights built-up areas distinctly from vegetation.
    swir1 = ds.GetRasterBand(4).ReadAsArray().astype(np.float64)
    nir = ds.GetRasterBand(3).ReadAsArray().astype(np.float64)
    red = ds.GetRasterBand(2).ReadAsArray().astype(np.float64)
    mask = ~np.isnan(swir1) & ~np.isnan(nir) & ~np.isnan(red)

    rgba = np.zeros((*swir1.shape, 4), dtype=np.uint8)
    rgba[:, :, 0] = percentile_stretch(swir1, mask)
    rgba[:, :, 1] = percentile_stretch(nir, mask)
    rgba[:, :, 2] = percentile_stretch(red, mask)
    rgba[:, :, 3] = np.where(mask, 255, 0).astype(np.uint8)

    tmp_tif = f"{out_dir}/_sentinel_native.tif"
    write_rgba_geotiff(tmp_tif, rgba, ds.GetGeoTransform(), ds.GetProjection())
    warp_to_4326_png(tmp_tif, f"{out_dir}/sentinel.png", f"{out_dir}/sentinel.bounds.json", needs_warp=True)
    ds = None


def process_first_construction(out_dir):
    # The wide-AOI download (34km x 34km, covering both datasets + a 15km
    # buffer) rather than each dataset's own tightly-cropped cache copy --
    # same source (WSF Evolution), just a much bigger extent so the raster
    # doesn't stop dead at the building footprints' own bounding box.
    src = f"{OUT_ROOT}/wsf/wsf_evolution_aoi.tif"
    ds = gdal.Open(src)
    arr = ds.GetRasterBand(1).ReadAsArray().astype(np.float64)
    mask = arr > 0  # 0 = no built-up detected in WSF Evolution's own encoding

    vmin, vmax = 1985, 2015
    t = np.clip((arr - vmin) / (vmax - vmin), 0, 1)
    lut = np.array([ramp_color(i / 255, YEAR_RAMP) for i in range(256)], dtype=np.uint8)
    idx = (t * 255).astype(np.uint8)

    rgba = np.zeros((*arr.shape, 4), dtype=np.uint8)
    rgba[:, :, 0] = lut[idx, 0]
    rgba[:, :, 1] = lut[idx, 1]
    rgba[:, :, 2] = lut[idx, 2]
    rgba[:, :, 3] = np.where(mask, 255, 0).astype(np.uint8)

    tmp_tif = f"{out_dir}/_first_construction_native.tif"
    write_rgba_geotiff(tmp_tif, rgba, ds.GetGeoTransform(), ds.GetProjection())
    # wsf_evolution_aoi.tif is already lon/lat (no explicit projected CRS) --
    # same situation as height map's dtm.tif/dsm_very_low_res.tif.
    # A projected CRS's WKT always embeds a base GEOGCS too, so checking
    # for GEOGCS *absence* never actually detects "needs no warp" -- the
    # real signal is the absence of a projected wrapper (PROJCS/PROJCRS).
    # (This file happens to be plain lon/lat already either way, but see
    # height/prepare_height_data.py's own fix for where this bug actually bit.)
    proj = ds.GetProjection()
    needs_warp = "PROJCS" in proj or "PROJCRS" in proj
    warp_to_4326_png(tmp_tif, f"{out_dir}/first_construction.png", f"{out_dir}/first_construction.bounds.json", needs_warp=needs_warp)
    ds = None


# Dominican Republic seismic-code eras, same table as
# code/ml_structural_system/ml_structural_system/dataset_prep/code_quality.py
# (CODE_YEAR_TABLES["dominican_republic"]) -- kept as a literal copy rather
# than importing that package (this script runs standalone with plain
# geopandas, no ml_structural_system install available).
DR_CODE_YEAR_THRESHOLDS = [(1979, "low_code"), (2011, "medium_code")]


def year_to_code_quality(year):
    if year is None or (isinstance(year, float) and year != year):  # NaN
        return None
    quality = "pre_code"
    for threshold_year, label in DR_CODE_YEAR_THRESHOLDS:
        if year >= threshold_year:
            quality = label
    return quality


def process_buildings(gpkg_path, out_dir):
    import geopandas as gpd

    gdf = gpd.read_file(gpkg_path)
    # "effective year" for the code-quality mapping: last modification if
    # known, else first construction -- per the brief ("use the latest
    # modification and if it is None then use the first construction year").
    effective_year = gdf["last_modification_year"].where(gdf["last_modification_year"].notna(), gdf["first_construction_year"])
    gdf["code_quality_effective_year"] = effective_year
    gdf["code_quality"] = effective_year.map(year_to_code_quality)

    dst = f"{out_dir}/buildings.geojson"
    gdf.to_crs(epsg=4326).to_file(dst, driver="GeoJSON")
    print(f"  wrote {dst} (code_quality: {gdf['code_quality'].value_counts(dropna=False).to_dict()})")


def main():
    import os

    for dataset_id, info in DATASETS.items():
        out_dir = f"{OUT_ROOT}/{dataset_id}"
        os.makedirs(out_dir, exist_ok=True)
        print(f"=== {dataset_id} ===")
        process_buildings(info["gpkg"], out_dir)
        process_sentinel(f"{CACHE_ROOT}/{info['cache']}/year", out_dir)
        process_first_construction(out_dir)


if __name__ == "__main__":
    main()
