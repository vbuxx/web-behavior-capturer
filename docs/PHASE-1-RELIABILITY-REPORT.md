# Phase 1 Reliability Report — Parallel Session Capture

## Scope

Reliability benchmark menjalankan beberapa `captureSession` secara paralel pada temporary directories terpisah. Setiap session harus menyelesaikan capture, membangun index, lolos `inspectSessionPackage`, dan tidak mencampur records antar-slot. Semua temporary output dihapus setelah inspection.

## Result

Run dengan parallelism 2 dan 1 cycle:

| Metric | Result |
| --- | ---: |
| Sessions | 2 |
| Total wall time | 11,488 ms |
| Per-session finalization | 11,487 ms |
| Verified packages | 2/2 |
| Behaviors per session | 5 |
| Records per session | 290 |
| Dropped records | 0/2 |
| Known loss | false/false |
| Failures | 0 |

Kedua session berjalan bersamaan, tetap memiliki package terpisah, dan dapat dibuka kembali tanpa checksum atau schema failure.

Profil lebih berat dengan parallelism 4 dan 2 cycles juga lulus: 8/8 session verified, total wall time 60,807 detik, peak host RSS 168,362 MB, peak Node heap 98,526 MB, dan peak open file descriptors 74. Tidak ada dropped record atau failure. Perbedaan record antar-session berasal dari timing natural fixture, bukan cross-session contamination.

Regression suite dijalankan serial (`--test-concurrency=1`) karena capture/browser-heavy tests yang berjalan paralel dapat membuat diagnostic timing probe dan review server timeout akibat resource contention. Ini adalah batas test harness, bukan concurrency limit pada reliability benchmark.

## Boundary

Ini membuktikan isolation dan repeatability pada dua capture Chromium lokal. Belum ada crash injection, kill/restart mid-capture, disk-full simulation, multi-host execution, atau sustained multi-minute session.

## Next Gate

Tambahkan crash/lifecycle interruption probe, capture session beberapa menit, serta recovery semantics. Resource ceiling pada parallelism 4 sudah memiliki baseline; perlu limit/alert yang eksplisit sebelum service lifecycle dan MCP job API.
