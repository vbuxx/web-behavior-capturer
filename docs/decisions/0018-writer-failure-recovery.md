# ADR 0018 Writer Failure Recovery

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Atomic promotion melindungi output final dari crash, tetapi error normal saat writer kehabisan ruang juga harus membersihkan staging dan meninggalkan output yang jelas tidak valid.

## Decision

Tambahkan fault-injection stage `before-contract` dan `before-index` yang melempar error berkode `ENOSPC`. Jalankan sebagai child process, inspeksi output final, dan verifikasi bahwa normal error path menghapus staging tanpa mempromosikan package.

## Consequence

Kedua stage menghasilkan exit code 1, final output tanpa file, zero staging orphan, dan integrity rejection. Ini memberi recovery matrix awal tanpa mengklaim bahwa filesystem penuh nyata sudah teruji.

Disk quota nyata, partial SQLite write, checksum corruption, dan rotation package existing tetap menjadi gate sebelum service lifecycle/MCP.
