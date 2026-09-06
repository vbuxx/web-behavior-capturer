# ADR 0004 Target Coverage and Late Attach

Status: accepted for Phase 0.5
Date: 5 September 2026

## Context

Target discovery saja tidak membuktikan bahwa evidence dapat dikumpulkan dari proses anak. Selain itu, collector yang dipasang setelah halaman berjalan tidak dapat merekonstruksi lifecycle yang telah selesai. Kedua keadaan harus dilaporkan eksplisit agar paket tidak memberi kesan capture lengkap.

## Decisions

1. Paksa isolasi situs hanya pada technical probe dengan Chromium `--site-per-process`, sehingga cross-origin iframe benar-benar muncul sebagai target OOPIF terpisah.
2. Probe OOPIF lulus hanya jika frame siap, target bertipe `iframe` ditemukan oleh CDP, dan ekspresi collector dapat dipasang melalui child CDP session.
3. Discovery worker dan OOPIF dicatat terpisah dari keberhasilan collector. Satu keberhasilan child frame tidak berarti recursive worker coverage.
4. Late attach diuji setelah animasi 64 ms tanpa fill selesai. Jika tidak ada active animation atau lifecycle historis, report wajib menandai `completeness: partial` dan gap `page_load_to_attach`.
5. Navigation race lulus hanya jika kedua URL diamati, node epoch lama terinvalidasi, dan dokumen akhir memiliki epoch baru. Identity DOM tidak boleh dibawa melewati navigasi.
6. Semua hasil ini tetap `mode: diagnostic`. Natural Behavior Contract tidak boleh mengklaim coverage OOPIF/worker sampai target registry, clock mapping, buffer, dan loss accounting terintegrasi ke capture utama.

## Consequences

Technical probe kini membuktikan mekanisme dasar lintas target tanpa memperbesar klaim natural capture. Coverage menjadi per-target dan late attach memiliki gap eksplisit. Langkah implementasi berikutnya adalah target registry rekursif dengan status attach, source clock mapping, serta loss range per target; bukan langsung menambahkan lebih banyak pola animasi.
