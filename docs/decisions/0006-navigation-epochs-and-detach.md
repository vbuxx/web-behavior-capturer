# ADR 0006 Navigation Epochs and Detach

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Satu `Frame` Playwright dapat bertahan ketika dokumennya berganti. Jika registry hanya menyimpan frame aktif terakhir, evidence dokumen lama tertimpa dan element identity berisiko dibawa melewati navigasi. Frame juga dapat dilepas sebelum buffer akhirnya dibaca.

## Decisions

1. Naikkan Behavior Contract ke schema 1.2.0. Setiap target coverage wajib mempunyai `navigationId`, nomor `epoch`, dan `lifecycleStatus`.
2. Pertahankan logical frame ID ketika frame bernavigasi, tetapi buat target ID dan navigation ID baru untuk setiap document epoch. Dokumen lama tetap berada dalam contract dengan status `navigated`.
3. Target yang dilepas tetap diekspor dengan status `detached`, `detachedAt`, dan `coverageEnd`.
4. Ambil checkpoint sebelum operasi lifecycle yang dikendalikan fixture. Untuk target yang bernavigasi atau detach, coverage berakhir pada checkpoint terakhir; interval dari checkpoint ke event diberi gap `checkpoint_to_navigation_unobserved` atau `checkpoint_to_detach_unobserved`.
5. Archived target selalu `partial`. Nilai ini tidak dinaikkan menjadi `full` hanya karena checkpoint berada dekat dengan event.
6. Semantic validator menolak duplicate target/navigation ID, parent yang hilang, active target dengan end boundary, archived target tanpa boundary/gap, dan coverage end setelah detach.
7. Rekam lifecycle request sebagai evidence. Proses navigasi tetap natural—tanpa pause, seek, atau clock modification—tetapi skenarionya dikendalikan agar hasil dapat diuji deterministik.
8. Pada navigation-race probe, nilai node lama terhadap execution context aktif. `isConnected` di handle lama tidak cukup karena BFCache dapat mempertahankan dokumen lama dalam keadaan connected tetapi tidak aktif.

## Consequences

Registry tidak lagi menimpa dokumen lama. Fixture terakhir menghasilkan dua epoch untuk logical lifecycle frame: epoch pertama berakhir sebagai `navigated`, epoch kedua sebagai `detached`. Karena collector masih memakai buffer realm yang dibaca berkala, beberapa milidetik terakhir sebelum navigation/detach dinyatakan unknown. Host-streaming transport diperlukan untuk memperkecil atau menutup gap ini.
