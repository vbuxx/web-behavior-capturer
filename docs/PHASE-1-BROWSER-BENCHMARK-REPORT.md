# Phase 1 Browser Benchmark Report — Synthetic Route Load

## Scope

Benchmark ini menguji natural browser runtime, bukan hanya membaca SQLite package. Fixture synthetic membuat 5.000 node load dan 50 CSS animations aktif. Run membandingkan route tanpa page observer dan dengan observer yang sama dipakai capture.

## Result

Run pada Chromium headless, viewport 1280×800, dua iterasi:

| Metric | Result |
| --- | ---: |
| DOM nodes observed | 5.011 |
| Active tracks | 50 |
| Baseline frame p95 | 16,8 ms |
| Observer frame p95 | 16,8 ms |
| Measured degradation | 0% |
| Baseline navigation | 569,740 ms |
| Observer navigation | 555,579 ms |
| Dropped observer records | 0 |

Nilai navigation mencakup route load dan `networkidle`, bukan full capture compiler. Selisih navigation yang lebih rendah dengan observer adalah noise pengukuran, bukan klaim observer mempercepat halaman.

## Interpretation

Slice ini memenuhi bentuk awal profil browser PRD—sekitar 5.000 DOM nodes dan 50 active tracks—tanpa frame degradation terukur pada mesin saat ini. Ini belum mengukur visual screenshot cost, CDP animation event volume, worker/OOPIF traffic, memory/RSS, atau sustained 5-minute route.

## Next Gate

Tambahkan pengukuran peak RSS/heap, sustained animation selama beberapa menit, scroll/input burst, dan kombinasi iframe/worker. Setelah itu bandingkan capture finalization time end-to-end, bukan hanya navigation dan observer frame interval.
