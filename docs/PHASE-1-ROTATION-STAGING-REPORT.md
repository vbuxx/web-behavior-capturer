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

## Recovery marker

Copy fallback kini membuat `.rotation-marker-<id>.json` dengan schema `1.0.0` dan phase `copying → verified → promoted → source_removed`. Marker ditulis melalui temporary file lalu atomic rename. Recovery dipisahkan dari janitor:

```bash
pnpm run recover:rotation -- --archive-dir .wbc/archive
pnpm run recover:rotation -- --archive-dir .wbc/archive --apply
```

Default adalah dry-run. `--apply` hanya mempromosikan staging yang lolos inspection, atau menghapus source ketika archive sudah verified dan session ID serta checksum `session-index.json` identik. Marker/package corrupt atau checksum mismatch dilaporkan sebagai `quarantine` dan tidak dihapus.

## Limitations

- Marker tidak membuat copy lintas filesystem menjadi atomik; hard crash dapat tetap meninggalkan artefak yang memerlukan keputusan operator.
- Staging yang sedang aktif lebih lama dari threshold dapat terhapus jika operator memilih threshold janitor terlalu kecil; gunakan recovery marker lebih dulu.
