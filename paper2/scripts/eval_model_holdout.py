#!/usr/bin/env python3
import math
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

TRAIN = Path("paper2/data/processed/dataset_clean.csv")
TEST = Path("paper2/data/processed/holdout_dataset.csv")
OUTDIR = Path("paper2/model")

NUM_FEATURES = [
    "num_levels",
    "sum_options",
    "max_options_per_level",
    "disable_steps_worst",
    "has_multi_level",
    "has_multi_option",
]
CAT_FEATURES = ["contract_type"]
TARGETS = ["deploy_gas", "worst_claim_gas", "refund_gas"]

def mape(y_true, y_pred):
    denom = y_true.where(y_true != 0, 1.0)
    return float((((y_true - y_pred).abs() / denom).mean()) * 100.0)

def make_encoder():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)

def build_pipeline():
    prep = ColumnTransformer([
        ("num", "passthrough", NUM_FEATURES),
        ("cat", make_encoder(), CAT_FEATURES),
    ])
    return Pipeline([
        ("prep", prep),
        ("model", LinearRegression())
    ])

def prep_df(df):
    for c in ["has_multi_level", "has_multi_option"]:
        df[c] = df[c].astype(str).str.lower().eq("true").astype(int)
    for c in NUM_FEATURES + TARGETS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df

def main():
    OUTDIR.mkdir(parents=True, exist_ok=True)

    train = pd.read_csv(TRAIN)
    test = pd.read_csv(TEST)

    train = train[
        (train["source_kind"] == "atg_analysis") &
        (train["ok"].astype(str).str.lower() == "true")
    ].copy()

    test = test[
        (test["source_kind"] == "holdout_analysis") &
        (test["ok"].astype(str).str.lower() == "true")
    ].copy()

    train = prep_df(train)
    test = prep_df(test)

    metrics = []
    pred_rows = []

    for target in TARGETS:
        tr = train[train[target].notna()].copy()
        te = test[test[target].notna()].copy()

        pipe = build_pipeline()
        pipe.fit(tr[NUM_FEATURES + CAT_FEATURES], tr[target])
        pred = pipe.predict(te[NUM_FEATURES + CAT_FEATURES])

        mae = mean_absolute_error(te[target], pred)
        mape_pct = mape(te[target], pd.Series(pred))
        r2 = r2_score(te[target], pred)

        metrics.append({
            "target": target,
            "model": "linear_holdout",
            "train_rows": len(tr),
            "test_rows": len(te),
            "mae": round(float(mae), 4),
            "mape_pct": round(float(mape_pct), 4),
            "r2": round(float(r2), 4),
        })

        tmp = te[["graph_id", "family", "pair", "contract_type", target]].copy()
        tmp["target"] = target
        tmp["actual"] = te[target].values
        tmp["predicted"] = pred
        pred_rows.append(tmp[["target", "graph_id", "family", "pair", "contract_type", "actual", "predicted"]])

    metrics_df = pd.DataFrame(metrics)
    preds_df = pd.concat(pred_rows, ignore_index=True)

    metrics_df.to_csv(OUTDIR / "holdout_metrics.csv", index=False)
    preds_df.to_csv(OUTDIR / "holdout_predictions.csv", index=False)

    print({
        "metrics_csv": str(OUTDIR / "holdout_metrics.csv"),
        "predictions_csv": str(OUTDIR / "holdout_predictions.csv"),
        "train_rows": len(train),
        "test_rows": len(test)
    })

if __name__ == "__main__":
    main()
