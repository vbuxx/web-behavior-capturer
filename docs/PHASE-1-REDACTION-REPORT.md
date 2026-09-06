# Phase 1 Redaction Report — Pre-Persistence Boundary

Status: completed. Agent-facing evidence retrieval continues in [PHASE-1-QUERY-REPORT.md](PHASE-1-QUERY-REPORT.md).

## Outcome

Capture pipeline sekarang meredaksi structured sensitive values sebelum data masuk evidence JSONL, Behavior Contract, atau SQLite. Contract schema 1.3.0 menyimpan policy version, replacement marker, jumlah replacement, dan kategori yang terdeteksi.

## Supported Patterns

- credential, password, secret, API key, dan token fields;
- authorization, cookie, dan session fields;
- email field sebagai personal data;
- header-style object dengan pasangan `name` dan `value`;
- bearer credential pada string tanpa key khusus;
- credential query parameters pada absolute atau relative URL.

## Verification

Unit tests membuktikan nested object tidak dimutasi, safe field dipertahankan, lima kategori sensitif diganti, URL non-sensitive parameter tetap tersedia, dan bearer token tanpa label tetap dihapus.

Natural fixture menambahkan token palsu pada URL OOPIF. End-to-end test memastikan `fixture-secret` tidak muncul di serialized contract, events JSONL, maupun bytes SQLite. Manifest harus melaporkan sedikitnya satu token replacement.

## Remaining Risk

- Screenshot dan visual asset belum di-OCR atau di-blur.
- Arbitrary text node tidak dipindai untuk menghindari perubahan makna dan biaya besar tanpa policy yang jelas.
- Encoded, encrypted, binary, atau application-specific secret dapat lolos.
- Redaction policy belum dapat dikonfigurasi per organisasi atau route.
- Network request/response body belum menjadi capture channel pada prototype ini.

Gate berikutnya adalah evidence query dengan target/time/type filter, cursor, serta batas record dan byte. Query harus hanya membaca data yang sudah melewati redaction boundary.
