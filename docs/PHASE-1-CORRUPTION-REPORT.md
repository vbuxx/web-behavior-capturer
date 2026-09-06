# Phase 1 Corruption-Rejection Report

## Scope

Benchmark ini menyalin package terverifikasi ke temporary directory, merusak satu artefak per case, lalu menjalankan `inspectSessionPackage`. Package sumber tidak pernah dimutasi.

## Result

Run `pnpm benchmark:corruption` terhadap `artifacts/phase1/latest`:

| Case | Mutation | Result |
| --- | --- | --- |
| Contract | append bytes to `behavior-contract.json` | rejected: contract checksum |
| Session index | append bytes to `session.sqlite` | rejected: session index checksum |
| Event evidence | append line to `evidence/events.jsonl` | rejected: evidence checksum |
| Visual evidence | append byte to a PNG checkpoint | rejected: evidence checksum |

Source package tetap `verified` setelah seluruh case selesai.

## Limitations

- Mutation dilakukan setelah package selesai, bukan partial SQLite page write saat process crash.
- Belum ada repair otomatis; recovery saat ini berupa menolak package dan mempertahankan source artifact yang tidak berubah.
- Corruption pada `technical-probe-report.json` atau verification report belum termasuk manifest integrity karena file tersebut bukan dependency contract/index.

## Next gate

Tambahkan package rotation policy yang eksplisit, disk quota nyata pada temporary volume, dan quarantine/repair workflow untuk package rusak.
