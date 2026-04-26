#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-paper2/data/raw/random_graphs}"
LIMIT="${2:-50}"
OUTDIR="paper2/data/raw/random_runs"

mkdir -p "$OUTDIR"

i=0
for atg in "$SRC"/*.json; do
  i=$((i+1))
  if [ "$i" -gt "$LIMIT" ]; then
    break
  fi

  name=$(basename "$atg" .json)
  echo "=== $name ==="

  pkill -f ganache || true
  fuser -k 8545/tcp || true

  node bench/run_atg_suite.js --atg "$atg" >/dev/null

  RUN=$(ls -dt results/atg-bench-* | head -n1)

  node tools/summarize_atg_results.js \
    --compiled "$RUN/compiled.atg.json" \
    --summary "$RUN/summary.json" \
    --out "$RUN/analysis.csv" >/dev/null

  mkdir -p "$OUTDIR/$name"
  cp "$atg" "$OUTDIR/$name/source_atg.json"
  cp "$RUN/compiled.atg.json" "$OUTDIR/$name/compiled.atg.json"
  cp "$RUN/summary.json" "$OUTDIR/$name/summary.json"
  cp "$RUN/analysis.csv" "$OUTDIR/$name/analysis.csv"
done

echo "Done."
