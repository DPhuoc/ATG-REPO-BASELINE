#!/usr/bin/env python3
import csv
import json
from pathlib import Path

ROOT = Path("paper2/data/raw/random_runs")
OUT = Path("paper2/data/processed/random_dataset.csv")

def dup_stats(s):
    parts = [p.strip() for p in str(s or "").split("|") if p.strip()]
    vals = [int(x) for x in parts] if parts else []
    if not vals:
        return 0, 0
    return sum(vals), max(vals)

rows = []

for run_dir in sorted(ROOT.glob("*")):
    if not run_dir.is_dir():
        continue

    atg_file = run_dir / "source_atg.json"
    analysis_file = run_dir / "analysis.csv"
    if not atg_file.exists() or not analysis_file.exists():
        continue

    atg = json.loads(atg_file.read_text())
    meta = atg.get("meta", {})
    family = meta.get("family", "random_v1")
    graph_id = meta.get("graph_id", run_dir.name)

    with analysis_file.open(newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            ok = str(r.get("okAll", "")).lower() == "true"
            if not ok:
                continue

            levels = int(float(r.get("levels", 0)))
            dup_vec = r.get("duplicateVector", "")
            sum_options, max_options = dup_stats(dup_vec)
            pattern = r.get("pattern", "")

            rows.append({
                "source_kind": "random_analysis",
                "graph_id": graph_id,
                "family": family,
                "pair": r.get("pair", ""),
                "contract_type": r.get("contract", ""),
                "scenario": "pair_summary",
                "num_levels": levels,
                "sum_options": sum_options,
                "max_options_per_level": max_options,
                "pattern": pattern,
                "has_multi_level": "true" if "multi-level" in pattern else "false",
                "has_multi_option": "true" if "multi-option" in pattern else "false",
                "disable_steps_worst": max(0, levels - 1),
                "deploy_gas": r.get("deployGasDecimal", ""),
                "best_claim_gas": r.get("bestClaimGas", ""),
                "worst_claim_gas": r.get("worstClaimGas", ""),
                "refund_gas": r.get("refundGas", ""),
                "ok": "true",
                "source_path": str(analysis_file.resolve()),
            })

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", newline="") as f:
    headers = list(rows[0].keys()) if rows else []
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    writer.writerows(rows)

print({"written": str(OUT), "rows": len(rows)})
