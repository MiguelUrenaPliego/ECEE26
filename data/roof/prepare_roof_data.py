#!/usr/bin/env python3
"""One-off preprocessing: cache/ rasters+gpkg -> BerlinConference/data/roof/.

Run with /usr/bin/python3 (has osgeo.gdal + numpy; the venv python3 on PATH
does not). Produces, per dataset:
  - multispectral.png + multispectral.bounds.json  (true-color B04/B03/B02
    composite of fused_bands.tif, percentile-stretched, reprojected to
    EPSG:4326, transparent outside the AOI mask)
  - clusters.png + clusters.bounds.json  (kmeans_clusters_4.tif recolored
    by roof_material via cluster_mapping.yaml, using the exact same
    palette the buildings/legend use in main.js -- ROOF_MATERIAL_COLORS
    below must be kept in sync with that file by hand)
  - buildings.geojson  (buildings_roof_material.gpkg reprojected to 4326)
  - pixels_per_cluster.json, cluster_spectral_centroids.json,
    cluster_mapping.json  (copied/converted as-is, these feed the two
    graphs)
"""
import json
import subprocess
import sys

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()

CACHE_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo"
OUT_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/roof"

# Keep in sync with ROOF_MATERIAL_COLORS in maps/roof_material/main.js.
# Picked for hue separation (gray/cream/blue/purple), not just lightness, so
# the 4 classes stay distinguishable in both the raster and the chart lines.
ROOF_MATERIAL_COLORS = {
    "asphalt": (107, 114, 128),
    "bright_concrete": (242, 227, 179),
    "metallic": (66, 153, 225),
    "dark_shadow": (135, 68, 173),
    "unlabeled": (201, 201, 194),
}

DATASETS = {
    "quisquella": "EnsancheQuisquella/cache",
    "naco": "Naco/cache",
}

# The *target* gpkg (not this roof_output's own buildings_roof_material.gpkg)
# carries height/n_floors -- joined in below so the map can extrude buildings
# by their real height instead of a flat placeholder.
TARGET_GPKG = {
    "quisquella": "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo/EnsancheQuisquella/santo_domingo_pilot_region.gpkg",
    "naco": "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo/Naco/santo_domingo_naco.gpkg",
}


def read_cluster_mapping(path):
    mapping = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.endswith(":"):
                continue
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            if key.isdigit():
                mapping[int(key)] = value
    return mapping


def percentile_stretch(band, mask, lo=2, hi=98):
    valid = band[mask]
    if valid.size == 0:
        return np.zeros(band.shape, dtype=np.uint8)
    p_lo, p_hi = np.percentile(valid, [lo, hi])
    if p_hi <= p_lo:
        p_hi = p_lo + 1
    scaled = (band - p_lo) / (p_hi - p_lo)
    scaled = np.clip(scaled, 0, 1) * 255
    return scaled.astype(np.uint8)


def write_rgba_geotiff(path, rgba, geotransform, projection):
    driver = gdal.GetDriverByName("GTiff")
    height, width, _ = rgba.shape
    ds = driver.Create(path, width, height, 4, gdal.GDT_Byte)
    ds.SetGeoTransform(geotransform)
    ds.SetProjection(projection)
    for i in range(4):
        band = ds.GetRasterBand(i + 1)
        band.WriteArray(rgba[:, :, i])
    ds.FlushCache()
    ds = None


def warp_to_4326_png(src_tif, out_png, out_bounds_json):
    warped_tif = src_tif.replace(".tif", "_4326.tif")
    gdal.Warp(
        warped_tif,
        src_tif,
        dstSRS="EPSG:4326",
        resampleAlg="near",
        dstAlpha=False,  # source already carries its own alpha band
        format="GTiff",
    )
    ds = gdal.Open(warped_tif)
    width, height = ds.RasterXSize, ds.RasterYSize
    gt = ds.GetGeoTransform()
    min_lon = gt[0]
    max_lat = gt[3]
    max_lon = gt[0] + width * gt[1]
    min_lat = gt[3] + height * gt[5]
    arr = np.dstack([ds.GetRasterBand(i + 1).ReadAsArray() for i in range(ds.RasterCount)])
    from PIL import Image

    Image.fromarray(arr, mode="RGBA" if arr.shape[2] == 4 else "RGB").save(out_png, optimize=True)
    with open(out_bounds_json, "w") as f:
        json.dump({"west": min_lon, "south": min_lat, "east": max_lon, "north": max_lat}, f)
    ds = None
    print(f"  wrote {out_png} ({width}x{height}), bounds -> {out_bounds_json}")


def process_multispectral(dataset_dir, out_dir):
    fused = f"{dataset_dir}/fused_bands.tif"
    clusters = f"{dataset_dir}/kmeans_clusters_4_full_extent.tif"
    ds = gdal.Open(fused)
    # Band order per DATA_OVERVIEW.txt: B02,B03,B04,B05,... -> true color
    # R=B04(3), G=B03(2), B=B02(1), 1-based.
    r = ds.GetRasterBand(3).ReadAsArray().astype(np.float64)
    g = ds.GetRasterBand(2).ReadAsArray().astype(np.float64)
    b = ds.GetRasterBand(1).ReadAsArray().astype(np.float64)

    cluster_ds = gdal.Open(clusters)
    cluster_arr = cluster_ds.GetRasterBand(1).ReadAsArray()
    mask = cluster_arr >= 0  # -1 = nodata/outside AOI, same grid as fused_bands

    rgba = np.zeros((*r.shape, 4), dtype=np.uint8)
    rgba[:, :, 0] = percentile_stretch(r, mask)
    rgba[:, :, 1] = percentile_stretch(g, mask)
    rgba[:, :, 2] = percentile_stretch(b, mask)
    rgba[:, :, 3] = np.where(mask, 255, 0).astype(np.uint8)

    tmp_tif = f"{out_dir}/_multispectral_native.tif"
    write_rgba_geotiff(tmp_tif, rgba, ds.GetGeoTransform(), ds.GetProjection())
    warp_to_4326_png(tmp_tif, f"{out_dir}/multispectral.png", f"{out_dir}/multispectral.bounds.json")
    ds = None
    cluster_ds = None


def process_clusters(dataset_dir, out_dir):
    # Full-extent variant (whole AOI, ~98-99.99% valid) rather than the
    # original building-masked one (~30% valid) -- see this repo's own
    # code/roof/src/roof_material/config.py::export_full_extent_cluster_raster.
    clusters = f"{dataset_dir}/kmeans_clusters_4_full_extent.tif"
    mapping = read_cluster_mapping(f"{dataset_dir}/cluster_mapping.yaml")
    ds = gdal.Open(clusters)
    arr = ds.GetRasterBand(1).ReadAsArray()

    rgba = np.zeros((*arr.shape, 4), dtype=np.uint8)
    for cluster_id, material in mapping.items():
        color = ROOF_MATERIAL_COLORS.get(material, ROOF_MATERIAL_COLORS["unlabeled"])
        sel = arr == cluster_id
        rgba[sel, 0] = color[0]
        rgba[sel, 1] = color[1]
        rgba[sel, 2] = color[2]
        rgba[sel, 3] = 255
    # nodata (-1) / anything unmapped stays alpha 0 (already zero-initialized)

    tmp_tif = f"{out_dir}/_clusters_native.tif"
    write_rgba_geotiff(tmp_tif, rgba, ds.GetGeoTransform(), ds.GetProjection())
    warp_to_4326_png(tmp_tif, f"{out_dir}/clusters.png", f"{out_dir}/clusters.bounds.json")
    ds = None


def process_buildings(dataset_dir, target_gpkg, out_dir):
    import geopandas as gpd

    roof_gdf = gpd.read_file(f"{dataset_dir}/buildings_roof_material.gpkg")
    target_gdf = gpd.read_file(target_gpkg).to_crs(roof_gdf.crs)
    # 'id' is NOT a shared key -- roof_output's own buildings_roof_material.gpkg
    # and the target gpkg were independently (re-)indexed (confirmed: id=0 in
    # one lines up with id=1 in the other purely by range-overlap coincidence,
    # not a real correspondence). The geometries themselves are identical
    # (same source footprints), so match on rounded centroid instead.
    roof_gdf["_cx"] = roof_gdf.geometry.centroid.x.round(6)
    roof_gdf["_cy"] = roof_gdf.geometry.centroid.y.round(6)
    target_gdf["_cx"] = target_gdf.geometry.centroid.x.round(6)
    target_gdf["_cy"] = target_gdf.geometry.centroid.y.round(6)
    target_dedup = target_gdf.drop_duplicates(subset=["_cx", "_cy"])[["_cx", "_cy", "n_floors", "height"]]
    merged = roof_gdf.merge(target_dedup, on=["_cx", "_cy"], how="left").drop(columns=["_cx", "_cy"])
    matched = merged["height"].notna().sum()
    print(f"  matched height/n_floors for {matched}/{len(merged)} buildings")
    dst = f"{out_dir}/buildings.geojson"
    merged.to_crs(epsg=4326).to_file(dst, driver="GeoJSON")
    print(f"  wrote {dst}")


def process_graph_data(dataset_dir, out_dir):
    import shutil

    shutil.copy(f"{dataset_dir}/pixels_per_cluster.json", f"{out_dir}/pixels_per_cluster.json")
    shutil.copy(f"{dataset_dir}/cluster_spectral_centroids.json", f"{out_dir}/cluster_spectral_centroids.json")
    mapping = read_cluster_mapping(f"{dataset_dir}/cluster_mapping.yaml")
    with open(f"{out_dir}/cluster_mapping.json", "w") as f:
        json.dump({str(k): v for k, v in mapping.items()}, f)
    print("  wrote pixels_per_cluster.json, cluster_spectral_centroids.json, cluster_mapping.json")


def main():
    for out_name, cache_name in DATASETS.items():
        dataset_dir = f"{CACHE_ROOT}/{cache_name}/roof/roof_output"
        out_dir = f"{OUT_ROOT}/{out_name}"
        print(f"=== {out_name} ({cache_name}) ===")
        process_multispectral(dataset_dir, out_dir)
        process_clusters(dataset_dir, out_dir)
        process_buildings(dataset_dir, TARGET_GPKG[out_name], out_dir)
        process_graph_data(dataset_dir, out_dir)


if __name__ == "__main__":
    main()
