# ADR 0005 Natural Target Registry

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Fase 0 hanya memasukkan main-frame observer ke Behavior Contract. OOPIF, worker, dan late attach sudah terbukti melalui report diagnostik, tetapi bukti tersebut belum ikut dalam natural capture. Menyatakan target sekadar “ditemukan” tidak cukup: konsumen perlu mengetahui kapan collector mulai bekerja, apakah ada loss, dan apakah riwayat target lengkap.

## Decisions

1. Naikkan Behavior Contract dari schema 1.0.0 ke 1.1.0. `manifest.targetCoverage` menjadi field wajib; artefak Fase 0 tetap disimpan sebagai baseline historis, bukan diam-diam diperlakukan sebagai 1.1.0.
2. Bentuk registry sebagai pohon logical target dengan `targetId` dan `parentTargetId`. Registry saat ini mencakup main frame, nested frame, cross-origin OOPIF, dan dedicated worker.
3. Gunakan `BrowserContext.addInitScript` untuk page-world observer. Karena script dipasang sebelum dokumen, frame yang dapat dievaluasi diberi `coverageStart: document_start` dan dapat berstatus `full`.
4. Pasang worker collector ketika Playwright memunculkan event worker. Karena script worker mungkin sudah berjalan, worker selalu `coverageStart: runtime`, `completeness: partial`, dan gap `worker_start_to_collector_install`.
5. Simpan record count, dropped record, known loss, collector status, dan gap per target. Ringkasan loss manifest harus sama dengan jumlah loss seluruh target dan divalidasi secara deterministik.
6. Petakan clock setiap realm dengan `performance.timeOrigin + performance.now()`. Gunakan midpoint host round-trip dan masukkan setengah round-trip ke estimated error agar serialization latency tidak dianggap clock drift.
7. Pakai `--site-per-process` pada fixture capture agar jalur cross-origin benar-benar menguji OOPIF. Ini keputusan harness Chromium saat ini, bukan janji dukungan semua browser.
8. Jangan mengklaim recursive worker coverage. Worker yang dibuat oleh worker lain belum masuk registry dan dinyatakan sebagai capability unavailable serta gap manifest.

## Consequences

Natural capture sekarang mengeluarkan coverage eksplisit untuk lima target fixture dan tidak lagi bergantung pada technical probe untuk menyatakan struktur target. Contract 1.1.0 tidak dibaca sebagai contract 1.0.0; migrator backward-compatible belum tersedia. Overhead benchmark saat ini mencakup page-world observer pada frame, tetapi belum memasukkan seluruh biaya host registry dan worker installation, sehingga belum menjadi benchmark Fase 1 final.
