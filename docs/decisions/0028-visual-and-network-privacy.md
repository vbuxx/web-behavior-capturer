# ADR 0028 Visual and Network Privacy Boundary

Status: accepted for Phase 1
Date: 6 September 2026

## Decision

Screenshot persistence applies a validated selector policy (default password/autocomplete/sensitive selectors) through Playwright masking before PNG write. A capture may provide a policy JSON with schema `1.0.0`, at most 100 selectors, and an explicit hex mask color.

Network evidence is metadata-only: URL, method, response status, resource type, and timing. Headers and bodies are never captured. URL query credentials still pass through structured redaction before persistence.

## Consequence

Visual masking is deterministic and auditable through `manifest.visualRedaction`; it does not claim OCR coverage or infer arbitrary sensitive text. Network-delayed behavior can be correlated with completion timing, but payload semantics remain an explicit unknown.
