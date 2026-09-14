#!/usr/bin/env python3
"""Rebuild the structural-system map's data from the new (2026-09-12)
experiment outputs -- replaces the old ml_structural_system/*.gpkg pipeline.

Sources (READ-ONLY -- never modified):
- code/data/SantoDomingo/{EnsancheQuisquella,Naco}/*_footprint_attributes_pass.gpkg
  -- the authoritative per-building base: geometry, id/dataset/city (the
  3-column unique key), height/year/code_quality/roof_material/n_floors,
  survey_structural_system (raw survey ground truth), and all 15 bare shape
  parameters. One row per building, already deduplicated.
- BerlinConference/experiment_outputs/<experiment>/inference/full_dataset_predictions.gpkg
  -- one such file per experiment (13 total), each covering ALL cities'
  buildings pooled together (San Jose/Guatemala/Santo Domingo), tagged by its
  own `dataset`/`city`/`id` columns matching the base files' key.
- BerlinConference/experiment_outputs/<experiment>/report/results.json --
  per-experiment metrics/generalizability/confusion matrices/feature
  importance/learning curve/class distribution.

Join key: (id, dataset, city) together identify one physical building row --
confirmed unique within both the base files and each experiment's inference
file (per dataset). Since city is constant ("Santo Domingo") for both our
datasets and dataset already scopes which base file we're joining into, a
plain `id` merge after filtering the experiment file to this dataset's rows
is sufficient and exact.

Column de-duplication: an experiment's own inference gpkg re-exports several
columns that are just copies of the base file's own per-building attributes
(height, year, code_quality, all 15 shape params, contact_*) -- same name,
same values, "the same column" per the brief, not a new one to prefix and
duplicate 13 times over. Those are dropped from every experiment and read
once from the base file instead. Only genuinely experiment-specific outputs
(split, predictions, probabilities, uncertainty, the ensemble read-out) get
kept, each prefixed with the experiment name so e.g. "split" from 13
different experiments doesn't collide -- santo_domingo_split,
loo_santo_domingo_split, etc.

A few further redundant/superseded columns inside each experiment's own file
are also dropped (kept the newer, clearer name): `pred_<model>`/`ensemble_pred`
/`majority_vote` (int-coded aliases of the string `<model>_prediction` /
`ensemble_prediction`), `proba_CR`/`proba_M`/`agreement_ratio`/
`normalized_entropy`/`is_contested` (older aliases of `ensemble_<class>_probability`
/`ensemble_agreement_ratio`/`ensemble_entropy_uncertainty`), `y_true` (numeric
alias of the kept string `ground_truth`), and the one-hot `roof_material_*`/
`relativePosition_*` columns (redundant with the base file's own
`roof_material`/`relativePosition` categorical columns).
"""
import json
import os
import re

import geopandas as gpd
import pandas as pd

CODE_DATA_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/code/data/SantoDomingo"
EXPERIMENTS_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/experiment_outputs"
OUT_ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/structural_system"

# out_name -> (base gpkg path, `dataset` column value in the experiment files)
DATASETS = {
    "quisquella": (
        f"{CODE_DATA_ROOT}/EnsancheQuisquella/santo_domingo_pilot_region_footprint_attributes_pass.gpkg",
        "santo_domingo_pilot_region",
    ),
    "naco": (
        f"{CODE_DATA_ROOT}/Naco/santo_domingo_naco_footprint_attributes_pass.gpkg",
        "santo_domingo_naco",
    ),
}

EXPERIMENTS = sorted(
    name
    for name in os.listdir(EXPERIMENTS_ROOT)
    if os.path.isfile(f"{EXPERIMENTS_ROOT}/{name}/inference/full_dataset_predictions.gpkg")
)

# Columns dropped from every experiment's inference file: either a plain
# duplicate of a base-file column (checked dynamically below) or one of the
# known-redundant/superseded aliases documented in the module docstring.
DROP_ALWAYS = {
    "y_true",
    "majority_vote",
    "ensemble_pred",
    "agreement_ratio",
    "normalized_entropy",
    "is_contested",
    "geometry",
    "dataset",
    "city",
}
DROP_PATTERNS = [
    re.compile(r"^pred_\w+$"),
    re.compile(r"^proba_\w+$"),
    re.compile(r"^roof_material_\w+$"),
    re.compile(r"^relativePosition_\w+$"),
]


def load_base(path):
    gdf = gpd.read_file(path)
    return gdf.to_crs(epsg=4326)


def experiment_columns_to_keep(all_cols, base_cols):
    keep = []
    for c in all_cols:
        if c in ("id",):
            continue
        if c in DROP_ALWAYS or c in base_cols:
            continue
        if any(p.match(c) for p in DROP_PATTERNS):
            continue
        keep.append(c)
    return keep


def merge_experiment(base_df, experiment, dataset_value, base_cols):
    path = f"{EXPERIMENTS_ROOT}/{experiment}/inference/full_dataset_predictions.gpkg"
    gdf = gpd.read_file(path, ignore_geometry=True)
    gdf = gdf[gdf["dataset"] == dataset_value]
    if gdf.empty:
        return base_df
    keep = experiment_columns_to_keep(gdf.columns, base_cols)
    sub = gdf[["id", *keep]].copy()
    dup = sub["id"].duplicated()
    if dup.any():
        print(f"    WARNING: {experiment} has {dup.sum()} duplicate ids for {dataset_value}, keeping first")
        sub = sub[~dup]
    for col in keep:
        if sub[col].dtype.kind == "f":
            sub[col] = sub[col].round(4)
    rename = {c: f"{experiment}_{c}" for c in keep}
    sub = sub.rename(columns=rename)
    merged = base_df.merge(sub, on="id", how="left")
    matched = merged[f"{experiment}_split"].notna().sum() if f"{experiment}_split" in merged else sub.shape[0]
    print(f"    {experiment}: {len(keep)} columns kept, {matched}/{len(base_df)} buildings matched")
    return merged


def build_results_json():
    """One shared results.json (metrics are experiment-level, not
    per-dataset -- an experiment's test set can span both datasets at once)."""
    results = {}
    for experiment in EXPERIMENTS:
        path = f"{EXPERIMENTS_ROOT}/{experiment}/report/results.json"
        if not os.path.exists(path):
            continue
        with open(path) as f:
            results[experiment] = json.load(f)
    out_path = f"{OUT_ROOT}/results.json"
    with open(out_path, "w") as f:
        json.dump(results, f)
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"wrote {out_path} ({size_mb:.1f} MB, {len(results)} experiments)")


def main():
    for out_name, (base_path, dataset_value) in DATASETS.items():
        print(f"=== {out_name} ({dataset_value}) ===")
        base_df = load_base(base_path)
        base_cols = set(base_df.columns) - {"geometry"}
        print(f"  base: {len(base_df)} rows, {len(base_cols)} columns")

        merged = base_df
        for experiment in EXPERIMENTS:
            merged = merge_experiment(merged, experiment, dataset_value, base_cols)

        os.makedirs(f"{OUT_ROOT}/{out_name}", exist_ok=True)
        out_path = f"{OUT_ROOT}/{out_name}/buildings.gpkg"
        if os.path.exists(out_path):
            os.remove(out_path)
        merged.to_file(out_path, driver="GPKG")
        size_mb = os.path.getsize(out_path) / (1024 * 1024)
        print(f"  wrote {out_path}: {len(merged)} rows, {len(merged.columns)} columns ({size_mb:.1f} MB)")

    build_results_json()


if __name__ == "__main__":
    main()
