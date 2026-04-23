# Evaluation text for paper

## Final topology-aware cost model

We select `linear_reduced` as the final cost model. Although the full linear model and the reduced linear model achieve identical scores, we prefer the reduced model because it uses fewer compile-time features and is easier to interpret.

On grouped cross-validation, the reduced linear model achieves:
- deploy gas: MAE=7066.0846, MAPE=0.6235%, R²=0.9946
- worst-claim gas: MAE=2101.3569, MAPE=2.5829%, R²=0.9909
- refund gas: MAE=5.5108, MAPE=0.0066%, R²=1.0000

On unseen hold-out graph families, the same model achieves:
- deploy gas: MAE=15520.5185, MAPE=1.3002%, R²=0.9669
- worst-claim gas: MAE=2430.5776, MAPE=3.4010%, R²=0.9611
- refund gas: MAE=1.8943, MAPE=0.0029%, R²=1.0000

These results indicate that simple compile-time topology features are sufficient to predict gas with good accuracy, even on unseen ATG families. This makes the model suitable as a practical decision component in a cost-aware ATG compiler.
