# ADR 0022 Clock Sampling Resilience

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Target coverage maps realm clocks to host epoch time. A single slow Playwright round-trip can inflate uncertainty and create a false diagnostic failure while the clock relation itself remains valid.

## Decision

Sample each frame and worker clock three times and retain the lowest round-trip sample. Keep the existing estimated-error calculation and 5 ms acceptance threshold; do not hide persistent timing failures by widening the threshold.

## Consequence

Clock mapping is less sensitive to transient host scheduling noise while preserving a strict uncertainty bound. The extra two lightweight evaluations are bounded overhead. OOPIF/worker clocks still share the same host-side sampling limitation.
