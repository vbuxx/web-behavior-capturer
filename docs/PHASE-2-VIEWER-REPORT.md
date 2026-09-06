# Phase 2 Viewer Report

## Result

- Viewer remains loopback-only and now requires a per-process 256-bit HttpOnly SameSite cookie for API routes.
- UI shows graph revision, node-kind coverage, visual evidence, evidence sample, target lifecycle, and append-only annotations.
- `/api/graph` validates graph schema before returning provenance; `/api/annotations` appends a sidecar without changing original evidence.
- Package integrity remains a precondition for server startup and API reads.

## Limitation

Reference-vs-replica mismatch rendering and timeline controls remain service/probe work; the current UI presents provenance and raw bounded samples only.
