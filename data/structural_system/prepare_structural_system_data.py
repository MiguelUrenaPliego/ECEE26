#!/usr/bin/env python3
"""Second stage: BerlinConference/data/structural_system/{name}/buildings.gpkg
(the full per-dataset merge built by build_structural_system_gpkg.py) ->
the lighter files the map actually fetches:
  - {name}/buildings.geojson: geometry + base attributes + ground truth,
    loaded eagerly.
  - {name}/{experiment}.json: one experiment's predictions, keyed by `id`,
    fetched lazily when that experiment is selected (Naco's ~14k buildings x
    5 models x 7 experiments made one combined file too large).

Only the 7 experiments whose predictions actually cover Santo Domingo
buildings are split out here (the other 6 in results.json -- guatemala,
guatemala_no_roof_code_year, san_jose, san_jose_no_roof_code_year,
mata_redonda_to_esquivel, zona1_to_zona10 -- are single-city runs with no
Santo Domingo rows at all, confirmed empty during the gpkg merge).

Run with plain `python3` (geopandas only).
"""
import json
import os
import re

import geopandas as gpd

ROOT = "/home/miguel/Documents/Proyectos/SismicaUPM/BerlinConference/data/structural_system"

DATASETS = ["quisquella", "naco"]

EXPERIMENTS = [
    "santo_domingo",
    "santo_domingo_no_roof_code_year",
    "ensanche_quisquella_to_naco",
    "loo_santo_domingo",
]

BASE_COLUMNS = [
    "id",
    "survey_structural_system",
    "height",
    "n_floors",
    "code_quality",
    "roof_material",
    "year",
    "relativePosition",
    "geometry",
]


def main():
    for name in DATASETS:
        print(f"=== {name} ===")
        gpkg_path = f"{ROOT}/{name}/buildings.gpkg"
        gdf = gpd.read_file(gpkg_path)
        all_cols = set(gdf.columns)

        base_keep = [c for c in BASE_COLUMNS if c in all_cols]
        base_gdf = gdf[base_keep]
        out_path = f"{ROOT}/{name}/buildings.geojson"
        base_gdf.to_file(out_path, driver="GeoJSON")
        size_mb = os.path.getsize(out_path) / (1024 * 1024)
        print(f"  base: {len(base_gdf)} rows, {len(base_keep)} columns, wrote {out_path} ({size_mb:.1f} MB)")

        # "santo_domingo_" is itself a prefix of "santo_domingo_no_roof_code_year_"
        # -- process longest experiment names first and remove their matched
        # columns from the pool so a shorter name never re-claims a longer
        # one's columns.
        remaining_cols = set(all_cols)
        for exp in sorted(EXPERIMENTS, key=len, reverse=True):
            prefix = f"{exp}_"
            present = sorted(c for c in remaining_cols if c.startswith(prefix))
            if not present:
                print(f"  {exp}: no columns found, skipping")
                continue
            remaining_cols -= set(present)

            exp_df = gdf[["id", *present]].copy()
            for col in present:
                if exp_df[col].dtype.kind == "f":
                    exp_df[col] = exp_df[col].round(4)
            # Strip the "{exp}_" prefix for a smaller/simpler per-file schema
            # -- the experiment is already implied by the filename.
            rename = {c: c[len(prefix) :] for c in present}
            exp_df = exp_df.rename(columns=rename)
            # Plain .where(df.notna(), None) silently gets re-coerced back to
            # float NaN by pandas on a mixed-dtype frame (it looks fixed
            # until you round-trip through JSON, which then emits the bare
            # token NaN -- invalid JSON, breaks JSON.parse() in the
            # browser) -- .astype(object) first prevents that recoercion.
            records = exp_df.astype(object).where(exp_df.notna(), None).set_index("id").to_dict(orient="index")

            exp_path = f"{ROOT}/{name}/{exp}.json"
            with open(exp_path, "w") as f:
                json.dump(records, f, separators=(",", ":"))
            exp_size_mb = os.path.getsize(exp_path) / (1024 * 1024)
            print(f"  {exp}: {len(present)} columns, wrote {exp_path} ({exp_size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
