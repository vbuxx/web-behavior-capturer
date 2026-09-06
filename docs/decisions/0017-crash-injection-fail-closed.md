# ADR 0017 Crash Injection Fail-Closed

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Capture berjalan sebagai proses panjang dan dapat berhenti sebelum contract, evidence index, atau SQLite sidecar selesai ditulis. Output parsial tidak boleh terlihat sebagai session package yang siap direview atau diverifikasi.

## Decision

Tambahkan crash-injection benchmark yang menjalankan capture sebagai child process, mengirim `SIGKILL` sebelum finalisasi, lalu selalu melewatkan output directory ke `inspectSessionPackage`. Integrity inspection menjadi gate fail-closed: package tanpa `session-index.json` atau checksum yang lengkap ditolak.

## Consequence

Dengan batas maksimum 15.000 ms, child berhenti dengan `SIGKILL` setelah menulis file evidence parsial, tidak menghasilkan exit code normal, dan output ditolak dengan `ENOENT` karena `session-index.json` belum ada. Ini membuktikan bahwa partial output tidak dipromosikan sebagai package valid.

Current writer masih menulis langsung ke output directory. Atomic staging/promotion, orphan cleanup, disk-full simulation, dan resume setelah restart menjadi gate berikutnya sebelum lifecycle service/MCP.
