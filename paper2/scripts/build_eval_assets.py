#!/usr/bin/env python3
import csv
import math
import os
import statistics as st
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


RUNS_CSV = "paper2/data/processed/leader_family_runs.csv"
SUMMARY_CSV = "paper2/data/processed/leader_family_summary.csv"
DATASET_CSV = "paper2/data/processed/dataset_clean.csv"

FIG_DIR = "paper2/figures"
TAB_DIR = "paper2/tables"
NOTE_DIR = "paper2/notes"


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def to_float(x):
    try:
        return float(x)
    except Exception:
        return math.nan


def to_int(x):
    try:
        return int(float(x))
    except Exception:
        return None


def write_csv(path, rows, headers):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        w.writerows(rows)


def pct_str(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return ""
    return f"{x:.2f}"


def median_safe(xs):
    xs = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return st.median(xs) if xs else None


def mean_safe(xs):
    xs = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return sum(xs) / len(xs) if xs else None


def plot_metric(summary_rows, direct_value, metric_orig, metric_best, title, ylabel, out_path):
    rows = [r for r in summary_rows if r["direct"] == direct_value]
    rows = sorted(rows, key=lambda r: int(r["options"]))

    if not rows:
        return

    xs = [int(r["options"]) for r in rows]
    ys_orig = [to_float(r[metric_orig]) for r in rows]
    ys_best = [to_float(r[metric_best]) for r in rows]

    plt.figure(figsize=(6.5, 4.2))
    plt.plot(xs, ys_orig, marker="o", label="original leader")
    plt.plot(xs, ys_best, marker="o", label="best leader")
    plt.xlabel("number of alternate options")
    plt.ylabel(ylabel)
    plt.title(title)
    plt.xticks(xs)
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_path, dpi=160)
    plt.close()


def plot_topology_bar(rows, metric_key, title, ylabel, out_path):
    order = [
        "single-level",
        "single-level+multi-option",
        "multi-level",
        "multi-level+multi-option",
    ]
    vals = []
    labels = []
    for pat in order:
        if pat in rows:
            labels.append(pat)
            vals.append(rows[pat][metric_key])

    if not labels:
        return

    plt.figure(figsize=(7.2, 4.4))
    plt.bar(labels, vals)
    plt.xlabel("compiled pair pattern")
    plt.ylabel(ylabel)
    plt.title(title)
    plt.xticks(rotation=18, ha="right")
    plt.tight_layout()
    plt.savefig(out_path, dpi=160)
    plt.close()


def main():
    os.makedirs(FIG_DIR, exist_ok=True)
    os.makedirs(TAB_DIR, exist_ok=True)
    os.makedirs(NOTE_DIR, exist_ok=True)

    runs = read_csv(RUNS_CSV)
    summary = read_csv(SUMMARY_CSV)
    dataset = read_csv(DATASET_CSV)

    # ---- Table 1: leader-selection stats
    graph_ids_by_direct = defaultdict(set)
    for r in runs:
        graph_ids_by_direct[r["direct"]].add(r["graph_id"])

    rows_stats = []
    for direct_value in sorted(graph_ids_by_direct.keys()):
        comp = [r for r in summary if r["direct"] == direct_value]
        total_graphs = len(graph_ids_by_direct[direct_value])
        compared_graphs = len(comp)
        already_best = total_graphs - compared_graphs

        worst_impr = [to_float(r["worst_claim_improvement_pct"]) for r in comp]
        refund_impr = [to_float(r["refund_improvement_pct"]) for r in comp]

        contract_changes = sum(
            1 for r in comp if r["original_contract"] != r["best_contract"]
        )
        pattern_changes = sum(
            1 for r in comp if r["original_pattern"] != r["best_pattern"]
        )

        rows_stats.append({
            "direct": direct_value,
            "total_graphs": total_graphs,
            "compared_graphs": compared_graphs,
            "already_best_graphs": already_best,
            "contract_changes": contract_changes,
            "pattern_changes": pattern_changes,
            "mean_worst_claim_improvement_pct": pct_str(mean_safe(worst_impr)),
            "median_worst_claim_improvement_pct": pct_str(median_safe(worst_impr)),
            "mean_refund_improvement_pct": pct_str(mean_safe(refund_impr)),
            "median_refund_improvement_pct": pct_str(median_safe(refund_impr)),
        })

    write_csv(
        os.path.join(TAB_DIR, "leader_selection_stats.csv"),
        rows_stats,
        [
            "direct",
            "total_graphs",
            "compared_graphs",
            "already_best_graphs",
            "contract_changes",
            "pattern_changes",
            "mean_worst_claim_improvement_pct",
            "median_worst_claim_improvement_pct",
            "mean_refund_improvement_pct",
            "median_refund_improvement_pct",
        ],
    )

    # ---- Table 2: topology effects on D->B
    d2b = [
        r for r in dataset
        if r.get("pair") == "D->B|evm|fund:db"
        and r.get("source_kind") == "atg_analysis"
        and r.get("ok") == "true"
    ]

    by_pattern = defaultdict(list)
    for r in d2b:
        by_pattern[r["pattern"]].append(r)

    topology_rows = []
    for pattern, rows in sorted(by_pattern.items()):
        deploys = [to_float(r["deploy_gas"]) for r in rows]
        worsts = [to_float(r["worst_claim_gas"]) for r in rows]
        refunds = [to_float(r["refund_gas"]) for r in rows]
        topology_rows.append({
            "pattern": pattern,
            "count": len(rows),
            "median_deploy_gas": int(median_safe(deploys)),
            "median_worst_claim_gas": int(median_safe(worsts)),
            "median_refund_gas": int(median_safe(refunds)),
        })

    write_csv(
        os.path.join(TAB_DIR, "topology_effects.csv"),
        topology_rows,
        ["pattern", "count", "median_deploy_gas", "median_worst_claim_gas", "median_refund_gas"],
    )

    # Helper map for topology bar plots
    topo_map = {r["pattern"]: {
        "median_deploy_gas": r["median_deploy_gas"],
        "median_worst_claim_gas": r["median_worst_claim_gas"],
        "median_refund_gas": r["median_refund_gas"],
    } for r in topology_rows}

    # ---- Figures
    plot_metric(
        summary, "false",
        "original_worst_claim_gas", "best_worst_claim_gas",
        "Leader selection impact on worst-claim gas (direct=false)",
        "worst-claim gas",
        os.path.join(FIG_DIR, "leader_worst_claim_direct_false.png"),
    )

    plot_metric(
        summary, "true",
        "original_worst_claim_gas", "best_worst_claim_gas",
        "Leader selection impact on worst-claim gas (direct=true)",
        "worst-claim gas",
        os.path.join(FIG_DIR, "leader_worst_claim_direct_true.png"),
    )

    plot_metric(
        summary, "false",
        "original_refund_gas", "best_refund_gas",
        "Leader selection impact on refund gas (direct=false)",
        "refund gas",
        os.path.join(FIG_DIR, "leader_refund_direct_false.png"),
    )

    plot_metric(
        summary, "true",
        "original_refund_gas", "best_refund_gas",
        "Leader selection impact on refund gas (direct=true)",
        "refund gas",
        os.path.join(FIG_DIR, "leader_refund_direct_true.png"),
    )

    plot_topology_bar(
        topo_map,
        "median_worst_claim_gas",
        "Topology effect on worst-claim gas for pair D->B",
        "median worst-claim gas",
        os.path.join(FIG_DIR, "topology_worst_claim.png"),
    )

    plot_topology_bar(
        topo_map,
        "median_deploy_gas",
        "Topology effect on deploy gas for pair D->B",
        "median deploy gas",
        os.path.join(FIG_DIR, "topology_deploy.png"),
    )

    # ---- Draft Evaluation text
    stats_by_direct = {r["direct"]: r for r in rows_stats}
    s_false = stats_by_direct.get("false", {})
    s_true = stats_by_direct.get("true", {})

    draft = f"""# Evaluation draft

## Leader selection changes the compiled structure and cost

On the leader-sensitive family, the best leader differs from the original leader on most non-trivial cases. For `direct=false`, the original leader is already optimal in {s_false.get('already_best_graphs', '0')} case(s), while the remaining cases show that choosing the best leader reduces worst-claim gas by a mean of {s_false.get('mean_worst_claim_improvement_pct', '')}% and a median of {s_false.get('median_worst_claim_improvement_pct', '')}%. Refund gas remains essentially unchanged, with a mean change of {s_false.get('mean_refund_improvement_pct', '')}%. In these cases, the main structural simplification is the removal of multi-option structure.

For `direct=true`, choosing the best leader reduces worst-claim gas by a mean of {s_true.get('mean_worst_claim_improvement_pct', '')}% and a median of {s_true.get('median_worst_claim_improvement_pct', '')}%. Refund gas decreases by a mean of {s_true.get('mean_refund_improvement_pct', '')}% and a median of {s_true.get('median_refund_improvement_pct', '')}%. Here the optimization is stronger: the compiled target pair collapses from a multi-level or multi-level+multi-option structure to a single-level one. This removes disable steps and often changes the contract family from `CTLCMultipleEdges` to `CTLCOnly`.

## Topology strongly predicts gas

Across the collected ATG-compiled runs for the target pair `D->B`, single-level patterns have the lowest median worst-claim and refund costs. Single-level+multi-option raises deployment and claim costs. Multi-level raises worst-claim and refund costs further due to the extra disable step. Multi-level+multi-option is the most expensive structure overall. This supports the paper's central claim for the follow-up work: the gas behavior of an ATG realization is strongly governed by the topology of the compiled pair.
"""

    with open(os.path.join(NOTE_DIR, "evaluation_draft.md"), "w") as f:
        f.write(draft)

    print({
        "figures": sorted(os.listdir(FIG_DIR)),
        "tables": sorted(os.listdir(TAB_DIR)),
        "draft": os.path.join(NOTE_DIR, "evaluation_draft.md"),
    })


if __name__ == "__main__":
    main()
