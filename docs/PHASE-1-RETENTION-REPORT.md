# Phase 1 Archive Retention Report

## Scope

Retention dijalankan eksplisit pada archive directory. Hanya package yang lolos `inspectSessionPackage` yang dipertimbangkan untuk pruning; package corrupt atau tidak dikenal dipertahankan sebagai quarantine evidence.

## Result

Test membuat dua archive verified dan satu archive corrupt, lalu menjalankan `keep=1`:

- 3 directory scanned;
- 2 verified;
- 1 verified terbaru retained;
- 1 verified lama removed;
- 1 corrupt quarantined dan tidak dihapus.

## Usage

```bash
pnpm run prune:archives -- \
  --archive-dir .wbc/archive \
  --keep 5
```

Pruning tidak otomatis dipanggil oleh capture dan tidak menyentuh package current.

## Limitations

- Retention menggunakan directory mtime sebagai urutan usia.
- Tidak ada dry-run atau approval UI; command harus dijalankan eksplisit pada archive directory yang tepat.
- Cross-filesystem archive dan recovery marker rename masih belum ditangani.
