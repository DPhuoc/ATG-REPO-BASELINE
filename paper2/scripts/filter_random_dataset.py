#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

SRC = Path("paper2/data/processed/random_dataset.csv")
OUT = Path("paper2/data/processed/random_dataset_filtered.csv")
SUMMARY = Path("paper2/tables/random_filter_summary.csv")

df = pd.read_csv(SRC)

for c in ["num_levels", "sum_options", "max_options_per_level", "disable_steps_worst",
          "deploy_gas", "worst_claim_gas", "refund_gas"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")

# Graph-level filter:
# keep graph if ALL rows satisfy these bounds
# bounds chosen to stay close to current curated/holdout families
graph_stats = df.groupby("graph_id").agg(
    rows=("graph_id", "size"),
    max_num_levels=("num_levels", "max"),
    max_sum_options=("sum_options", "max"),
    max_max_options=("max_options_per_level", "max"),
    max_disable=("disable_steps_worst", "max"),
)

keep_graphs = graph_stats[
    (graph_stats["rows"] >= 3) &
    (graph_stats["rows"] <= 20) &
    (graph_stats["max_num_levels"] <= 2) &
    (graph_stats["max_sum_options"] <= 6) &
    (graph_stats["max_max_options"] <= 4) &
    (graph_stats["max_disable"] <= 1)
].index

filtered = df[df["graph_id"].isin(keep_graphs)].copy()

OUT.parent.mkdir(parents=True, exist_ok=True)
filtered.to_csv(OUT, index=False)

summary = pd.DataFrame([{
    "original_rows": len(df),
    "filtered_rows": len(filtered),
    "original_graphs": df["graph_id"].nunique(),
    "filtered_graphs": filtered["graph_id"].nunique(),
}])
SUMMARY.parent.mkdir(parents=True, exist_ok=True)
summary.to_csv(SUMMARY, index=False)

print({
    "written": str(OUT),
    "summary": str(SUMMARY),
    "original_rows": len(df),
    "filtered_rows": len(filtered),
    "original_graphs": int(df["graph_id"].nunique()),
    "filtered_graphs": int(filtered["graph_id"].nunique()),
})
