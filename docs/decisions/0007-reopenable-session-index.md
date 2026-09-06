# ADR 0007 Reopenable Session Index

Status: accepted provisionally for Phase 1
Date: 6 September 2026

## Context

Behavior Contract dan JSONL sudah portabel, tetapi query harus membaca seluruh JSON dan belum membuktikan bahwa sesi dapat dibuka kembali secara konsisten. PRD mengusulkan SQLite untuk indeks sesi. Menambah native addon pada spike memperbesar risiko instalasi, sedangkan runtime lokal menyediakan `node:sqlite`.

## Decisions

1. Buat `session.sqlite` setelah contract dan evidence selesai ditulis. Database berisi metadata sesi, target, behavior, evidence reference, dan normalized event record.
2. Gunakan `node:sqlite` agar tidak menambah native package atau binary vendor. Requirement runtime dinaikkan menjadi Node.js 22.5 atau lebih baru, versi pertama yang menyediakan modul tersebut.
3. Tandai keputusan ini provisional karena runtime masih menampilkan ExperimentalWarning. Sebelum rilis, evaluasi stabilitas API dan pilihan driver dengan benchmark serta portability test.
4. Simpan `session-index.json` terpisah dengan checksum database dan Behavior Contract serta expected row counts. Database tidak dimasukkan ke evidence index contract untuk menghindari checksum dependency melingkar.
5. Perintah `inspect` harus memvalidasi schema manifest, checksum database/contract, schema dan semantics contract, checksum seluruh evidence file, metadata sesi, dan row counts sebelum mengembalikan hasil.
6. Semua path dari manifest harus relatif dan tetap berada di package directory. Absolute path serta traversal keluar package ditolak.
7. Query awal hanya read-only behavior listing dengan kind filter, limit maksimal 100, dan offset. Ini fondasi CLI query, bukan pengganti MCP/pagination revision semantics.

## Consequences

Paket dapat dibuka kembali dan diaudit tanpa website sumber. Kerusakan pada SQLite, contract, atau evidence menggagalkan inspection. Sidecar menambah ukuran paket dan bergantung pada API experimental; karena JSON/JSONL tetap source of truth, sidecar dapat dibangun ulang atau diganti driver tanpa mengubah Behavior Contract.
