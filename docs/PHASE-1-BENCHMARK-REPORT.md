# Phase 1 Benchmark Report — Verified Package Latency

## Scope

Benchmark mengukur tiga iterasi pada `artifacts/phase1/latest`: full integrity startup scan, behavior query, bounded evidence query, dan total loop. Ini bukan benchmark browser capture atau resolver CPU.

Package yang diukur berisi 7 target, 13 element, 5 behavior, 306 evidence reference, dan 291 record.

## Result

| Operation | Median | p95 | Target PRD |
| --- | ---: | ---: | --- |
| Integrity startup | 51,348 ms | 111,211 ms | Belum ada target khusus |
| Behavior query | 63,924 ms | 65,829 ms | Query ringkasan `<2 s` |
| Evidence query | 52,262 ms | 56,477 ms | Query `<2 s` |
| Full loop | 166,448 ms | 229,308 ms | Finalisasi `<30 s` |

Semua query masih jauh di bawah target PRD pada package kecil ini. Full loop juga jauh di bawah 30 detik, tetapi belum merepresentasikan capture/finalisasi browser; ini hanya membaca dan memvalidasi paket yang sudah jadi.

## Interpretation

Startup dan setiap query saat ini meng-hash evidence serta memvalidasi contract/index. Pendekatan ini mengutamakan integrity dan kesederhanaan prototype, tetapi akan bertambah linear terhadap jumlah asset. Benchmark tiga iterasi memiliki warm-up dan noise filesystem; angka ini baseline, bukan SLA.

## Next Gate

Bangun synthetic package dengan ukuran mendekati profil PRD: sampai 5.000 DOM nodes, 50 active tracks, dan evidence non-asset mendekati 100 MB. Ukur cold/warm startup, query pagination, concurrent read, peak memory, dan finalization capture terpisah. Setelah itu optimalkan cache revision atau integrity manifest bila target masih terancam.
