#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

FILES = [
    "paper2/data/processed/dataset_clean.csv",
    "paper2/data/processed/holdout_dataset.csv",
    "paper2/data/processed/hard_holdout_dataset.csv",
    "paper2/data/processed/dataset_expanded_filtered.csv",
]

def add_features(df):
    df = df.copy()

    # normalize numerics
    for c in [
        "num_levels", "sum_options", "max_options_per_level", "disable_steps_worst",
        "deploy_gas", "worst_claim_gas", "refund_gas"
    ]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # approx secrets checked on deepest claim path
    # empirical heuristic from your existing CTLC scenarios:
    # single-level -> ~2 secrets, two-level -> ~3 secrets
    df["num_hash_checks_est"] = df["num_levels"].fillna(0) + 1

    # selector + args + dynamic bytes[] payload
    # claim(uint i, bytes[] secrets): 4 + 96 + 96*n
    # claim(uint i, uint j, bytes[] secrets): 4 + 128 + 96*n
    base_claim = 4 + 96 + 96 * df["num_hash_checks_est"]
    extra_multi = df["contract_type"].astype(str).eq("CTLCMultipleEdges").astype(int) * 32
    df["estimated_claim_calldata_bytes"] = base_claim + extra_multi

    # worst path includes disableSubcontract(i) calls before final claim
    # disableSubcontract(uint i): selector + one uint arg = ~36 bytes
    df["estimated_worst_path_calldata_bytes"] = (
        df["estimated_claim_calldata_bytes"] +
        df["disable_steps_worst"].fillna(0) * 36
    )

    # refund() is selector only, plus disable path if multi-level
    df["estimated_refund_path_calldata_bytes"] = (
        4 + df["disable_steps_worst"].fillna(0) * 36
    )

    # deploy-time storage estimate (rough):
    # fixed slots + one slot per level + one slot per option + a small penalty for MultipleEdges
    df["deploy_sstore_cold_est"] = (
        2 +
        df["num_levels"].fillna(0) +
        df["sum_options"].fillna(0) +
        df["contract_type"].astype(str).eq("CTLCMultipleEdges").astype(int)
    )

    # claim path writes one "closed/withdrawn"-style slot
    df["claim_sstore_cold_est"] = 1

    # worst claim path: disable writes + final close write
    df["worst_sstore_cold_est"] = 1 + df["disable_steps_worst"].fillna(0)

    # refund path: disable writes + final refund/close write
    df["refund_sstore_cold_est"] = 1 + df["disable_steps_worst"].fillna(0)

    # warm writes: current corpus rarely rewrites same slot twice in one tx path
    df["claim_sstore_warm_est"] = 0
    df["worst_sstore_warm_est"] = 0
    df["refund_sstore_warm_est"] = 0

    # nested/external calls: terminal ETH transfer at the end of claim/refund;
    # near-constant on this corpus, so mainly for documentation
    df["claim_nested_calls_est"] = 1
    df["worst_nested_calls_est"] = 1
    df["refund_nested_calls_est"] = 1

    return df

for file in FILES:
    p = Path(file)
    if not p.exists():
        continue
    df = pd.read_csv(p)
    out = add_features(df)
    out_file = p.with_name(p.stem + "_evm.csv")
    out.to_csv(out_file, index=False)
    print({"src": str(p), "written": str(out_file), "rows": len(out)})
