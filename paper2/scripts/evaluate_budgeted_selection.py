#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

SRC = Path("paper2/data/processed/leader_family_runs.csv")
OUT = Path("paper2/tables/budgeted_selection_summary.csv")

df = pd.read_csv(SRC)
df = df[df["ok_all"].astype(str).str.lower() == "true"].copy()

for c in ["deploy_gas", "worst_claim_gas", "refund_gas"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")

# Use empirical deploy budgets from the leader-sensitive family itself
budgets = {
    "low": int(df["deploy_gas"].quantile(0.25)),
    "medium": int(df["deploy_gas"].quantile(0.50)),
    "high": int(df["deploy_gas"].quantile(0.75)),
}

rows = []

for label, B in budgets.items():
    feasible_graphs = 0
    improved_graphs = 0
    same_as_original = 0
    worst_claim_improvements = []

    for gid, sub in df.groupby("graph_id"):
        orig = sub[sub["leader_role"] == "original"]
        if orig.empty:
            continue
        orig = orig.iloc[0]

        feasible = sub[sub["deploy_gas"] <= B].copy()
        if feasible.empty:
            continue

        feasible_graphs += 1

        # Pick the feasible realization with minimum worst-claim,
        # then refund, then deploy as tie-breakers
        feasible = feasible.sort_values(
            ["worst_claim_gas", "refund_gas", "deploy_gas"],
            ascending=[True, True, True]
        )
        chosen = feasible.iloc[0]

        if chosen["leader"] == orig["leader"]:
            same_as_original += 1

        if chosen["worst_claim_gas"] < orig["worst_claim_gas"]:
            improved_graphs += 1
            rel = 100.0 * (orig["worst_claim_gas"] - chosen["worst_claim_gas"]) / orig["worst_claim_gas"]
            worst_claim_improvements.append(rel)

    rows.append({
        "budget_label": label,
        "budget_value": B,
        "feasible_graphs": feasible_graphs,
        "same_as_original_count": same_as_original,
        "improved_graphs": improved_graphs,
        "mean_worst_claim_improvement_pct": round(sum(worst_claim_improvements)/len(worst_claim_improvements), 4) if worst_claim_improvements else 0.0,
    })

OUT.parent.mkdir(parents=True, exist_ok=True)
pd.DataFrame(rows).to_csv(OUT, index=False)
print({"written": str(OUT), "rows": len(rows)})
