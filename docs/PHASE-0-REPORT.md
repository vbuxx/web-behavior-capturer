# Phase 0 Implementation and Feasibility Report

Status: completed and retained as the schema 1.0.0 baseline. Natural target coverage work continues in [PHASE-1-FOUNDATION-REPORT.md](PHASE-1-FOUNDATION-REPORT.md).

## Outcome

Vertical slice capture → Behavior Contract → verification berhasil dijalankan pada fixture lokal. Capture terakhir menghasilkan lima behavior, 106 evidence record, 15 visual checkpoint, dan kontrak tervalidasi. Scenario-driven verifier menjalankan lima skenario pada fresh page dan viewport 1100 × 740. Referensi dan replika independen masing-masing lulus 5/5.

Hasil ini memenuhi exit criterion teknis yang dipilih untuk Fase 0, tetapi belum memenuhi release gate MVP dalam PRD. Bukti hanya berlaku untuk fixture, browser, dan subset adapter yang dinyatakan di manifest.

Technical probe tambahan juga lulus 10/10: lifecycle animasi 72 ms terlihat melalui WAAPI dan CDP; main frame, same-origin iframe, cross-origin OOPIF, dan dedicated worker ditemukan; child collector berhasil dipasang pada OOPIF; DOM recreation menghasilkan instance berbeda; late attach dilaporkan sebagai coverage parsial; navigation race menginvalidasi node lama; dan page clock mapping berada di bawah batas 5 ms pada sepuluh sampel. Semua hasil target lintas proses ini adalah bukti diagnostik dengan `--site-per-process`, bukan klaim bahwa natural capture sudah memasang collector secara rekursif.

## Implementation Plan and Current State

| Workstream | Phase 0 decision | Current state |
|---|---|---|
| Session orchestration | Satu managed Chromium context per natural capture | Implemented |
| Native animation | CDP lifecycle + WAAPI keyframes/timing + computed samples | Implemented for main-frame fixture |
| DOM/runtime adapter | Pre-navigation page observer with bounded buffer | Implemented |
| Visual evidence | Before/mid/after region screenshots, animations allowed | Implemented |
| Evidence store | JSONL + PNG + SHA-256 index | Implemented; SQLite deferred |
| Behavior compiler | Five normalized behavior kinds with provenance and unknowns | Implemented |
| Contract validation | JSON Schema plus reference and checksum validation | Implemented |
| Replica verifier | Versioned scenario JSON, fresh page, stable identity, held-out points | Implemented against reference and independent replica |
| Loss accounting | Bounded-buffer overflow surfaced in manifest | Implemented and tested by injection |
| Technical probes | 72 ms lifecycle, frame/worker/OOPIF coverage, child collector, identity recreation, late attach, navigation race, clock mapping | Implemented in diagnostic mode |
| MCP and viewer | Not needed for vertical-slice proof | Deferred to later phase |

## Capture Results

| Capability | Evidence from last run | Result |
|---|---|---|
| Hover | 240 ms, cubic-bezier timing, opacity 0.72 → 1, Y 0 → -12 px | Captured and verified |
| CSS animation | Three normalized keyframes, 600 ms lifecycle, final X 120 px | Captured and verified |
| Interrupted transition | Partial state at 105 ms, leave evidence, recovery to idle | Captured and verified at a held-out 25% exit |
| Scroll reveal | Observed onset scan, 360 ms reveal, reverse hides target | Captured and verified on a different viewport |
| GSAP scrub | Public adapter resolves start/end and direct scrub; samples include reverse | Captured and verified at progress 0.2, 0.8, then 0.4 |

Kedua committed verification report mencatat 5 passed dan 0 failed. Evidence references resolve ke indexed files dan setiap file diperiksa checksum-nya sebelum verifikasi.

## Cross Implementation Verification

Replika sengaja tidak menyalin struktur implementasi referensi:

- ID dan class DOM berbeda; verifier memakai stable `dataWbcId` dari element index.
- CSS keyframe animation diganti dengan Web Animations API.
- IntersectionObserver untuk reveal diganti dengan scroll listener.
- GSAP ScrollTrigger diganti dengan fungsi progress scroll manual tanpa GSAP runtime.
- Layout berbeda, sehingga resolved scroll start/end juga berbeda.

Verifier tidak mengakses class state, GSAP adapter, atau selector sumber. Scroll reveal dinilai dari observable opacity recovery. Scroll scrub dinilai dari computed transform setelah verifier menemukan motion boundaries. Pada replika, max progress error tercatat 0 pada progress 0.2, 0.8, lalu reverse ke 0.4.

## Overhead and Integrity

The last natural run used Chromium 140.0.7339.16. Median p95 frame interval across three baseline/capture pairs was 16.8 ms without the collector and 16.7 ms with it, based on 264 baseline frame samples and the same number in capture mode. The calculated difference was -0.595%, which should be interpreted as measurement noise and no detected slowdown on this simple fixture, not as a performance improvement.

The natural capture produced 0 dropped records. A separate automated run constrains the page buffer to eight records and asserts that `knownLoss` becomes true, `droppedRecords` is positive, and the export remains schema-valid. This proves visibility of known observer loss; it does not yet test CDP tracing loss, process crash recovery, or unknown loss.

The evidence package is approximately 170 KB. This is far below the proposed 100 MB budget and is not representative of a real route.

## Limitations

- Natural Behavior Contract coverage tetap satu route dan main frame. Same-origin iframe, cross-origin OOPIF, dedicated worker, child collector, navigation race, dan late attach baru dibuktikan pada diagnostic probe; recursive child-worker attachment serta shadow boundary belum diuji.
- Candidate discovery is scenario-directed. The engine does not autonomously enumerate all interactive elements or prove recall.
- Trigger edges use controlled fixture probes; this is not universal causal tracing through timers, promises, frameworks, workers, or compositor work.
- Scroll reveal threshold is observed at 20 CSS px scan resolution. IntersectionObserver configuration is not introspected.
- GSAP semantic data is extracted only through an accessible public adapter. Private/closure-scoped instances fall back to sampled computed styles and retain an explicit unknown.
- Visual capture is static before/mid/after PNG evidence; there is no video/clip evidence or pixel trajectory evaluator.
- Sensitive-data redaction, asset persistence policy, authenticated sessions, packaging, MCP, and viewer are not implemented.
- Overhead measurement is a microbenchmark on one machine and one fixture. It is insufficient for a user-facing performance claim.
- Identity mapping masih membutuhkan atribut `data-wbc-id` yang disediakan kedua implementasi. Resolver locator majemuk dan ambiguity report belum dibangun.
- Cross-implementation sudah terbukti, tetapi belum cross-framework penuh atau menggunakan replika yang dibangun agent hanya dari contract summary.

## Scope Revisions Required

1. Narrow the P0 GSAP promise to public/source-assisted ScrollTrigger instances plus an explicitly labeled sampled fallback. Do not promise private timeline reconstruction.
2. Keep SQLite out of the spike and introduce it in Fase 1 when evidence queries, pagination, and session reopening are implemented.
3. Define Fase 0 success as five behavior patterns on one route, not the PRD's proposed 12 fixtures. Expand fixture count only after lifecycle and contract semantics stop changing.
4. Diagnostic probes now cover a 72 ms animation, worker/OOPIF discovery, one child-frame collector, late attach, and navigation race. General native support remains blocked until these paths are integrated into natural capture and collectors are installed recursively in every eligible child session.
5. Treat current overhead as a harness validation. The PRD threshold of median p95 degradation no more than 10% must be evaluated on pinned hardware across multiple fixture classes.
6. Independent replica gate sudah tercapai untuk lima behavior. Klaim tetap dibatasi pada domain fixture sampai locator resolver dan agent-built replica diuji.

## Next Engineering Gate

Lifecycle 72 ms, same-origin iframe, cross-origin OOPIF, dedicated worker discovery, satu child-frame collector, node recreation, late attach, dan navigation race sudah dibuktikan pada diagnostic probe. Milestone berikutnya adalah memindahkan target registry dan recursive collector installation ke natural capture, mengkalibrasi clock lintas proses, lalu menguji replika yang dibangun agent hanya dari contract summary dan evidence query. Gate berikutnya adalah tidak ada silent loss dan setiap target yang gagal di-attach muncul dengan rentang coverage eksplisit.
