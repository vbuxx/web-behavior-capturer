# ADR 0012 Loopback Review Service

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Session index sudah dapat dibuka lewat CLI, tetapi arsitektur produk juga membutuhkan jalur viewer/review. Slice ini perlu memberi manusia ringkasan yang dapat diperiksa tanpa memperluas trust boundary menjadi network service umum.

## Decisions

1. Tambahkan server HTTP native Node.js tanpa framework baru.
2. Bind eksklusif ke `127.0.0.1`; tidak ada opsi host publik.
3. Jalankan full package integrity verification sebelum port mulai menerima request.
4. Batasi API ke GET: `/api/session`, `/api/behaviors`, dan `/api/evidence`. Method lain mendapat 405 dan route lain 404.
5. Gunakan query SQLite read-only yang sudah ada. Evidence tetap dibatasi maksimum 100 record dan 1 MiB per page, dengan cursor terikat revision/filter.
6. Sajikan hanya tiga asset viewer yang terdaftar eksplisit. Tidak ada generic filesystem route.
7. Terapkan CSP self-only, `nosniff`, frame denial, dan `no-store`.
8. Render seluruh data dinamis dengan `textContent`; viewer tidak menyuntik payload evidence sebagai HTML.

## Consequences

Paket release dapat direview dari browser lokal setelah checksum contract, database, dan evidence lolos. Startup melakukan hashing seluruh evidence; query behavior/evidence saat ini kembali menjalankan integrity inspection sehingga aman tetapi belum efisien untuk session besar. Viewer belum menampilkan screenshot, provenance chain interaktif, comparison overlay, atau action mutation.
