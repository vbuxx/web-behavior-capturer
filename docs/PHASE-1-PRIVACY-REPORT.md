# Phase 1 Privacy Report

## Supported

- Structured evidence redaction for credential, token, authorization, cookie, session, and personal-data keys.
- Screenshot masking for password inputs, sensitive autocomplete fields, and `[data-wbc-sensitive]` by default.
- Capture-specific policy file via `--visual-policy PATH`, validated as schema `1.0.0`.
- Network metadata evidence limited to URL, method, status, resource type, and timing.

## Explicitly unavailable

- OCR/general-purpose sensitive text detection.
- Network header/body capture.
- Semantic reconstruction of payload-driven UI from response bodies.

The manifest records masked/unmasked screenshot counts and the selected policy selectors. A PNG is never persisted before the configured selector mask is applied.
