# Phase 2 Evidence Graph Foundation Report

## Result

- New `1.6.0` packages write and checksum `evidence-graph.json`.
- Reopen rejects a graph checksum mismatch or invalid graph edge reference before query.
- Minimum node classes are emitted for input, observable state, mutation, animation, network completion, visual checkpoint, and probe run.
- Graph nodes and edges carry evidence refs, target/navigation scope, clock uncertainty, and limitations.
- Observable-state nodes include URL, focus, visibility, relevant attributes, scroll, and layout fields; unavailable values are explicit `null`/`unknown`.

## Scope boundary

This is a capture-time revision only. Immutable annotation sidecars, probe-generated revisions, and graph query endpoints belong to the service/viewer milestone.
