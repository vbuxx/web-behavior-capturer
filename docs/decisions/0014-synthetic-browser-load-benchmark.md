# ADR 0014 Synthetic Browser Load Benchmark

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Package latency benchmark belum mengukur biaya browser runtime. PRD mengusulkan profil hingga 5.000 DOM nodes dan 50 active tracks, sehingga perlu route deterministik untuk membandingkan baseline dan observer.

## Decision

Tambahkan fixture `/load/` dengan 5.000 nodes dan 50 CSS animations, lalu jalankan baseline dan observer context terpisah pada viewport 1280×800. Selama 2 detik, berikan burst scroll/pointer dan ambil metrik CDP JS heap/DOM. Laporkan frame p95, navigation timing, node/track count, memory proxy, dan dropped observer records.

## Consequence

Current machine menunjukkan 0% frame degradation dan zero observer loss pada dua iterasi. Worker dan cross-origin frame readiness terbukti; observer peak JS heap 2,915 MB versus baseline 1,898 MB pada route ini. Hasil ini bukan SLA: peak RSS native (CDP unsupported), visual/asset capture, CDP event volume, atau finalization end-to-end belum tercakup.
