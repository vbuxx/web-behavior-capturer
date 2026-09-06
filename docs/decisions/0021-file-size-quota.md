# ADR 0021 File-Size Quota Gate

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Simulated `ENOSPC` membuktikan error path di level aplikasi, tetapi belum menguji batas resource OS. Capture juga harus fail-closed ketika child process tidak dapat menulis file melewati limit ukuran.

## Decision

Tambahkan benchmark macOS/Linux yang menjalankan child capture di bawah `ulimit -f`, memeriksa output final, staging cleanup, dan integrity rejection. Klaim dibatasi sebagai file-size quota, bukan full filesystem quota.

## Consequence

Quota 65,536 bytes menghasilkan child failure, zero final/staging files, dan integrity rejection. Error SQLite muncul sebagai `disk I/O error` dengan runtime-specific code; observability produksi tetap perlu memetakan error code dan stderr.

Windows quota, full-volume exhaustion, dan crash saat rotation masih menjadi gate berikutnya.
