# Phase 1 Package Rotation Report

## Scope

Atomic capture promotion tidak menimpa package lama yang masih ada. Command rotation memvalidasi package lama lebih dulu, lalu memindahkannya ke archive directory sebelum capture baru dijalankan. Rename digunakan pada filesystem yang sama; fallback copy memverifikasi archive sebelum source dihapus.

## Result

Test menyalin `artifacts/phase1/latest` ke temporary package, menjalankan rotation, lalu memverifikasi:

- package source tidak lagi tersedia di lokasi current;
- satu archive directory dibuat dengan session ID dan unique suffix;
- archive package tetap lolos `inspectSessionPackage` dan memiliki lima behavior;
- copy fallback juga memverifikasi staging dan archive destination sebelum menghapus source;
- package yang invalid tidak akan melewati tahap rotation karena integrity inspection dijalankan sebelum rename.

## Usage

```bash
pnpm run rotate:package -- \
  --package .wbc/phase1 \
  --archive-dir .wbc/archive
```

Archive directory harus berada di luar source package. Rename atomik dipakai bila filesystem sama; cross-filesystem fallback menggunakan copy + verify + remove.

## Limitations

- Rotation bersifat eksplisit, bukan otomatis pada setiap capture.
- Tidak ada retention/TTL policy untuk archive lama.
- Hard crash saat copy fallback dapat meninggalkan `.rotation-staging-*` yang perlu dijanitor.
- Hard crash tepat di antara rename source dan archive masih memerlukan janitor/recovery marker khusus.

## Next gate

Tambahkan retention policy untuk rotation staging, dry-run, dan recovery marker untuk copy yang terinterupsi.
