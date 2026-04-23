#!/usr/bin/env python3
import math
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


TRAIN = Path("paper2/data/processed/dataset_clean.csv")
HOLDOUT = Path("paper2/data/processed/holdout_dataset.csv")
OUTDIR = Path("paper2/model")

TARGETS = ["deploy_gas", "worst_claim_gas", "refund_gas"]

FULL_NUM = [
    "num_levels",
    "sum_options",
    "max_options_per_level",
    "disable_steps_worst",
    "has_multi_level",
    "has_multi_option",
]
FULL_CAT = ["contract_type"]

REDUCED_DEPLOY_NUM = [
    "num_levels",
    "sum_options",
    "max_options_per_level",
]
REDUCED_RUNTIME_NUM = [
    "disable_steps_worst",
    "sum_options",
    "max_options_per_level",
]
REDUCED_CAT = ["contract_type"]


def make_encoder():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def mape(y_true, y_pred):
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.where(y_true == 0, 1.0, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100.0)


def prep_df(df):
    df = df.copy()
    for c in ["has_multi_level", "has_multi_option"]:
        df[c] = df[c].astype(str).str.lower().eq("true").astype(int)
    for c in FULL_NUM + TARGETS:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def feature_set_for_target(target, variant):
    if variant == "full":
        return FULL_NUM, FULL_CAT
    if variant == "reduced":
        if target == "deploy_gas":
            return REDUCED_DEPLOY_NUM, REDUCED_CAT
        return REDUCED_RUNTIME_NUM, REDUCED_CAT
    raise ValueError(f"Unknown variant: {variant}")


def build_pipeline(num_features, cat_features, model_name):
    if model_name == "linear":
        prep = ColumnTransformer([
            ("num", "passthrough", num_features),
            ("cat", make_encoder(), cat_features),
        ])
        model = LinearRegression()
    elif model_name == "ridge":
        prep = ColumnTransformer([
            ("num", Pipeline([("scaler", StandardScaler())]), num_features),
            ("cat", make_encoder(), cat_features),
        ])
        model = Ridge(alpha=1.0)
    else:
        raise ValueError(f"Unknown model_name: {model_name}")

    return Pipeline([
        ("prep", prep),
        ("model", model),
    ])


def get_feature_names(pipe, num_features, cat_features):
    cat = pipe.named_steps["prep"].named_transformers_["cat"]
    try:
        cat_names = list(cat.get_feature_names_out(cat_features))
    except Exception:
        cat_names = cat_features
    return list(num_features) + cat_names


def evaluate_cv(train_df, target, variant, model_name):
    num_features, cat_features = feature_set_for_target(target, variant)
    cols = num_features + cat_features

    sub = train_df[train_df[target].notna()].copy()
    X = sub[cols]
    y = sub[target].astype(float)
    groups = sub["graph_id"].astype(str)

    n_groups = groups.nunique()
    n_splits = min(5, n_groups)
    if n_splits < 2:
        raise RuntimeError(f"Need at least 2 groups for target={target}")

    gkf = GroupKFold(n_splits=n_splits)
    oof_pred = np.full(len(sub), np.nan)

    for tr, te in gkf.split(X, y, groups):
        pipe = build_pipeline(num_features, cat_features, model_name)
        pipe.fit(X.iloc[tr], y.iloc[tr])
        pred = pipe.predict(X.iloc[te])
        oof_pred[te] = pred

    mask = ~np.isnan(oof_pred)
    y_true = y.values[mask]
    y_hat = oof_pred[mask]

    return {
        "target": target,
        "variant": variant,
        "model": f"{model_name}_{variant}",
        "rows": int(len(sub)),
        "groups": int(n_groups),
        "mae": round(float(mean_absolute_error(y_true, y_hat)), 4),
        "mape_pct": round(float(mape(y_true, y_hat)), 4),
        "r2": round(float(r2_score(y_true, y_hat)), 4),
    }


def evaluate_holdout(train_df, holdout_df, target, variant, model_name):
    num_features, cat_features = feature_set_for_target(target, variant)
    cols = num_features + cat_features

    tr = train_df[train_df[target].notna()].copy()
    te = holdout_df[holdout_df[target].notna()].copy()

    pipe = build_pipeline(num_features, cat_features, model_name)
    pipe.fit(tr[cols], tr[target].astype(float))
    pred = pipe.predict(te[cols])

    metrics = {
        "target": target,
        "variant": variant,
        "model": f"{model_name}_{variant}",
        "train_rows": int(len(tr)),
        "test_rows": int(len(te)),
        "mae": round(float(mean_absolute_error(te[target], pred)), 4),
        "mape_pct": round(float(mape(te[target], pred)), 4),
        "r2": round(float(r2_score(te[target], pred)), 4),
    }

    preds = te[["graph_id", "family", "pair", "contract_type"]].copy()
    preds["target"] = target
    preds["variant"] = variant
    preds["model"] = f"{model_name}_{variant}"
    preds["actual"] = te[target].values
    preds["predicted"] = pred

    # save coefficients / importances from final train fit when available
    final_pipe = build_pipeline(num_features, cat_features, model_name)
    final_pipe.fit(tr[cols], tr[target].astype(float))
    feat_names = get_feature_names(final_pipe, num_features, cat_features)

    if hasattr(final_pipe.named_steps["model"], "coef_"):
        coef = final_pipe.named_steps["model"].coef_
        coef_df = pd.DataFrame({"feature": feat_names, "coefficient": coef})
        coef_df = coef_df.reindex(coef_df["coefficient"].abs().sort_values(ascending=False).index)
        coef_df.to_csv(
            OUTDIR / f"coefficients_{target}_{model_name}_{variant}.csv",
            index=False
        )

    return metrics, preds


def main():
    OUTDIR.mkdir(parents=True, exist_ok=True)

    train_df = pd.read_csv(TRAIN)
    holdout_df = pd.read_csv(HOLDOUT)

    train_df = train_df[
        (train_df["source_kind"] == "atg_analysis") &
        (train_df["ok"].astype(str).str.lower() == "true")
    ].copy()

    holdout_df = holdout_df[
        (holdout_df["source_kind"] == "holdout_analysis") &
        (holdout_df["ok"].astype(str).str.lower() == "true")
    ].copy()

    train_df = prep_df(train_df)
    holdout_df = prep_df(holdout_df)

    cv_rows = []
    holdout_rows = []
    pred_frames = []

    configs = [
        ("full", "linear"),
        ("reduced", "linear"),
        ("reduced", "ridge"),
    ]

    for target in TARGETS:
        for variant, model_name in configs:
            cv_rows.append(evaluate_cv(train_df, target, variant, model_name))
            m, preds = evaluate_holdout(train_df, holdout_df, target, variant, model_name)
            holdout_rows.append(m)
            pred_frames.append(preds)

    cv_df = pd.DataFrame(cv_rows).sort_values(["target", "mae"])
    holdout_metrics_df = pd.DataFrame(holdout_rows).sort_values(["target", "mae"])
    holdout_preds_df = pd.concat(pred_frames, ignore_index=True)

    cv_df.to_csv(OUTDIR / "model_v2_cv_metrics.csv", index=False)
    holdout_metrics_df.to_csv(OUTDIR / "model_v2_holdout_metrics.csv", index=False)
    holdout_preds_df.to_csv(OUTDIR / "model_v2_holdout_predictions.csv", index=False)

    print({
        "cv_metrics": str(OUTDIR / "model_v2_cv_metrics.csv"),
        "holdout_metrics": str(OUTDIR / "model_v2_holdout_metrics.csv"),
        "holdout_predictions": str(OUTDIR / "model_v2_holdout_predictions.csv"),
        "train_rows": int(len(train_df)),
        "holdout_rows": int(len(holdout_df)),
    })


if __name__ == "__main__":
    main()
