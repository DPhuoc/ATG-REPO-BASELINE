#!/usr/bin/env python3
import csv
import json
from pathlib import Path

OUT = Path("experiments/scale_trace/manifests/corpus_manifest.csv")

SOURCES = [
    ("train", "random_v1", Path("paper2/data/raw/random_graphs")),
    ("holdout", "holdout", Path("paper2/data/raw/holdout_graphs")),
    ("hard_holdout", "hard_holdout", Path("paper2/data/raw/hard_holdout_graphs")),
]

rows = []

for split, default_family, root in SOURCES:
    if not root.exists():
        print(f"SKIP missing source dir: {root}")
        continue

    for p in sorted(root.glob("*.json")):
        try:
            atg = json.loads(p.read_text())
        except Exception as e:
            print(f"SKIP invalid json {p}: {e}")
            continue

        meta = atg.get("meta", {})
        graph_id = meta.get("graph_id", p.stem)
        family = meta.get("family", default_family)
        leader = atg.get("leader", "")

        rows.append({
            "graph_id": graph_id,
            "family": family,
            "split": split,
            "leader": leader,
            "atg_path": str(p),
        })

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["graph_id", "family", "split", "leader", "atg_path"])
    w.writeheader()
    w.writerows(rows)

print({"written": str(OUT), "rows": len(rows)})
