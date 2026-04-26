#!/usr/bin/env python3
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

TRAIN = Path("paper2/data/processed/dataset_expanded_filtered.csv")
HOLDOUT = Path("paper2/data/processed/holdout_dataset.csv")
OUT = Path("paper2/model/filtered_expanded_linear_metrics.csv")

NUM = ["num_levels", "sum_options", "max_options_per_level", "disable_steps_worst"]
CAT = ["contract_type"]
TARGETS = ["deploy_gas", "worst_claim_gas", "refund_gas"]

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

train = prep(pd.read_csv(TRAIN))
holdout = prep(pd.read_csv(HOLDOUT))

rows = []
for target in TARGETS:
    tr = train[train[target].notna()].copy()
    te = holdout[holdout[target].notna()].copy()
    Xtr, ytr = tr[NUM + CAT], tr[target].astype(float)
    Xte, yte = te[NUM + CAT], te[target].astype(float)
    groups = tr["graph_id"].astype(str)
    gkf = GroupKFold(n_splits=min(5, groups.nunique()))

    pred_cv = np.full(len(tr), np.nan)
    for tr_idx, te_idx in gkf.split(Xtr, ytr, groups):
        pipe = build()
        pipe.fit(Xtr.iloc[tr_idx], ytr.iloc[tr_idx])
        pred_cv[te_idx] = pipe.predict(Xtr.iloc[te_idx])

    mask = ~np.isnan(pred_cv)
    cv_mae = mean_absolute_error(ytr.iloc[mask], pred_cv[mask])
    cv_mape = mape(ytr.iloc[mask], pred_cv[mask])
    cv_r2 = r2_score(ytr.iloc[mask], pred_cv[mask])

    pipe = build()
    pipe.fit(Xtr, ytr)
    pred_ho = pipe.predict(Xte)
    ho_mae = mean_absolute_error(yte, pred_ho)
    ho_mape = mape(yte, pred_ho)
    ho_r2 = r2_score(yte, pred_ho)

    rows.append({
        "target": target,
        "model": "linear_reduced_filtered_expanded",
        "train_rows": len(tr),
        "test_rows": len(te),
        "cv_mae": round(float(cv_mae), 4),
        "cv_mape_pct": round(float(cv_mape), 4),
        "cv_r2": round(float(cv_r2), 4),
        "holdout_mae": round(float(ho_mae), 4),
        "holdout_mape_pct": round(float(ho_mape), 4),
        "holdout_r2": round(float(ho_r2), 4),
    })

pd.DataFrame(rows).to_csv(OUT, index=False)
print({"written": str(OUT), "rows": len(rows)})
