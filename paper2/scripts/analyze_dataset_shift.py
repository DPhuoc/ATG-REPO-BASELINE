#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

BASE = Path("paper2/data/processed/dataset_clean.csv")
RAND = Path("paper2/data/processed/random_dataset.csv")
HOLD = Path("paper2/data/processed/holdout_dataset.csv")

OUT1 = Path("paper2/tables/dataset_shift_overview.csv")
OUT2 = Path("paper2/tables/dataset_shift_patterns.csv")

def prep(df):
    df = df.copy()
    for c in ["num_levels", "sum_options", "max_options_per_level", "disable_steps_worst",
              "deploy_gas", "worst_claim_gas", "refund_gas"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df

base = prep(pd.read_csv(BASE))
rand = prep(pd.read_csv(RAND))
hold = prep(pd.read_csv(HOLD))

base = base[(base["source_kind"] == "atg_analysis") & (base["ok"].astype(str).str.lower() == "true")].copy()
rand = rand[(rand["source_kind"] == "random_analysis") & (rand["ok"].astype(str).str.lower() == "true")].copy()
hold = hold[(hold["source_kind"] == "holdout_analysis") & (hold["ok"].astype(str).str.lower() == "true")].copy()

splits = {
    "base": base,
    "random": rand,
    "holdout": hold,
}

overview_rows = []
for name, df in splits.items():
    overview_rows.append({
        "dataset": name,
        "rows": len(df),
        "graphs": df["graph_id"].nunique(),
        "median_num_levels": df["num_levels"].median(),
        "median_sum_options": df["sum_options"].median(),
        "median_max_options_per_level": df["max_options_per_level"].median(),
        "median_disable_steps_worst": df["disable_steps_worst"].median(),
        "median_deploy_gas": df["deploy_gas"].median(),
        "median_worst_claim_gas": df["worst_claim_gas"].median(),
        "median_refund_gas": df["refund_gas"].median(),
        "pct_multi_level": (df["has_multi_level"].astype(str).str.lower().eq("true").mean() * 100.0),
        "pct_multi_option": (df["has_multi_option"].astype(str).str.lower().eq("true").mean() * 100.0),
    })

overview = pd.DataFrame(overview_rows)
OUT1.parent.mkdir(parents=True, exist_ok=True)
overview.to_csv(OUT1, index=False)

pattern_rows = []
for name, df in splits.items():
    grp = df.groupby("pattern")
    for pat, sub in grp:
        pattern_rows.append({
            "dataset": name,
            "pattern": pat,
            "count": len(sub),
            "median_deploy_gas": sub["deploy_gas"].median(),
            "median_worst_claim_gas": sub["worst_claim_gas"].median(),
            "median_refund_gas": sub["refund_gas"].median(),
        })

patterns = pd.DataFrame(pattern_rows).sort_values(["dataset", "pattern"])
patterns.to_csv(OUT2, index=False)

print({
    "overview_csv": str(OUT1),
    "patterns_csv": str(OUT2),
    "base_rows": len(base),
    "random_rows": len(rand),
    "holdout_rows": len(hold),
})
