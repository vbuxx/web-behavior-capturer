# ADR 0013 Package Latency Benchmark

Status: accepted for Phase 1
Date: 6 September 2026

## Context

PRD mengusulkan query p95 di bawah 2 detik dan finalisasi di bawah 30 detik, tetapi sebelumnya belum ada pengukuran reproducible pada session package.

## Decision

Tambahkan command `pnpm run benchmark` yang mengukur full integrity startup, behavior query, bounded evidence query, dan total loop dengan median/p95. Benchmark membaca package terverifikasi dan tidak mengubah artifact.

## Consequence

Current package baseline memenuhi target query dengan margin besar. Angka belum dapat digeneralisasi ke package 100 MB atau capture browser finalization; synthetic load benchmark menjadi gate sebelum optimasi storage atau caching.
