#!/usr/bin/env python3
"""Build one complete per-dataset GeoPackage under BerlinConference/data/unified/,
merging every column from the ml_structural_system source (1136 columns:
structural_system ground truth + all 19 model-experiment prediction/probability
columns + engineered shape-feature columns -- see
data/ml_structural_system/COLUMNS.md) with the columns the roof/height/year
maps already rely on but that ml_structural_system's own files don't carry
(gba_height, first_construction_year, last_modification_year, survey_n_floors).

Run with plain `python3` (geopandas only, no GDAL raster bindings needed).

Join key: NOT `id` (confirmed unreliable -- see prepare_roof_data.py's own
comment on the same issue: independently-indexed files, the same id string
can land on different buildings). Geometries are confirmed identical across
all these files (same source footprints, verified by exact centroid match),
so buildings are matched on rounded centroid instead, same as
prepare_roof_data.py's own join.
"""
import geopandas as gpd

ML_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/ml_structural_system"
GPKG_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo"
OUT_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/unified"

DATASETS = {
    "quisquella": {
        "ml_gpkg": f"{ML_ROOT}/ensanche_quisquella.gpkg",
        "target_gpkg": f"{GPKG_ROOT}/EnsancheQuisquella/santo_domingo_pilot_region.gpkg",
    },
    "naco": {
        "ml_gpkg": f"{ML_ROOT}/naco.gpkg",
        "target_gpkg": f"{GPKG_ROOT}/Random700Sample/santo_domingo_700_buildings.gpkg",
    },
}

# Columns to pull in from the target gpkg that ml_structural_system's own
# files don't have. `n_floors` there is carried across under an explicit
# survey_n_floors name (see prepare_height_data.py's own comment: confirmed
# NOT derived from height, i.e. it's the real survey/raw-data floor count).
EXTRA_COLUMNS = {
    "gba_height": "gba_height",
    "n_floors": "survey_n_floors",
    "first_construction_year": "first_construction_year",
    "last_modification_year": "last_modification_year",
}


def add_centroid_keys(gdf, crs):
    g = gdf.to_crs(crs) if gdf.crs != crs else gdf
    out = gdf.copy()
    out["_cx"] = g.geometry.centroid.x.round(6)
    out["_cy"] = g.geometry.centroid.y.round(6)
    return out


def main():
    for name, info in DATASETS.items():
        print(f"=== {name} ===")
        ml_gdf = gpd.read_file(info["ml_gpkg"])
        target_gdf = gpd.read_file(info["target_gpkg"])

        ml_keyed = add_centroid_keys(ml_gdf, ml_gdf.crs)
        target_keyed = add_centroid_keys(target_gdf, ml_gdf.crs)

        extra = target_keyed[["_cx", "_cy", *EXTRA_COLUMNS.keys()]].rename(columns=EXTRA_COLUMNS)
        extra = extra.drop_duplicates(subset=["_cx", "_cy"])

        merged = ml_keyed.merge(extra, on=["_cx", "_cy"], how="left").drop(columns=["_cx", "_cy"])

        matched = merged["gba_height"].notna().sum()
        print(f"  {len(ml_gdf)} buildings from ml_structural_system, {len(merged.columns)} columns total")
        print(f"  matched extra columns (gba_height/survey_n_floors/first_construction_year/last_modification_year) for {matched}/{len(merged)}")

        out_path = f"{OUT_ROOT}/{name}.gpkg"
        merged.to_file(out_path, driver="GPKG")
        print(f"  wrote {out_path}")


if __name__ == "__main__":
    main()
