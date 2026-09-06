# ADR 0025 Rotation Staging Recovery

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Copy fallback lintas filesystem tidak atomik end-to-end. Hard crash dapat meninggalkan `.rotation-staging-*` yang bukan package archive valid dan tidak boleh bercampur dengan archive retention.

## Decision

Tambahkan janitor khusus `cleanupRotationStaging` dengan age threshold. Hanya directory dengan prefix `.rotation-staging-` di archive root yang dipindai; expired staging dihapus, active staging dipertahankan. Cleanup dipanggil eksplisit.

## Consequence

Orphan staging dapat dibersihkan tanpa menghapus archive verified atau current package. Metadata marker, dry-run, dan deduplication source/archive masih menjadi pekerjaan berikutnya.
