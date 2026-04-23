# Cost model v1 draft

We train a first topology-aware gas model on successful `atg_analysis` rows only, using grouped cross-validation by graph/run id. The features are available at compile time: `num_levels`, `sum_options`, `max_options_per_level`, `disable_steps_worst`, `has_multi_level`, `has_multi_option`, and `contract_type`.

Best out-of-fold models by target:

- Deploy gas: linear, MAE=7066.0846, MAPE=0.6235%, R²=0.9946
- Worst-claim gas: linear, MAE=2101.3569, MAPE=2.5829%, R²=0.9909
- Refund gas: linear, MAE=5.5108, MAPE=0.0066%, R²=1.0

This model is still a sanity-check model rather than the final paper model: the dataset is small and dominated by synthetic ATG families. Still, if the out-of-fold errors are reasonably low and the linear coefficients align with intuition (e.g. more levels, more options, and more disable steps increase gas), then the result is already strong evidence that compile-time topology features are predictive enough to guide optimization.
