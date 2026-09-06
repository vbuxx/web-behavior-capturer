# Phase 2 Status

Implemented foundations: evidence graph revision/checksum, immutable snapshot service, local stdio MCP, authenticated viewer/provenance UI, annotation sidecar with derived revisions, probe-derived contract revisions, selector fingerprint checkpoints, visual masking, and a 12-fixture evaluation matrix.

The executable evaluator now creates isolated temporary starter workspaces and condition-specific evidence bundles for screenshot, trace, and WBC runs. It records process status separately from held-out verifier success, enforces an evidence byte budget, omits raw `events.jsonl` from agent workspaces, and stores no prompt/output text. The current smoke verifier covers hover/interruption, CSS/WAAPI, and numeric GSAP scrub; the remaining fixture-specific verifiers are explicit `unsupported` and are not counted as success. The 80%/20-point target is not claimed until the full 12-fixture matrix is implemented; closed shadow remains deferred to Fase 3.
