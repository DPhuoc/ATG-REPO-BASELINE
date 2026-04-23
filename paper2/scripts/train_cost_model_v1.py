#!/usr/bin/env python3
import math
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


DATA = "paper2/data/processed/dataset_clean.csv"
OUTDIR = Path("paper2/model")
FIGDIR = Path("paper2/figures")
NOTEDIR = Path("paper2/notes")


NUM_FEATURES = [
    "num_levels",
    "sum_options",
    "max_options_per_level",
    "disable_steps_worst",
    "has_multi_level",
    "has_multi_option",
]

CAT_FEATURES = [
    "contract_type",
]

TARGETS = [
    "deploy_gas",
    "worst_claim_gas",
    "refund_gas",
]


def ensure_dirs():
    OUTDIR.mkdir(parents=True, exist_ok=True)
    FIGDIR.mkdir(parents=True, exist_ok=True)
    NOTEDIR.mkdir(parents=True, exist_ok=True)


def make_encoder():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def build_pipeline(model):
    prep = ColumnTransformer(
        transformers=[
            ("num", "passthrough", NUM_FEATURES),
            ("cat", make_encoder(), CAT_FEATURES),
        ]
    )
    return Pipeline([
        ("prep", prep),
        ("model", model),
    ])


def load_data():
    df = pd.read_csv(DATA)

    # focus on successful ATG-compiled pair summaries only
    df = df[
        (df["source_kind"] == "atg_analysis") &
        (df["ok"].astype(str).str.lower() == "true")
    ].copy()

    if "scenario" in df.columns:
        df = df[df["scenario"] == "pair_summary"].copy()

    # normalize booleans
    for c in ["has_multi_level", "has_multi_option"]:
        df[c] = df[c].astype(str).str.lower().eq("true").astype(int)

    # numeric columns
    for c in NUM_FEATURES + TARGETS:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # keep a graph group id to avoid leakage across rows from same graph/run
    df["group_id"] = df["graph_id"].fillna(df["run_id"]).astype(str)

    return df


def mape(y_true, y_pred):
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    denom = np.where(y_true == 0, 1.0, y_true)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100.0)


def feature_names_from_pipeline(pipe):
    prep = pipe.named_steps["prep"]
    cat = prep.named_transformers_["cat"]

    num_names = list(NUM_FEATURES)
    cat_names = list(cat.get_feature_names_out(CAT_FEATURES))
    return num_names + cat_names


def save_feature_table(path, feature_names, values, value_col):
    pd.DataFrame({
        "feature": feature_names,
        value_col: values,
    }).sort_values(value_col, ascending=False, key=lambda s: s.abs()).to_csv(path, index=False)


def plot_pred_vs_actual(actual, pred, title, out_path):
    actual = np.asarray(actual, dtype=float)
    pred = np.asarray(pred, dtype=float)

    mn = min(actual.min(), pred.min())
    mx = max(actual.max(), pred.max())

    plt.figure(figsize=(4.8, 4.8))
    plt.scatter(actual, pred)
    plt.plot([mn, mx], [mn, mx], linestyle="--")
    plt.xlabel("actual")
    plt.ylabel("predicted")
    plt.title(title)
    plt.tight_layout()
    plt.savefig(out_path, dpi=160)
    plt.close()


def evaluate_target(df, target):
    sub = df[df[target].notna()].copy()
    if len(sub) < 6:
        raise RuntimeError(f"Not enough rows for target {target}: {len(sub)}")

    X = sub[NUM_FEATURES + CAT_FEATURES]
    y = sub[target].astype(float)
    groups = sub["group_id"].astype(str)

    n_groups = groups.nunique()
    n_splits = min(5, n_groups)
    if n_splits < 2:
        raise RuntimeError(f"Need at least 2 groups for grouped CV on target {target}")

    gkf = GroupKFold(n_splits=n_splits)

    models = {
        "linear": LinearRegression(),
        "rf": RandomForestRegressor(
            n_estimators=300,
            random_state=0,
            min_samples_leaf=1
        ),
    }

    metrics_rows = []
    all_pred_rows = []

    for model_name, estimator in models.items():
        oof_pred = np.full(shape=len(sub), fill_value=np.nan, dtype=float)

        for fold_idx, (tr, te) in enumerate(gkf.split(X, y, groups), start=1):
            pipe = build_pipeline(clone(estimator))
            pipe.fit(X.iloc[tr], y.iloc[tr])
            pred = pipe.predict(X.iloc[te])
            oof_pred[te] = pred

            fold_rows = pd.DataFrame({
                "target": target,
                "model": model_name,
                "graph_id": sub.iloc[te]["graph_id"].values,
                "pair": sub.iloc[te]["pair"].values,
                "contract_type": sub.iloc[te]["contract_type"].values,
                "actual": y.iloc[te].values,
                "predicted": pred,
                "fold": fold_idx,
            })
            all_pred_rows.append(fold_rows)

        mask = ~np.isnan(oof_pred)
        y_true = y.values[mask]
        y_hat = oof_pred[mask]

        mae = mean_absolute_error(y_true, y_hat)
        mape_val = mape(y_true, y_hat)
        r2 = r2_score(y_true, y_hat)

        metrics_rows.append({
            "target": target,
            "model": model_name,
            "rows": int(len(sub)),
            "groups": int(n_groups),
            "mae": round(float(mae), 4),
            "mape_pct": round(float(mape_val), 4),
            "r2": round(float(r2), 4),
        })

        # fit final model on full data for interpretation
        final_pipe = build_pipeline(clone(estimator))
        final_pipe.fit(X, y)

        feat_names = feature_names_from_pipeline(final_pipe)

        if model_name == "linear":
            coef = final_pipe.named_steps["model"].coef_
            save_feature_table(
                OUTDIR / f"coefficients_{target}_{model_name}.csv",
                feat_names,
                coef,
                "coefficient"
            )
        elif model_name == "rf":
            imp = final_pipe.named_steps["model"].feature_importances_
            save_feature_table(
                OUTDIR / f"feature_importance_{target}_{model_name}.csv",
                feat_names,
                imp,
                "importance"
            )

        plot_pred_vs_actual(
            y_true,
            y_hat,
            f"{target} ({model_name})",
            FIGDIR / f"model_{target}_{model_name}_pred_vs_actual.png"
        )

    pred_df = pd.concat(all_pred_rows, ignore_index=True)
    pred_df.to_csv(OUTDIR / f"predictions_{target}.csv", index=False)

    return metrics_rows


def write_draft(metrics_df):
    by_target = {}
    for target in TARGETS:
        sub = metrics_df[metrics_df["target"] == target].sort_values("mae")
        if len(sub):
            by_target[target] = sub.iloc[0].to_dict()

    def fmt(x):
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return ""
        return str(x)

    text = f"""# Cost model v1 draft

We train a first topology-aware gas model on successful `atg_analysis` rows only, using grouped cross-validation by graph/run id. The features are available at compile time: `num_levels`, `sum_options`, `max_options_per_level`, `disable_steps_worst`, `has_multi_level`, `has_multi_option`, and `contract_type`.

Best out-of-fold models by target:

- Deploy gas: {fmt(by_target.get('deploy_gas', {}).get('model'))}, MAE={fmt(by_target.get('deploy_gas', {}).get('mae'))}, MAPE={fmt(by_target.get('deploy_gas', {}).get('mape_pct'))}%, R²={fmt(by_target.get('deploy_gas', {}).get('r2'))}
- Worst-claim gas: {fmt(by_target.get('worst_claim_gas', {}).get('model'))}, MAE={fmt(by_target.get('worst_claim_gas', {}).get('mae'))}, MAPE={fmt(by_target.get('worst_claim_gas', {}).get('mape_pct'))}%, R²={fmt(by_target.get('worst_claim_gas', {}).get('r2'))}
- Refund gas: {fmt(by_target.get('refund_gas', {}).get('model'))}, MAE={fmt(by_target.get('refund_gas', {}).get('mae'))}, MAPE={fmt(by_target.get('refund_gas', {}).get('mape_pct'))}%, R²={fmt(by_target.get('refund_gas', {}).get('r2'))}

This model is still a sanity-check model rather than the final paper model: the dataset is small and dominated by synthetic ATG families. Still, if the out-of-fold errors are reasonably low and the linear coefficients align with intuition (e.g. more levels, more options, and more disable steps increase gas), then the result is already strong evidence that compile-time topology features are predictive enough to guide optimization.
"""
    with open(NOTEDIR / "model_v1_draft.md", "w") as f:
        f.write(text)


def main():
    ensure_dirs()
    df = load_data()

    # save the exact modeling subset
    df.to_csv(OUTDIR / "model_dataset.csv", index=False)

    metrics = []
    for target in TARGETS:
        metrics.extend(evaluate_target(df, target))

    metrics_df = pd.DataFrame(metrics)
    metrics_df.to_csv(OUTDIR / "model_metrics.csv", index=False)

    write_draft(metrics_df)

    print({
        "rows_in_model_dataset": int(len(df)),
        "unique_groups": int(df["group_id"].nunique()),
        "metrics_csv": str(OUTDIR / "model_metrics.csv"),
        "model_dataset_csv": str(OUTDIR / "model_dataset.csv"),
        "figures_dir": str(FIGDIR),
        "draft": str(NOTEDIR / "model_v1_draft.md"),
    })


if __name__ == "__main__":
    main()
