# Phase 2 Evaluation Report

Run with:

```bash
pnpm run evaluate -- --package artifacts/phase1/latest --repetitions 3 --out .wbc/evaluation/phase2-report.json
```

The executable harness repeats reference and independent-replica verification three times under held-out interruption, reverse, and viewport conditions. It reports extraction accuracy, behavior equivalence, observer degradation, loss, and an explicit `agentSuccess: not_measured`.

The 12-fixture matrix is `fixtures/evaluation/fixture-matrix.json`. Screenshot-only and Playwright-trace-only baselines are marked unavailable until a separate agent harness exists; verifier success is not presented as an agent score. Unsupported and partial capabilities remain visible in the matrix.
