#!/usr/bin/env python3
"""One-off preprocessing: unified gpkg -> BerlinConference/data/shape_parameters/
and BerlinConference/data/relative_position/.

Computes RAW (physical-unit) shape/plan-irregularity parameters and the
relative-position classification directly from building footprint geometry,
using the actual `footprint_attributes` package (code/footprint_attributes) --
NOT the standardized/z-scored columns under ml_structural_system's
`ensanche_quisquella_to_naco_` experiment prefix, which can't be compared
against real seismic-code norm limits (a z-score of 1.2 means nothing next
to EC8's "eccentricity ratio > 0.30").

Also replaces the old relative_position source (a raw field-survey column
that only exists for buildings actually surveyed by hand, leaving Naco
~100% "unlabeled") with `footprint_attributes.position()`'s geometric
contact-force classification, which covers every building with a footprint
polygon (isolated/lateral/corner/confined/torque).

Run with the footprint_attributes package's own venv:
  code/footprint_attributes/.venv/bin/python prepare_shape_data.py
"""
import os
import sys

sys.path.insert(0, "/home/miguel/Documents/Proyectos/SismicaUPM/code/footprint_attributes/src")

import geopandas as gpd
import shapely
from footprint_attributes import position, shape
from footprint_attributes.geometry import ensure_projected, to_gdf

UNIFIED_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/unified"
SHAPE_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/shape_parameters"
POSITION_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/relative_position"

DATASETS = ["quisquella", "naco"]

# The 15 shape/plan-irregularity metrics used by maps/shape_parameters's
# SHAPE_ATTRIBUTES cycle (norm limits live in
# code/footprint_attributes/src/footprint_attributes/config.py; mirrored
# into maps/shape_parameters/main.js's NORM_INFO for the frontend).
SHAPE_COLUMNS = [
    "EC8_eccentricityRatio", "EC8_radiusRatio", "EC8_compactness",
    "ASCE7_setbackRatio", "ASCE7_holeRatio", "ASCE7_parallelityAngle",
    "GNDTII_beta1_mainShapeSlenderness", "GNDTII_beta2_setbackRatio",
    "GNDTII_beta4_eccentricityRatio", "GNDTII_beta6_setbackSlenderness",
    "CSCR2010_eccentricityRatio",
    "NTC23_setbackRatio", "NTC23_holeRatio",
]
SLENDERNESS_COLUMNS = ["slenderness_bbox", "slenderness_inertia"]

EXTRA_COLUMNS = ["building_uid", "height", "n_floors", "structural_system", "roof_material"]


def to_largest_polygon(geom):
    """make_valid() on a self-intersecting footprint can return a
    GeometryCollection (polygon + a degenerate line/point sliver);
    footprint_attributes requires pure Polygon geometry, so keep only the
    largest polygonal part."""
    if geom.geom_type == "Polygon":
        return geom
    parts = [g for g in shapely.get_parts(geom) if g.geom_type in ("Polygon", "MultiPolygon")]
    if not parts:
        return geom
    polys = []
    for p in parts:
        polys.extend(list(p.geoms) if p.geom_type == "MultiPolygon" else [p])
    return max(polys, key=lambda p: p.area)


def main():
    for name in DATASETS:
        print(f"=== {name} ===")
        gdf = gpd.read_file(f"{UNIFIED_ROOT}/{name}.gpkg", columns=["building_uid", "geometry"])

        # Reprojection (needed for the area/length-based shape metrics) can
        # reintroduce self-intersections in an already-repaired geometry, so
        # repair both before and after.
        gdf.geometry = gdf.geometry.make_valid()
        gdf = ensure_projected(to_gdf(gdf))
        gdf.geometry = gdf.geometry.make_valid()
        gdf.geometry = gdf.geometry.apply(to_largest_polygon)

        result = shape(gdf, columns=[*SHAPE_COLUMNS, *SLENDERNESS_COLUMNS])
        result["building_uid"] = gdf["building_uid"].values
        result["relativePosition"] = position(gdf)["relativePosition"].values

        for c in [*SHAPE_COLUMNS, *SLENDERNESS_COLUMNS]:
            print(f"  {c}: {result[c].notna().sum()}/{len(result)}")
        print("  relativePosition counts:", result["relativePosition"].value_counts().to_dict())

        result = result.to_crs(epsg=4326)

        extra = gpd.read_file(f"{UNIFIED_ROOT}/{name}.gpkg", columns=EXTRA_COLUMNS)
        merged = result.merge(extra.drop(columns="geometry"), on="building_uid", how="left")

        os.makedirs(f"{SHAPE_ROOT}/{name}", exist_ok=True)
        merged.to_file(f"{SHAPE_ROOT}/{name}/buildings.geojson", driver="GeoJSON")
        print(f"  wrote {SHAPE_ROOT}/{name}/buildings.geojson")

        pos_cols = ["building_uid", "relativePosition", "height", "n_floors", "structural_system", "roof_material", "geometry"]
        os.makedirs(f"{POSITION_ROOT}/{name}", exist_ok=True)
        merged[pos_cols].to_file(f"{POSITION_ROOT}/{name}/buildings.geojson", driver="GeoJSON")
        print(f"  wrote {POSITION_ROOT}/{name}/buildings.geojson")


if __name__ == "__main__":
    main()
