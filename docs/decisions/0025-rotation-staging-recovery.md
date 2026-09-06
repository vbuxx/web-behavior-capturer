# ADR 0025 Rotation Staging Recovery

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Copy fallback lintas filesystem tidak atomik end-to-end. Hard crash dapat meninggalkan `.rotation-staging-*` yang bukan package archive valid dan tidak boleh bercampur dengan archive retention.

## Decision

Tambahkan janitor khusus `cleanupRotationStaging` dengan age threshold. Hanya directory dengan prefix `.rotation-staging-` di archive root yang dipindai; expired staging dihapus, active staging dipertahankan. Cleanup dipanggil eksplisit.

Rotation copy fallback juga menulis marker berversi di archive root. Marker diperbarui dengan temporary file + atomic rename pada phase `copying`, `verified`, `promoted`, dan `source_removed`. `recoverRotationMarkers` default dry-run; `--apply` hanya mempromosikan package staging yang lolos integrity inspection dan hanya menghapus source ketika session ID serta checksum index cocok. Artefak corrupt atau mismatch tidak dihapus.

## Consequence

Orphan staging dapat dibersihkan tanpa menghapus archive verified atau current package. Recovery dapat membedakan copy incomplete, archive promoted/source retained, duplicate, dan unresolved marker. Janitor tetap bukan pengganti recovery dan harus dijalankan setelah review dry-run.
