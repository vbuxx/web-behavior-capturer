# Phase 1 Release Gate

Tanggal pengukuran: 6 September 2026, macOS + Chromium lokal.

## Evidence

| Gate | Hasil | Catatan |
|---|---:|---|
| Full regression | 31/31 pass | unit, e2e, corruption, quota, rotation, service, viewer, visual mask, active cancellation, nested scroller, open shadow |
| Behavior query p95 | 112.446 ms | 3 reopen/query iterations pada package fixture |
| Evidence query p95 | 83.985 ms | 3 bounded query iterations |
| Total inspect/query p95 | 316.254 ms | jauh di bawah target 2 detik pada fixture |
| Capture finalisasi | 9.156 s | package `1.6.0`, 7 targets, 0 dropped records |
| Observer degradation | -0.595% | satu benchmark run; e2e memakai sample 264 |
| 5.000 DOM/50 track | pass | 5-minute endurance: 300.000 ms, 5.012 DOM nodes, 50 tracks, 0 dropped records, package valid |
| Rotation/corruption/quota | pass | fail-closed and recovery tests |

## Capability decision

- Supported: Chromium macOS/Linux target registry (Playwright revision 1187), hover/CSS/interrupt/viewport scroll/GSAP numeric scrub, OOPIF discovery, bounded host batches, schema 1.6 compatibility, visual selector masking, network metadata-only, graph checksum, local service/MCP/viewer.
- Partial: nested scroller, GSAP boolean semantics, overlap causality, resume (new revision only), worker history before attach, network-delayed payload semantics, annotation semantics beyond immutable revision notes.
- Unavailable/deferred: worker-of-worker, closed shadow DOM, Windows release gate, non-Chromium, OCR, network header/body, Lottie, semantic Canvas/WebGL, website-realism benchmark, screenshot/trace agent baselines.

Crash matrix on every supported filesystem, hosted Linux quota CI, and repeated hardware reference run remain release-candidate work. Archive pruning and rotation cleanup are now dry-run by default and require `--apply`. No claim of native private-memory overhead is made because CDP did not expose it on this machine.
