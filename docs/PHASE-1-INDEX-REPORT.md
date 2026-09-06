# Phase 1 Index Report — Reopenable Session Package

Status: completed. Persistence redaction continues in [PHASE-1-REDACTION-REPORT.md](PHASE-1-REDACTION-REPORT.md).

## Outcome

Natural capture sekarang menghasilkan `session.sqlite` dan `session-index.json` di samping Behavior Contract dan evidence. Paket dapat dibuka kembali melalui CLI tanpa mengunjungi fixture sumber. Inspection menolak paket sebelum query jika checksum, schema, semantic reference, metadata, atau row count tidak konsisten.

Artefak terakhir berukuran sekitar 572 KB. SQLite berukuran 252 KB dan mengindeks 7 target epoch, 13 element, 5 behavior, 306 evidence reference, serta 291 normalized record.

## Indexed Data

- session ID, contract schema version, dan product version;
- seluruh target/navigation epoch beserta lifecycle serta completeness;
- Behavior Contract lengkap dan ringkasan behavior;
- evidence path, media type, dan checksum;
- normalized input, page, WAAPI, CDP, adapter, dan lifecycle records.

Query behavior mendukung filter kind, limit 1–100, dan offset. Evidence query berbujet dilanjutkan pada [PHASE-1-QUERY-REPORT.md](PHASE-1-QUERY-REPORT.md). SQLite dibuka read-only setelah integrity inspection berhasil.

## Verification

- Capture test membuka ulang paket dan mencocokkan jumlah target, behavior, evidence, dan record terhadap Behavior Contract.
- Query `gsap_scrub` hanya mengembalikan behavior scrub yang diharapkan.
- Penambahan byte pada SQLite mengubah checksum dan membuat inspection gagal.
- Evidence JSONL tampering tetap membuat verifier gagal.
- Buffer-loss injection menghasilkan index yang konsisten dengan quality manifest.

## Limitations and Next Gate

- `node:sqlite` masih experimental pada runtime lokal; driver belum layak dianggap API distribusi final.
- Session index belum memiliki revision, cancellation, atau concurrent writer.
- Evidence range, target filter, dan pagination cursor tersedia pada slice berikutnya; revision concurrency lintas writer belum tersedia.
- Tidak ada redaction policy sebelum payload masuk JSONL/SQLite.
- Database bukan source of truth; ia dibangun dari contract dan evidence agar dapat diganti.

Gate berikutnya adalah redaction sebelum persistence dan evidence query dengan byte/record budget. Setelah data boundary aman, service layer yang sama dapat digunakan oleh CLI, MCP, dan viewer.
