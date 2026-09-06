# ADR 0023 Verified Archive Retention

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Explicit rotation dapat membuat archive bertambah tanpa batas. Penghapusan harus tidak pernah menghapus package corrupt yang mungkin diperlukan untuk investigasi.

## Decision

Tambahkan pruning eksplisit dengan `keep=N`. Setiap candidate harus lolos integrity inspection sebelum masuk ranking mtime. Hanya verified archive di luar `N` terbaru yang dihapus; candidate invalid/quarantine dipertahankan.

## Consequence

Retention dapat mengendalikan pertumbuhan archive tanpa menghapus evidence corrupt secara diam-diam. Command tidak otomatis dipanggil capture. Dry-run, approval UI, dan cross-filesystem recovery tetap menjadi pekerjaan lanjutan.
