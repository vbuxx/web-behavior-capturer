# Phase 1 Release Gate

Tanggal pengukuran: 6 September 2026, macOS + Chromium lokal.

## Evidence

| Gate | Hasil | Catatan |
|---|---:|---|
| Full regression | 24/24 pass | unit, e2e, corruption, quota, rotation, service, viewer, visual mask |
| Behavior query p95 | 112.446 ms | 3 reopen/query iterations pada package fixture |
| Evidence query p95 | 83.985 ms | 3 bounded query iterations |
| Total inspect/query p95 | 316.254 ms | jauh di bawah target 2 detik pada fixture |
| Capture finalisasi | 10.602 s | package `1.6.0`, 7 targets, 0 dropped records |
| Observer degradation | -0.595% | satu benchmark run; e2e memakai sample 264 |
| 5.000 DOM/50 track | pass | synthetic browser benchmark; bukan yet 5-minute endurance capture |
| Rotation/corruption/quota | pass | fail-closed and recovery tests |

## Capability decision

- Supported: Chromium macOS/Linux target registry, hover/CSS/interrupt/viewport scroll/GSAP numeric scrub, OOPIF discovery, bounded host batches, schema 1.6 compatibility, visual selector masking, network metadata-only, graph checksum, local service/MCP/viewer.
- Partial: nested scroller, GSAP boolean semantics, overlap causality, resume (new revision only), worker history before attach, network-delayed payload semantics, annotation-to-contract recompilation.
- Unavailable/deferred: worker-of-worker, closed shadow DOM, Windows release gate, non-Chromium, OCR, network header/body, Lottie, semantic Canvas/WebGL, website-realism benchmark, screenshot/trace agent baselines.

The 5-minute endurance run, crash matrix on every supported filesystem, Linux quota CI, and repeated hardware reference run remain release-candidate work. No claim of zero loss beyond the measured lanes is made.
