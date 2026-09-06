# ADR 0010 Target Scoped Element Identity

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Element index sebelumnya hanya membaca main frame dan menyimpan satu selector. ID tersebut tidak cukup untuk iframe, dokumen yang sudah bernavigasi, atau selector yang cocok ke beberapa node. Raw visible text dapat membantu locator, tetapi belum aman disimpan sebelum visual/text redaction tersedia.

## Decisions

1. Naikkan Behavior Contract ke schema 1.4.0. Setiap element wajib memiliki target ID, navigation ID, frame kind, document coordinate space, instance ordinal, locator candidates, dan ambiguity report.
2. Ambil element snapshot bersama target checkpoint. Karena snapshot disimpan pada target history, element dari navigated dan detached document tetap tersedia setelah frame hilang.
3. Pertahankan main-frame ID yang sudah digunakan behavior (`nav-1:main:<data-id>`). Child element ID memasukkan target/navigation epoch; duplicate data ID mendapat ordinal.
4. Kandidat locator awal adalah `data-wbc-id`, DOM ID, dan inferred/explicit role. Kandidat unik diprioritaskan sebelum score dasar yang lebih tinggi tetapi ambigu.
5. Simpan match count per kandidat. Preferred locator dan element ambiguity harus konsisten dan diperiksa semantic validator.
6. Jangan simpan raw visible text atau accessible name sebagai kandidat pada slice ini. Text locator diberi capability unavailable sampai redaction policy yang kompatibel tersedia.
7. Tambahkan tabel element ke SQLite dan naikkan session-index manifest ke schema 1.1.0 agar row count ikut diverifikasi.

## Consequences

Contract terakhir memuat element dari main frame, nested frame, OOPIF, serta kedua lifecycle epoch. Duplicate fixture menghasilkan dua element berstatus ambiguous dengan ordinal berbeda, sehingga ambiguity tidak disembunyikan. Ordinal dapat berubah bila DOM direorder; resolver geometry/ancestry dan confidence calibration masih diperlukan untuk website nyata.
