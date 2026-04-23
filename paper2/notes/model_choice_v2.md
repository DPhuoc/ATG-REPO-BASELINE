# Final model choice

Chosen main model: `linear_reduced`

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
