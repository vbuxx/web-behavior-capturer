# ADR 0026 Versioned Rotation Recovery Marker

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Cross-filesystem rotation tidak memiliki commit point atomik antara copy, archive promotion, dan source removal. Tanpa metadata, recovery tidak dapat membedakan staging partial dari archive verified yang belum menghapus source.

## Decision

Marker JSON `1.0.0` disimpan di archive root, bukan di dalam package yang sedang dipindahkan. Marker memuat source/staging/archive path, session ID, checksum index, timestamp, dan phase `copying`, `verified`, `promoted`, atau `source_removed`. Setiap perubahan marker memakai temporary file dan atomic rename.

Command `rotation-recover` default dry-run. Mode `--apply` bersifat fail-closed: staging hanya dipromosikan setelah inspection dan checksum cocok; source hanya dihapus setelah archive inspection, session ID, dan checksum cocok. Invalid marker, corrupt package, atau mismatch dilaporkan sebagai quarantine dan tidak dihapus.

## Consequence

Recovery menjadi dapat diaudit dan tidak bergantung pada janitor age-based. Marker tetap bukan transaksi lintas filesystem; crash pada titik yang tidak memiliki marker update atomik masih dilaporkan sebagai unresolved, bukan dipaksakan menjadi sukses.
