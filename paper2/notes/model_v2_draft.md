# Cost model v2 draft

We evaluate three topology-aware gas models: a full linear model, a reduced linear model, and a reduced Ridge model. The goal of v2 is not only predictive accuracy, but also robustness and interpretability under feature collinearity.

The reduced model removes redundant compile-time signals that largely encode the same structural fact, such as simultaneously using both level-count and multi-level indicator features. This makes the model more suitable for a cost-aware compiler.

We compare the models on grouped cross-validation over the original ATG analysis set, and on a hold-out dataset generated from unseen graph families. If the reduced or regularized model remains close to the full model on hold-out, then we prefer it for the paper because it better supports the claim that simple compile-time topology features are sufficient for optimization-aware compilation.
