# Phase 1 Finalization Benchmark Report — Capture End-to-End

## Scope

`benchmark:capture` menjalankan `captureSession` lengkap pada temporary directory, termasuk browser orchestration, natural behavior capture, visual PNG, event JSONL, contract validation, SQLite index build, checksum manifest, dan reopenable `inspectSessionPackage`. Temporary package dihapus setelah inspection.

## Result

Run dengan `overheadRuns=1`:

| Metric | Result |
| --- | ---: |
| End-to-end finalization | 9.626 s |
| Artifact size | 537.210 bytes |
| Contract schema | 1.5.0 |
| Targets | 7 |
| Elements | 13 |
| Behaviors | 5 |
| Evidence references | 307 |
| Normalized records | 292 |
| Dropped records | 0 |
| Known loss | false |
| Observer baseline p95 | 16,7 ms |
| Observer capture p95 | 16,8 ms |
| Measured degradation | 0,599% |

Angka ini masih di bawah target PRD finalisasi `<30 detik`, tetapi overhead benchmark hanya satu run dan package fixture kecil. Nilai observer degradation 0,599% berada dalam noise timer pada skala ini.

## Boundary

Benchmark ini membuktikan artifact dapat selesai, divalidasi, diindeks, dan dibuka kembali. Ia belum mengukur sustained multi-minute capture, 100 MiB evidence, concurrent sessions, crash recovery, atau peak RSS native.

## Next Gate

Jalankan capture route synthetic dengan durasi lebih panjang, evidence visual lebih besar, worker/OOPIF traffic aktif, dan beberapa session paralel. Ukur finalization p50/p95, memory, dropped record, serta behavior contract integrity di setiap run.
