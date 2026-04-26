#!/usr/bin/env python3
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

HARD = Path("paper2/data/processed/hard_holdout_dataset.csv")
OUT = Path("paper2/model/hard_holdout_model_compare.csv")

NUM = ["num_levels", "sum_options", "max_options_per_level", "disable_steps_worst"]
CAT = ["contract_type"]
TARGETS = ["deploy_gas", "worst_claim_gas", "refund_gas"]

TRAINSETS = {
    "linear_reduced_main": Path("paper2/data/processed/dataset_clean.csv"),
    "linear_reduced_filtered_expanded": Path("paper2/data/processed/dataset_expanded_filtered.csv"),
}

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

def prep(df):
    df = df.copy()
    for c in ["has_multi_level", "has_multi_option"]:
        if c in df.columns:
            df[c] = df[c].astype(str).str.lower().eq("true").astype(int)
    for c in NUM + TARGETS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df

def build():
    prepper = ColumnTransformer([
        ("num", "passthrough", NUM),
        ("cat", make_encoder(), CAT),
    ])
    return Pipeline([("prep", prepper), ("model", LinearRegression())])

hard = prep(pd.read_csv(HARD))
rows = []

for model_name, train_path in TRAINSETS.items():
    train = prep(pd.read_csv(train_path))

    if model_name == "linear_reduced_main":
        train = train[(train["source_kind"] == "atg_analysis") & (train["ok"].astype(str).str.lower() == "true")].copy()

    for target in TARGETS:
        tr = train[train[target].notna()].copy()
        te = hard[hard[target].notna()].copy()

        Xtr, ytr = tr[NUM + CAT], tr[target].astype(float)
        Xte, yte = te[NUM + CAT], te[target].astype(float)

        pipe = build()
        pipe.fit(Xtr, ytr)
        pred = pipe.predict(Xte)

        rows.append({
            "target": target,
            "model": model_name,
            "train_rows": len(tr),
            "test_rows": len(te),
            "mae": round(float(mean_absolute_error(yte, pred)), 4),
            "mape_pct": round(float(mape(yte, pred)), 4),
            "r2": round(float(r2_score(yte, pred)), 4),
        })

pd.DataFrame(rows).to_csv(OUT, index=False)
print({"written": str(OUT), "rows": len(rows)})
