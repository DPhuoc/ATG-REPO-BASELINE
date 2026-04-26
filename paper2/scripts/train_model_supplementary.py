#!/usr/bin/env python3
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

TRAIN = Path("paper2/data/processed/dataset_clean.csv")
HOLDOUT = Path("paper2/data/processed/holdout_dataset.csv")
OUT = Path("paper2/model/supplementary_metrics.csv")

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

def prep_df(df):
    df = df.copy()
    for c in ["has_multi_level", "has_multi_option"]:
        if c in df.columns:
            df[c] = df[c].astype(str).str.lower().eq("true").astype(int)
    for c in NUM + TARGETS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df

def build(model):
    prep = ColumnTransformer([
        ("num", "passthrough", NUM),
        ("cat", make_encoder(), CAT),
    ])
    return Pipeline([
        ("prep", prep),
        ("model", model),
    ])

train = pd.read_csv(TRAIN)
holdout = pd.read_csv(HOLDOUT)

train = train[(train["source_kind"] == "atg_analysis") & (train["ok"].astype(str).str.lower() == "true")].copy()
holdout = holdout[(holdout["source_kind"] == "holdout_analysis") & (holdout["ok"].astype(str).str.lower() == "true")].copy()

train = prep_df(train)
holdout = prep_df(holdout)

models = {
    "rf": RandomForestRegressor(n_estimators=300, random_state=0),
    "gbr": GradientBoostingRegressor(random_state=0),
}

rows = []

for target in TARGETS:
    tr = train[train[target].notna()].copy()
    te = holdout[holdout[target].notna()].copy()

    Xtr = tr[NUM + CAT]
    ytr = tr[target].astype(float)
    Xte = te[NUM + CAT]
    yte = te[target].astype(float)
    groups = tr["graph_id"].astype(str)
    gkf = GroupKFold(n_splits=min(5, groups.nunique()))

    for name, model in models.items():
        # grouped CV
        pred_cv = np.full(len(tr), np.nan)
        for tr_idx, te_idx in gkf.split(Xtr, ytr, groups):
            pipe = build(model)
            pipe.fit(Xtr.iloc[tr_idx], ytr.iloc[tr_idx])
            pred_cv[te_idx] = pipe.predict(Xtr.iloc[te_idx])

        cv_mask = ~np.isnan(pred_cv)
        cv_mae = mean_absolute_error(ytr.iloc[cv_mask], pred_cv[cv_mask])
        cv_mape = mape(ytr.iloc[cv_mask], pred_cv[cv_mask])
        cv_r2 = r2_score(ytr.iloc[cv_mask], pred_cv[cv_mask])

        # holdout
        pipe = build(model)
        pipe.fit(Xtr, ytr)
        pred_ho = pipe.predict(Xte)
        ho_mae = mean_absolute_error(yte, pred_ho)
        ho_mape = mape(yte, pred_ho)
        ho_r2 = r2_score(yte, pred_ho)

        rows.append({
            "target": target,
            "model": name,
            "cv_mae": round(float(cv_mae), 4),
            "cv_mape_pct": round(float(cv_mape), 4),
            "cv_r2": round(float(cv_r2), 4),
            "holdout_mae": round(float(ho_mae), 4),
            "holdout_mape_pct": round(float(ho_mape), 4),
            "holdout_r2": round(float(ho_r2), 4),
        })

pd.DataFrame(rows).to_csv(OUT, index=False)
print({"written": str(OUT), "rows": len(rows)})
