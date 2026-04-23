#!/usr/bin/env bash
set -euo pipefail

OUTROOT="${1:-paper2/data/raw/leader_family}"
CSV_OUT="${2:-paper2/data/processed/leader_family_runs.csv}"
PAIR="D->B|evm|fund:db"

mkdir -p "$OUTROOT" "$(dirname "$CSV_OUT")"
rm -f "$CSV_OUT"

for direct in false true; do
  for options in 1 2 3 4; do
    graph_id="leaderfam_direct${direct}_opt${options}"
    atg="$OUTROOT/${graph_id}.json"
    search_json="$OUTROOT/${graph_id}.leader_search.json"
    search_csv="$OUTROOT/${graph_id}.leader_search.csv"
    emit_dir="$OUTROOT/${graph_id}_leaders"

    echo "=== $graph_id ==="

    node tools/generate_leader_sensitive_family.js \
      --out "$atg" \
      --direct "$direct" \
      --options "$options"

    node tools/search_leader.js \
      --atg "$atg" \
      --objective balanced \
      --out "$search_json" \
      --csv "$search_csv" \
      --emitDir "$emit_dir" >/dev/null

    ORIGINAL="A"
    BEST=$(node -e "const x=require('./${search_json}'); console.log(x.best_leader)")

    leaders=("original:$ORIGINAL")
    if [ "$BEST" != "$ORIGINAL" ]; then
      leaders+=("best:$BEST")
    fi

    for item in "${leaders[@]}"; do
      role="${item%%:*}"
      leader="${item##*:}"

      echo " -> role=$role leader=$leader"

      pkill -f ganache || true
      fuser -k 8545/tcp || true

      node bench/run_atg_suite.js \
        --atg "$emit_dir/leader_${leader}.json" \
        --pair "$PAIR" \
        --retries 3 >/dev/null

      RUN=$(ls -dt results/atg-bench-* | head -n1)

      node tools/summarize_atg_results.js \
        --compiled "$RUN/compiled.atg.json" \
        --summary "$RUN/summary.json" \
        --out "$RUN/analysis.csv" >/dev/null

      node tools/append_leader_family_row.js \
        --search "$search_json" \
        --analysis "$RUN/analysis.csv" \
        --out "$CSV_OUT" \
        --graphId "$graph_id" \
        --direct "$direct" \
        --options "$options" \
        --leaderRole "$role" \
        --leader "$leader" \
        --pair "$PAIR" >/dev/null
    done
  done
done

echo "Wrote: $CSV_OUT"
