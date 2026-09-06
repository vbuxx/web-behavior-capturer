# Phase 2 Viewer Report

## Result

- Viewer remains loopback-only and now requires a per-process 256-bit HttpOnly SameSite cookie for API routes.
- UI shows graph revision, node-kind coverage, visual evidence, bounded evidence timeline, target lifecycle, verification summary, and append-only annotations.
- Viewer exposes a loopback probe request and displays its job status; probe results remain immutable revisions.
- `/api/graph` validates graph schema before returning provenance; `/api/annotations` appends a sidecar without changing original evidence.
- Package integrity remains a precondition for server startup and API reads.

## Limitation

Reference-vs-replica mismatch rendering is currently a bounded verification summary rather than a per-track visual diff. Full timeline scrubbing and probe recipe controls remain service/probe work.
