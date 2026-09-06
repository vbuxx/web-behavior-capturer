# ADR 0009 Budgeted Evidence Query

Status: accepted for Phase 1
Date: 6 September 2026

## Context

Agent tidak boleh menerima seluruh raw event stream ketika hanya memerlukan bukti tertentu. Query juga perlu pagination yang konsisten terhadap immutable package, serta batas byte agar satu record besar tidak melampaui budget tanpa terlihat.

## Decisions

1. Tambahkan read-only evidence query di atas verified SQLite sidecar. Setiap query menjalankan package integrity inspection sebelum membaca record.
2. Dukung filter `sourceTargetId`, event `type`, `targetRef`, dan inclusive source-time range. Source-time range sebaiknya dipakai bersama source target karena clock realm berbeda.
3. Batasi satu page maksimal 100 record dan 1 MB. Default adalah 50 record dan 64 KB.
4. Cursor adalah base64url payload yang memuat database checksum revision, normalized filter signature, dan offset berikutnya.
5. Tolak cursor jika revision berubah atau filter berbeda. Limit dan byte budget boleh berubah antar-page karena tidak mengubah himpunan hasil.
6. Jika record pertama saja melebihi byte budget, gagal secara eksplisit dan minta budget lebih besar; jangan melewati record secara diam-diam.
7. Laporkan `returnedBytes`, `nextCursor`, dan apakah page dipotong oleh batas record atau byte.

## Consequences

Agent dapat mengambil subset evidence yang stabil dan berbujet tanpa membaca JSONL penuh. Offset cursor cukup untuk immutable package ini, tetapi belum sesuai untuk concurrent writer atau revision yang bertambah selama capture. Cursor revision dan snapshot semantics service perlu diperluas ketika live query dibangun.
