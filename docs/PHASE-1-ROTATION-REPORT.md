# Phase 1 Package Rotation Report

## Scope

Atomic capture promotion tidak menimpa package lama yang masih ada. Command rotation memvalidasi package lama lebih dulu, lalu memindahkannya ke archive directory pada filesystem yang sama sebelum capture baru dijalankan.

## Result

Test menyalin `artifacts/phase1/latest` ke temporary package, menjalankan rotation, lalu memverifikasi:

- package source tidak lagi tersedia di lokasi current;
- satu archive directory dibuat dengan session ID dan unique suffix;
- archive package tetap lolos `inspectSessionPackage` dan memiliki lima behavior;
- package yang invalid tidak akan melewati tahap rotation karena integrity inspection dijalankan sebelum rename.

## Usage

```bash
pnpm run rotate:package -- \
  --package .wbc/phase1 \
  --archive-dir .wbc/archive
```

Archive directory harus berada di luar source package dan pada filesystem yang sama agar rename atomik dapat dilakukan.

## Limitations

- Rotation bersifat eksplisit, bukan otomatis pada setiap capture.
- Tidak ada retention/TTL policy untuk archive lama.
- Cross-filesystem archive menghasilkan rename failure dan tidak menghapus source.
- Hard crash tepat di antara rename source dan archive masih memerlukan janitor/recovery marker khusus.

## Next gate

Tambahkan retention policy, cross-filesystem copy fallback yang checksum-verifiable, dan disk-quota test pada temporary volume.
