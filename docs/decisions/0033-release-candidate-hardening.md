# 0033 — Release-candidate hardening and immutable derived revisions

Status: accepted, 6 September 2026.

Release cleanup is dry-run by default. Archive pruning, rotation cleanup, and staging janitors report `plannedRemovals`; filesystem deletion requires an explicit `--apply`. This prevents an operator typo or an incomplete marker from becoming an irreversible data loss event.

Node 24.14.0, pnpm 11.19.0, Playwright 1.55.0, Chromium, locale, timezone, viewport, and DPR are pinned in the repository profile. Browser acceptance is serial; stress/quota/crash runs are separate because timing probes mixed with resource pressure produce false degradation signals.

Probe and human annotation corrections create immutable derived revisions containing a contract, evidence graph, checksums, and revision index entry. Base contract, raw event stream, and original graph are not overwritten. Queries bind to a revision checksum, while unsupported or unknown relationships remain explicit.

The release gate requires an independently measured five-minute synthetic endurance run and Linux/macOS acceptance evidence. A short local smoke run proves wiring only; it is not promoted as the endurance result.
