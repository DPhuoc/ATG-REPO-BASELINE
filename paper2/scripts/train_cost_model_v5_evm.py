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

TRAIN = Path("paper2/data/processed/dataset_clean_evm.csv")
HOLDOUT = Path("paper2/data/processed/holdout_dataset_evm.csv")
HARD = Path("paper2/data/processed/hard_holdout_dataset_evm.csv")
OUT = Path("paper2/model/model_v5_evm_metrics.csv")
DROP_SUMMARY = Path("paper2/model/model_v5_evm_drop_summary.csv")

TARGETS = ["deploy_gas", "worst_claim_gas", "refund_gas"]

DEPLOY_NUM = [
    "num_levels",
    "sum_options",
    "max_options_per_level",
    "deploy_sstore_cold_est",
]

WORST_NUM = [
    "disable_steps_worst",
    "num_hash_checks_est",
    "estimated_worst_path_calldata_bytes",
    "worst_sstore_cold_est",
    "sum_options",
]

REFUND_NUM = [
    "disable_steps_worst",
    "estimated_refund_path_calldata_bytes",
    "refund_sstore_cold_est",
]

CAT = ["contract_type"]

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

def features_for(target):
    if target == "deploy_gas":
        return DEPLOY_NUM, CAT
    if target == "worst_claim_gas":
        return WORST_NUM, CAT
    return REFUND_NUM, CAT

def build(num_features, cat_features):
    prep = ColumnTransformer([
        ("num", "passthrough", num_features),
        ("cat", make_encoder(), cat_features),
    ])
    return Pipeline([
        ("prep", prep),
        ("model", LinearRegression())
    ])

def prep(df):
    df = df.copy()

    # normalize booleans if present
    for c in ["has_multi_level", "has_multi_option"]:
        if c in df.columns:
            df[c] = df[c].astype(str).str.lower().eq("true").astype(int)

    # numeric conversion
    for c in df.columns:
        if c.endswith("_est") or c in TARGETS or c in ["num_levels", "sum_options", "max_options_per_level", "disable_steps_worst"]:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # safe categorical handling
    if "contract_type" in df.columns:
        df["contract_type"] = df["contract_type"].fillna("UNKNOWN").astype(str)

    return df

def load_split(path, expected_source_kind):
    df = prep(pd.read_csv(path))
    df = df[
        (df["source_kind"].astype(str) == expected_source_kind) &
        (df["ok"].astype(str).str.lower() == "true")
    ].copy()
    return df

def clean_rows(df, cols, target, need_group=False):
    needed = cols + [target]
    if need_group:
        needed = needed + ["graph_id"]

    before = len(df)
    out = df[needed].dropna().copy()
    dropped = before - len(out)
    return out, before, dropped

def main():
    train = load_split(TRAIN, "atg_analysis")
    holdout = load_split(HOLDOUT, "holdout_analysis")
    hard = load_split(HARD, "hard_holdout_analysis")

    rows = []
    drop_rows = []

    for target in TARGETS:
        numf, catf = features_for(target)
        cols = numf + catf

        tr, tr_before, tr_dropped = clean_rows(train, cols, target, need_group=True)
        te, te_before, te_dropped = clean_rows(holdout, cols, target, need_group=False)
        th, th_before, th_dropped = clean_rows(hard, cols, target, need_group=False)

        drop_rows.append({
            "target": target,
            "train_before": tr_before,
            "train_after": len(tr),
            "train_dropped": tr_dropped,
            "holdout_before": te_before,
            "holdout_after": len(te),
            "holdout_dropped": te_dropped,
            "hard_before": th_before,
            "hard_after": len(th),
            "hard_dropped": th_dropped,
        })

        Xtr = tr[cols]
        ytr = tr[target].astype(float)
        groups = tr["graph_id"].astype(str)

        n_groups = groups.nunique()
        if n_groups < 2:
            raise RuntimeError(f"Need at least 2 groups for {target}, got {n_groups}")

        gkf = GroupKFold(n_splits=min(5, n_groups))

        pred_cv = np.full(len(tr), np.nan)
        for tr_idx, te_idx in gkf.split(Xtr, ytr, groups):
            pipe = build(numf, catf)
            pipe.fit(Xtr.iloc[tr_idx], ytr.iloc[tr_idx])
            pred_cv[te_idx] = pipe.predict(Xtr.iloc[te_idx])

        mask = ~np.isnan(pred_cv)
        cv_mae = mean_absolute_error(ytr.iloc[mask], pred_cv[mask])
        cv_mape = mape(ytr.iloc[mask], pred_cv[mask])
        cv_r2 = r2_score(ytr.iloc[mask], pred_cv[mask])

        # fit on full train
        pipe = build(numf, catf)
        pipe.fit(Xtr, ytr)

        # regular holdout
        Xte = te[cols]
        yte = te[target].astype(float)
        pred_ho = pipe.predict(Xte)
        ho_mae = mean_absolute_error(yte, pred_ho)
        ho_mape = mape(yte, pred_ho)
        ho_r2 = r2_score(yte, pred_ho)

        # hard holdout
        Xh = th[cols]
        yh = th[target].astype(float)
        pred_hard = pipe.predict(Xh)
        hard_mae = mean_absolute_error(yh, pred_hard)
        hard_mape = mape(yh, pred_hard)
        hard_r2 = r2_score(yh, pred_hard)

        rows.append({
            "target": target,
            "model": "linear_evm_v5",
            "train_rows": len(tr),
            "cv_mae": round(float(cv_mae), 4),
            "cv_mape_pct": round(float(cv_mape), 4),
            "cv_r2": round(float(cv_r2), 4),
            "holdout_rows": len(te),
            "holdout_mae": round(float(ho_mae), 4),
            "holdout_mape_pct": round(float(ho_mape), 4),
            "holdout_r2": round(float(ho_r2), 4),
            "hard_holdout_rows": len(th),
            "hard_holdout_mae": round(float(hard_mae), 4),
            "hard_holdout_mape_pct": round(float(hard_mape), 4),
            "hard_holdout_r2": round(float(hard_r2), 4),
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(OUT, index=False)
    pd.DataFrame(drop_rows).to_csv(DROP_SUMMARY, index=False)

    print({
        "written_metrics": str(OUT),
        "written_drop_summary": str(DROP_SUMMARY),
        "train_rows": len(train),
        "holdout_rows": len(holdout),
        "hard_rows": len(hard),
    })

if __name__ == "__main__":
    main()
