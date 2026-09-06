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

Regression suite dijalankan serial (`--test-concurrency=1`) karena capture/browser-heavy tests yang berjalan paralel dapat membuat diagnostic timing probe dan review server timeout akibat resource contention. Ini adalah batas test harness, bukan concurrency limit pada reliability benchmark.

## Boundary

Ini membuktikan isolation dan repeatability pada dua capture Chromium lokal. Belum ada crash injection, kill/restart mid-capture, disk-full simulation, multi-host execution, atau sustained multi-minute session.

## Next Gate

Tambahkan crash/lifecycle interruption probe, capture session beberapa menit, dan parallelism 3–4. Ukur peak RSS host, file descriptor count, serta recovery semantics sebelum service lifecycle dan MCP job API.
