#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="paper2/data/raw/hard_holdout_graphs"
OUT_DIR="paper2/data/raw/hard_holdout_runs"

mkdir -p "$OUT_DIR"

for atg in "$SRC_DIR"/*.json; do
  name=$(basename "$atg" .json)
  echo "=== Running $name ==="

  pkill -f ganache || true
  fuser -k 8545/tcp || true

  node bench/run_atg_suite.js --atg "$atg" >/dev/null

  RUN=$(ls -dt results/atg-bench-* | head -n1)

  node tools/summarize_atg_results.js \
    --compiled "$RUN/compiled.atg.json" \
    --summary "$RUN/summary.json" \
    --out "$RUN/analysis.csv" >/dev/null

  mkdir -p "$OUT_DIR/$name"
  cp "$atg" "$OUT_DIR/$name/source_atg.json"
  cp "$RUN/compiled.atg.json" "$OUT_DIR/$name/compiled.atg.json"
  cp "$RUN/summary.json" "$OUT_DIR/$name/summary.json"
  cp "$RUN/analysis.csv" "$OUT_DIR/$name/analysis.csv"
done

echo "Done. Hard hold-out raw runs saved to $OUT_DIR"
