#!/usr/bin/env python3
import numpy as np
import pandas as pd
from pathlib import Path

from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

DATA = Path("experiments/scale_trace/datasets/dataset_trace_pair.csv")
OUT = Path("experiments/scale_trace/models/trace_model_ablation.csv")

TARGETS = ["deploy_gas", "worst_claim_gas", "refund_gas"]

TOPO_NUM = [
    "num_levels",
    "sum_options",
    "max_options_per_level",
    "disable_steps_worst",
]

CAT = ["contract_type"]

TRACE_DEPLOY_CORE = [
    "actual_deploy_calldata_bytes",
    "actual_deploy_sstore_count",
    "actual_deploy_call_count",
]

TRACE_WORST_CORE = [
    "actual_worst_path_calldata_bytes",
    "actual_worst_path_sstore_count",
    "actual_worst_path_call_count",
]

TRACE_REFUND_CORE = [
    "actual_refund_path_calldata_bytes",
    "actual_refund_path_sstore_count",
    "actual_refund_path_call_count",
]

TRACE_DEPLOY_FULL = TRACE_DEPLOY_CORE + ["actual_deploy_opcode_steps"]
TRACE_WORST_FULL = TRACE_WORST_CORE + ["actual_worst_path_opcode_steps"]
TRACE_REFUND_FULL = TRACE_REFUND_CORE + ["actual_refund_path_opcode_steps"]


def mape(y_true, y_pred):
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.where(y_true == 0, 1.0, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100.0)


def make_encoder():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def build_pipeline(num_features, cat_features):
    prep = ColumnTransformer([
        ("num", "passthrough", num_features),
        ("cat", make_encoder(), cat_features),
    ])

    return Pipeline([
        ("prep", prep),
        ("model", LinearRegression()),
    ])


def trace_features_for(target, mode):
    if mode == "topology":
        return []

    if target == "deploy_gas":
        return TRACE_DEPLOY_CORE if mode == "trace_core" else TRACE_DEPLOY_FULL

    if target == "worst_claim_gas":
        return TRACE_WORST_CORE if mode == "trace_core" else TRACE_WORST_FULL

    if target == "refund_gas":
        return TRACE_REFUND_CORE if mode == "trace_core" else TRACE_REFUND_FULL

    raise ValueError(f"unknown target: {target}")


def features_for(target, variant):
    if variant == "topology":
        return TOPO_NUM, CAT

    if variant == "topology_plus_trace_core":
        return TOPO_NUM + trace_features_for(target, "trace_core"), CAT

    if variant == "topology_plus_trace_full":
        return TOPO_NUM + trace_features_for(target, "trace_full"), CAT

    raise ValueError(f"unknown variant: {variant}")


def clean_numeric(df, columns):
    df = df.copy()
    for c in columns:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def eval_model(df, target, variant, split):
    num_features, cat_features = features_for(target, variant)
    cols = num_features + cat_features

    train = df[df["split"] == "train"].copy()
    test = df[df["split"] == split].copy()

    train = train[cols + [target]].dropna()
    test = test[cols + [target]].dropna()

    if len(train) < 5 or len(test) < 2:
        return {
            "target": target,
            "variant": variant,
            "test_split": split,
            "train_rows": len(train),
            "test_rows": len(test),
            "mae": "",
            "mape_pct": "",
            "r2": "",
            "status": "not enough rows",
        }

    Xtr = train[cols]
    ytr = train[target].astype(float)

    Xte = test[cols]
    yte = test[target].astype(float)

    pipe = build_pipeline(num_features, cat_features)
    pipe.fit(Xtr, ytr)
    pred = pipe.predict(Xte)

    return {
        "target": target,
        "variant": variant,
        "test_split": split,
        "train_rows": len(train),
        "test_rows": len(test),
        "mae": round(float(mean_absolute_error(yte, pred)), 4),
        "mape_pct": round(float(mape(yte, pred)), 4),
        "r2": round(float(r2_score(yte, pred)), 4),
        "status": "ok",
    }


def main():
    df = pd.read_csv(DATA)

    all_numeric = (
        TOPO_NUM +
        TRACE_DEPLOY_FULL +
        TRACE_WORST_FULL +
        TRACE_REFUND_FULL +
        TARGETS
    )

    df = clean_numeric(df, all_numeric)

    rows = []
    for target in TARGETS:
        for variant in [
            "topology",
            "topology_plus_trace_core",
            "topology_plus_trace_full",
        ]:
            for split in ["holdout", "hard_holdout"]:
                rows.append(eval_model(df, target, variant, split))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(OUT, index=False)

    print({
        "written": str(OUT),
        "rows": len(rows),
        "dataset_rows": len(df),
    })


if __name__ == "__main__":
    main()
