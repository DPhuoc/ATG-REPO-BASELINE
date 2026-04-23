#!/usr/bin/env python3
from pathlib import Path
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

CV = Path("paper2/model/model_v2_cv_metrics.csv")
HO = Path("paper2/model/model_v2_holdout_metrics.csv")
PRED = Path("paper2/model/model_v2_holdout_predictions.csv")

TABLE_DIR = Path("paper2/tables")
FIG_DIR = Path("paper2/figures")
NOTE_DIR = Path("paper2/notes")

MODEL = "linear_reduced"

TARGET_ORDER = ["deploy_gas", "worst_claim_gas", "refund_gas"]
TARGET_LABEL = {
    "deploy_gas": "Deploy gas",
    "worst_claim_gas": "Worst-claim gas",
    "refund_gas": "Refund gas",
}

def main():
    TABLE_DIR.mkdir(parents=True, exist_ok=True)
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    NOTE_DIR.mkdir(parents=True, exist_ok=True)

    cv = pd.read_csv(CV)
    ho = pd.read_csv(HO)
    pred = pd.read_csv(PRED)

    cvm = cv[cv["model"] == MODEL].copy()
    hom = ho[ho["model"] == MODEL].copy()
    prm = pred[pred["model"] == MODEL].copy()

    cvm = cvm[["target", "variant", "model", "mae", "mape_pct", "r2"]].rename(columns={
        "mae": "cv_mae",
        "mape_pct": "cv_mape_pct",
        "r2": "cv_r2",
    })

    hom = hom[["target", "variant", "model", "mae", "mape_pct", "r2"]].rename(columns={
        "mae": "holdout_mae",
        "mape_pct": "holdout_mape_pct",
        "r2": "holdout_r2",
    })

    final = cvm.merge(hom, on=["target", "variant", "model"], how="inner")
    final["target_label"] = final["target"].map(TARGET_LABEL)
    final = final[[
        "target",
        "target_label",
        "variant",
        "model",
        "cv_mae",
        "cv_mape_pct",
        "cv_r2",
        "holdout_mae",
        "holdout_mape_pct",
        "holdout_r2",
    ]]
    final["target"] = pd.Categorical(final["target"], categories=TARGET_ORDER, ordered=True)
    final = final.sort_values("target")
    final.to_csv(TABLE_DIR / "final_model_metrics.csv", index=False)

    # predicted vs actual plots
    for target in TARGET_ORDER:
        sub = prm[prm["target"] == target].copy()
        if sub.empty:
            continue

        x = sub["actual"].astype(float)
        y = sub["predicted"].astype(float)
        mn = min(x.min(), y.min())
        mx = max(x.max(), y.max())

        plt.figure(figsize=(5.0, 5.0))
        plt.scatter(x, y)
        plt.plot([mn, mx], [mn, mx], linestyle="--")
        plt.xlabel("Actual")
        plt.ylabel("Predicted")
        plt.title(f"{TARGET_LABEL[target]} on hold-out ({MODEL})")
        plt.tight_layout()
        plt.savefig(FIG_DIR / f"final_model_{target}_pred_vs_actual.png", dpi=160)
        plt.close()

    # model choice note
    choice_note = f"""# Final model choice

Chosen main model: `{MODEL}`

## Why this model?

The model-selection results show that `linear_full` and `linear_reduced` have identical performance, to the reported precision, on both grouped cross-validation and hold-out evaluation for all three targets:
- deploy gas
- worst-claim gas
- refund gas

In contrast, `ridge_reduced` performs worse on both grouped CV and hold-out evaluation.

Therefore, the paper should use `linear_reduced` as the main cost model, for three reasons:

1. It matches the predictive accuracy of the full linear model.
2. It uses fewer features and is therefore easier to explain.
3. It reduces redundancy and is less exposed to collinearity than the full feature set.

`linear_full` can be retained as a robustness check in the appendix or supplementary discussion.
"""
    (NOTE_DIR / "model_choice_v2.md").write_text(choice_note, encoding="utf-8")

    # evaluation paragraph
    row_map = {r["target"]: r for _, r in final.iterrows()}

    eval_text = f"""# Evaluation text for paper

## Final topology-aware cost model

We select `linear_reduced` as the final cost model. Although the full linear model and the reduced linear model achieve identical scores, we prefer the reduced model because it uses fewer compile-time features and is easier to interpret.

On grouped cross-validation, the reduced linear model achieves:
- deploy gas: MAE={row_map['deploy_gas']['cv_mae']:.4f}, MAPE={row_map['deploy_gas']['cv_mape_pct']:.4f}%, R²={row_map['deploy_gas']['cv_r2']:.4f}
- worst-claim gas: MAE={row_map['worst_claim_gas']['cv_mae']:.4f}, MAPE={row_map['worst_claim_gas']['cv_mape_pct']:.4f}%, R²={row_map['worst_claim_gas']['cv_r2']:.4f}
- refund gas: MAE={row_map['refund_gas']['cv_mae']:.4f}, MAPE={row_map['refund_gas']['cv_mape_pct']:.4f}%, R²={row_map['refund_gas']['cv_r2']:.4f}

On unseen hold-out graph families, the same model achieves:
- deploy gas: MAE={row_map['deploy_gas']['holdout_mae']:.4f}, MAPE={row_map['deploy_gas']['holdout_mape_pct']:.4f}%, R²={row_map['deploy_gas']['holdout_r2']:.4f}
- worst-claim gas: MAE={row_map['worst_claim_gas']['holdout_mae']:.4f}, MAPE={row_map['worst_claim_gas']['holdout_mape_pct']:.4f}%, R²={row_map['worst_claim_gas']['holdout_r2']:.4f}
- refund gas: MAE={row_map['refund_gas']['holdout_mae']:.4f}, MAPE={row_map['refund_gas']['holdout_mape_pct']:.4f}%, R²={row_map['refund_gas']['holdout_r2']:.4f}

These results indicate that simple compile-time topology features are sufficient to predict gas with good accuracy, even on unseen ATG families. This makes the model suitable as a practical decision component in a cost-aware ATG compiler.
"""
    (NOTE_DIR / "evaluation_model_v2.md").write_text(eval_text, encoding="utf-8")

    print({
        "final_metrics": str(TABLE_DIR / "final_model_metrics.csv"),
        "figures": sorted([p.name for p in FIG_DIR.glob("final_model_*_pred_vs_actual.png")]),
        "model_choice_note": str(NOTE_DIR / "model_choice_v2.md"),
        "evaluation_text": str(NOTE_DIR / "evaluation_model_v2.md"),
    })

if __name__ == "__main__":
    main()
