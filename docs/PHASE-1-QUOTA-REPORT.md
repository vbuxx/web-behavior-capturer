# Phase 1 File-Size Quota Report

## Scope

Pada host macOS, benchmark menjalankan capture sebagai child process di bawah `ulimit -f` 128 blocks (65,536 bytes). Ini memberi batas ukuran file OS-level tanpa memenuhi filesystem global.

## Result

Run `pnpm benchmark:quota -- --quota-blocks 128`:

| Metric | Result |
| --- | ---: |
| Platform | macOS |
| File-size quota | 65,536 bytes |
| Child result | non-zero failure |
| Final output files | 0 |
| Staging directories | 0 |
| Integrity inspection | rejected |

Capture gagal saat SQLite writer melewati quota dengan `disk I/O error`, lalu normal cleanup menghapus staging. Tidak ada package parsial yang dipromosikan.

## Limitations

- `ulimit -f` menguji file-size resource limit, bukan filesystem penuh atau disk quota container.
- Error surface bergantung pada writer/runtime; pada run ini SQLite mengembalikan `disk I/O error`, bukan `ENOSPC` eksplisit.
- Platform Windows belum didukung oleh benchmark ini.

## Next gate

Tambahkan temporary filesystem quota yang benar-benar membatasi free blocks, Windows equivalent, dan recovery marker untuk crash di antara rename rotation.
