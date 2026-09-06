# ADR 0030 Shared Session Service and Local MCP

Status: accepted for Phase 2 foundation
Date: 6 September 2026

## Decision

CLI and local MCP call `SessionService`, which owns a local atomic JSON job store. Jobs record operation, lifecycle status, output path, compact result, and error provenance. Capture jobs have an in-memory AbortController; cancellation delegates to capture fail-closed cleanup.

Read operations first run package integrity inspection and return an immutable snapshot containing session ID, contract schema, and checksums. Behavior and evidence reads are paginated/budgeted and return summaries rather than raw logs. MCP uses newline-delimited JSON over stdio only; no browser debug endpoint or public network listener is opened.

## Consequence

Viewer integration can reuse the same service without changing package semantics. The current job store is intentionally local and single-host; distributed scheduling, authentication, and multi-user tenancy remain out of scope.
