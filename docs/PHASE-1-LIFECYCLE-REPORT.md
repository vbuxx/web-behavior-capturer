# Phase 1 Lifecycle Report — Navigation Epoch and Detach

Status: completed. Reopenable evidence indexing continues in [PHASE-1-INDEX-REPORT.md](PHASE-1-INDEX-REPORT.md).

## Outcome

Natural target registry sekarang mempertahankan histori dokumen ketika iframe bernavigasi dan kemudian dilepas. Behavior Contract 1.2.0 mengeluarkan tujuh target coverage: empat target frame aktif, dua epoch historis dari satu logical lifecycle frame, dan satu dedicated worker.

Epoch A tersimpan dengan status `navigated`; epoch B memakai logical frame yang sama tetapi target/navigation ID baru dan berakhir dengan status `detached`. Keduanya memiliki attach time, coverage end, detach time, dan gap eksplisit. Element identity tidak digunakan ulang lintas epoch.

## Contract Rules

- Active target tidak boleh memiliki detach atau coverage-end boundary.
- Navigated/detached target wajib partial, memiliki kedua end boundary, dan sedikitnya satu gap.
- Coverage end tidak boleh lebih lambat daripada detach time.
- Target ID dan navigation ID harus unik.
- Parent target wajib tersedia di paket.
- Loss summary sesi harus sama dengan jumlah dropped record seluruh epoch.

## Verification

Automated test menjalankan capture nyata, memicu iframe A → B, mengambil checkpoint, melepas iframe B, lalu memeriksa kedua epoch. Lima behavior utama tetap diverifikasi pada fresh reference dan independent replica page. Loss injection, checksum tampering, schema failure, dan technical probe tetap dijalankan sebagai regression gate.

## Limitations and Next Gate

- Coverage archived target berakhir pada checkpoint terakhir, bukan tepat pada lifecycle event. Gap tetap eksplisit.
- Buffer belum streaming ke host, sehingga arbitrary navigation yang terjadi tanpa checkpoint dapat menyisakan rentang unknown lebih besar.
- Main-page multi-navigation belum menjadi acceptance fixture.
- Element index masih hanya untuk main frame dan memakai `data-wbc-id`.
- Worker child recursion dan generic worker owner attribution belum tersedia.

Gate berikutnya adalah host-streaming evidence transport atau flush-on-lifecycle yang dapat memperkecil gap, diikuti element registry yang scoped oleh target/navigation epoch. Setelah identity stabil, implementasi bergerak ke reopenable evidence index dan redaction.
