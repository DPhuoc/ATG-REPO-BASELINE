# Budgeted selection draft

In addition to unconstrained leader selection, we evaluate a constrained objective that minimizes worst-claim gas subject to a deployment budget. The budget is defined empirically using low, medium, and high quantiles of deployment gas on the leader-sensitive family.

This experiment shows that compile-time optimization remains meaningful even under deployment constraints. In a non-trivial subset of feasible graphs, the budgeted selector still chooses a realization with lower worst-claim gas than the original leader. As the deployment budget increases, the selector gains access to more structurally complex realizations and can often reduce runtime cost further.

This result strengthens the paper's main claim: cost-aware ATG compilation should not be viewed only as a weighted-score problem, but also as a constrained optimization problem in which deployment and runtime costs can be traded off explicitly.
