# Evaluation draft

## Leader selection changes the compiled structure and cost

On the leader-sensitive family, the best leader differs from the original leader on most non-trivial cases. For `direct=false`, the original leader is already optimal in 1 case(s), while the remaining cases show that choosing the best leader reduces worst-claim gas by a mean of 14.92% and a median of 14.92%. Refund gas remains essentially unchanged, with a mean change of -0.04%. In these cases, the main structural simplification is the removal of multi-option structure.

For `direct=true`, choosing the best leader reduces worst-claim gas by a mean of 49.56% and a median of 49.86%. Refund gas decreases by a mean of 47.05% and a median of 47.04%. Here the optimization is stronger: the compiled target pair collapses from a multi-level or multi-level+multi-option structure to a single-level one. This removes disable steps and often changes the contract family from `CTLCMultipleEdges` to `CTLCOnly`.

## Topology strongly predicts gas

Across the collected ATG-compiled runs for the target pair `D->B`, single-level patterns have the lowest median worst-claim and refund costs. Single-level+multi-option raises deployment and claim costs. Multi-level raises worst-claim and refund costs further due to the extra disable step. Multi-level+multi-option is the most expensive structure overall. This supports the paper's central claim for the follow-up work: the gas behavior of an ATG realization is strongly governed by the topology of the compiled pair.
