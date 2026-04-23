# Hold-out evaluation draft

We evaluate the topology-aware linear cost model on two unseen ATG families, `diamond` and `ring`, which are not used in the original training subset. The hold-out test set is built from fresh ATG-compiled runs generated from these families only.

The goal of this experiment is not to claim universal generalization, but to test whether compile-time topology features remain predictive when the model is evaluated on graph families that were not part of the original synthetic training corpus.

We report MAE, MAPE, and R² on deploy gas, worst-claim gas, and refund gas. If the errors remain low on hold-out families, then the model is strong enough to support optimization-aware compilation rather than merely fitting one synthetic family.
