# ADR 0012 Loopback Review Service

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Session index sudah dapat dibuka lewat CLI, tetapi arsitektur produk juga membutuhkan jalur viewer/review. Slice ini perlu memberi manusia ringkasan yang dapat diperiksa tanpa memperluas trust boundary menjadi network service umum.

## Decisions

1. Tambahkan server HTTP native Node.js tanpa framework baru.
2. Bind eksklusif ke `127.0.0.1`; tidak ada opsi host publik.
3. Jalankan full package integrity verification sebelum port mulai menerima request.
4. Batasi API ke GET: `/api/session`, `/api/behaviors`, `/api/evidence`, `/api/visuals`, dan `/api/visual/:evidenceId`. Method lain mendapat 405 dan route lain 404.
5. Gunakan query SQLite read-only yang sudah ada. Evidence tetap dibatasi maksimum 100 record dan 1 MiB per page, dengan cursor terikat revision/filter.
6. Sajikan hanya tiga asset viewer yang terdaftar eksplisit. Tidak ada generic filesystem route.
7. Terapkan CSP self-only, `nosniff`, frame denial, dan `no-store`.
8. Asset visual hanya boleh diakses melalui evidence ID dengan media type `image/png`; path harus tetap di dalam package dan SHA-256 harus diverifikasi ulang sebelum bytes dikirim.
9. Render seluruh data dinamis dengan `textContent`; viewer tidak menyuntik payload evidence sebagai HTML.

## Consequences

Paket release dapat direview dari browser lokal setelah checksum contract, database, dan evidence lolos. Visual evidence dapat dilihat tanpa membuka arbitrary path. Startup dan setiap query melakukan integrity inspection sehingga aman tetapi belum efisien untuk session besar. Viewer belum memiliki provenance chain interaktif, comparison overlay, atau action mutation.
