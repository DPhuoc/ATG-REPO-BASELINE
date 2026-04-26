# Hard holdout draft

To stress-test model generalization, we introduce a harder unseen test set built from two additional ATG families, `bowtie` and `ladder`. These families produce more structurally complex compiled pairs than the earlier hold-out set.

We compare two training regimes on this hard hold-out set:
1. `linear_reduced_main`, trained only on the original curated ATG analysis set.
2. `linear_reduced_filtered_expanded`, trained on the curated set plus a filtered random-family expansion.

The filtered-expanded model improves deploy-gas prediction from 1.7031% to 1.3978% MAPE and worst-claim prediction from 4.0682% to 3.8373% MAPE. Refund prediction remains effectively perfect for both models, with only a negligible difference.

We therefore keep `linear_reduced_main` as the main model in the paper, because it remains simpler and already generalizes well. However, the hard hold-out result shows that carefully filtered data augmentation can further improve generalization on more difficult unseen families.
