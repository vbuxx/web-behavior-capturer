# Phase 1 Browser Benchmark Report — Synthetic Route Load

## Scope

Benchmark ini menguji natural browser runtime, bukan hanya membaca SQLite package. Fixture synthetic membuat 5.000 node load dan 50 CSS animations aktif. Run membandingkan route tanpa page observer dan dengan observer yang sama dipakai capture.

## Result

Run pada Chromium headless, viewport 1280×800, dua iterasi. Setiap iterasi menjalankan sustained animation selama 2 detik dengan burst scroll dan pointer:

| Metric | Result |
| --- | ---: |
| DOM nodes observed | 5.012 |
| Active tracks | 50 |
| Baseline frame p95 | 16,8 ms |
| Observer frame p95 | 16,8 ms |
| Measured degradation | 0% |
| Baseline navigation | 693,708 ms |
| Observer navigation | 630,689 ms |
| Dropped observer records | 0 |
| Baseline peak JS heap | 1.898 MB |
| Observer peak JS heap | 2.915 MB |
| Baseline peak CDP DOM nodes | 10.043 |
| Observer peak CDP DOM nodes | 10.062 |
| Baseline scroll events | 17 |
| Observer scroll events | 19 |
| Baseline pointer bursts | 18 |
| Observer pointer bursts | 20 |
| Baseline worker messages | 2 |
| Observer worker messages | 2 |
| Cross-origin frame ready | yes / yes |

Nilai navigation mencakup route load dan `networkidle`, bukan full capture compiler. Selisih navigation yang lebih rendah dengan observer adalah noise pengukuran, bukan klaim observer mempercepat halaman.

## Interpretation

Slice ini memenuhi bentuk awal profil browser PRD—sekitar 5.000 DOM nodes dan 50 active tracks—tanpa frame degradation terukur pada mesin saat ini. Worker dan cross-origin frame aktif pada baseline maupun observer. Heap observer naik sekitar 1,02 MB pada run ini; angka tersebut adalah peak JS heap, bukan peak RSS, dan belum dipakai sebagai SLA. Scroll/pointer burst tetap tidak menghasilkan observer loss.

Chrome headless pada environment ini tidak mengembalikan private-memory process metrics melalui `SystemInfo.getProcessInfo`; kolom process RSS dilaporkan unsupported, bukan diganti dengan angka perkiraan.

## Next Gate

Tambahkan peak RSS native process melalui collector OS yang terpisah, sustained animation beberapa menit, dan CDP event volume. Setelah itu bandingkan capture finalization time end-to-end, bukan hanya navigation dan observer frame interval.
