# Phase 1 Rotation-Staging Recovery Report

## Scope

Cross-filesystem rotation menggunakan `.rotation-staging-*` sebelum archive promotion. Janitor khusus rotation membersihkan directory staging yang melewati threshold umur, tanpa menyentuh archive verified atau package current.

## Result

Test membuat satu staging expired dan satu staging active dengan `keep`-independent cleanup:

- 2 staging directories scanned;
- 1 expired removed;
- 1 active retained.

## Usage

```bash
pnpm run cleanup:rotation -- \
  --archive-dir .wbc/archive \
  --max-age-ms 86400000
```

Cleanup tidak otomatis dijalankan oleh rotation; operator atau scheduler harus memanggilnya eksplisit.

## Limitations

- Age threshold adalah safety heuristic; belum ada recovery marker berisi source/session metadata.
- Staging yang sedang aktif lebih lama dari threshold dapat terhapus jika operator memilih threshold terlalu kecil.
- Jika archive sudah dipromosikan tetapi source belum terhapus, janitor tidak melakukan deduplication otomatis.

## Next gate

Tambahkan rotation manifest marker, dry-run, dan recovery decision yang membedakan copy incomplete dari archive promoted/source retained.
