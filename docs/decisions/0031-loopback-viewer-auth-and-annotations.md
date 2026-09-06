# ADR 0031 Loopback Viewer Auth and Immutable Annotations

Status: accepted for Phase 2 foundation
Date: 6 September 2026

## Decision

Review server generates a random 256-bit token per process and sets it as an HttpOnly, SameSite=Strict loopback cookie. API routes require the cookie; static bootstrap remains available to establish the session. The server binds only to `127.0.0.1`.

Viewer exposes graph revision/provenance and an append-only `annotations.jsonl` sidecar. An annotation records base checksum/revision, timestamp, note, and optional target/evidence refs; it never mutates original evidence. Corrupt packages are rejected before any API response.

## Consequence

Browser review gains a local CSRF boundary and audit trail without introducing a public listener. Annotation correction does not silently rewrite a contract; a probe/compiler revision is required for derived changes.
