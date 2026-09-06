# ADR 0015 Capture Finalization Benchmark

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Package query benchmark dan browser runtime benchmark belum mengukur waktu lengkap dari natural capture sampai contract/index yang dapat dibuka kembali.

## Decision

Tambahkan `benchmark:capture` yang menjalankan `captureSession` pada temporary package, mengukur wall-clock sampai `inspectSessionPackage` selesai, mencatat quality/size/counts, lalu menghapus package. Benchmark tidak menimpa artifact release.

## Consequence

Fixture capture saat ini selesai dalam 9,626 detik dengan zero loss dan masih di bawah target finalisasi 30 detik. Hasil belum mewakili route besar, multi-session, crash recovery, atau sustained capture; gate tersebut tetap diperlukan sebelum klaim performance release.
