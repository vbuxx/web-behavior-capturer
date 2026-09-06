# Phase 1 Query Report — Budgeted Evidence Retrieval

## Outcome

CLI sekarang menyediakan evidence retrieval dari verified session package. Hasil dapat difilter berdasarkan source target, event type, target reference, dan inclusive source-time range. Setiap page memiliki record limit, byte budget, immutable revision, dan opaque continuation cursor.

## Verification

- Page pertama dengan limit dua mengembalikan dua record dan cursor.
- Cursor berikutnya mengembalikan record berbeda tanpa mengulang page pertama.
- Cursor yang dipakai dengan filter berbeda ditolak.
- Query mutation untuk OOPIF hanya mengembalikan source target yang diminta.
- Byte budget yang lebih kecil daripada record pertama gagal eksplisit.
- Integrity inspection tetap mendahului query, sehingga database atau evidence yang berubah tidak dapat dibaca memakai cursor lama.

## Current API Boundary

Default page berisi maksimal 50 record dan 64 KB. Hard limit adalah 100 record dan 1 MB. Response melaporkan checksum database sebagai revision, byte aktual, penyebab truncation, serta cursor berikutnya bila masih ada data.

## Remaining Limitations and Next Gate

- Pagination memakai offset dan ditujukan untuk immutable package; live capture membutuhkan revision snapshot serta keyset cursor.
- Query belum mencakup visual asset crop atau clip range.
- Source-time filter tidak otomatis mengubah clock realm; caller perlu memakai source target yang sama.
- CLI belum memakai service/job manager bersama MCP.

Gate Fase 1 berikutnya adalah element registry lintas frame/navigation dengan locator candidates dan ambiguity report. Sesudah itu, capture/query dapat dibungkus dalam service layer yang dipakai bersama CLI, MCP, dan viewer.
