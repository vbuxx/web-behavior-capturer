# ADR 0016 Parallel Capture Reliability

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Single-session finalization sudah terukur, tetapi service produk harus menjaga isolation ketika beberapa capture berjalan bersamaan.

## Decision

Tambahkan reliability benchmark dengan temporary output directory per `(cycle, slot)`, parallel capture, reopenable inspection, dan aggregate failure list. Failure satu slot tidak boleh menghapus atau menyamarkan hasil slot lain.

## Consequence

Parallelism 2 lulus dengan dua package verified, lima behavior per package, dan zero loss. Profil parallelism 4 × 2 cycles menghasilkan 8/8 package verified, peak RSS host 168,362 MB, peak heap 98,526 MB, dan peak 74 file descriptors. Regression test browser-heavy dijalankan serial untuk menghindari resource contention pada diagnostic timing probe; ini tidak membatasi benchmark parallelism. Crash recovery dan session cancellation masih menjadi gate sebelum job-oriented service/MCP.
