# Reproduction Report and Next-Paper Roadmap

## Title
Reproducing Atomic Transfer Graphs and CTLC-Based Protocol Synthesis on Ethereum, and a Roadmap for a Follow-Up Paper

## Abstract
This report summarizes a local reproduction of the paper *Atomic Transfer Graphs: Secure-by-design Protocols for Heterogeneous Blockchain Ecosystems*. The original paper introduces Atomic Transfer Graphs (ATGs) as a high-level way to specify desired transfers and a framework that compiles these goals into CTLC-based protocols deployable across heterogeneous blockchain systems. In our reproduction, we re-ran the Solidity implementations in a local Ganache/Truffle environment, benchmarked CTLC-based contracts against comparator protocols, and built an ATG-to-CTLC compilation pipeline that generates contract instances from graph inputs. The empirical results support the paper’s main qualitative claim: contract structure and gas costs are strongly driven by graph topology. Single-level pairs collapse to CTLCOnly, while multi-level and multi-option pairs require CTLCMultipleEdges and incur additional gas due to disable progression and option checking. Based on these results, the most promising next paper is a gas-aware ATG compiler that minimizes deployment and execution cost while preserving the security properties of the ATG realization.

## 1. Background
The original paper argues that many blockchain protocols share the same security and functionality goals and that these goals can be expressed using an Atomic Transfer Graph (ATG). It then presents a framework that generates secure-by-design protocols from ATGs using Conditional Timelock Contracts (CTLCs), which the authors describe as a minimal smart-contract functionality implementable on restricted scripting environments such as Bitcoin-like systems and payment channels. The paper positions this framework as generic, provably secure, and capable of matching or improving the performance of use-case-specific protocols across a range of applications.

## 2. Reproduction Goals
The reproduction had four goals:
1. Run the public Solidity code associated with the paper on a local Ethereum-like environment.
2. Reproduce contract-level gas comparisons among CTLC-based contracts and the comparator protocols in the repository.
3. Build a practical compiler-like pipeline from ATG JSON inputs to deployed CTLC contract instances.
4. Empirically validate that ATG structure determines whether the resulting realization is CTLCOnly or CTLCMultipleEdges and how that structure changes gas costs.

## 3. Experimental Setup
The experiments were run locally with Ganache and Truffle, which is consistent with the paper’s Appendix-style evaluation setup. The deployed contracts included Swap, SwapImproved, CTLCOnly, and CTLCMultipleEdges, along with auxiliary contracts. In one recorded deployment log, the measured deployment gas was 2,027,030 for Swap, 1,301,614 for SwapImproved, 1,239,070 for CTLCOnly, and 1,308,809 for CTLCMultipleEdges.

## 4. Main Contract-Level Results
The contract-level reproduction produced the following summary:

| Protocol | Deploy | Claim (best) | Claim (worst) | Refund (best) | Refund (worst) |
|---|---:|---:|---:|---:|---:|
| CTLCOnly | 1239070 | 68507 | 125473 | N/A | 112508 |
| CTLCMultipleEdges | 1308809 | 71401 | 128525 | N/A | 112464 |
| Swap | 2026970 | 422427 | N/A | 41309 | 344541 |
| SwapImproved | 1301590 | 68417 | 92801 | N/A | 44117 |

These measurements show three strong trends.
First, CTLCOnly is substantially cheaper to deploy than Swap and slightly cheaper to deploy than SwapImproved. Second, CTLCOnly and SwapImproved are almost identical on best-claim paths. Third, CTLC-style executions are more expensive on refund paths because they explicitly advance through subcontract levels with disable operations before the final refund can be reached.

## 5. ATG-to-CTLC Compilation Results
A custom ATG pipeline was implemented to compile graph instances into contract realizations. The resulting experiments showed that the compiled contract family depends directly on graph structure:
- Single-level pairs compile to CTLCOnly.
- Multi-level pairs require additional disable progression before final claim or refund.
- Multi-option pairs compile to CTLCMultipleEdges.

A representative compiled example was the pair `D->B|evm|fund:db`, which produced:
- Contract: CTLCMultipleEdges
- Levels: 2
- Duplicate vector: 1|4
- Pattern: multi-level+multi-option
- Best claim gas: 71,641
- Worst claim gas: 128,885
- Refund gas: 112,464
- Disable gas before last claim/refund: 52,925

This is exactly the type of structure the paper is designed to capture: a single pair can require both multiple subcontract levels and multiple condition options because the original ATG contains multiple relevant paths.

## 6. Branchy Sweep Results
A family of synthetic “branchy” ATGs was generated to stress the compiler. The sweep revealed four stable regimes:
- Without a direct path and with one option, the pair remains single-level and compiles to CTLCOnly.
- Without a direct path and with two or more options, the pair becomes single-level+multi-option and compiles to CTLCMultipleEdges.
- With a direct path and one alternate option, the pair becomes multi-level and worst-claim/refund gas rises because a disable step is needed.
- With a direct path and multiple alternate options, the pair becomes multi-level+multi-option and deploy/claim costs rise further.

A concise version of the sweep is:

| direct | options | Contract | Levels | Pattern | Best claim | Worst claim | Refund |
|---:|---:|---|---:|---|---:|---:|---:|
| false | 1 | CTLCOnly | 1 | single-level | 72874 | 72874 | 59561 |
| false | 2 | CTLCMultipleEdges | 1 | single-level+multi-option | 75948 | 75948 | 59539 |
| true | 1 | CTLCOnly | 2 | multi-level | 68747 | 125833 | 112508 |
| true | 4 | CTLCMultipleEdges | 2 | multi-level+multi-option | 71641 | 128885 | 112464 |

## 7. Interpretation
The experiments reproduce the core qualitative claim of the paper.
ATG topology determines both the compiled contract family and the cost profile of execution. Single-level graphs collapse to the simpler CTLCOnly form. Adding depth introduces disable progression, which raises worst-case claim and refund costs. Adding parallel options introduces additional storage and condition checking, which raises deploy and claim costs in CTLCMultipleEdges.

The comparator results also make sense semantically. Swap is significantly more expensive on deployment and claim scenarios because it requires richer path-unlock style execution. SwapImproved narrows the gap on claim paths, but CTLCOnly remains simpler to deploy. Refund behavior favors comparator-style timeout logic, while CTLC pays an explicit cost for progressing through subcontract levels.

## 8. Threats to Validity
This reproduction is strong qualitatively but should not be over-claimed.
- The experiments were run on a local Ganache chain rather than a public chain.
- Some local patches were necessary to make the repository practical on modern toolchains.
- The benchmark harnesses were built for reproducibility and diagnosis, not for exact byte-for-byte replication of the paper’s original environment.
- The reproduction focuses primarily on the EVM realization; it does not yet reproduce a Bitcoin/adaptor-signature execution path.

Accordingly, the safest conclusion is that the reproduction validates the paper’s qualitative behavior and implementation strategy, not that every gas number exactly matches the authors’ environment.

## 9. Final Conclusion
The reproduction is successful.
It demonstrates that:
1. The repository code can be run and benchmarked locally.
2. CTLC-based contracts exhibit the expected trade-offs against comparator protocols.
3. An ATG compiler pipeline can be built in practice.
4. Graph topology directly determines whether the realization is CTLCOnly or CTLCMultipleEdges and whether disable progression appears in the critical path.

This is already enough to support a technically solid reproduction report and to motivate a follow-up research paper.

## 10. Recommended New Paper
### Working title
Gas-Aware Compilation of Atomic Transfer Graphs to Conditional Timelock Contracts

### Core idea
The current paper shows that ATGs can be compiled into secure CTLC-based protocols. A natural next step is to study how to compile them more efficiently. The new paper should ask:

**Given an ATG and a security target, can we synthesize a CTLC realization that minimizes deployment gas and worst-case execution gas without violating the ATG’s safety guarantees?**

This direction is attractive because your experiments already show that graph shape strongly influences cost. That means there is a real optimization problem, not an artificial one.

### Research questions
1. How much do level count and duplicate-option count contribute to deploy gas, claim gas, and refund gas?
2. Can leader choice change the size of the compiled realization?
3. Can duplicate options be compressed or encoded more efficiently without breaking correctness?
4. Can we predict gas from graph features before deployment?
5. Can we automatically choose a cheaper secure realization among several equivalent ATG embeddings?

### Hypotheses
- H1: Deployment gas grows with both the number of subcontract levels and the number of options per level.
- H2: Worst-case claim and refund gas are primarily driven by the number of disable steps.
- H3: For a fixed transfer goal, different valid leader choices or graph embeddings can produce measurably different costs.
- H4: A compiler that optimizes for graph shape can reduce deployment and worst-case gas compared with a naive compilation baseline.

## 11. Minimal Novel Contribution for the New Paper
To make the new paper publishable, you need one real algorithmic or systems contribution. The cleanest version is:

1. Define a cost model over compiled CTLC realizations.
2. Design an optimization pass that chooses a lower-cost compilation subject to correctness constraints.
3. Evaluate on both hand-crafted and synthetic ATG families.
4. Compare against a naive baseline compiler and the unoptimized realization.

That is enough for a workshop paper, and if the optimization is nontrivial and well-evaluated, potentially enough for a stronger venue.

## 12. Concrete Plan of Work
### Phase 1: Clean baseline
- Freeze the current reproduction environment.
- Save all scripts, patches, and benchmark outputs.
- Turn the reproduction into a one-command artifact.

### Phase 2: Cost model
- Extract graph features: number of nodes, number of arcs, leader choice, pair count, level count, duplicate vector, total option count.
- Fit a simple empirical cost model for deploy, claim, disable, and refund gas.
- Validate whether the model predicts measured gas with reasonable error.

### Phase 3: Optimization pass
Start with one or two optimizations only:
- leader selection heuristic,
- option-ordering/packing heuristic,
- duplicate-aware compilation heuristic.

The goal is not to solve everything. The goal is to show that the compiler can deliberately lower cost.

### Phase 4: Evaluation
Use three benchmark families:
- the original repository contracts,
- your branchy synthetic families,
- a few application-shaped ATGs such as swap, rebalance, and crowdfunding-style motifs.

Measure:
- deploy gas,
- best and worst claim gas,
- refund gas,
- number of disable steps,
- size of generated contract input,
- compile time.

### Phase 5: Writing
A strong paper outline is:
1. Introduction
2. Background and paper-2501.17786 recap
3. Cost model for ATG-to-CTLC compilation
4. Optimization algorithm
5. Implementation
6. Evaluation
7. Limitations and future work
8. Conclusion

## 13. What You Should Do Next
The next five concrete actions are:
1. Freeze the current code, scripts, and outputs in a clean Git branch.
2. Turn your branchy sweep into a larger benchmark grid and export all results as CSV.
3. Implement one optimization knob first, preferably leader selection.
4. Re-run the full benchmark suite with and without the optimization.
5. Write a short extended abstract before writing the full paper.

## 14. One-Sentence Thesis for the New Paper
ATGs are not only a secure specification language for heterogeneous atomic transfers; they are also a compilation target whose graph structure exposes exploitable cost optimizations in CTLC-based realizations.
